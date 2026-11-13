import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDefaultReposDir, getDefaultWorktreesDir } from "cyrus-core";
import type { ApiResponse } from "../types.js";
import { resolveEnvFilePath } from "./envPath.js";
import { handleRepository, handleRepositoryDelete } from "./repository.js";

/**
 * Handlers behind the nyrus dashboard (`/api/dashboard/*`).
 *
 * They read what nyrus already persists in its home directory (the session
 * state file, `config.json`, `.env`) and make small, targeted changes to the
 * repository list in `config.json`. nyrus watches `config.json` and picks up
 * repository changes without a restart. Secrets are never returned: tokens
 * are stripped from repositories and only the names of `.env` variables are
 * listed.
 */

/** Longest entry content returned in a session detail. */
const MAX_ENTRY_CONTENT = 4000;
/** Pull request URLs on GitHub or GitLab, as agents post them. */
const PR_URL =
	/https:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|gitlab\.com\/[\w./-]+\/-\/merge_requests\/\d+)/g;
/** Repository fields that can hold credentials and must not leave nyrus. */
const SECRET_REPO_FIELDS = ["linearToken", "linearRefreshToken"] as const;

interface StoredEntry {
	type?: string;
	content?: unknown;
	metadata?: {
		timestamp?: number;
		toolName?: string;
		isError?: boolean;
		toolResultError?: boolean;
	};
}

interface StoredSession {
	id: string;
	status?: string;
	createdAt?: number;
	updatedAt?: number;
	issueId?: string;
	issue?: { id?: string; identifier?: string; title?: string };
	issueContext?: {
		trackerId?: string;
		issueId?: string;
		issueIdentifier?: string;
	};
	repositories?: { repositoryId?: string; branchName?: string }[];
	workspace?: { path?: string };
	metadata?: {
		model?: string;
		totalCostUsd?: number;
		runStartedAt?: number;
		totals?: {
			runs?: number;
			durationMs?: number;
			inputTokens?: number;
			outputTokens?: number;
			cacheReadTokens?: number;
			cacheCreationTokens?: number;
			costUsd?: number;
		};
	} | null;
}

interface StoredState {
	agentSessions?: Record<string, StoredSession>;
	agentSessionEntries?: Record<string, StoredEntry[]>;
}

type RepoConfig = Record<string, unknown> & { id?: string; name?: string };

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf-8"));
}

function readState(
	cyrusHome: string,
	readLiveState?: () => unknown,
): StoredState {
	if (readLiveState) {
		return (readLiveState() ?? {}) as StoredState;
	}
	const statePath = join(cyrusHome, "state", "edge-worker-state.json");
	if (!existsSync(statePath)) {
		return {};
	}
	const file = readJson(statePath) as { state?: StoredState };
	return file.state ?? {};
}

function entryText(entry: StoredEntry): string {
	return typeof entry.content === "string"
		? entry.content
		: JSON.stringify(entry.content ?? "");
}

function lastPullRequestUrl(entries: StoredEntry[]): string | undefined {
	let found: string | undefined;
	for (const entry of entries) {
		for (const match of entryText(entry).matchAll(PR_URL)) {
			found = match[0];
		}
	}
	return found;
}

/** Trackers whose sessions run Linear-shaped: their ids are `<platform>-<issue id>`. */
const COMMENT_TRACKERS = ["jira", "clickup"];

/**
 * The session's tracker. Jira and ClickUp sessions run as Linear-shaped
 * sessions (tracker "linear"), so their id prefix names the real one.
 */
function trackerOf(session: StoredSession): string | null {
	const trackerId = session.issueContext?.trackerId ?? null;
	if (trackerId === "linear") {
		const prefix = session.id.split("-")[0] ?? "";
		if (COMMENT_TRACKERS.includes(prefix)) {
			return prefix;
		}
	}
	return trackerId;
}

/**
 * How long the agent worked (finished runs plus the run in progress) and the
 * tokens of its finished runs.
 */
