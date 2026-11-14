import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DesiredRepository, PlanContext, SyncPlan } from "./plan.js";

/** Jira project keys / ClickUp Space ids, and ClickUp List names. */
export interface RoutingKeys {
	teamKeys: string[];
	projectKeys: string[];
}

export type ManualPlatform = "jira" | "clickup";

/**
 * What a person added in the dashboard for a repository inBudget knows,
 * by `owner/name` (lowercase): the Jira project or ClickUp Space/List that
 * inBudget doesn't have (yet).
 */
export type ManualRouting = Record<string, ManualRepository>;

/** Manual keys; `detached`: unlinked from inBudget, so they win over its keys. */
export interface ManualKeys extends RoutingKeys {
	detached?: boolean;
}

export interface ManualRepository
	extends Partial<Record<ManualPlatform, ManualKeys>> {
	/**
	 * The repository's group, set in the dashboard: a name (repositories
	 * with the same name form a group), or "" for its own group. Absent: the
	 * group of its inBudget customer.
	 */
	group?: string;
}

/** The group a repository is worked in, for the dashboard. */
export interface RepoGroup {
	/** `client:<id>`, `manual:<name, lowercase>` or `repo:<owner/name>` */
	key: string;
	name: string;
	source: "inbudget" | "manual";
	customer?: string;
}

/** One GitHub repository inBudget knows, for the dashboard. */
export interface RepoOverview {
	repo: string;
	projects: string[];
	branch?: string;
	group: RepoGroup;
	platforms: {
		jira?: PlatformOverview;
		clickup?: PlatformOverview;
		github?: { entryId?: string };
	};
}

export interface PlatformOverview {
	inbudget: RoutingKeys;
	manual: RoutingKeys;
	/** Unlinked from inBudget in the dashboard: the manual keys apply. */
	detached: boolean;
	/** Per field: inBudget's keys, or the manual ones if inBudget has none. */
	effective: RoutingKeys;
	/** Keys it gets from its group (the group's own, other members') beyond its own. */
	inherited: RoutingKeys;
	entryId?: string;
}

/** A group's tracker keys: set on the group, and shared by all its members. */
export interface GroupPlatformOverview {
	own: RoutingKeys;
	/** The group's own keys and all its members' keys: every member is routed with them. */
	effective: RoutingKeys;
}

/** The manual store key of a group's own tracker keys. */
export function groupManualKey(groupKey: string): string {
	return `@group:${groupKey.toLowerCase()}`;
}

const empty = (): RoutingKeys => ({ teamKeys: [], projectKeys: [] });

export function manualPath(cyrusHome: string): string {
	return join(cyrusHome, "inbudget-manual.json");
}

export function readManual(cyrusHome: string): ManualRouting {
	try {
		const data = JSON.parse(readFileSync(manualPath(cyrusHome), "utf8"));
		return data && typeof data === "object" ? (data as ManualRouting) : {};
	} catch {
		return {};
	}
}

/** Save (or, with no keys, clear) a repository's manual routing for one tracker. */
/**
 * A repository's manual entry with one tracker's keys changed (empty keys
 * clear them, unless unlinked from inBudget); undefined when nothing is left.
 */
export function withManualKeys(
	entry: ManualRepository | undefined,
	platform: ManualPlatform,
	keys: RoutingKeys,
	detached?: boolean,
): ManualRepository | undefined {
	const next = { ...entry };
	const isDetached = detached ?? entry?.[platform]?.detached ?? false;
	const clean: ManualKeys = {
		teamKeys: unique(keys.teamKeys),
		projectKeys: unique(keys.projectKeys),
		...(isDetached && { detached: true }),
	};
	if (clean.teamKeys.length || clean.projectKeys.length || isDetached) {
		next[platform] = clean;
	} else {
		delete next[platform];
	}
	return Object.keys(next).length ? next : undefined;
}

/**
 * A repository's manual entry in a group: a name, "" for its own group, or
 * null for its inBudget customer's group; undefined when nothing is left.
 */
export function withGroup(
	entry: ManualRepository | undefined,
	group: string | null,
): ManualRepository | undefined {
	const next = { ...entry };
	if (group === null) delete next.group;
	else next.group = group.trim();
	return Object.keys(next).length ? next : undefined;
}

