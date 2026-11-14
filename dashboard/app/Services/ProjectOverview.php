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
        $grouping = self::groupingEnabled($inbudget);
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

        return array_values(array_map(fn (array $group) => self::row($group, $configured, $legacyProjects[$group['key']] ?? [], $grouping), $groups));
    }

    /**
     * Whether nyrus groups repositories (sends `group` per repo or
     * `status.groups`). Older nyrus versions don't; then there is no grouping UI.
     */
    public static function groupingEnabled(?array $inbudget): bool
    {
        if (is_array($inbudget['groups'] ?? null)) {
            return true;
        }
        foreach ((array) ($inbudget['repos'] ?? []) as $repo) {
            if (is_array($repo['group'] ?? null)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Effective repository groups (tickets for one repo of a group get all
     * repos of the group), keyed by group key, sorted by name. Built from the
     * rows so manual config entries (`routingGroup`) join manual groups of the
     * same name; names from `status.groups` win.
     *
     * @param  list<array<string, mixed>>  $rows
     *                                            `platforms` is the group's own Jira/ClickUp value and the effective one
     *                                            (own ∪ members' keys, what every member is routed with), per ticket
     *                                            tracker; null if nyrus doesn't send it (older nyrus: no group-level UI).
     * @return array<string, array{key: string, name: string, source: string, customer: ?string, rows: list<array<string, mixed>>, size: int, platforms: ?array<string, array{own: array, effective: array}>}>
     */
    public static function groups(array $rows, ?array $inbudget): array
    {
        $names = [];
        $platforms = [];
        foreach ((array) ($inbudget['groups'] ?? []) as $group) {
            if (! is_array($group) || ! filled($group['key'] ?? null)) {
                continue;
            }
            if (filled($group['name'] ?? null)) {
                $names[(string) $group['key']] = (string) $group['name'];
            }
            if (is_array($group['platforms'] ?? null)) {
                foreach (self::TICKET_TRACKERS as $platform) {
                    $info = is_array($group['platforms'][$platform] ?? null) ? $group['platforms'][$platform] : [];
                    $own = self::keys($info['own'] ?? []);
                    $platforms[(string) $group['key']][$platform] = ['own' => $own, 'effective' => self::keys($info['effective'] ?? $own)];
                }
            }
        }

        $groups = [];
        foreach ($rows as $row) {
            $group = $row['group'] ?? null;
            if ($group === null) {
                continue;
            }
            $groups[$group['key']] ??= [
                'key' => $group['key'],
                'name' => $names[$group['key']] ?? $group['name'],
                'source' => $group['source'],
                'customer' => null,
                'rows' => [],
                'size' => 0,
                'platforms' => $platforms[$group['key']] ?? null,
            ];
            $groups[$group['key']]['customer'] ??= $group['customer'];
            $groups[$group['key']]['rows'][] = $row;
            $groups[$group['key']]['size']++;
        }
        foreach ($groups as &$group) {
            usort($group['rows'], fn ($a, $b) => strnatcasecmp($a['name'], $b['name']) ?: strnatcasecmp((string) $a['owner'], (string) $b['owner']));
        }
        unset($group);
        uasort($groups, fn ($a, $b) => strnatcasecmp($a['name'], $b['name']) ?: strcmp($a['key'], $b['key']));

        return $groups;
    }

    /**
     * The group of one repository: what nyrus reports for an inBudget
     * repository, otherwise the `routingGroup` of its manual config entries,
     * otherwise its own group.
     *
     * @param  array<string, mixed>|null  $status
     * @param  list<array<string, mixed>>  $manualEntries
     * @return array{key: string, name: string, source: string, customer: ?string}
     */
    private static function rowGroup(?array $status, array $manualEntries, string $key, string $name): array
    {
        $group = $status['group'] ?? null;
        if (is_array($group) && filled($group['key'] ?? null)) {
            return [
                'key' => (string) $group['key'],
                'name' => (string) ($group['name'] ?? '') ?: $name,
                'source' => ($group['source'] ?? '') === 'manual' ? 'manual' : 'inbudget',
                'customer' => filled($group['customer'] ?? null) ? (string) $group['customer'] : null,
            ];
        }
        foreach ($manualEntries as $entry) {
            $routingGroup = trim((string) ($entry['routingGroup'] ?? ''));
            if ($routingGroup !== '') {
                return ['key' => 'manual:'.mb_strtolower($routingGroup), 'name' => $routingGroup, 'source' => 'manual', 'customer' => null];
            }
        }

        return ['key' => 'repo:'.$key, 'name' => $name, 'source' => 'manual', 'customer' => null];
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
    private static function row(array $group, array $configured, array $legacyProjects, bool $grouping = false): array
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
            foreach (['effective', 'inherited'] as $value) {
                $keys[] = implode(' ', $tracker[$value]['teamKeys'] ?? []);
                $keys[] = implode(' ', $tracker[$value]['projectKeys'] ?? []);
            }
        }

        $repoGroup = $grouping ? self::rowGroup($status, $manual, $group['key'], $isRepo ? $display : $name) : null;

        return [
            'key' => $group['key'],
            'isRepo' => $isRepo,
            // owner/name as inBudget spells it (for /inbudget/manual), null if inBudget doesn't know the repository
            'statusRepo' => $status !== null ? (string) $status['repo'] : null,
            'group' => $repoGroup,
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
                [$group['key'], $name, (string) $owner, (string) ($repoGroup['name'] ?? '')],
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

        // detached: the manual value applies even where inBudget has one (set by "Entknüpfen")
        $detached = is_array($info) && $platform !== 'github' && ($info['detached'] ?? false) === true;
        // inherited: the group's keys this repository doesn't have itself
        $inherited = $empty;
        if (is_array($info) && $platform !== 'github') {
            $inbudget = self::keys($info['inbudget'] ?? $empty);
            $manual = self::keys($info['manual'] ?? $empty);
            $inherited = self::keys($info['inherited'] ?? $empty);
            $effective = self::keys($info['effective'] ?? ($detached ? $manual : [
                'teamKeys' => $inbudget['teamKeys'] ?: $manual['teamKeys'],
                'projectKeys' => $inbudget['projectKeys'] ?: $manual['projectKeys'],
            ]));
            // `effective` is the repository's own value (without what only comes from the group)
            $effective = [
                'teamKeys' => array_values(array_diff($effective['teamKeys'], $inherited['teamKeys'])),
                'projectKeys' => array_values(array_diff($effective['projectKeys'], $inherited['projectKeys'])),
            ];
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

        $hasInherited = $inherited['teamKeys'] || $inherited['projectKeys'];

        $summary = self::summary($platform, $effective);
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
            'detached' => $detached,
            'inbudget' => $inbudget,
            'manual' => $manual,
            'effective' => $effective,
            'entryId' => is_array($info) ? ($info['entryId'] ?? null) : ($managedEntries[0]['_id'] ?? null),
            'entries' => $own,
            'manualEntries' => $manualEntries,
            'inherited' => $inherited,
            // connected only through the group's keys
            'inheritedOnly' => $hasInherited && ! $fromKeys && ! $manualEntries,
            'covered' => $fromKeys || (bool) $manualEntries || $hasInherited,
            'summary' => array_values(array_unique(array_map('strval', $summary))),
            'source' => match (true) {
                $detached => 'detached',
                $inbudget !== null && ($inbudget['teamKeys'] || $inbudget['projectKeys']) => 'inbudget',
                $manual !== null && ($manual['teamKeys'] || $manual['projectKeys']) => 'supplement',
                $inbudget === null && $managedEntries => 'inbudget',
                (bool) $manualEntries => 'manual',
                default => null,
            },
        ];
    }

    /**
     * What a tracker is connected to, as labels with links where the tracker
     * has a URL for it (Jira project, ClickUp Space, GitHub issues). `$bases`
     * are the tracker base URLs from `status.trackerLinks` (no links without).
     *
     * @param  array<string, mixed>  $tracker  one of a row's `trackers`
     * @param  array<string, mixed>  $bases
     * @return list<array{label: string, url: ?string}>
     */
    public static function links(array $tracker, ?string $repo, array $bases): array
    {
        $teamKeys = $tracker['effective']['teamKeys'];
        $projectKeys = $tracker['effective']['projectKeys'];
        foreach ($tracker['manualEntries'] as $entry) {
            $teamKeys = array_merge($teamKeys, array_map('strval', (array) ($entry['teamKeys'] ?? [])));
            $projectKeys = array_merge($projectKeys, array_map('strval', (array) ($entry['projectKeys'] ?? [])));
        }
        if ($tracker['platform'] === 'github') {
            return $tracker['covered'] && $repo !== null ? [['label' => $repo, 'url' => "https://github.com/{$repo}/issues"]] : [];
        }

        return array_map(
            fn (array $link) => ['label' => $link['label'], 'url' => $link['url']],
            self::keyLinks($tracker['platform'], ['teamKeys' => $teamKeys, 'projectKeys' => $projectKeys], $bases),
        );
    }

    /**
     * Jira projects / ClickUp Spaces and Lists as labels with links (see links()).
     *
     * @param  array{teamKeys: list<string>, projectKeys: list<string>}  $keys
     * @param  array<string, mixed>  $bases
     * @return list<array{label: string, url: ?string, field: string, key: string}>
     */
    public static function keyLinks(string $platform, array $keys, array $bases): array
    {
        $base = fn (string $platform) => is_string($bases[$platform] ?? null) && preg_match('~^https://~', $bases[$platform]) ? rtrim($bases[$platform], '/') : null;
        $teamKeys = array_values(array_unique(array_map('strval', $keys['teamKeys'] ?? [])));
        $projectKeys = array_values(array_unique(array_map('strval', $keys['projectKeys'] ?? [])));

        return match ($platform) {
            'jira' => array_map(fn ($key) => ['label' => $key, 'url' => ($url = $base('jira')) ? $url.'/browse/'.rawurlencode($key) : null, 'field' => 'teamKeys', 'key' => $key], $teamKeys),
            'clickup' => array_merge(
                array_map(fn ($id) => ['label' => "Space {$id}", 'url' => ($url = $base('clickup')) && ctype_digit($id) ? $url.'/v/s/'.$id : null, 'field' => 'teamKeys', 'key' => $id], $teamKeys),
                array_map(fn ($list) => ['label' => "Liste {$list}", 'url' => null, 'field' => 'projectKeys', 'key' => $list], $projectKeys),
            ),
            default => [],
        };
    }

    /**
     * Short label of a Jira/ClickUp value for chips (Jira projects; ClickUp Lists, else Spaces).
     *
     * @param  array{teamKeys: list<string>, projectKeys: list<string>}  $keys
     * @return list<string>
     */
    public static function summary(string $platform, array $keys): array
    {
        return match ($platform) {
            'jira' => $keys['teamKeys'],
            'clickup' => $keys['projectKeys'] ?: array_map(fn ($s) => "Space {$s}", $keys['teamKeys']),
            default => [],
        };
    }

    /**
     * Jira/ClickUp of a group, per configured ticket tracker: its own value,
     * the effective one (own ∪ members' keys) as links, and where each key
     * comes from: the group itself, or members (from inBudget or set on the
     * repository). Empty without group-level trackers (older nyrus).
     *
     * @param  array<string, mixed>  $group  one of groups()
     * @param  list<string>  $configured  configured trackers
     * @param  array<string, mixed>  $bases  `status.trackerLinks`
     * @return array<string, array<string, mixed>>
     */
    public static function groupTrackers(array $group, array $configured, array $bases): array
    {
        if (! is_array($group['platforms'] ?? null)) {
            return [];
        }

        $result = [];
        foreach (self::TICKET_TRACKERS as $platform) {
            $own = $group['platforms'][$platform]['own'] ?? ['teamKeys' => [], 'projectKeys' => []];
            $effective = $group['platforms'][$platform]['effective'] ?? $own;
            $hasOwn = $own['teamKeys'] || $own['projectKeys'];
            $connected = $effective['teamKeys'] || $effective['projectKeys'];
            if (! $connected && ! in_array($platform, $configured, true)) {
                continue;
            }

            $links = [];
            foreach (self::keyLinks($platform, $effective, $bases) as $link) {
                $sources = in_array($link['key'], $own[$link['field']], true) ? [['kind' => 'group']] : [];
                foreach ($group['rows'] as $row) {
                    $tracker = $row['trackers'][$platform] ?? null;
                    if ($tracker === null) {
                        continue;
                    }
                    $memberKeys = $tracker['effective'][$link['field']];
                    foreach ($tracker['manualEntries'] as $entry) {
                        $memberKeys = array_merge($memberKeys, array_map('strval', (array) ($entry[$link['field']] ?? [])));
                    }
                    if (in_array($link['key'], $memberKeys, true)) {
                        $fromInbudget = ! $tracker['detached'] && in_array($link['key'], $tracker['inbudget'][$link['field']] ?? [], true);
                        $sources[] = ['kind' => $fromInbudget ? 'inbudget' : 'manual', 'row' => $row];
                    }
                }
                $links[] = $link + ['sources' => $sources];
            }

            $result[$platform] = [
                'platform' => $platform,
                'label' => self::LABELS[$platform],
                'own' => $own,
                'effective' => $effective,
                'hasOwn' => (bool) $hasOwn,
                'connected' => (bool) $connected,
                'links' => $links,
            ];
        }

        return $result;
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
