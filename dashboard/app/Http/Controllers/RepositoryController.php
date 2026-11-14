<?php

namespace App\Http\Controllers;

use App\Exceptions\NyrusException;
use App\Models\AuditLog;
use App\Services\NyrusClient;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\View\View;

/**
 * Repositories nyrus works on and how tickets are routed to them.
 * Changes go to nyrus's config.json, which nyrus picks up without a restart.
 */
class RepositoryController extends Controller
{
    private const NAME = 'regex:/^[\w.-]+$/';

    /** Query parameters the list understands (kept across pages and after saving). */
    public const LIST_PARAMS = ['q', 'source', 'tracker', 'status', 'sort', 'per_page', 'page'];

    private const PER_PAGE = [25, 50, 100, 200];

    private const SORTS = ['name', '-name', 'status', 'source'];

    public function index(Request $request, NyrusClient $nyrus): View
    {
        $repositories = [];
        $error = null;

        try {
            $repositories = $nyrus->config()['repositories'] ?? [];
        } catch (NyrusException $e) {
            $error = $e->getMessage();
        }
        $inbudget = $error ? null : $nyrus->inbudget();
        $inbudgetProjects = $this->inbudgetProjects($repositories, $inbudget);

        $rows = array_map(fn (array $repo) => $this->row($repo, $inbudgetProjects), array_values($repositories));
        $filters = $this->filters($request);
        $facets = $this->facets($rows);
        $matches = $this->sort($this->filter($rows, $filters), $filters['sort']);

        $page = LengthAwarePaginator::resolveCurrentPage();
        $paginator = (new LengthAwarePaginator(
            array_slice($matches, ($page - 1) * $filters['per_page'], $filters['per_page']),
            count($matches),
            $filters['per_page'],
            $page,
            ['path' => $request->url(), 'pageName' => 'page'],
        ))->withQueryString();

        return view('repositories', [
            'repositories' => $paginator,
            'total' => count($rows),
            'filters' => $filters,
            'filtered' => $filters['q'] !== '' || $filters['source'] !== '' || $filters['tracker'] !== '' || $filters['status'] !== '',
            'facets' => $facets,
            'perPageOptions' => self::PER_PAGE,
            'listQuery' => $request->only(self::LIST_PARAMS),
            'error' => $error,
            'inbudget' => $inbudget,
        ]);
    }

    /**
     * Normalised filters from the query string; unknown values fall back to "all".
     *
     * @return array{q: string, source: string, tracker: string, status: string, sort: string, per_page: int}
     */
    private function filters(Request $request): array
    {
        $pick = fn (string $key, array $allowed, string $default = '') => in_array($value = (string) $request->query($key, $default), $allowed, true) ? $value : $default;
        $perPage = (int) $request->query('per_page', 50);

        return [
            'q' => trim(mb_substr((string) $request->query('q', ''), 0, 200)),
            'source' => $pick('source', ['inbudget', 'manual']),
            'tracker' => $pick('tracker', ['jira', 'clickup', 'other']),
            'status' => $pick('status', ['active', 'inactive']),
            'sort' => $pick('sort', self::SORTS, 'name'),
            'per_page' => in_array($perPage, self::PER_PAGE, true) ? $perPage : 50,
        ];
    }

    /**
     * A repository from config.json plus what the list needs to filter, sort and show it.
     *
     * @param  array<string, mixed>  $repo
     * @param  array<string, list<string>>  $inbudgetProjects
     * @return array<string, mixed>
     */
    private function row(array $repo, array $inbudgetProjects): array
    {
        $id = (string) ($repo['id'] ?? '');
        $name = (string) ($repo['name'] ?? $id);
        $managed = str_starts_with($id, 'inbudget-');
        $projects = $inbudgetProjects[$id] ?? [];

        return $repo + [
            '_name' => $name,
            '_managed' => $managed,
            '_tracker' => $this->tracker($id, (string) ($repo['linearWorkspaceId'] ?? '')),
            '_active' => ($repo['isActive'] ?? true) !== false,
            '_projects' => $projects,
            '_search' => mb_strtolower(implode(' ', [
                $name,
                $id,
                (string) ($repo['githubUrl'] ?? ''),
                implode(' ', (array) ($repo['teamKeys'] ?? [])),
                implode(' ', (array) ($repo['projectKeys'] ?? [])),
                implode(' ', (array) ($repo['routingLabels'] ?? [])),
                implode(' ', $projects),
            ])),
        ];
    }

