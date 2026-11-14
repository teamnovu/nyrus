<?php

namespace App\Services;

/**
 * One row per GitHub repository for the "Projekte" page.
 *
 * Merges what inBudget knows (`status.repos` of /api/dashboard/inbudget: the
 * inBudget value, the manual supplement and the effective value per tracker)
 * with the repository entries in nyrus's config.json. inBudget-managed entries
 * (ids `inbudget-…`) and entries added by hand are grouped by their GitHub
 * repository (owner/name, case-insensitive), so one repository that is routed
 * from Jira, ClickUp and GitHub issues is one row.
 *
 * Older nyrus versions send no `status.repos`; then the rows come from the
 * config entries alone.
 */
class ProjectOverview
{
    /** Trackers that route tickets by keys (Jira project, ClickUp Space/List). */
    public const TICKET_TRACKERS = ['jira', 'clickup'];

    public const LABELS = ['jira' => 'Jira', 'clickup' => 'ClickUp', 'github' => 'GitHub Issues'];

    /**
     * @param  list<array<string, mixed>>  $repositories  config.json entries
     * @param  array<string, mixed>|null  $inbudget  inBudget sync status (null: no inBudget)
     * @return list<array<string, mixed>>
     */
    public static function rows(array $repositories, ?array $inbudget): array
    {
        $configured = self::configuredTrackers($repositories, $inbudget);
        $statusRepos = is_array($inbudget['repos'] ?? null) ? $inbudget['repos'] : null;

        $entries = [];
        foreach ($repositories as $repo) {
            if (! is_array($repo)) {
                continue;
            }
            $id = (string) ($repo['id'] ?? $repo['name'] ?? '');
            $entries[$id] = $repo + [
                '_id' => $id,
                '_name' => (string) ($repo['name'] ?? $id),
                '_managed' => str_starts_with($id, 'inbudget-'),
                '_tracker' => self::tracker($id, (string) ($repo['linearWorkspaceId'] ?? '')),
                '_active' => ($repo['isActive'] ?? true) !== false,
            ];
        }

        /** @var array<string, array<string, mixed>> $groups */
        $groups = [];
        $assigned = [];

        // inBudget repositories first: they claim the entries nyrus created for them.
        foreach ($statusRepos ?? [] as $statusRepo) {
            $key = self::normaliseRepo((string) ($statusRepo['repo'] ?? ''));
            if ($key === null) {
                continue;
            }
            $group = $groups[$key] ?? self::group($key);
            $group['status'] = $statusRepo;
            $group['displayRepo'] = (string) $statusRepo['repo'];
            foreach ((array) ($statusRepo['platforms'] ?? []) as $platform) {
                $entryId = (string) ($platform['entryId'] ?? '');
                if ($entryId !== '' && isset($entries[$entryId]) && ! isset($assigned[$entryId])) {
                    $group['entries'][] = $entries[$entryId];
                    $assigned[$entryId] = true;
                }
            }
            $groups[$key] = $group;
        }

        foreach ($entries as $id => $entry) {
            if (isset($assigned[$id])) {
                continue;
            }
            $key = self::entryRepo($entry) ?? '-/'.$id;
            $groups[$key] ??= self::group($key);
            $groups[$key]['entries'][] = $entry;
        }

        // older nyrus: the inBudget projects behind each repository come from `status.repositories`
        $legacyProjects = [];
        if ($statusRepos === null) {
            foreach ((array) ($inbudget['repositories'] ?? []) as $entry) {
                if ($key = self::normaliseRepo((string) ($entry['repo'] ?? ''))) {
                    $legacyProjects[$key] = array_merge($legacyProjects[$key] ?? [], (array) ($entry['projects'] ?? []));
                }
            }
        }

        return array_values(array_map(fn (array $group) => self::row($group, $configured, $legacyProjects[$group['key']] ?? []), $groups));
    }

    /** Lower-case owner/name of a GitHub repository ("teamnovu/Shop", a URL or an SSH remote), or null. */
    public static function normaliseRepo(string $value): ?string
    {
        $value = trim($value);
        if (preg_match('~github\.com[:/]+([\w.-]+)/([\w.-]+?)(?:\.git)?/?$~i', $value, $m)
            || preg_match('~^([\w.-]+)/([\w.-]+?)(?:\.git)?$~', $value, $m)) {
            return strtolower("{$m[1]}/{$m[2]}");
        }

        return null;
    }

    /** Jira, ClickUp, GitHub issues or something else (Linear, ...), from the managed id or the workspace key. */
    public static function tracker(string $id, string $workspace): string
    {
        foreach (['jira', 'clickup', 'github'] as $tracker) {
            if ((str_starts_with($id, 'inbudget-') && str_ends_with($id, "-{$tracker}"))
                || $workspace === $tracker || str_starts_with($workspace, "{$tracker}-")) {
                return $tracker;
            }
        }

        return 'other';
    }

