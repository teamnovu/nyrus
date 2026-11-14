import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDefaultReposDir, getDefaultWorktreesDir } from "cyrus-core";
import type { DesiredRepository } from "./plan.js";

/** Ids of repositories nyrus manages from inBudget start with this. */
export const MANAGED_PREFIX = "inbudget-";

/** A repository entry of config.json, as far as the sync touches it. */
export interface RepoEntry {
	id: string;
	name: string;
	repositoryPath: string;
	baseBranch: string;
	githubUrl?: string;
	linearWorkspaceId?: string;
	teamKeys?: string[];
	projectKeys?: string[];
	routingGroup?: string;
	workspaceBaseDir: string;
	isActive?: boolean;
	appendInstruction?: string;
	[key: string]: unknown;
}

export interface ApplyOptions {
	cyrusHome: string;
	/**
	 * Clone the repository into `path` if it isn't there yet; returns its
	 * default branch if it can tell. Throws if cloning fails.
	 */
	clone: (
		repo: DesiredRepository,
		name: string,
	) => Promise<{ path: string; defaultBranch?: string }>;
	/** `appendInstruction` for a new entry. */
	instructions?: (repo: DesiredRepository) => string | undefined;
}

export interface ApplyResult {
	added: string[];
	updated: string[];
	reactivated: string[];
	deactivated: string[];
	/** Configured by hand for the same workspace, so left alone. */
	manual: string[];
	errors: Array<{ repository: string; message: string }>;
}

interface SyncState {
	/** Managed entries the sync turned off (others were turned off by a person). */
	deactivatedBySync: string[];
}

/**
 * Bring config.json's repositories in line with the plan:
 *
 * - A planned repository gets a managed entry `inbudget-<name>-<tracker>`,
 *   cloned first. The sync owns its routing (`githubUrl`, workspace, team
 *   and project keys); everything else (base branch, instructions, tools)
 *   is set once and then left to whoever edits it.
 * - A repository configured by hand for the same workspace wins: no managed
 *   entry is made, an existing one is turned off.
 * - A managed entry no longer planned (project archived, link removed) is
 *   turned off, not deleted, and turned on again when it comes back, unless
 *   a person turned it off.
 */
export async function applyPlan(
	desired: DesiredRepository[],
	options: ApplyOptions,
): Promise<ApplyResult> {
	const { cyrusHome } = options;
	const config = readConfig(cyrusHome);
	const repos = config.repositories;
	const before = JSON.stringify(repos);
	const state = readState(cyrusHome);
	const deactivatedBySync = new Set(state.deactivatedBySync);
	const result: ApplyResult = {
		added: [],
		updated: [],
		reactivated: [],
		deactivated: [],
		manual: [],
		errors: [],
	};
	const names = directoryNames(desired, repos);
	const wanted = new Set<string>();

	for (const repo of desired) {
		const githubUrl = `https://github.com/${repo.repo}`;
		const manual = repos.find(
			(r) =>
				!r.id.startsWith(MANAGED_PREFIX) &&
				sameGitHubRepo(r.githubUrl, githubUrl) &&
				r.linearWorkspaceId === repo.workspaceKey,
		);
		if (manual) {
			result.manual.push(manual.name);
			continue;
		}
		const name = names.get(repo.repo.toLowerCase())!;
		const id = `${MANAGED_PREFIX}${name}-${repo.platform}`;
		wanted.add(id);
		const index = repos.findIndex((r) => r.id === id);
		const routing = {
			githubUrl,
			linearWorkspaceId: repo.workspaceKey,
			teamKeys: repo.teamKeys,
			projectKeys: repo.projectKeys,
			routingGroup: repo.routingGroup,
		};

		if (index < 0) {
			try {
				// Another entry of the same repository (e.g. its Jira one) shares its clone.
				const sibling = repos.find(
					(r) => r.repositoryPath && sameGitHubRepo(r.githubUrl, githubUrl),
				);
				const cloned = sibling
					? { path: sibling.repositoryPath, defaultBranch: sibling.baseBranch }
					: await options.clone(repo, name);
				const entry: RepoEntry = {
					id,
					name: id,
					repositoryPath: cloned.path,
					baseBranch: repo.branch ?? cloned.defaultBranch ?? "main",
					workspaceBaseDir: getDefaultWorktreesDir(cyrusHome),
					isActive: true,
					...routing,
				};
				const instruction = options.instructions?.(repo);
				if (instruction) entry.appendInstruction = instruction;
				repos.push(entry);
				result.added.push(id);
			} catch (error) {
				result.errors.push({
					repository: repo.repo,
					message: error instanceof Error ? error.message : String(error),
				});
			}
			continue;
		}

		const current = repos[index]!;
		const next: RepoEntry = { ...current, ...routing };
		if (repo.branch) next.baseBranch = repo.branch;
		if (current.isActive === false && deactivatedBySync.has(id)) {
			next.isActive = true;
			deactivatedBySync.delete(id);
			result.reactivated.push(id);
		}
		if (JSON.stringify(next) !== JSON.stringify(current)) {
			repos[index] = next;
			if (!result.reactivated.includes(id)) result.updated.push(id);
		}
	}

	for (const [index, repo] of repos.entries()) {
		if (!repo.id.startsWith(MANAGED_PREFIX) || wanted.has(repo.id)) continue;
		if (repo.isActive === false) continue;
		repos[index] = { ...repo, isActive: false };
		deactivatedBySync.add(repo.id);
		result.deactivated.push(repo.id);
	}

	if (JSON.stringify(repos) !== before) {
		writeConfig(cyrusHome, { ...config, repositories: repos });
	}
	writeState(cyrusHome, { deactivatedBySync: [...deactivatedBySync].sort() });
	return result;
}