    /** Jira, ClickUp or something else (Linear, ...), from the managed id or the workspace key. */
    private function tracker(string $id, string $workspace): string
    {
        foreach (['jira', 'clickup'] as $tracker) {
            if (($id !== '' && str_starts_with($id, 'inbudget-') && str_ends_with($id, "-{$tracker}"))
                || $workspace === $tracker || str_starts_with($workspace, "{$tracker}-")) {
                return $tracker;
            }
        }

        return 'other';
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  array<string, mixed>  $filters
     * @return list<array<string, mixed>>
     */
    private function filter(array $rows, array $filters): array
    {
        $terms = array_filter(preg_split('/\s+/', mb_strtolower($filters['q'])) ?: []);

        return array_values(array_filter($rows, function (array $row) use ($filters, $terms) {
            if ($filters['source'] !== '' && $row['_managed'] !== ($filters['source'] === 'inbudget')) {
                return false;
            }
            if ($filters['tracker'] !== '' && $row['_tracker'] !== $filters['tracker']) {
                return false;
            }
            if ($filters['status'] !== '' && $row['_active'] !== ($filters['status'] === 'active')) {
                return false;
            }
            foreach ($terms as $term) {
                if (! str_contains($row['_search'], $term)) {
                    return false;
                }
            }

            return true;
        }));
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    private function sort(array $rows, string $sort): array
    {
        $byName = fn (array $a, array $b) => strnatcasecmp($a['_name'], $b['_name']);
        usort($rows, match ($sort) {
            '-name' => fn ($a, $b) => $byName($b, $a),
            'status' => fn ($a, $b) => $b['_active'] <=> $a['_active'] ?: $byName($a, $b),
            'source' => fn ($a, $b) => $a['_managed'] <=> $b['_managed'] ?: $byName($a, $b),
            default => $byName,
        });

        return $rows;
    }

    /**
     * How many repositories each filter option matches (over all repositories).
     *
     * @param  list<array<string, mixed>>  $rows
     * @return array<string, array<string, int>>
     */
    private function facets(array $rows): array
    {
        $facets = [
            'source' => ['inbudget' => 0, 'manual' => 0],
            'tracker' => ['jira' => 0, 'clickup' => 0, 'other' => 0],
            'status' => ['active' => 0, 'inactive' => 0],
        ];
        foreach ($rows as $row) {
            $facets['source'][$row['_managed'] ? 'inbudget' : 'manual']++;
            $facets['tracker'][$row['_tracker']]++;
            $facets['status'][$row['_active'] ? 'active' : 'inactive']++;
        }

        return $facets;
    }

    /**
     * The inBudget projects behind each managed repository, by repository id.
     *
     * @param  list<array<string, mixed>>  $repositories
     * @param  array<string, mixed>|null  $inbudget
     * @return array<string, list<string>>
     */
    private function inbudgetProjects(array $repositories, ?array $inbudget): array
    {
        $wanted = [];
        foreach ($inbudget['repositories'] ?? [] as $entry) {
            $key = 'https://github.com/'.strtolower((string) ($entry['repo'] ?? '')).'|'.($entry['workspaceKey'] ?? '');
            $wanted[$key] = $entry['projects'] ?? [];
        }

        $projects = [];
        foreach ($repositories as $repo) {
            if (! str_starts_with((string) ($repo['id'] ?? ''), 'inbudget-')) {
                continue;
            }
            $key = strtolower(rtrim((string) ($repo['githubUrl'] ?? ''), '/')).'|'.($repo['linearWorkspaceId'] ?? '');
            if (isset($wanted[$key])) {
                $projects[$repo['id']] = $wanted[$key];
            }
        }

        return $projects;
    }

    /** Sync repositories from inBudget now. */
    public function syncInbudget(Request $request, NyrusClient $nyrus): RedirectResponse
    {
        try {
            $status = $nyrus->syncInbudget();
        } catch (NyrusException $e) {
            AuditLog::record('inbudget.sync', 'inbudget', ['error' => $e->getMessage()], success: false);

            return back()->with('error', $e->getMessage());
        }

        $failed = filled($status['error'] ?? null);
        AuditLog::record('inbudget.sync', 'inbudget', array_filter([
            'error' => $status['error'] ?? null,
            'result' => $status['result'] ?? null,
        ]), success: ! $failed);

        return $this->toList($request)->with(
            $failed ? 'error' : 'status',
            match (true) {
                $failed => 'inBudget-Abgleich fehlgeschlagen: '.$status['error'],
                (bool) ($status['running'] ?? false) => 'inBudget-Abgleich läuft noch (Repositories werden geklont). Lade die Seite gleich neu.',
                default => 'Mit inBudget abgeglichen.',
            },
        );
    }

    public function store(Request $request, NyrusClient $nyrus): RedirectResponse
    {
        $data = $request->validate([
            'repository_url' => ['required', 'string', 'max:500', 'regex:/^(https:\/\/|git@)\S+$/'],
            'name' => ['nullable', 'string', 'max:100', self::NAME],
            'baseBranch' => ['nullable', 'string', 'max:200'],
            'projectKeys' => ['nullable', 'string', 'max:1000'],
            'teamKeys' => ['nullable', 'string', 'max:1000'],
            'routingLabels' => ['nullable', 'string', 'max:1000'],
        ]);

        $payload = array_filter([
            'repository_url' => trim($data['repository_url']),
            'name' => $data['name'] ?? null,
            'baseBranch' => $data['baseBranch'] ?? null,
        ]) + $this->lists($data);

        return $this->run(
            $request,
            fn () => $nyrus->addRepository($payload),
            'repository.add',
            $payload['name'] ?? $payload['repository_url'],
            ['url' => $payload['repository_url']] + $this->lists($data),
            'Repository hinzugefügt.',
        );
    }

    public function update(Request $request, NyrusClient $nyrus, string $name): RedirectResponse
    {
        $data = $request->validate([
            'baseBranch' => ['nullable', 'string', 'max:200'],
            'projectKeys' => ['nullable', 'string', 'max:1000'],
            'teamKeys' => ['nullable', 'string', 'max:1000'],
            'routingLabels' => ['nullable', 'string', 'max:1000'],
            'isActive' => ['nullable', 'boolean'],
        ]);

        $payload = ['name' => $name, 'isActive' => $request->boolean('isActive')]
            + array_filter(['baseBranch' => $data['baseBranch'] ?? null])
            + $this->lists($data);

        return $this->run(
            $request,
            fn () => $nyrus->updateRouting($payload),
            'repository.routing',
            $name,
            $payload,
            'Routing gespeichert.',
        );
    }

    public function destroy(Request $request, NyrusClient $nyrus, string $name): RedirectResponse
    {
        $deleteFiles = $request->boolean('deleteFiles');

        return $this->run(
            $request,
            fn () => $nyrus->removeRepository($name, $deleteFiles),
            'repository.remove',
            $name,
            ['deleteFiles' => $deleteFiles],
            $deleteFiles ? 'Repository entfernt und Dateien gelöscht.' : 'Repository aus der Konfiguration entfernt.',
        );
    }

    /**
     * Comma-separated form fields as lists for nyrus.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, list<string>>
     */
    private function lists(array $data): array
    {
        $lists = [];
        foreach (['projectKeys', 'teamKeys', 'routingLabels'] as $field) {
            if (array_key_exists($field, $data)) {
                $lists[$field] = array_values(array_filter(array_map('trim', explode(',', (string) $data[$field]))));
            }
        }

        return $lists;
    }

    /** @param  array<string, mixed>  $details */
    private function run(Request $request, callable $call, string $action, string $subject, array $details, string $success): RedirectResponse
    {
        try {
            $call();
        } catch (NyrusException $e) {
            AuditLog::record($action, $subject, $details + ['error' => $e->getMessage()], success: false);

            return back()->withInput()->with('error', $e->getMessage());
        }

        AuditLog::record($action, $subject, $details);

        return $this->toList($request)->with('status', $success);
    }

    /** Back to the list, on the page and with the filters the form was sent from. */
    private function toList(Request $request): RedirectResponse
    {
        $query = $request->input('_query');
        $query = is_array($query) ? array_filter(
            array_intersect_key($query, array_flip(self::LIST_PARAMS)),
            fn ($value) => is_scalar($value) && (string) $value !== '',
        ) : [];

        return redirect()->route('repositories.index', $query);
    }
}
