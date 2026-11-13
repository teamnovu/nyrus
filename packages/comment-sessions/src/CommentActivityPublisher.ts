import {
	type AgentActivityCreateInput,
	createLogger,
	type ILogger,
} from "cyrus-core";
import type { SessionDirectory, SessionRecord } from "./SessionDirectory.js";
import type { CommentTracker } from "./types.js";

/** At most one edit of a progress comment in this interval (rate limits). */
const MIN_UPDATE_MS = 15_000;
const MAX_PROGRESS_TEXT = 400;
/** Cyrus's own housekeeping thoughts, not worth showing as progress. */
const HOUSEKEEPING =
	/^(Using model:|Analyzing your request|Still working|Conversation history compacted)/i;

export interface CommentActivityPublisherOptions {
	minUpdateMs?: number;
	logger?: ILogger;
}

interface ProgressNote {
	commentId: string;
	shown: string;
	pending?: string;
	lastUpdate: number;
	timer?: NodeJS.Timeout;
}

interface ActivityContent {
	type: string;
	body?: string;
	action?: string;
	parameter?: unknown;
}

interface SignalMetadata {
	options?: Array<{ value: string; label?: string }>;
	url?: string;
}

/**
 * Posts a session's agent activities as ticket comments:
 *
 * - Thoughts and actions keep one "working on it" comment up to date with the
 *   latest step (edited at most every 15 s). It is deleted when the session
 *   answers, asks or fails, so only those stay on the ticket.
 * - Responses are posted as comments.
 * - Questions are posted with their options numbered; a reply with the
 *   number is resolved by the coordinator.
 * - Errors are posted as a comment with a warning sign.
 */
export class CommentActivityPublisher {
	private readonly notes = new Map<string, Promise<ProgressNote | undefined>>();
	private readonly logger: ILogger;

	constructor(
		private readonly tracker: CommentTracker,
		private readonly directory: SessionDirectory,
		private readonly options: CommentActivityPublisherOptions = {},
	) {
		this.logger =
			options.logger ?? createLogger({ component: "CommentActivityPublisher" });
	}

	/** Returns the id of the comment it posted, or "" if none. */
	async publish(input: AgentActivityCreateInput): Promise<{ id: string }> {
		const record = this.directory.get(input.agentSessionId);
		if (!record) {
			this.logger.warn(
				`Dropping activity for unknown ${this.tracker.platform} session ${input.agentSessionId}`,
			);
			return { id: "" };
		}
		const content = input.content as ActivityContent;
		switch (content.type) {
			case "thought":
			case "action":
				await this.progress(record, progressText(content));
				return { id: "" };
			case "response":
				await this.finishProgress(record);
				return this.tracker.postComment(record.issueId, content.body ?? "");
			case "elicitation":
				await this.finishProgress(record);
				return this.postQuestion(
					record,
					content.body ?? "",
					input.signalMetadata as SignalMetadata | undefined,
				);
			case "error":
				await this.finishProgress(record);
				return this.tracker.postComment(
					record.issueId,
					`⚠️ ${content.body ?? "Something went wrong."}`,
				);
			default:
				return { id: "" }; // prompts are the user's side
		}
	}

	/** Cancel pending progress edits (on shutdown). */
	dispose(): void {
		for (const created of this.notes.values()) {
			void created.then((note) => clearTimeout(note?.timer));
		}
		this.notes.clear();
	}

	private async postQuestion(
		record: SessionRecord,
		body: string,
		metadata: SignalMetadata | undefined,
	): Promise<{ id: string }> {
		const options = metadata?.options ?? [];
		let text = body;
		if (options.length > 0) {
			const list = options
				.map((o, i) => `${i + 1}. ${o.label ?? o.value}`)
				.join("\n");
			text += `\n\n${list}\n\nReply with the number or the name.`;
			this.directory.update(record.sessionId, {
				pendingOptions: options.map((o) => o.value),
			});
		}
		if (metadata?.url) {
			text += `\n\n${metadata.url}`;
		}
		return this.tracker.postComment(record.issueId, text);
	}

	private async progress(
		record: SessionRecord,
		latest: string | undefined,
	): Promise<void> {
		try {
			let created = this.notes.get(record.sessionId);
			if (!created) {
				created = this.createNote(record, latest);
				this.notes.set(record.sessionId, created);
				await created;
				return;
			}
			const note = await created;
			if (note && latest) this.scheduleUpdate(record, note, latest);
		} catch (error) {
			this.logger.warn(
				`Progress comment for session ${record.sessionId} failed`,
				error,
			);
		}
	}

	private async createNote(
		record: SessionRecord,
		latest: string | undefined,
	): Promise<ProgressNote | undefined> {
		// A progress comment left over from before a restart is reused.
		if (record.progressCommentId) {
			const note: ProgressNote = {
				commentId: record.progressCommentId,
				shown: "",
				lastUpdate: 0,
			};
			if (latest) this.scheduleUpdate(record, note, latest);
			return note;
		}
		const text = latest ?? "";
		const comment = await this.tracker.postComment(
			record.issueId,
			progressMarkdown(text),
		);
		this.directory.update(record.sessionId, { progressCommentId: comment.id });
		return { commentId: comment.id, shown: text, lastUpdate: Date.now() };
	}

	private scheduleUpdate(
		record: SessionRecord,
		note: ProgressNote,
		latest: string,
	): void {
		note.pending = latest;
		if (note.timer) return;
		const wait = Math.max(
			0,
			note.lastUpdate +
				(this.options.minUpdateMs ?? MIN_UPDATE_MS) -
				Date.now(),
		);
		const flush = () => {
			note.timer = undefined;
			const text = note.pending;
			note.pending = undefined;
			if (!text || text === note.shown) return;
			note.shown = text;
			note.lastUpdate = Date.now();
			void this.tracker
				.updateComment(record.issueId, note.commentId, progressMarkdown(text))
				.catch((error) =>
					this.logger.warn("Progress comment update failed", error),
				);
		};
		if (wait === 0) flush();
		else note.timer = setTimeout(flush, wait);
	}

	/** Delete the session's progress comment, if it has one. Never throws. */
	private async finishProgress(record: SessionRecord): Promise<void> {
		const created = this.notes.get(record.sessionId);
		this.notes.delete(record.sessionId);
		const note = await created?.catch(() => undefined);
		clearTimeout(note?.timer);
		const commentId = note?.commentId ?? record.progressCommentId;
		if (!commentId) return;
		this.directory.update(record.sessionId, { progressCommentId: undefined });
		try {
			await this.tracker.deleteComment(record.issueId, commentId);
		} catch (error) {
			this.logger.warn(`Could not delete progress comment ${commentId}`, error);
		}
	}
}

function progressText(content: ActivityContent): string | undefined {
	if (content.type === "thought") {
		const thought = content.body?.trim();
		return thought && !HOUSEKEEPING.test(thought) ? thought : undefined;
	}
	if (!content.action) return undefined;
	const parameter =
		typeof content.parameter === "string" ? content.parameter.trim() : "";
	return parameter ? `${content.action}: ${parameter}` : content.action;
}

function progressMarkdown(latest: string): string {
	const text =
		latest.length > MAX_PROGRESS_TEXT
			? `${latest.slice(0, MAX_PROGRESS_TEXT)}…`
			: latest;
	return (
		"⏳ **Working on it.** This comment goes away when I post my answer." +
		(text ? `\n\nNow: ${text}` : "")
	);
}
