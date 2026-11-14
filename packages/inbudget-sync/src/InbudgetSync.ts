import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { handleRepository } from "cyrus-config-updater";
import { createLogger, type ILogger } from "cyrus-core";
import { type ApplyResult, applyPlan, clonePath } from "./ConfigSync.js";
import type { InbudgetClient } from "./InbudgetClient.js";
import {
	type DesiredRepository,
	type PlanContext,
	planRepositories,
	type SyncPlan,
} from "./plan.js";

const execFileAsync = promisify(execFile);

/** What the last sync did, for the dashboard. */
export interface SyncStatus {
	running: boolean;
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
}

/** Repositories and routing from inBudget, one sync at a time. */
export class InbudgetSync {
	private status: SyncStatus = { running: false };
	private current?: Promise<SyncStatus>;
	private readonly logger: ILogger;

	constructor(private readonly options: InbudgetSyncOptions) {
		this.logger = options.logger ?? createLogger({ component: "InbudgetSync" });
	}

	getStatus(): SyncStatus {
		return this.status;
	}

	/** Run a sync, or join the one running. Never throws: errors end up in the status. */
	sync(): Promise<SyncStatus> {
		this.current ??= this.run().finally(() => {
			this.current = undefined;
		});
		return this.current;
	}

	private async run(): Promise<SyncStatus> {
		const started = Date.now();
		this.status = { ...this.status, running: true };
		try {
			const [projects, resources] = await Promise.all([
				this.options.client.listProjects(),
				this.options.client.listClientResources().catch((error: unknown) => {
					this.logger.warn(
						`inBudget sync: could not read client resources: ${error instanceof Error ? error.message : String(error)}`,
					);
					return [];
				}),
			]);
			const infos = await this.options.client.listProjectInfos(projects);
			const plan = await planRepositories(
				projects,
				infos,
				this.options.context,
				resources,
			);
			const result = await applyPlan(plan.repositories, {
				cyrusHome: this.options.cyrusHome,
				clone:
					this.options.clone ??
					((repo, name) => cloneRepository(this.options.cyrusHome, repo, name)),
				instructions: this.options.instructions,
			});
			this.status = {
				running: false,
				lastRunAt: new Date(started).toISOString(),
				lastSuccessAt: new Date().toISOString(),
				durationMs: Date.now() - started,
				projectCount: plan.projectCount,
				infoCount: plan.infoCount,
				matchedInfoCount: plan.matchedInfoCount,
				linkCount: plan.linkCount,
				resourceCount: plan.resourceCount,
				resourceRepoCount: plan.resourceRepoCount,
				repositories: plan.repositories,
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
				`inBudget sync: ${plan.repositories.length} repositories from ${plan.projectCount} projects (${plan.infoCount} infos, ${plan.linkCount} links, ${plan.resourceRepoCount} repositories from client resources)${changes.length ? ` (${changes.join(", ")})` : ", no changes"}${plan.warnings.length ? `, ${plan.warnings.length} warnings` : ""}`,
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
