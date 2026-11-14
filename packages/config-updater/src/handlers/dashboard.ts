import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDefaultReposDir, getDefaultWorktreesDir } from "cyrus-core";
import {
	entryText,
	historicalSummary,
	SESSION_HISTORY_FILE,
	SessionHistory,
	type SessionSummary,
	type StoredEntry,
	type StoredSession,
	summarizeSession,
} from "../sessionSummary.js";
import type { ApiResponse } from "../types.js";
import { resolveEnvFilePath } from "./envPath.js";
import { handleRepository, handleRepositoryDelete } from "./repository.js";

/**
 * Handlers behind the nyrus dashboard (`/api/dashboard/*`).
 *
 * They read what nyrus already persists in its home directory (the session
 * state file and history, `config.json`, `.env`) and make small, targeted changes to the
 * repository list in `config.json`. nyrus watches `config.json` and picks up
 * repository changes without a restart. Secrets are never returned: tokens
 * are stripped from repositories and only the names of `.env` variables are
 * listed.
 */

/** Longest entry content returned in a session detail. */
const MAX_ENTRY_CONTENT = 4000;
/** Repository fields that can hold credentials and must not leave nyrus. */
const SECRET_REPO_FIELDS = ["linearToken", "linearRefreshToken"] as const;

/**
 * What the dashboard reads: the edge worker's serialized sessions (issue
 * sessions and chat sessions), plus hints only the edge worker knows and the
 * session history (sessions it no longer holds).
 */
export interface StoredState {
	agentSessions?: Record<string, StoredSession>;
	agentSessionEntries?: Record<string, StoredEntry[]>;
	childToParentAgentSession?: Record<string, string>;
	/** Source of Linear-shaped sessions that are not Linear's (Plane, CLI). */
	sessionSources?: Record<string, string>;
	sessionHistory?: SessionSummary[];
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
	const history = SessionHistory.read(
		join(cyrusHome, "state", SESSION_HISTORY_FILE),
	);
	if (!existsSync(statePath)) {
		return { sessionHistory: history };
	}
	const file = readJson(statePath) as { state?: StoredState };
	return { sessionHistory: history, ...(file.state ?? {}) };
}

function summarize(state: StoredState, session: StoredSession, now?: number) {
	return summarizeSession(
		session,
		state.agentSessionEntries?.[session.id] ?? [],
		{
			now,
			source: state.sessionSources?.[session.id],
			parentSessionId: state.childToParentAgentSession?.[session.id] ?? null,
		},
	);
}

/**
 * Every session nyrus holds, plus the recorded ones it no longer holds,
 * newest first.
 */
export function listSessions(state: StoredState, now = Date.now()) {
	const live = Object.values(state.agentSessions ?? {}).map((session) =>
		summarize(state, session, now),
	);
	const liveIds = new Set(live.map((session) => session.id));
	const past = (state.sessionHistory ?? [])
		.filter((summary) => !liveIds.has(summary.id))
		.map(historicalSummary);
	const sortKey = (s: { updatedAt: number | null; createdAt: number | null }) =>
		s.updatedAt ?? s.createdAt ?? 0;
	return [...live, ...past].sort((a, b) => sortKey(b) - sortKey(a));
}

/** GET /api/dashboard/sessions: all known sessions, newest first. */
export async function handleDashboardSessions(
	cyrusHome: string,
	readLiveState?: () => unknown,
): Promise<ApiResponse> {
	try {
		const sessions = listSessions(readState(cyrusHome, readLiveState));
		return { success: true, message: "Sessions", data: { sessions } };
	} catch (error) {
		return {
			success: false,
			error: "Failed to read sessions",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * GET /api/dashboard/session?id=…: one session with its activity log. A
 * session nyrus no longer holds comes from the history, without entries.
 */
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
			const past = state.sessionHistory?.find((s) => s.id === query.id);
			if (!past) {
				return { success: false, error: `Session ${query.id} not found` };
			}
			return {
				success: true,
				message: "Session",
				data: { session: historicalSummary(past), entries: [] },
			};
		}
		const entries = state.agentSessionEntries?.[query.id] ?? [];
		return {
			success: true,
			message: "Session",
			data: {
				session: summarize(state, session),
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
	routingGroup?: string;
	isActive?: boolean;
}

const ROUTING_FIELDS = [
	"baseBranch",
	"githubUrl",
	"linearWorkspaceId",
	"teamKeys",
	"projectKeys",
	"routingLabels",
	"routingGroup",
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