function runtimeAndTokens(session: StoredSession, now: number) {
	const totals = session.metadata?.totals;
	const running = session.metadata?.runStartedAt;
	const runtimeMs =
		(totals?.durationMs ?? 0) +
		(session.status === "active" && typeof running === "number"
			? Math.max(0, now - running)
			: 0);
	const tokens = totals
		? {
				input: totals.inputTokens ?? 0,
				output: totals.outputTokens ?? 0,
				cacheRead: totals.cacheReadTokens ?? 0,
				cacheCreation: totals.cacheCreationTokens ?? 0,
				total:
					(totals.inputTokens ?? 0) +
					(totals.outputTokens ?? 0) +
					(totals.cacheReadTokens ?? 0) +
					(totals.cacheCreationTokens ?? 0),
			}
		: null;
	return {
		runtimeMs: totals || typeof running === "number" ? runtimeMs : null,
		runs: totals?.runs ?? 0,
		tokens,
	};
}

function summarizeSession(
	session: StoredSession,
	entries: StoredEntry[],
	now = Date.now(),
) {
	const timestamps = entries
		.map((entry) => entry.metadata?.timestamp)
		.filter((ts): ts is number => typeof ts === "number");
	return {
		id: session.id,
		status: session.status ?? "unknown",
		createdAt: session.createdAt ?? null,
		updatedAt: session.updatedAt ?? null,
		tracker: trackerOf(session),
		issue: {
			id: session.issueContext?.issueId ?? session.issue?.id ?? session.issueId,
			identifier:
				session.issueContext?.issueIdentifier ??
				session.issue?.identifier ??
				null,
			title: session.issue?.title ?? null,
		},
		repositories: (session.repositories ?? []).map((repo) => ({
			id: repo.repositoryId ?? null,
			branch: repo.branchName ?? null,
		})),
		workspacePath: session.workspace?.path ?? null,
		model: session.metadata?.model ?? null,
		totalCostUsd:
			session.metadata?.totals?.costUsd ??
			session.metadata?.totalCostUsd ??
			null,
		...runtimeAndTokens(session, now),
		entryCount: entries.length,
		lastActivityAt: timestamps.length > 0 ? Math.max(...timestamps) : null,
		pullRequestUrl: lastPullRequestUrl(entries) ?? null,
	};
}