/**
 * Clone directory per repository: its name, or `<owner>-<name>` if another
 * repository (planned, or configured with that path) has the same name.
 */
function directoryNames(
	desired: DesiredRepository[],
	repos: RepoEntry[],
): Map<string, string> {
	const byName = new Map<string, Set<string>>();
	for (const { repo } of desired) {
		const name = repo.split("/")[1]!.toLowerCase();
		const set = byName.get(name) ?? new Set<string>();
		set.add(repo.toLowerCase());
		byName.set(name, set);
	}
	const names = new Map<string, string>();
	for (const { repo } of desired) {
		const [owner, name] = repo.split("/") as [string, string];
		const clash =
			byName.get(name.toLowerCase())!.size > 1 ||
			repos.some(
				(r) =>
					r.repositoryPath?.split("/").pop()?.toLowerCase() ===
						name.toLowerCase() &&
					r.githubUrl &&
					!sameGitHubRepo(r.githubUrl, `https://github.com/${repo}`),
			);
		names.set(repo.toLowerCase(), sanitize(clash ? `${owner}-${name}` : name));
	}
	return names;
}

function sanitize(name: string): string {
	return name.replace(/[^\w.-]+/g, "-");
}

export function sameGitHubRepo(a: string | undefined, b: string): boolean {
	const norm = (url: string) =>
		url
			.trim()
			.toLowerCase()
			.replace(/^git@github\.com:/, "https://github.com/")
			.replace(/\.git$/, "")
			.replace(/\/+$/, "");
	return a !== undefined && norm(a) === norm(b);
}

/** Where a repository is cloned: like the dashboard, under the repos directory. */
export function clonePath(cyrusHome: string, name: string): string {
	return join(getDefaultReposDir(cyrusHome), name);
}

function configPath(cyrusHome: string): string {
	return join(cyrusHome, "config.json");
}

/** config.json's repository entries. */
export function readRepositories(cyrusHome: string): RepoEntry[] {
	return readConfig(cyrusHome).repositories;
}

function readConfig(cyrusHome: string): Record<string, unknown> & {
	repositories: RepoEntry[];
} {
	const path = configPath(cyrusHome);
	if (!existsSync(path)) return { repositories: [] };
	const config = JSON.parse(readFileSync(path, "utf8")) as Record<
		string,
		unknown
	>;
	return {
		...config,
		repositories: Array.isArray(config.repositories)
			? (config.repositories as RepoEntry[])
			: [],
	};
}

function writeConfig(cyrusHome: string, config: Record<string, unknown>): void {
	// In place, like the dashboard: nyrus watches the file and reloads it.
	writeFileSync(
		configPath(cyrusHome),
		JSON.stringify(config, null, 2),
		"utf-8",
	);
}

function statePath(cyrusHome: string): string {
	return join(cyrusHome, "inbudget-sync.json");
}

function readState(cyrusHome: string): SyncState {
	try {
		const state = JSON.parse(
			readFileSync(statePath(cyrusHome), "utf8"),
		) as Partial<SyncState>;
		return { deactivatedBySync: state.deactivatedBySync ?? [] };
	} catch {
		return { deactivatedBySync: [] };
	}
}

function writeState(cyrusHome: string, state: SyncState): void {
	writeFileSync(statePath(cyrusHome), `${JSON.stringify(state, null, 2)}\n`);
}
