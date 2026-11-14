<?php

namespace App\Http\Controllers;

use App\Exceptions\NyrusException;
use App\Models\AuditLog;
use App\Services\NyrusClient;
use App\Services\ProjectOverview;
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
    public const LIST_PARAMS = ['q', 'source', 'tracker', 'status', 'group', 'sort', 'per_page', 'page'];

    private const PER_PAGE = [25, 50, 100, 200];

    private const SORTS = ['name', '-name', 'status', 'source', 'missing', 'group'];

    public function index(Request $request, NyrusClient $nyrus): View
    {
        [$rows, $inbudget, $error, $repositories] = self::load($nyrus);
        $groups = ProjectOverview::groupingEnabled($inbudget) ? ProjectOverview::groups($rows, $inbudget) : [];
        $filters = $this->filters($request, (bool) $groups);
        $matches = $this->sort($this->filter($rows, $filters, $groups), $filters['sort']);

        // the list is paginated by units: a group with its matching repositories, or one repository
        $units = [];
        foreach ($matches as $row) {
            $key = $groups ? $row['group']['key'] : $row['key'];
            $units[$key] ??= ['group' => $groups[$key] ?? null, 'rows' => []];
            $units[$key]['rows'][] = $row;
        }
        $units = array_values($units);
        if ($groups && $filters['sort'] === 'group') {
            usort($units, fn ($a, $b) => $b['group']['size'] <=> $a['group']['size'] ?: strnatcasecmp($a['group']['name'], $b['group']['name']));
        }

        $page = LengthAwarePaginator::resolveCurrentPage();
        $offset = ($page - 1) * $filters['per_page'];
        $paginator = (new LengthAwarePaginator(
            array_slice($units, $offset, $filters['per_page']),
            count($units),
            $filters['per_page'],
            $page,
            ['path' => $request->url(), 'pageName' => 'page'],
        ))->withQueryString();
        $before = array_sum(array_map(fn (array $unit) => count($unit['rows']), array_slice($units, 0, $offset)));
        $shown = array_sum(array_map(fn (array $unit) => count($unit['rows']), $paginator->items()));

        return view('repositories', [
            'units' => $paginator,
            'matchCount' => count($matches),
            'shownFrom' => $shown ? $before + 1 : 0,
            'shownTo' => $before + $shown,
            'total' => count($rows),
            'grouping' => (bool) $groups,
            'filters' => $filters,
            'filtered' => $filters['q'] !== '' || $filters['source'] !== '' || $filters['tracker'] !== '' || $filters['status'] !== '' || $filters['group'] !== '',
            'facets' => $this->facets($rows, $groups),
            'perPageOptions' => self::PER_PAGE,
            'listQuery' => self::listQuery($request),
            'error' => $error,
            'inbudget' => $inbudget,
            'workspaces' => $this->workspaces($repositories, $inbudget),
        ]);
    }

    /** One repository: its trackers (inBudget value, manual supplement) and its entries in nyrus. */
    public function show(Request $request, NyrusClient $nyrus, string $owner, string $repo): View
    {
        [$rows, $inbudget, $error] = self::load($nyrus);
        if ($error) {
            return view('repository', ['row' => null, 'error' => $error, 'listQuery' => self::listQuery($request), 'inbudget' => null, 'trackerLinks' => [], 'group' => null, 'groups' => []]);
        }

        $key = $owner === '-' ? "-/{$repo}" : strtolower("{$owner}/{$repo}");
        $row = collect($rows)->first(fn (array $row) => $row['key'] === $key);
        abort_if($row === null, 404);

        $groups = ProjectOverview::groupingEnabled($inbudget) ? ProjectOverview::groups($rows, $inbudget) : [];

        return view('repository', [
            'row' => $row,
            'error' => null,
            'listQuery' => self::listQuery($request),
            'inbudget' => $inbudget,
            'trackerLinks' => is_array($inbudget['trackerLinks'] ?? null) ? $inbudget['trackerLinks'] : [],
            'group' => $groups[$row['group']['key'] ?? ''] ?? null,
            'groups' => $groups,
        ]);
    }

    /** Everything the last inBudget sync reported: clone errors, unusable links, projects without tracker. */
    public function inbudget(Request $request, NyrusClient $nyrus): View
    {
        return view('inbudget', [
            'inbudget' => $nyrus->inbudget(),
            'listQuery' => self::listQuery($request),
        ]);
    }

    /**
     * Rows for the list (one per GitHub repository), the inBudget status, a
     * load error and the raw config entries.
     *
     * @return array{0: list<array<string, mixed>>, 1: ?array<string, mixed>, 2: ?string, 3: list<array<string, mixed>>}
     */
    public static function load(NyrusClient $nyrus): array
    {
        try {
            $repositories = array_values($nyrus->config()['repositories'] ?? []);
        } catch (NyrusException $e) {
            return [[], null, $e->getMessage(), []];
        }
        $inbudget = $nyrus->inbudget();

        return [ProjectOverview::rows($repositories, $inbudget), $inbudget, null, $repositories];
    }

    /**
     * The list's query parameters of this request (so links and forms keep them).
     *
     * @return array<string, string>
     */
    public static function listQuery(Request $request): array
    {
        return array_filter(
            array_map(fn ($v) => is_scalar($v) ? (string) $v : '', $request->only(self::LIST_PARAMS)),
            fn (string $value) => $value !== '',
        );
    }

    /**
     * Tracker workspaces a repository can be routed from (e.g. `jira-novu`,
     * `clickup-14278081`): the ones configured repositories and inBudget use.
     *
     * @return list<string>
     */
    private function workspaces(array $repositories, ?array $inbudget): array
    {
        $keys = array_merge(
            array_map(fn (array $repo) => (string) ($repo['linearWorkspaceId'] ?? ''), $repositories),
            array_map(fn (array $entry) => (string) ($entry['workspaceKey'] ?? ''), $inbudget['repositories'] ?? []),
        );
        $keys[] = 'github'; // GitHub issues (GITHUB_ISSUES_WEBHOOK_SECRET)
        $keys = array_values(array_unique(array_filter($keys)));
        sort($keys);

        return $keys;
    }

    /**
     * Normalised filters from the query string; unknown values fall back to "all".
     *
     * @return array{q: string, source: string, tracker: string, status: string, group: string, sort: string, per_page: int}
     */
    private function filters(Request $request, bool $grouping): array
    {
        $pick = fn (string $key, array $allowed, string $default = '') => in_array($value = (string) $request->query($key, $default), $allowed, true) ? $value : $default;
        $perPage = (int) $request->query('per_page', 50);

        return [
            'q' => trim(mb_substr((string) $request->query('q', ''), 0, 200)),
            'source' => $pick('source', ['inbudget', 'manual']),
            'tracker' => $pick('tracker', ['jira', 'clickup', 'github', 'none']),
            'status' => $pick('status', ['active', 'inactive']),
            'group' => $grouping ? $pick('group', ['multi', 'single']) : '',
            'sort' => $grouping || $request->query('sort') !== 'group' ? $pick('sort', self::SORTS, 'name') : 'name',
            'per_page' => in_array($perPage, self::PER_PAGE, true) ? $perPage : 50,
        ];
    }

    /** Whether a row has a working tracker of this kind ('none': neither Jira nor ClickUp). */
    private function hasTracker(array $row, string $tracker): bool
    {
        return $tracker === 'none' ? ! $row['hasTicketTracker'] : (bool) ($row['trackers'][$tracker]['covered'] ?? false);
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @param  array<string, mixed>  $filters
     * @param  array<string, array<string, mixed>>  $groups
     * @return list<array<string, mixed>>
     */
    private function filter(array $rows, array $filters, array $groups): array
    {
        $terms = array_filter(preg_split('/\s+/', mb_strtolower($filters['q'])) ?: []);

        return array_values(array_filter($rows, function (array $row) use ($filters, $terms, $groups) {
            if ($filters['group'] !== '' && (($groups[$row['group']['key'] ?? '']['size'] ?? 1) > 1) !== ($filters['group'] === 'multi')) {
                return false;
            }
            if ($filters['source'] !== '' && ! $row[$filters['source']]) {
                return false;
            }
            if ($filters['tracker'] !== '' && ! $this->hasTracker($row, $filters['tracker'])) {
                return false;
            }
            if ($filters['status'] !== '' && $row['active'] !== ($filters['status'] === 'active')) {
                return false;
            }
            foreach ($terms as $term) {
                if (! str_contains($row['search'], $term)) {
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
        $byName = fn (array $a, array $b) => strnatcasecmp($a['name'], $b['name']) ?: strnatcasecmp((string) $a['owner'], (string) $b['owner']);
        usort($rows, match ($sort) {
            '-name' => fn ($a, $b) => $byName($b, $a),
            'status' => fn ($a, $b) => $b['active'] <=> $a['active'] ?: $byName($a, $b),
            'source' => fn ($a, $b) => $b['manual'] <=> $a['manual'] ?: $byName($a, $b),
            'missing' => fn ($a, $b) => $a['hasTicketTracker'] <=> $b['hasTicketTracker'] ?: $byName($a, $b),
            default => $byName,
        });

        return $rows;
    }

    /**
     * How many repositories each filter option matches (over all repositories).
     *
     * @param  list<array<string, mixed>>  $rows
     * @param  array<string, array<string, mixed>>  $groups
     * @return array<string, array<string, int>>
     */
    private function facets(array $rows, array $groups): array
    {
        $facets = [
            'group' => ['multi' => 0, 'single' => 0],
            'source' => ['inbudget' => 0, 'manual' => 0],
            'tracker' => ['jira' => 0, 'clickup' => 0, 'github' => 0, 'none' => 0],
            'status' => ['active' => 0, 'inactive' => 0],
        ];
        foreach ($rows as $row) {
            foreach (['inbudget', 'manual'] as $source) {
                $facets['source'][$source] += $row[$source] ? 1 : 0;
            }
            foreach (array_keys($facets['tracker']) as $tracker) {
                $facets['tracker'][$tracker] += $this->hasTracker($row, $tracker) ? 1 : 0;
            }
            $facets['status'][$row['active'] ? 'active' : 'inactive']++;
            $facets['group'][($groups[$row['group']['key'] ?? '']['size'] ?? 1) > 1 ? 'multi' : 'single']++;
        }

        return $facets;
    }

    /**
     * Save the manual Jira project / ClickUp Space and List for a repository
     * inBudget knows. inBudget's own value wins wherever it has one.
     */
    public function saveManual(Request $request, NyrusClient $nyrus): RedirectResponse
    {
        $data = $request->validate([
            'repo' => ['required', 'string', 'max:200', 'regex:/^[\w.-]+\/[\w.-]+$/'],
            'platform' => ['required', 'in:jira,clickup'],
            'teamKeys' => ['nullable', 'string', 'max:1000'],
            'projectKeys' => ['nullable', 'string', 'max:1000'],
            // "Entknüpfen" (true: the manual value applies even where inBudget has one) / "Wieder verknüpfen" (false)
            'detached' => ['nullable', 'boolean'],
        ]);
        $payload = ['repo' => $data['repo'], 'platform' => $data['platform']]
            + $this->lists(['teamKeys' => $data['teamKeys'] ?? '', 'projectKeys' => $data['projectKeys'] ?? ''])
            + ($request->has('detached') && $data['detached'] !== null ? ['detached' => (bool) $data['detached']] : []);

        try {
            $status = $nyrus->setInbudgetManual($payload);
        } catch (NyrusException $e) {
            AuditLog::record('inbudget.manual', $data['repo'], $payload + ['error' => $e->getMessage()], success: false);

            return back()->withInput()->with('error', $e->getMessage());
        }

        $failed = filled($status['error'] ?? null);
        AuditLog::record('inbudget.manual', $data['repo'], $payload + array_filter(['error' => $status['error'] ?? null]), success: ! $failed);

        return self::toList($request)->with(
            $failed ? 'error' : 'status',
            match (true) {
                $failed => 'Gespeichert, aber der inBudget-Abgleich ist fehlgeschlagen: '.$status['error'],
                (bool) ($status['running'] ?? false) => 'Gespeichert. Der Abgleich läuft noch (Repository wird geklont). Lade die Seite gleich neu.',
                ($payload['detached'] ?? null) === true => 'Von inBudget entknüpft. Dein Wert gilt jetzt.',
                ($payload['detached'] ?? null) === false => 'Wieder mit inBudget verknüpft.',
                default => 'Gespeichert und mit inBudget abgeglichen.',
            },
        );
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

        return self::toList($request)->with(
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
            'linearWorkspaceId' => ['nullable', 'string', 'max:100', 'regex:/^[\w.:-]+$/'],
        ]);

        $payload = array_filter([
            'repository_url' => trim($data['repository_url']),
            'name' => $data['name'] ?? null,
            'baseBranch' => $data['baseBranch'] ?? null,
            'linearWorkspaceId' => isset($data['linearWorkspaceId']) ? trim($data['linearWorkspaceId']) : null,
        ]) + $this->lists($data);
        // GitHub issues route by the repository's owner/name as team key.
        if (($payload['linearWorkspaceId'] ?? null) === 'github' && empty($payload['teamKeys'])
            && preg_match('~github\.com[:/]([\w.-]+)/([\w.-]+?)(?:\.git)?/?$~i', $payload['repository_url'], $m)) {
            $payload['teamKeys'] = [strtolower("{$m[1]}/{$m[2]}")];
        }

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
            'Einstellungen gespeichert.',
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

        return self::toList($request)->with('status', $success);
    }

    /**
     * Back to the list (or to the repository page in `_detail`, "owner/name"),
     * with the filters the form was sent from.
     */
    public static function toList(Request $request): RedirectResponse
    {
        $query = $request->input('_query');
        $query = is_array($query) ? array_filter(
            array_intersect_key($query, array_flip(self::LIST_PARAMS)),
            fn ($value) => is_scalar($value) && (string) $value !== '',
        ) : [];

        $detail = (string) $request->input('_detail', '');
        if (preg_match('~^([\w.-]+)/([\w.-]+)$~', $detail, $m)) {
            return redirect()->route('repositories.show', ['owner' => $m[1], 'repo' => $m[2]] + $query);
        }

        return redirect()->route('repositories.index', $query);
    }
}
