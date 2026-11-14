import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

/**
 * The dashboard's view of a session: one compact summary per session, built
 * from a stored session (as the edge worker serializes it) and its entries.
 *
 * The same summaries are kept in the session history (see
 * {@link SessionHistory}), so sessions stay listed after nyrus dropped them
 * from its live state (a restart for chat sessions, a ticket that was closed
 * for issue sessions).
 */

/** Pull request URLs on GitHub or GitLab, as agents post them. */
const PR_URL =
	/https:\/\/(?:github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|gitlab\.com\/[\w./-]+\/-\/merge_requests\/\d+)/g;

/** Longest title kept for a session without a ticket (chat sessions). */
const MAX_TITLE = 140;

export interface StoredEntry {
	type?: string;
	content?: unknown;
	metadata?: {
		timestamp?: number;
		toolName?: string;
		isError?: boolean;
		toolResultError?: boolean;
	};
}

export interface StoredSession {
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
	claudeSessionId?: string;
	geminiSessionId?: string;
	codexSessionId?: string;
	cursorSessionId?: string;
	opencodeSessionId?: string;
	metadata?: {
		model?: string;
		title?: string;
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

/**
 * Where a session came from: `linear`, `jira`, `clickup`, `github-issue`,
 * `github-pr`, `gitlab`, `slack`, `zulip`, `plane`, `cli`, or the session's
 * tracker id for anything else (`unknown` without one).
 */
export type SessionSource = string;

/** Status groups for filtering: what a person wants to know at a glance. */
export type SessionState =
	| "running"
	| "waiting"
	| "finished"
	| "failed"
	| "stale";

export interface SessionSummary {
	id: string;
	status: string;
	state: SessionState;
	createdAt: number | null;
	updatedAt: number | null;
	tracker: string | null;
	source: SessionSource;
	title: string | null;
	issue: {
		id: string | undefined;
		identifier: string | null;
		title: string | null;
	};
	repositories: { id: string | null; branch: string | null }[];
	workspacePath: string | null;
	model: string | null;
	runner: string | null;
	totalCostUsd: number | null;
	runtimeMs: number | null;
	runs: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheCreation: number;
		total: number;
	} | null;
	entryCount: number;
	lastActivityAt: number | null;
	pullRequestUrl: string | null;
	parentSessionId: string | null;
	/** Whether nyrus still holds the session (with its activity log). */
	live: boolean;
}

/** Trackers whose sessions run Linear-shaped: their ids are `<platform>-<issue id>`. */
const COMMENT_TRACKERS = ["jira", "clickup"];

/** Chat platforms; their session ids are `<platform>-<event id>`. */
const CHAT_PLATFORMS = ["slack", "zulip"];

/**
 * The session's tracker. Jira and ClickUp sessions run as Linear-shaped
 * sessions (tracker "linear"), so their id prefix names the real one.
 */
export function trackerOf(session: StoredSession): string | null {
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
 * Where the session came from, read from its id and tracker. Plane and CLI
 * sessions look exactly like Linear sessions; the edge worker knows better
 * and passes that as `linearShapedSource`.
 */
export function sessionSource(
	session: StoredSession,
	linearShapedSource?: string,
): SessionSource {
	const id = session.id;
	if (id.startsWith("gh-issues-")) return "github-issue";
	if (id.startsWith("github-")) return "github-pr";
	if (id.startsWith("gitlab-")) return "gitlab";
	const prefix = id.split("-")[0] ?? "";
	if (COMMENT_TRACKERS.includes(prefix) || CHAT_PLATFORMS.includes(prefix)) {
		return prefix;
	}
	const trackerId = session.issueContext?.trackerId;
	if (trackerId === "github") return "github-pr";
	if (trackerId === "linear" || (!trackerId && session.issue)) {
		return linearShapedSource ?? "linear";
	}
	return trackerId ?? linearShapedSource ?? "unknown";
}

/** The status group of a Linear-style session status. */
export function sessionState(status: string | undefined): SessionState {
	switch (status) {
		case "active":
			return "running";
		case "pending":
		case "awaitingInput":
			return "waiting";
		case "complete":
			return "finished";
		case "error":
			return "failed";
		case "stale":
			return "stale";
		default:
			return "finished";
	}
}

/** The runner that ran the session, from the runner session id it got. */
export function runnerOf(session: StoredSession): string | null {
	if (session.claudeSessionId) return "claude";
	if (session.geminiSessionId) return "gemini";
	if (session.codexSessionId) return "codex";
	if (session.cursorSessionId) return "cursor";
	if (session.opencodeSessionId) return "opencode";
	return null;
}

/** A one-line title for a session without a ticket, from its first prompt. */
export function chatTitle(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line;
}

export function entryText(entry: StoredEntry): string {
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

export interface SummaryOptions {
	now?: number;
	/** Source of a Linear-shaped session (Plane, CLI), see {@link sessionSource}. */
	source?: string;
	parentSessionId?: string | null;
}

export function summarizeSession(
	session: StoredSession,
	entries: StoredEntry[],
	options: SummaryOptions = {},
): SessionSummary {
	const now = options.now ?? Date.now();
	const timestamps = entries
		.map((entry) => entry.metadata?.timestamp)
		.filter((ts): ts is number => typeof ts === "number");
	const status = session.status ?? "unknown";
	const issueTitle = session.issue?.title ?? null;
	return {
		id: session.id,
		status,
		state: sessionState(status),
		createdAt: session.createdAt ?? null,
		updatedAt: session.updatedAt ?? null,
		tracker: trackerOf(session),
		source: sessionSource(session, options.source),
		title: issueTitle ?? session.metadata?.title ?? null,
		issue: {
			id: session.issueContext?.issueId ?? session.issue?.id ?? session.issueId,
			identifier:
				session.issueContext?.issueIdentifier ??
				session.issue?.identifier ??
				null,
			title: issueTitle,
		},
		repositories: (session.repositories ?? []).map((repo) => ({
			id: repo.repositoryId ?? null,
			branch: repo.branchName ?? null,
		})),
		workspacePath: session.workspace?.path ?? null,
		model: session.metadata?.model ?? null,
		runner: runnerOf(session),
		totalCostUsd:
			session.metadata?.totals?.costUsd ??
			session.metadata?.totalCostUsd ??
			null,
		...runtimeAndTokens(session, now),
		entryCount: entries.length,
		lastActivityAt: timestamps.length > 0 ? Math.max(...timestamps) : null,
		pullRequestUrl: lastPullRequestUrl(entries) ?? null,
		parentSessionId: options.parentSessionId ?? null,
		live: true,
	};
}

/**
 * A summary of a session nyrus no longer holds. A session that was still
 * running or waiting when it was dropped (e.g. a chat session at a restart)
 * did not finish: it is shown as interrupted ("stale").
 */
export function historicalSummary(summary: SessionSummary): SessionSummary {
	const unfinished = summary.state === "running" || summary.state === "waiting";
	return {
		...summary,
		status: unfinished ? "stale" : summary.status,
		state: unfinished ? "stale" : summary.state,
		live: false,
	};
}

export interface SessionHistoryOptions {
	/** Most sessions kept (default 500). */
	maxEntries?: number;
	/** Oldest session kept, by last update (default 30 days). */
	maxAgeMs?: number;
	now?: () => number;
}

/**
 * A bounded, persisted list of session summaries, newest first. The edge
 * worker records every session it holds into it; the dashboard lists the
 * recorded sessions nyrus no longer holds alongside the live ones.
 */
export class SessionHistory {
	private readonly records = new Map<string, SessionSummary>();
	private readonly maxEntries: number;
	private readonly maxAgeMs: number;
	private readonly now: () => number;
	private dirty = false;

	constructor(
		private readonly path: string,
		options: SessionHistoryOptions = {},
	) {
		this.maxEntries = options.maxEntries ?? 500;
		this.maxAgeMs = options.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000;
		this.now = options.now ?? Date.now;
		this.load();
	}

	/** Read the summaries a path holds, without keeping a history. */
	static read(path: string): SessionSummary[] {
		if (!existsSync(path)) return [];
		try {
			const data = JSON.parse(readFileSync(path, "utf-8")) as {
				sessions?: SessionSummary[];
			};
			return Array.isArray(data.sessions)
				? data.sessions.filter(
						(s) => s && typeof s === "object" && typeof s.id === "string",
					)
				: [];
		} catch {
			return [];
		}
	}

	private load(): void {
		for (const summary of SessionHistory.read(this.path)) {
			this.records.set(summary.id, summary);
		}
	}

	/**
	 * Whether the recorded summary of a session is up to date, so recording
	 * it again can be skipped (summarizing scans all of its entries).
	 */
	isCurrent(
		id: string,
		updatedAt: number | undefined,
		status: string | undefined,
		entryCount: number,
	): boolean {
		const record = this.records.get(id);
		return (
			record !== undefined &&
			record.updatedAt === (updatedAt ?? null) &&
			record.status === (status ?? "unknown") &&
			record.entryCount === entryCount
		);
	}

	record(summary: SessionSummary): void {
		const existing = this.records.get(summary.id);
		const next = { ...summary, live: true };
		if (existing && JSON.stringify(existing) === JSON.stringify(next)) {
			return;
		}
		this.records.set(summary.id, next);
		this.dirty = true;
	}

	get(id: string): SessionSummary | undefined {
		return this.records.get(id);
	}

	/** The recorded summaries, newest first, within the bounds. */
	list(): SessionSummary[] {
		this.prune();
		return [...this.records.values()];
	}

	private prune(): void {
		const cutoff = this.now() - this.maxAgeMs;
		const sorted = [...this.records.values()].sort(
			(a, b) =>
				(b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
		);
		const kept = sorted
			.filter((s) => (s.updatedAt ?? s.createdAt ?? 0) >= cutoff)
			.slice(0, this.maxEntries);
		if (kept.length !== this.records.size) {
			this.dirty = true;
		}
		this.records.clear();
		for (const summary of kept) {
			this.records.set(summary.id, summary);
		}
	}

	/** Write the history if it changed since the last write. */
	save(): void {
		this.prune();
		if (!this.dirty) return;
		mkdirSync(dirname(this.path), { recursive: true });
		const tmp = `${this.path}.tmp`;
		writeFileSync(
			tmp,
			JSON.stringify({ version: 1, sessions: [...this.records.values()] }),
			"utf-8",
		);
		renameSync(tmp, this.path);
		this.dirty = false;
	}
}

/** Where the edge worker keeps the session history, inside its home. */
export const SESSION_HISTORY_FILE = "session-history.json";