/** Change one repository's entry in the manual file. */
export function updateManualFile(
	cyrusHome: string,
	repo: string,
	change: (entry: ManualRepository | undefined) => ManualRepository | undefined,
): ManualRouting {
	const manual = readManual(cyrusHome);
	const key = repo.toLowerCase();
	const next = change(manual[key]);
	if (next) manual[key] = next;
	else delete manual[key];
	writeFileSync(manualPath(cyrusHome), `${JSON.stringify(manual, null, 2)}\n`);
	return manual;
}

/** Save (or, with no keys, clear) a repository's manual routing for one tracker. */
export function writeManual(
	cyrusHome: string,
	repo: string,
	platform: ManualPlatform,
	keys: RoutingKeys,
	detached?: boolean,
): ManualRouting {
	return updateManualFile(cyrusHome, repo, (e) =>
		withManualKeys(e, platform, keys, detached),
	);
}

/** Put a repository into a group (name, "" alone, null its customer's). */
export function writeGroup(
	cyrusHome: string,
	repo: string,
	group: string | null,
): ManualRouting {
	return updateManualFile(cyrusHome, repo, (e) => withGroup(e, group));
}

/** A repository's group: set in the dashboard, else its inBudget customer's. */
export function groupOf(
	found: { repo: string; customer?: { key: string; name: string } },
	manual: ManualRouting,
): RepoGroup {
	const key = found.repo.toLowerCase();
	const customer = found.customer?.name;
	const own = manual[key]?.group;
	const base = customer ? { customer } : {};
	if (own !== undefined) {
		return own
			? {
					key: `manual:${own.toLowerCase()}`,
					name: own,
					source: "manual",
					...base,
				}
			: { key: `repo:${key}`, name: found.repo, source: "manual", ...base };
	}
	return found.customer
		? {
				key: `client:${found.customer.key}`,
				name: found.customer.name,
				source: "inbudget",
				...base,
			}
		: { key: `repo:${key}`, name: found.repo, source: "inbudget" };
}

/**
 * The `routingGroup` of a repository's entries: the client or the manual
 * group's name (manual entries join it by that name), none when alone.
 */
function routingGroupOf(group: RepoGroup, size: number): string | undefined {
	if (size < 2 || group.key.startsWith("repo:")) return undefined;
	return group.key.startsWith("manual:") ? group.name : group.key;
}

/**
 * inBudget is the source; the dashboard supplements it. Per repository and
 * tracker, each field takes inBudget's keys, or the manual ones where
 * inBudget has none. A manual Jira/ClickUp entry for a repository inBudget
 * routes nowhere (yet) makes it a repository of that tracker.
 */
