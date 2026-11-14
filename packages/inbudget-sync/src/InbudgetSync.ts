import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { handleRepository } from "cyrus-config-updater";
import { createLogger, type ILogger } from "cyrus-core";
import {
	type ApplyResult,
	applyPlan,
	clonePath,
	readRepositories,
	sameGitHubRepo,
} from "./ConfigSync.js";
import {
	type InbudgetCache,
	mergeById,
	readCache,
	writeCache,
} from "./cache.js";
import type { InbudgetClient } from "./InbudgetClient.js";
import {
	type ManualPlatform,
	mergeManual,
	type RepoGroup,
	type RepoOverview,
	type RoutingKeys,
	readManual,
	writeGroup,
	writeManual,
} from "./manual.js";
import {
	type DesiredRepository,
	type PlanContext,
	planRepositories,
	type SyncPlan,
} from "./plan.js";

const execFileAsync = promisify(execFile);

/** What the last sync did, for the dashboard. */
/**
 * - `full`: read everything from inBudget again (daily, and "Jetzt abgleichen").
 * - `changes`: read only what changed (project list, resources changed since
 *   the last read, infos of new projects); the rest comes from the cache.
 * - `local`: no inBudget request; apply the cache with the dashboard's
 *   changes (manual routing, groups, repositories set up on demand).
 */
export type SyncMode = "full" | "changes" | "local";

export interface SyncStatus {
	running: boolean;
	/** Last full read from inBudget. */
	lastFullSyncAt?: string;
	/** Last read of changes from inBudget. */
	lastChangesSyncAt?: string;
	/** What the last run read from inBudget, and how many requests it took. */
	lastFetch?: { mode: "full" | "changes" | "none"; requests: number };
	lastRunAt?: string;
	lastSuccessAt?: string;
	durationMs?: number;
	error?: string;
	projectCount?: number;
	/** Project infos read from inBudget. */
	infoCount?: number;
	/** Infos that belong to an active project. */
	matchedInfoCount?: number;
	/** Infos recognised as a GitHub, Jira or ClickUp link. */
	linkCount?: number;
	/** Client resources read from inBudget. */
	resourceCount?: number;
	/** Client resources with a GitHub repository. */
	resourceRepoCount?: number;
	/** Managed repositories wanted by inBudget, with the projects they come from. */
	repositories?: Array<
		Pick<
			DesiredRepository,
			| "repo"
			| "platform"
			| "workspaceKey"
			| "teamKeys"
			| "projectKeys"
			| "projects"
			| "branch"
		>
	>;
	/** Which trackers nyrus has configured. */
	trackers?: { jira: boolean; clickup: boolean; github: boolean };
	/** Base URLs for links to the trackers. */
	trackerLinks?: { jira?: string; clickup?: string };
	/** Every GitHub repository inBudget knows, with inBudget's and the manual routing. */
	repos?: RepoOverview[];
	/** Every group of repositories worked together (customer or set in the dashboard). */
	groups?: Array<RepoGroup & { repos: string[] }>;
	result?: ApplyResult;
	warnings?: SyncPlan["warnings"];
	unrouted?: string[];
}

export interface InbudgetSyncOptions {
	client: Pick<
		InbudgetClient,
		"listProjects" | "listProjectInfos" | "listClientResources"
	>;
	cyrusHome: string;
	context: PlanContext;
	/** Clone a repository (default: like the dashboard, with `gh`/`git`). */
	clone?: (
		repo: DesiredRepository,
		name: string,
	) => Promise<{ path: string; defaultBranch?: string }>;
	instructions?: (repo: DesiredRepository) => string | undefined;
	logger?: ILogger;
	/** A `changes` sync reads everything again when the last full one is older (default 24 h). */
	fullSyncHours?: number;
}

/** Repositories and routing from inBudget, one sync at a time. */
export class InbudgetSync {
	private status: SyncStatus = { running: false };
	private tail?: Promise<SyncStatus>;
	private readonly logger: ILogger;

	constructor(private readonly options: InbudgetSyncOptions) {
		this.logger = options.logger ?? createLogger({ component: "InbudgetSync" });
	}

	getStatus(): SyncStatus {
		return this.status;
	}

