import { createLogger, type ILogger } from "cyrus-core";
import type { JiraApiClient } from "./JiraApiClient.js";
import { markdownToWiki, signed } from "./JiraText.js";

/** At most one edit of a note in this interval; each edit is an API call. */
const MIN_UPDATE_MS = 20_000;
const MAX_THOUGHT = 400;
const MAX_STEP = 120;
const MAX_STEPS = 5;
/** Cyrus's own housekeeping thoughts, not worth showing as progress. */
const HOUSEKEEPING =
	/^(Using model:|Analyzing your request|Still working|Conversation history compacted)/i;

interface Note {
	issueId: string;
	commentId: string;
	latest?: string;
	steps: string[];
	shown: string;
	lastUpdate: number;
	timer?: NodeJS.Timeout;
}

/**
 * One comment on the issue that says Cyrus is working and what it is doing
 * now. Jira has no agent timeline, and a comment for every thought and tool
 * call would bury the issue, so the note is posted at the session's first
 * step, edited with its latest thought and last few steps (at most every
 * 20 s, without notifying watchers), and deleted when Cyrus answers, asks a
 * question or fails, so only the answer stays.
 */
export class JiraProgressNotes {
	private readonly notes = new Map<string, Promise<Note | undefined>>();
	private readonly logger: ILogger;

	constructor(
		private readonly api: JiraApiClient,
		private readonly options: {
			minUpdateMs?: number;
			logger?: ILogger;
			/** Called with the id of every note comment, so its webhook is ignored. */
			onCreated?: (commentId: string, issueId: string) => void;
		} = {},
	) {
		this.logger =
			options.logger ?? createLogger({ component: "JiraProgressNotes" });
	}

	/** Called for every thought or action of a session. Never throws. */
	async onStep(
		issueId: string,
		step: { thought?: string; action?: string },
	): Promise<void> {
		try {
			const thought = step.thought?.trim();
			const latest =
				thought && !HOUSEKEEPING.test(thought) ? thought : undefined;
			const created = this.notes.get(issueId);
			if (!created) {
				const creating = this.create(issueId, latest, step.action);
				this.notes.set(issueId, creating);
				try {
					await creating;
				} catch (error) {
					// Let a later step try again.
					if (this.notes.get(issueId) === creating) this.notes.delete(issueId);
					throw error;
				}
				return;
			}
			const note = await created;
			if (!note) return;
			if (latest) note.latest = latest;
			if (step.action) {
				note.steps.push(step.action);
				if (note.steps.length > MAX_STEPS) note.steps.shift();
			}
			this.schedule(note);
		} catch (error) {
			this.logger.warn(`Progress note for issue ${issueId} failed`, error);
		}
	}

	/** Delete the issue's note, if any. Never throws. */
	async finish(issueId: string): Promise<void> {
		const created = this.notes.get(issueId);
		if (!created) return;
		this.notes.delete(issueId);
		const note = await created.catch(() => undefined);
		if (!note) return;
		clearTimeout(note.timer);
		await this.api
			.deleteComment(note.issueId, note.commentId)
			.catch((error) =>
				this.logger.warn(`Deleting progress note on ${issueId} failed`, error),
			);
	}

	/** Stop pending edits (on shutdown). */
	dispose(): void {
		for (const created of this.notes.values()) {
			void created.then((note) => clearTimeout(note?.timer)).catch(() => {});
		}
		this.notes.clear();
	}

	private async create(
		issueId: string,
		latest: string | undefined,
		action: string | undefined,
	): Promise<Note | undefined> {
		const note: Note = {
			issueId,
			commentId: "",
			latest,
			steps: action ? [action] : [],
			shown: "",
			lastUpdate: Date.now(),
		};
		const body = noteWiki(note);
		const comment = await this.api.createComment(issueId, body);
		note.commentId = comment.id;
		note.shown = body;
		this.options.onCreated?.(comment.id, issueId);
		return note;
	}

	private schedule(note: Note): void {
		if (note.timer) return;
		const wait = Math.max(
			0,
			note.lastUpdate +
				(this.options.minUpdateMs ?? MIN_UPDATE_MS) -
				Date.now(),
		);
		const flush = () => {
			note.timer = undefined;
			const body = noteWiki(note);
			if (body === note.shown) return;
			note.lastUpdate = Date.now();
			void this.api
				.updateComment(note.issueId, note.commentId, body)
				.then(() => {
					// Only once Jira has it, so a failed edit is retried by the next step.
					note.shown = body;
				})
				.catch((error) =>
					this.logger.warn("Progress note update failed", error),
				);
		};
		if (wait === 0) flush();
		else {
			note.timer = setTimeout(flush, wait);
			note.timer.unref?.();
		}
	}
}

function truncate(text: string, max: number): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** Exported for tests. */
export function noteWiki(note: { latest?: string; steps: string[] }): string {
	const parts = [
		"⏳ *Working on it.* This comment goes away when I post my answer.",
	];
	if (note.latest) {
		parts.push(
			markdownToWiki(`**Now:** ${truncate(note.latest, MAX_THOUGHT)}`),
		);
	}
	if (note.steps.length) {
		parts.push(
			`*Recent steps:*\n${note.steps
				.map(
					(step) =>
						`* {{${truncate(step, MAX_STEP).replace(/[{}]/g, (c) => `\\${c}`)}}}`,
				)
				.join("\n")}`,
		);
	}
	return signed(parts.join("\n\n"));
}