/** GET /api/dashboard/sessions: all known sessions, newest first. */
export async function handleDashboardSessions(
	cyrusHome: string,
	readLiveState?: () => unknown,
): Promise<ApiResponse> {
	try {
		const state = readState(cyrusHome, readLiveState);
		const sessions = Object.values(state.agentSessions ?? {})
			.map((session) =>
				summarizeSession(
					session,
					state.agentSessionEntries?.[session.id] ?? [],
				),
			)
			.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
		return { success: true, message: "Sessions", data: { sessions } };
	} catch (error) {
		return {
			success: false,
			error: "Failed to read sessions",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

/** GET /api/dashboard/session?id=…: one session with its activity log. */
export async function handleDashboardSession(
	query: { id?: string },
	cyrusHome: string,
	readLiveState?: () => unknown,
): Promise<ApiResponse> {
	if (!query?.id || typeof query.id !== "string") {
		return { success: false, error: "Session id is required" };
	}
	try {
		const state = readState(cyrusHome, readLiveState);
		const session = state.agentSessions?.[query.id];
		if (!session) {
			return { success: false, error: `Session ${query.id} not found` };
		}
		const entries = state.agentSessionEntries?.[query.id] ?? [];
		return {
			success: true,
			message: "Session",
			data: {
				session: summarizeSession(session, entries),
				entries: entries.map((entry) => {
					const text = entryText(entry);
					return {
						type: entry.type ?? "unknown",
						content:
							text.length > MAX_ENTRY_CONTENT
								? `${text.slice(0, MAX_ENTRY_CONTENT)}…`
								: text,
						toolName: entry.metadata?.toolName ?? null,
						isError: Boolean(
							entry.metadata?.isError || entry.metadata?.toolResultError,
						),
						timestamp: entry.metadata?.timestamp ?? null,
					};
				}),
			},
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to read session",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

function configPath(cyrusHome: string): string {
	return join(cyrusHome, "config.json");
}

function readConfig(cyrusHome: string): Record<string, unknown> & {
	repositories: RepoConfig[];
} {
	const path = configPath(cyrusHome);
	if (!existsSync(path)) {
		return { repositories: [] };
	}
	const config = readJson(path) as Record<string, unknown>;
	return {
		...config,
		repositories: Array.isArray(config.repositories)
			? (config.repositories as RepoConfig[])
			: [],
	};
}

function writeConfig(cyrusHome: string, config: Record<string, unknown>): void {
	writeFileSync(
		configPath(cyrusHome),
		JSON.stringify(config, null, 2),
		"utf-8",
	);
}

function publicRepository(repo: RepoConfig): RepoConfig {
	const copy: RepoConfig = { ...repo };
	for (const field of SECRET_REPO_FIELDS) {
		delete copy[field];
	}
	return copy;
}

/** GET /api/dashboard/config: repositories and routing, without secrets. */
export async function handleDashboardConfig(
	cyrusHome: string,
): Promise<ApiResponse> {
	try {
		const config = readConfig(cyrusHome);
		return {
			success: true,
			message: "Configuration",
			data: {
				repositories: config.repositories.map(publicRepository),
				settingKeys: Object.keys(config).filter(
					(key) => key !== "repositories",
				),
			},
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to read configuration",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

/** GET /api/dashboard/env: names of the variables set in `.env`, no values. */
export async function handleDashboardEnv(
	cyrusHome: string,
): Promise<ApiResponse> {
	try {
		const envPath = resolveEnvFilePath(cyrusHome);
		if (!existsSync(envPath)) {
			return {
				success: true,
				message: "No .env file",
				data: { exists: false, keys: [] },
			};
		}
		const keys = readFileSync(envPath, "utf-8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith("#"))
			.map((line) => {
				const index = line.indexOf("=");
				return {
					key: index > 0 ? line.slice(0, index).trim() : "",
					hasValue: index > 0 && line.slice(index + 1).trim() !== "",
				};
			})
			.filter((entry) => entry.key !== "");
		return {
			success: true,
			message: "Environment keys",
			data: { exists: true, keys },
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to read environment",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

export interface DashboardRepositoryPayload {
	repository_url?: string;
	name?: string;
	baseBranch?: string;
	githubUrl?: string;
	linearWorkspaceId?: string;
	teamKeys?: string[];
	projectKeys?: string[];
	routingLabels?: string[];
	isActive?: boolean;
}

const ROUTING_FIELDS = [
	"baseBranch",
	"githubUrl",
	"linearWorkspaceId",
	"teamKeys",
	"projectKeys",
	"routingLabels",
	"isActive",
] as const;

function stringList(value: unknown): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter(Boolean);
}

function routingUpdates(payload: DashboardRepositoryPayload): RepoConfig {
	const updates: RepoConfig = {};
	for (const field of ROUTING_FIELDS) {
		const value = payload[field];
		if (value === undefined) continue;
		if (
			field === "teamKeys" ||
			field === "projectKeys" ||
			field === "routingLabels"
		) {
			updates[field] = stringList(value);
		} else if (field === "isActive") {
			updates[field] = Boolean(value);
		} else if (typeof value === "string") {
			// An empty string clears an optional field
			updates[field] = value.trim() === "" ? undefined : value.trim();
		}
	}
	return updates;
}

function repoNameFromUrl(url: string): string {
	const match = url.match(/\/([^/]+?)(\.git)?\/?$/);
	return match?.[1] ?? url;
}

function githubWebUrl(url: string): string | undefined {
	const https = url.match(
		/^https:\/\/github\.com\/([^/]+\/[^/]+?)(\.git)?\/?$/,
	);
	const ssh = url.match(/^git@github\.com:([^/]+\/[^/]+?)(\.git)?$/);
	const slug = https?.[1] ?? ssh?.[1];
	return slug ? `https://github.com/${slug}` : undefined;
}

function findRepoIndex(repos: RepoConfig[], name: string): number {
	return repos.findIndex((repo) => repo.id === name || repo.name === name);
}

/**
 * POST /api/dashboard/repository: clone a repository (if needed) and add it
 * to `config.json` with its routing, or update the routing if it is there.
 */
export async function handleDashboardAddRepository(
	payload: DashboardRepositoryPayload,
	cyrusHome: string,
): Promise<ApiResponse> {
	if (!payload?.repository_url || typeof payload.repository_url !== "string") {
		return { success: false, error: "Repository URL is required" };
	}
	const url = payload.repository_url.trim();
	const name = payload.name?.trim() || repoNameFromUrl(url);
	if (!/^[\w.-]+$/.test(name)) {
		return {
			success: false,
			error: "Invalid repository name",
			details: "Use letters, digits, dots, dashes and underscores only.",
		};
	}

	const cloned = await handleRepository(
		{ repository_url: url, repository_name: name },
		cyrusHome,
	);
	if (!cloned.success) {
		return cloned;
	}

	try {
		const config = readConfig(cyrusHome);
		const repos = [...config.repositories];
		const index = findRepoIndex(repos, name);
		const updates = routingUpdates(payload);
		const entry: RepoConfig =
			index >= 0
				? { ...repos[index], ...updates }
				: {
						id: name,
						name,
						repositoryPath: join(getDefaultReposDir(cyrusHome), name),
						baseBranch: "main",
						githubUrl: githubWebUrl(url),
						workspaceBaseDir: getDefaultWorktreesDir(cyrusHome),
						isActive: true,
						teamKeys: [],
						...updates,
					};
		if (index >= 0) {
			repos[index] = entry;
		} else {
			repos.push(entry);
		}
		writeConfig(cyrusHome, { ...config, repositories: repos });
		return {
			success: true,
			message:
				index >= 0 ? "Repository updated" : "Repository added to configuration",
			data: {
				repository: publicRepository(entry),
				action: cloned.data?.action ?? "verified",
			},
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to update configuration",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * POST /api/dashboard/repository/routing: change the routing of a configured
 * repository (base branch, team/project keys, labels, active flag).
 */
export async function handleDashboardRepositoryRouting(
	payload: DashboardRepositoryPayload,
	cyrusHome: string,
): Promise<ApiResponse> {
	if (!payload?.name || typeof payload.name !== "string") {
		return { success: false, error: "Repository name is required" };
	}
	try {
		const config = readConfig(cyrusHome);
		const repos = [...config.repositories];
		const index = findRepoIndex(repos, payload.name);
		if (index < 0) {
			return {
				success: false,
				error: `Repository ${payload.name} is not configured`,
			};
		}
		repos[index] = { ...repos[index], ...routingUpdates(payload) };
		writeConfig(cyrusHome, { ...config, repositories: repos });
		return {
			success: true,
			message: "Routing updated",
			data: { repository: publicRepository(repos[index]!) },
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to update routing",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * DELETE /api/dashboard/repository: remove a repository from `config.json`;
 * with `deleteFiles` also delete its clone.
 */
export async function handleDashboardRemoveRepository(
	payload: { name?: string; deleteFiles?: boolean },
	cyrusHome: string,
): Promise<ApiResponse> {
	if (!payload?.name || typeof payload.name !== "string") {
		return { success: false, error: "Repository name is required" };
	}
	try {
		const config = readConfig(cyrusHome);
		const index = findRepoIndex(config.repositories, payload.name);
		if (index < 0) {
			return {
				success: false,
				error: `Repository ${payload.name} is not configured`,
			};
		}
		const removed = config.repositories[index]!;
		writeConfig(cyrusHome, {
			...config,
			repositories: config.repositories.filter((_, i) => i !== index),
		});
		if (payload.deleteFiles) {
			const deleted = await handleRepositoryDelete(
				{
					repository_name: String(removed.name ?? payload.name),
					linear_team_key: "",
				},
				cyrusHome,
			);
			if (!deleted.success) {
				return {
					success: false,
					error: "Removed from configuration, but deleting the files failed",
					details: deleted.details ?? deleted.error,
				};
			}
		}
		return {
			success: true,
			message: payload.deleteFiles
				? "Repository removed and files deleted"
				: "Repository removed from configuration",
			data: { name: removed.name ?? payload.name },
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to remove repository",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}