	/**
	 * Set a repository up for GitHub issues on demand (the first issue
	 * assigned in it): if inBudget knows it, it is cloned and gets its
	 * `github` entry, now and on every later sync. True once the entry is
	 * in config.json.
	 */
	async provideGitHub(repo: string): Promise<boolean> {
		const { context, cyrusHome } = this.options;
		if (!context.github) return false;
		if (!this.status.repos) await this.sync("local");
		const key = repo.toLowerCase();
		if (!this.status.repos?.some((r) => r.repo.toLowerCase() === key)) {
			return false;
		}
		// The whole group: its tickets get all of its repositories.
		const groupKey = this.status.repos?.find(
			(r) => r.repo.toLowerCase() === key,
		)?.group.key;
		const group = this.status.groups?.find((g) => g.key === groupKey);
		const wanted = (group?.repos ?? [repo]).map((r) => r.toLowerCase());
		const requested = readGitHubRequested(cyrusHome);
		const next = [...new Set([...requested, ...wanted])].sort();
		if (next.length !== requested.length) {
			writeGitHubRequested(cyrusHome, next);
		}
		const status = await this.sync("local");
		return Boolean(
			status.repos?.find((r) => r.repo.toLowerCase() === key)?.platforms.github
				?.entryId,
		);
	}

	/**
	 * Put repositories into a group (a name, "" alone, null their
	 * customer's) and apply it, without asking inBudget.
	 */
	async setGroup(
		repos: string | string[],
		group: string | null,
	): Promise<SyncStatus> {
		for (const repo of Array.isArray(repos) ? repos : [repos]) {
			writeGroup(this.options.cyrusHome, repo, group);
		}
		return this.sync("local");
	}

	/**
	 * Save a repository's manual routing for one tracker (empty keys clear
	 * it) and apply it, without asking inBudget.
	 */
	async setManual(
		repo: string,
		platform: ManualPlatform,
		keys: RoutingKeys,
		detached?: boolean,
	): Promise<SyncStatus> {
		writeManual(this.options.cyrusHome, repo, platform, keys, detached);
		return this.sync("local");
	}

	/**
	 * Run a sync after the ones queued (runs never overlap). Never throws:
	 * errors end up in the status.
	 */
	sync(mode: SyncMode = "changes"): Promise<SyncStatus> {
		const run = (this.tail ?? Promise.resolve(this.status)).then(() =>
			this.run(mode),
		);
		const tail = run.finally(() => {
			if (this.tail === tail) this.tail = undefined;
		});
		this.tail = tail;
		return run;
	}

	/** Read everything from inBudget. */
	private async fetchAll(): Promise<InbudgetCache> {
		const { client } = this.options;
		const at = new Date().toISOString();
		const [projects, resources] = await Promise.all([
			client.listProjects(),
			client.listClientResources().catch((error: unknown) => {
				this.logger.warn(
					`inBudget sync: could not read client resources: ${error instanceof Error ? error.message : String(error)}`,
				);
				return undefined;
			}),
		]);
		const infos = await client.listProjectInfos(projects);
		return {
			projects,
			infos,
			resources: resources ?? [],
			fetchedAt: {
				full: at,
				projects: at,
				...(resources && { resources: at }),
			},
		};
	}

	/**
	 * Read only what changed: the project list (archived and new projects),
	 * resources changed since the last read (with 5 minutes overlap), and
	 * the infos of new projects.
	 */
	private async fetchChanges(cache: InbudgetCache): Promise<InbudgetCache> {
		const { client } = this.options;
		const at = new Date().toISOString();
		const since = cache.fetchedAt.resources
			? new Date(
					Date.parse(cache.fetchedAt.resources) - 5 * 60_000,
				).toISOString()
			: undefined;
		const [projects, changed] = await Promise.all([
			client.listProjects(),
			client.listClientResources(since).catch((error: unknown) => {
				this.logger.warn(
					`inBudget sync: could not read changed client resources: ${error instanceof Error ? error.message : String(error)}`,
				);
				return undefined;
			}),
		]);
		const known = new Set(cache.projects.map((p) => p.id));
		const fresh = projects.filter((p) => !known.has(p.id));
		const newInfos = fresh.length ? await client.listProjectInfos(fresh) : [];
		return {
			projects,
			infos: mergeById(cache.infos, newInfos),
			resources: changed
				? mergeById(cache.resources, changed)
				: cache.resources,
			fetchedAt: {
				...cache.fetchedAt,
				projects: at,
				...(changed && { resources: at }),
			},
		};
	}

