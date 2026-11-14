<?php

namespace App\Http\Controllers;

use App\Exceptions\NyrusException;
use App\Models\AuditLog;
use App\Services\NyrusClient;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * Repositories nyrus works on and how tickets are routed to them.
 * Changes go to nyrus's config.json, which nyrus picks up without a restart.
 */
class RepositoryController extends Controller
{
    private const NAME = 'regex:/^[\w.-]+$/';

    public function index(NyrusClient $nyrus): View
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

        return view('repositories', compact('repositories', 'error', 'inbudget', 'inbudgetProjects'));
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
        $projects = [];
        foreach ($repositories as $repo) {
            if (! str_starts_with((string) ($repo['id'] ?? ''), 'inbudget-')) {
                continue;
            }
            $url = strtolower(rtrim((string) ($repo['githubUrl'] ?? ''), '/'));
            foreach ($inbudget['repositories'] ?? [] as $wanted) {
                if ('https://github.com/'.strtolower($wanted['repo'] ?? '') === $url
                    && ($wanted['workspaceKey'] ?? null) === ($repo['linearWorkspaceId'] ?? null)) {
                    $projects[$repo['id']] = $wanted['projects'] ?? [];
                }
            }
        }

        return $projects;
    }

    /** Sync repositories from inBudget now. */
    public function syncInbudget(NyrusClient $nyrus): RedirectResponse
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

        return redirect()->route('repositories.index')->with(
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
    private function run(callable $call, string $action, string $subject, array $details, string $success): RedirectResponse
    {
        try {
            $call();
        } catch (NyrusException $e) {
            AuditLog::record($action, $subject, $details + ['error' => $e->getMessage()], success: false);

            return back()->withInput()->with('error', $e->getMessage());
        }

        AuditLog::record($action, $subject, $details);

        return redirect()->route('repositories.index')->with('status', $success);
    }
}
