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
export type ManualRouting = Record<
	string,
	Partial<Record<ManualPlatform, RoutingKeys>>
>;

/** One GitHub repository inBudget knows, for the dashboard. */
export interface RepoOverview {
	repo: string;
	projects: string[];
	branch?: string;
	platforms: {
		jira?: PlatformOverview;
		clickup?: PlatformOverview;
		github?: { entryId?: string };
	};
}

export interface PlatformOverview {
	inbudget: RoutingKeys;
	manual: RoutingKeys;
	/** Per field: inBudget's keys, or the manual ones if inBudget has none. */
	effective: RoutingKeys;
	entryId?: string;
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
export function writeManual(
	cyrusHome: string,
	repo: string,
	platform: ManualPlatform,
	keys: RoutingKeys,
): ManualRouting {
	const manual = readManual(cyrusHome);
	const key = repo.toLowerCase();
	const clean = {
		teamKeys: unique(keys.teamKeys),
		projectKeys: unique(keys.projectKeys),
	};
	const entry = { ...manual[key] };
	if (clean.teamKeys.length || clean.projectKeys.length) {
		entry[platform] = clean;
	} else {
		delete entry[platform];
	}
	if (Object.keys(entry).length) manual[key] = entry;
	else delete manual[key];
	writeFileSync(manualPath(cyrusHome), `${JSON.stringify(manual, null, 2)}\n`);
	return manual;
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
): { desired: DesiredRepository[]; repos: RepoOverview[] } {
	const desired = plan.repositories.map((r) => ({ ...r }));
	const repos: RepoOverview[] = [];
	const workspaces: Record<ManualPlatform, string | undefined> = {
		jira: context.jira?.workspaceKey,
		clickup: context.clickup?.workspaceKey,
	};

	for (const found of plan.found) {
		const key = found.repo.toLowerCase();
		const overview: RepoOverview = {
			repo: found.repo,
			projects: found.projects,
			...(found.branch && { branch: found.branch }),
			platforms: {},
		};
		for (const platform of ["jira", "clickup"] as const) {
			const workspaceKey = workspaces[platform];
			if (!workspaceKey) continue;
			const entry = desired.find(
				(d) => d.repo.toLowerCase() === key && d.workspaceKey === workspaceKey,
			);
			const inbudget: RoutingKeys = entry
				? { teamKeys: [...entry.teamKeys], projectKeys: [...entry.projectKeys] }
				: empty();
			const own = manual[key]?.[platform] ?? empty();
			const effective: RoutingKeys = {
				teamKeys: inbudget.teamKeys.length ? inbudget.teamKeys : own.teamKeys,
				projectKeys: inbudget.projectKeys.length
					? inbudget.projectKeys
					: own.projectKeys,
			};
			overview.platforms[platform] = { inbudget, manual: own, effective };
			const routes = effective.teamKeys.length || effective.projectKeys.length;
			if (entry) {
				entry.teamKeys = effective.teamKeys;
				entry.projectKeys = effective.projectKeys;
			} else if (routes) {
				desired.push({
					repo: found.repo,
					...(found.branch && { branch: found.branch }),
					platform,
					workspaceKey,
					teamKeys: effective.teamKeys,
					projectKeys: effective.projectKeys,
					projects: found.projects,
				});
			}
		}
		if (context.github) overview.platforms.github = {};
		repos.push(overview);
	}

	desired.sort((a, b) =>
		`${a.repo}|${a.workspaceKey}`.localeCompare(`${b.repo}|${b.workspaceKey}`),
	);
	repos.sort((a, b) => a.repo.localeCompare(b.repo));
	return { desired, repos };
}

function unique(values: string[]): string[] {
	return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
