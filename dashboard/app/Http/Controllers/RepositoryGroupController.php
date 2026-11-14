<?php

namespace App\Http\Controllers;

use App\Exceptions\NyrusException;
use App\Models\AuditLog;
use App\Services\NyrusClient;
use App\Services\ProjectOverview;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * Repository groups: tickets routed to one repository of a group get all
 * repositories of the group in their session. By default a group is the
 * inBudget customer; groups set here (manual) win over that.
 *
 * nyrus stores the group per repository: `POST /api/dashboard/inbudget/manual`
 * with `{repo, group}` for repositories inBudget knows (a name: that manual
 * group, "": its own group, null: back to the customer), `routingGroup` on the
 * config entry for repositories added by hand.
 */
class RepositoryGroupController extends Controller
{
    private const ROW_KEY = ['string', 'max:200', 'regex:~^[\w.-]+/[\w.-]+$~'];

    private const GROUP_NAME = ['string', 'max:80', 'regex:/^[^\x00-\x1f\x7f]+$/u'];

    public function show(Request $request, NyrusClient $nyrus, string $key): View
    {
        [$rows, $inbudget, $error] = RepositoryController::load($nyrus);
        $groups = $error ? [] : $this->groups($rows, $inbudget);
        $group = $groups[$key] ?? null;
        abort_if($error === null && $group === null, 404);

        return view('repository-group', [
            'group' => $group,
            'groups' => $groups,
            'rows' => $rows,
            'error' => $error,
            'listQuery' => RepositoryController::listQuery($request),
        ]);
    }

    public function update(Request $request, NyrusClient $nyrus): RedirectResponse
    {
        $data = $request->validate([
            'action' => ['required', 'in:move,rename,dissolve,customer,add,remove'],
            'repo' => ['required_if:action,move,add,remove', 'nullable', ...self::ROW_KEY],
            'group' => ['required_unless:action,move', 'nullable', 'string', 'max:300'],
            'mode' => ['required_if:action,move', 'nullable', 'in:existing,new,alone,customer'],
            'target' => ['required_if:mode,existing', 'nullable', 'string', 'max:300'],
            'name' => ['required_if:action,rename', 'required_if:mode,new', 'nullable', ...self::GROUP_NAME],
        ], [
            'name.required_if' => 'Gib einen Namen für die Gruppe ein.',
            'target.required_if' => 'Wähle eine Gruppe.',
        ]);

        [$rows, $inbudget, $error] = RepositoryController::load($nyrus);
        if ($error) {
            return back()->withInput()->with('error', $error);
        }
        $groups = $this->groups($rows, $inbudget);
        if (! $groups) {
            return back()->with('error', 'Diese nyrus-Version kennt noch keine Gruppen.');
        }
        $row = isset($data['repo']) ? collect($rows)->first(fn (array $r) => $r['key'] === strtolower($data['repo']) || $r['key'] === $data['repo']) : null;
        $group = isset($data['group']) ? ($groups[$data['group']] ?? null) : null;
        if ((isset($data['repo']) && $row === null) || (isset($data['group']) && $group === null)) {
            return back()->with('error', 'Repository oder Gruppe nicht gefunden. Lade die Seite neu.');
        }
        $name = isset($data['name']) ? trim($data['name']) : null;

        // what to set per repository, and where to go afterwards
        [$plan, $next] = match ($data['action']) {
            'move' => [$this->movePlan($row, $groups, $data['mode'], $data['target'] ?? null, $name), null],
            'rename' => [array_map(fn ($r) => [$r, $name], $group['rows']), 'manual:'.mb_strtolower($name)],
            'dissolve' => [array_map(fn ($r) => [$r, ''], $group['rows']), null],
            'customer' => [array_map(fn ($r) => [$r, null], $group['rows']), null],
            'add' => $this->joinPlan($group, $row),
            // a group left with one repository may end up under another key: then back to the list
            'remove' => [[[$row, '']], $group['size'] > 2 ? $group['key'] : null],
        };
        if (is_string($plan)) {
            return back()->withInput()->with('error', $plan);
        }

        $errors = [];
        // inBudget repositories: one request per group value (nyrus applies it
        // locally, without asking inBudget); hand-added ones per config entry.
        $batches = [];
        foreach ($plan as [$member, $value]) {
            if ($member['statusRepo'] !== null) {
                $batches[json_encode($value)][] = $member;

                continue;
            }
            try {
                $this->assign($nyrus, $member, $value);
                AuditLog::record('repository.group', $member['key'], ['group' => $value, 'action' => $data['action']]);
            } catch (NyrusException $e) {
                $errors[] = $member['key'].': '.$e->getMessage();
                AuditLog::record('repository.group', $member['key'], ['group' => $value, 'action' => $data['action'], 'error' => $e->getMessage()], success: false);
            }
        }
        foreach ($batches as $encoded => $members) {
            $value = json_decode($encoded, true);
            try {
                $status = $nyrus->setInbudgetManual(['repos' => array_column($members, 'statusRepo'), 'group' => $value]);
                if (filled($status['error'] ?? null)) {
                    throw new NyrusException('inBudget-Abgleich fehlgeschlagen: '.$status['error']);
                }
                foreach ($members as $member) {
                    AuditLog::record('repository.group', $member['key'], ['group' => $value, 'action' => $data['action']]);
                }
            } catch (NyrusException $e) {
                foreach ($members as $member) {
                    $errors[] = $member['key'].': '.$e->getMessage();
                    AuditLog::record('repository.group', $member['key'], ['group' => $value, 'action' => $data['action'], 'error' => $e->getMessage()], success: false);
                }
            }
        }

        $redirect = match (true) {
            $data['action'] === 'move' => RepositoryController::toList($request),
            $next !== null => redirect()->route('repositories.group', ['key' => $next] + $this->query($request)),
            default => redirect()->route('repositories.index', $this->query($request)),
        };

        return $redirect->with(
            $errors ? 'error' : 'status',
            $errors
                ? 'Gruppe nicht (ganz) gespeichert: '.implode(' · ', $errors)
                : 'Gruppe gespeichert. Tickets für ein Repo der Gruppe bekommen ab jetzt alle Repos der Gruppe.',
        );
    }