    /**
     * Trackers nyrus has configured: from `status.trackers` if nyrus sends it,
     * otherwise the ones repositories and inBudget already use.
     *
     * @return list<string>
     */
    public static function configuredTrackers(array $repositories, ?array $inbudget): array
    {
        if (is_array($inbudget['trackers'] ?? null)) {
            return array_values(array_filter(['jira', 'clickup', 'github'], fn ($t) => ! empty($inbudget['trackers'][$t])));
        }

        $seen = [];
        foreach ($repositories as $repo) {
            $seen[self::tracker((string) ($repo['id'] ?? ''), (string) ($repo['linearWorkspaceId'] ?? ''))] = true;
        }
        foreach ((array) ($inbudget['repositories'] ?? []) as $entry) {
            $seen[self::tracker('', (string) ($entry['workspaceKey'] ?? ($entry['platform'] ?? '')))] = true;
        }

        return array_values(array_filter(['jira', 'clickup', 'github'], fn ($t) => isset($seen[$t])));
    }

    /** @return array<string, mixed> */
    private static function group(string $key): array
    {
        return ['key' => $key, 'status' => null, 'displayRepo' => null, 'entries' => []];
    }

    /** owner/name of the GitHub repository a config entry works on, if known. */
    private static function entryRepo(array $entry): ?string
    {
        if ($repo = self::normaliseRepo((string) ($entry['githubUrl'] ?? ''))) {
            return $repo;
        }
        if ($entry['_tracker'] === 'github') {
            foreach ((array) ($entry['teamKeys'] ?? []) as $key) {
                if ($repo = self::normaliseRepo((string) $key)) {
                    return $repo;
                }
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $group
     * @param  list<string>  $configured
     * @param  list<string>  $legacyProjects
     * @return array<string, mixed>
     */
    private static function row(array $group, array $configured, array $legacyProjects): array
    {
        $status = $group['status'];
        $entries = $group['entries'];
        usort($entries, fn ($a, $b) => self::order($a['_tracker']) <=> self::order($b['_tracker']) ?: strnatcasecmp($a['_name'], $b['_name']));

        $isRepo = ! str_starts_with($group['key'], '-/');
        $display = $group['displayRepo'] ?? null;
        if ($display === null && $isRepo) {
            foreach ($entries as $entry) {
                if (preg_match('~github\.com[:/]+([\w.-]+)/([\w.-]+?)(?:\.git)?/?$~i', (string) ($entry['githubUrl'] ?? ''), $m)) {
                    $display = "{$m[1]}/{$m[2]}";
                    break;
                }
            }
            $display ??= $group['key'];
        }
        [$owner, $name] = $isRepo ? explode('/', $display, 2) : [null, $entries[0]['_name'] ?? $group['key']];

        $managed = array_values(array_filter($entries, fn ($e) => $e['_managed']));
        $manual = array_values(array_filter($entries, fn ($e) => ! $e['_managed']));

        $trackers = [];
        foreach (['jira', 'clickup', 'github'] as $platform) {
            $tracker = self::trackerState($platform, $status, $entries, in_array($platform, $configured, true));
            if ($tracker['configured'] || $tracker['covered'] || $tracker['entries']) {
                $trackers[$platform] = $tracker;
            }
        }
        $others = array_values(array_filter($entries, fn ($e) => $e['_tracker'] === 'other'));

        $hasTicketTracker = (bool) array_filter(self::TICKET_TRACKERS, fn ($t) => $trackers[$t]['covered'] ?? false);
        $configuredTicket = array_values(array_filter(self::TICKET_TRACKERS, fn ($t) => in_array($t, $configured, true)));
        $missing = $hasTicketTracker || $others ? [] : array_map(fn ($t) => self::LABELS[$t], $configuredTicket);

        $branches = array_values(array_unique(array_filter(array_map(fn ($e) => (string) ($e['baseBranch'] ?? ''), $entries))));
        $projects = array_values(array_unique(array_map('strval', $status !== null ? (array) ($status['projects'] ?? []) : $legacyProjects)));

        $keys = [];
        foreach ($trackers as $tracker) {
            $keys[] = implode(' ', $tracker['effective']['teamKeys'] ?? []);
            $keys[] = implode(' ', $tracker['effective']['projectKeys'] ?? []);
        }

        return [
            'key' => $group['key'],
            'isRepo' => $isRepo,
            'owner' => $owner,
            'name' => $name,
            'githubUrl' => $isRepo ? "https://github.com/{$display}" : null,
            'projects' => $projects,
            'inbudgetBranch' => $status['branch'] ?? null,
            'inbudget' => $status !== null || (bool) $managed,
            'manual' => (bool) $manual,
            'entries' => $entries,
            'trackers' => $trackers,
            'others' => $others,
            'hasTicketTracker' => $hasTicketTracker,
            'missing' => $missing,
            'hasEntries' => (bool) $entries,
            'active' => (bool) array_filter($entries, fn ($e) => $e['_active']),
            'branches' => $branches,
            'search' => mb_strtolower(implode(' ', array_merge(
                [$group['key'], $name, (string) $owner],
                $projects,
                $keys,
                array_map(fn ($e) => $e['_id'].' '.$e['_name'].' '.implode(' ', array_map(fn ($f) => implode(' ', (array) ($e[$f] ?? [])), ['teamKeys', 'projectKeys', 'routingLabels'])), $entries),
            ))),
        ];
    }

    /**
     * State of one tracker for a repository.
     *
     * @param  array<string, mixed>|null  $status  the inBudget repo (null: not known to inBudget / older nyrus)
     * @param  list<array<string, mixed>>  $entries
     * @return array<string, mixed>
     */
    private static function trackerState(string $platform, ?array $status, array $entries, bool $configured): array
    {
        $own = array_values(array_filter($entries, fn ($e) => $e['_tracker'] === $platform));
        $manualEntries = array_values(array_filter($own, fn ($e) => ! $e['_managed']));
        $managedEntries = array_values(array_filter($own, fn ($e) => $e['_managed']));
        $info = $status['platforms'][$platform] ?? null;
        $empty = ['teamKeys' => [], 'projectKeys' => []];

        if (is_array($info) && $platform !== 'github') {
            $inbudget = self::keys($info['inbudget'] ?? $empty);
            $manual = self::keys($info['manual'] ?? $empty);
            $effective = self::keys($info['effective'] ?? [
                'teamKeys' => $inbudget['teamKeys'] ?: $manual['teamKeys'],
                'projectKeys' => $inbudget['projectKeys'] ?: $manual['projectKeys'],
            ]);
        } else {
            $inbudget = $manual = null;
            $effective = $empty;
            foreach ($managedEntries as $entry) {
                $effective = self::keys([
                    'teamKeys' => array_merge($effective['teamKeys'], (array) ($entry['teamKeys'] ?? [])),
                    'projectKeys' => array_merge($effective['projectKeys'], (array) ($entry['projectKeys'] ?? [])),
                ]);
            }
        }

        $fromKeys = $platform === 'github'
            ? (is_array($info) && filled($info['entryId'] ?? null)) || $managedEntries
            : $effective['teamKeys'] || $effective['projectKeys'];

        $summary = [];
        if ($platform === 'jira') {
            $summary = $effective['teamKeys'];
        } elseif ($platform === 'clickup') {
            $summary = $effective['projectKeys'] ?: array_map(fn ($s) => "Space {$s}", $effective['teamKeys']);
        }
        foreach ($manualEntries as $entry) {
            $summary = array_merge($summary, $platform === 'clickup'
                ? ((array) ($entry['projectKeys'] ?? []) ?: (array) ($entry['teamKeys'] ?? []))
                : ($platform === 'jira' ? (array) ($entry['teamKeys'] ?? []) : []));
        }

        return [
            'platform' => $platform,
            'label' => self::LABELS[$platform],
            'configured' => $configured,
            // the supplement form is available (nyrus knows the repository from inBudget)
            'editable' => is_array($info) && $platform !== 'github',
            'inbudget' => $inbudget,
            'manual' => $manual,
            'effective' => $effective,
            'entryId' => is_array($info) ? ($info['entryId'] ?? null) : ($managedEntries[0]['_id'] ?? null),
            'entries' => $own,
            'manualEntries' => $manualEntries,
            'covered' => $fromKeys || (bool) $manualEntries,
            'summary' => array_values(array_unique(array_map('strval', $summary))),
            'source' => match (true) {
                $inbudget !== null && ($inbudget['teamKeys'] || $inbudget['projectKeys']) => 'inbudget',
                $manual !== null && ($manual['teamKeys'] || $manual['projectKeys']) => 'supplement',
                (bool) $managedEntries => 'inbudget',
                (bool) $manualEntries => 'manual',
                default => null,
            },
        ];
    }

    /** @return array{teamKeys: list<string>, projectKeys: list<string>} */
    private static function keys(mixed $value): array
    {
        $clean = fn ($list) => array_values(array_unique(array_filter(array_map(fn ($v) => trim((string) $v), (array) $list), 'strlen')));

        return [
            'teamKeys' => $clean($value['teamKeys'] ?? []),
            'projectKeys' => $clean($value['projectKeys'] ?? []),
        ];
    }

    private static function order(string $tracker): int
    {
        return ['jira' => 0, 'clickup' => 1, 'github' => 2][$tracker] ?? 3;
    }
}