	private async run(mode: SyncMode): Promise<SyncStatus> {
		const started = Date.now();
		this.status = { ...this.status, running: true };
		const counter = this.options.client as { requests?: number };
		const requestsBefore = counter.requests ?? 0;
		try {
			const { cyrusHome } = this.options;
			let cache = readCache(cyrusHome);
			const fullDue =
				!cache?.fetchedAt.full ||
				Date.now() - Date.parse(cache.fetchedAt.full) >
					(this.options.fullSyncHours ?? 24) * 3_600_000;
			let fetched: "full" | "changes" | "none" = "none";
			if (!cache || mode === "full" || (mode === "changes" && fullDue)) {
				cache = await this.fetchAll();
				fetched = "full";
			} else if (mode === "changes") {
				cache = await this.fetchChanges(cache);
				fetched = "changes";
			}
			if (fetched !== "none") writeCache(cyrusHome, cache);
			const { projects, infos, resources } = cache;
			const plan = await planRepositories(
				projects,
				infos,
				this.options.context,
				resources,
			);
			const { context } = this.options;
			const { desired, repos, groups } = mergeManual(
				plan,
				readManual(this.options.cyrusHome),
				context,
			);
			// GitHub issues entries are cloned on demand: only for repositories
			// already cloned (e.g. for Jira) or asked for by a first issue.
			const requested = new Set(readGitHubRequested(this.options.cyrusHome));
			const configured = readRepositories(this.options.cyrusHome);
			const cloned = (repo: string) =>
				configured.some(
					(e) =>
						e.repositoryPath &&
						sameGitHubRepo(e.githubUrl, `https://github.com/${repo}`),
				);
			for (let i = desired.length - 1; i >= 0; i--) {
				const d = desired[i]!;
				if (d.platform !== "github") continue;
				const tracked = desired.some(
					(o) =>
						o.platform !== "github" &&
						o.repo.toLowerCase() === d.repo.toLowerCase(),
				);
				const groupRepos = groups.find((g) =>
					g.repos.some((r) => r.toLowerCase() === d.repo.toLowerCase()),
				)?.repos ?? [d.repo];
				const wanted = groupRepos.some(
					(r) =>
						requested.has(r.toLowerCase()) ||
						cloned(r) ||
						desired.some(
							(o) =>
								o.platform !== "github" &&
								o.repo.toLowerCase() === r.toLowerCase(),
						),
				);
				if (!tracked && !wanted) {
					desired.splice(i, 1);
				}
			}
			const result = await applyPlan(desired, {
				cyrusHome: this.options.cyrusHome,
				clone:
					this.options.clone ??
					((repo, name) => cloneRepository(this.options.cyrusHome, repo, name)),
				instructions: this.options.instructions,
			});
			this.status = {
				running: false,
				lastRunAt: new Date(started).toISOString(),
				lastSuccessAt:
					fetched === "none"
						? (this.status.lastSuccessAt ?? cache.fetchedAt.projects)
						: new Date().toISOString(),
				lastFullSyncAt: cache.fetchedAt.full,
				lastChangesSyncAt: cache.fetchedAt.projects,
				lastFetch: {
					mode: fetched,
					requests: (counter.requests ?? 0) - requestsBefore,
				},
				durationMs: Date.now() - started,
				projectCount: plan.projectCount,
				trackers: {
					jira: Boolean(context.jira),
					clickup: Boolean(context.clickup),
					github: Boolean(context.github),
				},
				trackerLinks: {
					...(context.jira && { jira: `https://${context.jira.host}` }),
					...(context.clickup?.teamId && {
						clickup: `https://app.clickup.com/${context.clickup.teamId}`,
					}),
				},
				repos: withEntryIds(repos, this.options.cyrusHome, context),
				groups,
				infoCount: plan.infoCount,
				matchedInfoCount: plan.matchedInfoCount,
				linkCount: plan.linkCount,
				resourceCount: plan.resourceCount,
				resourceRepoCount: plan.resourceRepoCount,
				repositories: desired,
				result,
				warnings: plan.warnings,
				unrouted: plan.unrouted,
			};
			const changes = [
				result.added.length && `${result.added.length} added`,
				result.updated.length && `${result.updated.length} updated`,
				result.reactivated.length && `${result.reactivated.length} turned on`,
				result.deactivated.length && `${result.deactivated.length} turned off`,
			].filter(Boolean);
			this.logger.info(
				`inBudget sync (${fetched === "none" ? "local" : `${fetched}, ${(counter.requests ?? 0) - requestsBefore} requests`}): ${desired.length} repositories from ${plan.projectCount} projects (${plan.infoCount} infos, ${plan.linkCount} links, ${plan.resourceRepoCount} repositories from client resources)${changes.length ? ` (${changes.join(", ")})` : ", no changes"}${plan.warnings.length ? `, ${plan.warnings.length} warnings` : ""}`,
			);
			for (const error of result.errors) {
				this.logger.warn(
					`inBudget sync: could not add ${error.repository}: ${error.message}`,
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.status = {
				...this.status,
				running: false,
				lastRunAt: new Date(started).toISOString(),
				durationMs: Date.now() - started,
				error: message,
			};
			this.logger.error(`inBudget sync failed: ${message}`);
		}
		return this.status;
	}
}

function githubRequestedPath(cyrusHome: string): string {
	return join(cyrusHome, "inbudget-github.json");
}

/** Repositories set up for GitHub issues on demand (`owner/name`, lowercase). */
function readGitHubRequested(cyrusHome: string): string[] {
	try {
		const list = JSON.parse(
			readFileSync(githubRequestedPath(cyrusHome), "utf8"),
		);
		return Array.isArray(list)
			? list.filter((r): r is string => typeof r === "string")
			: [];
	} catch {
		return [];
	}
}

function writeGitHubRequested(cyrusHome: string, repos: string[]): void {
	writeFileSync(
		githubRequestedPath(cyrusHome),
		`${JSON.stringify(repos, null, 2)}\n`,
	);
}

/** The managed config entry of each repository and tracker, for the dashboard. */
function withEntryIds(
	repos: RepoOverview[],
	cyrusHome: string,
	context: InbudgetSyncOptions["context"],
): RepoOverview[] {
	const entries = readRepositories(cyrusHome).filter(
		(e) => e.id.startsWith("inbudget-") && e.isActive !== false,
	);
	const entryId = (repo: string, workspaceKey: string | undefined) =>
		workspaceKey
			? entries.find(
					(e) =>
						e.linearWorkspaceId === workspaceKey &&
						sameGitHubRepo(e.githubUrl, `https://github.com/${repo}`),
				)?.id
			: undefined;
	return repos.map((r) => {
		const platforms = { ...r.platforms };
		for (const platform of ["jira", "clickup"] as const) {
			const current = platforms[platform];
			if (!current) continue;
			const id = entryId(r.repo, context[platform]?.workspaceKey);
			platforms[platform] = { ...current, ...(id && { entryId: id }) };
		}
		if (platforms.github) {
			const id = entryId(r.repo, context.github?.workspaceKey);
			platforms.github = id ? { entryId: id } : {};
		}
		return { ...r, platforms };
	});
}

/**
 * Clone like the dashboard does (`gh repo clone`, or `git clone` with pushed
 * tokens) into the repos directory, and read the default branch.
 */
export async function cloneRepository(
	cyrusHome: string,
	repo: DesiredRepository,
	name: string,
): Promise<{ path: string; defaultBranch?: string }> {
	const result = await handleRepository(
		{
			repository_url: `https://github.com/${repo.repo}.git`,
			repository_name: name,
		},
		cyrusHome,
	);
	if (!result.success) {
		throw new Error([result.error, result.details].filter(Boolean).join(": "));
	}
	const path = clonePath(cyrusHome, name);
	try {
		const { stdout } = await execFileAsync("git", [
			"-C",
			path,
			"symbolic-ref",
			"--short",
			"refs/remotes/origin/HEAD",
		]);
		const branch = stdout.trim().replace(/^origin\//, "");
		return { path, defaultBranch: branch || undefined };
	} catch {
		return { path };
	}
}