    /**
     * Groups only if this nyrus groups repositories.
     *
     * @return array<string, array<string, mixed>>
     */
    private function groups(array $rows, ?array $inbudget): array
    {
        return ProjectOverview::groupingEnabled($inbudget) ? ProjectOverview::groups($rows, $inbudget) : [];
    }

    /**
     * Changing the group of one repository from its page.
     *
     * @param  array<string, array<string, mixed>>  $groups
     * @return list<array{0: array<string, mixed>, 1: ?string}>|string list of [row, group] or an error
     */
    private function movePlan(array $row, array $groups, string $mode, ?string $target, ?string $name): array|string
    {
        return match ($mode) {
            'new' => [[$row, $name]],
            'alone' => [[$row, '']],
            'customer' => $row['statusRepo'] !== null && filled($row['group']['customer'] ?? null)
                ? [[$row, null]]
                : 'Dieses Repository gehört zu keinem inBudget-Kunden.',
            'existing' => isset($groups[$target]) ? $this->joinPlan($groups[$target], $row)[0] : 'Gruppe nicht gefunden. Lade die Seite neu.',
        };
    }

    /**
     * Adding a repository to a group. A manual group is joined by its name;
     * the repository's own customer group by going back to the customer. Any
     * other group (another customer, a single repository) becomes a manual
     * group of that name with all its members, since nyrus can only group by name.
     *
     * @return array{0: list<array{0: array<string, mixed>, 1: ?string}>, 1: string}
     */
    private function joinPlan(array $group, array $row): array
    {
        if ($group['source'] === 'manual' && str_starts_with($group['key'], 'manual:')) {
            return [[[$row, $group['name']]], $group['key']];
        }
        if ($group['source'] === 'inbudget' && $group['customer'] !== null && $row['statusRepo'] !== null
            && ($row['group']['customer'] ?? null) === $group['customer']) {
            return [[[$row, null]], $group['key']];
        }

        $plan = array_map(fn (array $member) => [$member, $group['name']], $group['rows']);
        if (! in_array($row['key'], array_column(array_column($plan, 0), 'key'), true)) {
            $plan[] = [$row, $group['name']];
        }

        return [$plan, 'manual:'.mb_strtolower($group['name'])];
    }

    /**
     * Set the group of one repository in nyrus (name, "" alone, null back to the customer).
     *
     * @throws NyrusException
     */
    private function assign(NyrusClient $nyrus, array $row, ?string $group): void
    {
        if ($row['statusRepo'] !== null) {
            $status = $nyrus->setInbudgetManual(['repo' => $row['statusRepo'], 'group' => $group]);
            if (filled($status['error'] ?? null)) {
                throw new NyrusException('inBudget-Abgleich fehlgeschlagen: '.$status['error']);
            }

            return;
        }

        $entries = array_values(array_filter($row['entries'], fn (array $entry) => ! $entry['_managed']));
        if (! $entries) {
            throw new NyrusException('kein Eintrag in nyrus, dem eine Gruppe zugewiesen werden kann');
        }
        foreach ($entries as $entry) {
            $nyrus->updateRouting(['name' => $entry['_name'], 'routingGroup' => $group ?? '']);
        }
    }

    /** @return array<string, string> */
    private function query(Request $request): array
    {
        $query = $request->input('_query');

        return is_array($query) ? array_filter(
            array_intersect_key($query, array_flip(RepositoryController::LIST_PARAMS)),
            fn ($value) => is_scalar($value) && (string) $value !== '',
        ) : [];
    }
}