export function mergeManual(
	plan: SyncPlan,
	manual: ManualRouting,
	context: PlanContext,
): {
	desired: DesiredRepository[];
	repos: RepoOverview[];
	groups: Array<
		RepoGroup & {
			repos: string[];
			platforms: Partial<Record<ManualPlatform, GroupPlatformOverview>>;
		}
	>;
} {
	const planned = plan.repositories.map((r) => ({ ...r }));
	const repos: RepoOverview[] = [];
	const workspaces: Record<ManualPlatform, string | undefined> = {
		jira: context.jira?.workspaceKey,
		clickup: context.clickup?.workspaceKey,
	};

	// Groups first: a group's repositories share their tracker keys.
	const groupByRepo = new Map<string, RepoGroup>();
	const members = new Map<string, string[]>();
	for (const found of plan.found) {
		const group = groupOf(found, manual);
		groupByRepo.set(found.repo.toLowerCase(), group);
		members.set(group.key, [...(members.get(group.key) ?? []), found.repo]);
	}

	const effectiveByRepo = new Map<
		string,
		Partial<Record<ManualPlatform, RoutingKeys>>
	>();
	for (const found of plan.found) {
		const key = found.repo.toLowerCase();
		const group = groupByRepo.get(key)!;
		const overview: RepoOverview = {
			repo: found.repo,
			projects: found.projects,
			...(found.branch && { branch: found.branch }),
			group,
			platforms: {},
		};
		const effectives: Partial<Record<ManualPlatform, RoutingKeys>> = {};
		for (const platform of ["jira", "clickup"] as const) {
			const workspaceKey = workspaces[platform];
			if (!workspaceKey) continue;
			const entry = planned.find(
				(d) => d.repo.toLowerCase() === key && d.workspaceKey === workspaceKey,
			);
			const inbudget: RoutingKeys = entry
				? { teamKeys: [...entry.teamKeys], projectKeys: [...entry.projectKeys] }
				: empty();
			const stored = manual[key]?.[platform];
			const own: RoutingKeys = stored
				? { teamKeys: stored.teamKeys, projectKeys: stored.projectKeys }
				: empty();
			const detached = stored?.detached === true;
			const effective: RoutingKeys = detached
				? own
				: {
						teamKeys: inbudget.teamKeys.length
							? inbudget.teamKeys
							: own.teamKeys,
						projectKeys: inbudget.projectKeys.length
							? inbudget.projectKeys
							: own.projectKeys,
					};
			effectives[platform] = effective;
			overview.platforms[platform] = {
				inbudget,
				manual: own,
				detached,
				effective,
				inherited: empty(),
			};
		}
		if (context.github) overview.platforms.github = {};
		effectiveByRepo.set(key, effectives);
		repos.push(overview);
	}

	// Per group and tracker: its own keys and its members' keys.
	const groupKeys = new Map<
		string,
		Partial<Record<ManualPlatform, GroupPlatformOverview>>
	>();
	for (const [groupKey, list] of members) {
		const platforms: Partial<Record<ManualPlatform, GroupPlatformOverview>> =
			{};
		for (const platform of ["jira", "clickup"] as const) {
			if (!workspaces[platform]) continue;
			const stored = manual[groupManualKey(groupKey)]?.[platform];
			const own: RoutingKeys = stored
				? { teamKeys: stored.teamKeys, projectKeys: stored.projectKeys }
				: empty();
			const effective: RoutingKeys = { ...own };
			for (const r of list) {
				const e = effectiveByRepo.get(r.toLowerCase())?.[platform];
				if (!e) continue;
				effective.teamKeys = unique([...effective.teamKeys, ...e.teamKeys]);
				effective.projectKeys = unique([
					...effective.projectKeys,
					...e.projectKeys,
				]);
			}
			platforms[platform] = { own, effective };
		}
		groupKeys.set(groupKey, platforms);
	}
	for (const overview of repos) {
		for (const platform of ["jira", "clickup"] as const) {
			const mine = overview.platforms[platform];
			const shared = groupKeys.get(overview.group.key)?.[platform]?.effective;
			if (!mine || !shared) continue;
			mine.inherited = {
				teamKeys: shared.teamKeys.filter(
					(k) => !mine.effective.teamKeys.includes(k),
				),
				projectKeys: shared.projectKeys.filter(
					(k) => !mine.effective.projectKeys.includes(k),
				),
			};
		}
	}

	// Entries: per repository and tracker, the keys of its whole group.
	const desired: DesiredRepository[] = planned.filter(
		(d) => !groupByRepo.has(d.repo.toLowerCase()),
	);
	for (const found of plan.found) {
		const key = found.repo.toLowerCase();
		const group = groupByRepo.get(key)!;
		const groupRepos = members.get(group.key) ?? [found.repo];
		const routingGroup = routingGroupOf(group, groupRepos.length);
		const projects = unique(
			groupRepos.flatMap(
				(r) =>
					plan.found.find((f) => f.repo.toLowerCase() === r.toLowerCase())
						?.projects ?? [],
			),
		);
		for (const platform of ["jira", "clickup"] as const) {
			const workspaceKey = workspaces[platform];
			if (!workspaceKey) continue;
			const union = groupKeys.get(group.key)?.[platform]?.effective ?? empty();
			if (!union.teamKeys.length && !union.projectKeys.length) continue;
			desired.push({
				repo: found.repo,
				...(found.branch && { branch: found.branch }),
				platform,
				workspaceKey,
				...union,
				projects: groupRepos.length > 1 ? projects : found.projects,
				...(routingGroup && { routingGroup }),
			});
		}
		const github = planned.find(
			(d) => d.repo.toLowerCase() === key && d.platform === "github",
		);
		if (github) {
			desired.push({ ...github, ...(routingGroup && { routingGroup }) });
		}
	}

	desired.sort((a, b) =>
		`${a.repo}|${a.workspaceKey}`.localeCompare(`${b.repo}|${b.workspaceKey}`),
	);
	repos.sort((a, b) => a.repo.localeCompare(b.repo));
	const groups = [...members.entries()]
		.map(([key, list]) => {
			const group = groupByRepo.get(list[0]!.toLowerCase())!;
			return {
				...group,
				key,
				repos: [...list].sort(),
				platforms: groupKeys.get(key) ?? {},
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	return { desired, repos, groups };
}

function unique(values: string[]): string[] {
	return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
