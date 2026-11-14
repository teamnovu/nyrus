import {
	type AgentActivityCreateInput,
	createLogger,
	type ILogger,
} from "cyrus-core";
import type { QuestionOption, SessionStore } from "./SessionStore.js";
import type { CommentTracker } from "./types.js";

/** At most one edit of a progress comment in this interval; each edit is an API call. */
const MIN_UPDATE_MS = 20_000;
const MAX_THOUGHT = 400;
const MAX_STEP = 120;
const MAX_STEPS = 5;
/** Cyrus's own housekeeping thoughts, not worth showing as progress. */
const HOUSEKEEPING =
	/^(Using model:|Analyzing your request|Still working|Conversation history compacted)/i;

export interface CommentActivityPublisherOptions {
	/** Minimum time between edits of a progress comment (default 20 s). */
	minUpdateMs?: number;
	logger?: ILogger;
}

interface ProgressNote {
	issueId: string;
	commentId: string;
	latest?: string;
	steps: string[];
	shown: string;
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
	options?: QuestionOption[];
	url?: string;
}

/**
 * Posts a session's agent activities as comments on its ticket:
 *
 * - Thoughts and actions keep one "working on it" comment up to date with the
 *   latest thought and the last few steps (edited at most every 20 s, without
 *   notifying watchers). It is deleted when the agent answers, asks or fails,
 *   so only those stay on the ticket.
 * - Responses are posted as comments.
 * - Questions are posted with their options numbered; a reply with the
 *   number or the option's name is resolved by the coordinator.
 * - Errors are posted with a warning sign.
 *
 * Every comment it posts is remembered in the store, so its webhook is ignored.
 */
export class CommentActivityPublisher {
	private readonly notes = new Map<string, Promise<ProgressNote>>();
	private readonly logger: ILogger;

	constructor(
		private readonly tracker: CommentTracker,
		private readonly store: SessionStore,
		private readonly options: CommentActivityPublisherOptions = {},
	) {
		this.logger =
			options.logger ?? createLogger({ component: "CommentActivityPublisher" });
	}

	/**
	 * Post one activity of a session on the given ticket. Returns the id of
	 * the comment it posted, or "" if none.
	 */
	async publish(
		issueId: string,
		input: AgentActivityCreateInput,
	): Promise<{ id: string }> {
		const sessionId = input.agentSessionId;
		const content = input.content as ActivityContent;
		switch (content.type) {
			case "thought": {
				const thought = content.body?.trim();
				await this.progress(sessionId, issueId, {
					thought: thought && !HOUSEKEEPING.test(thought) ? thought : undefined,
				});
				return { id: "" };
			}
			case "action":
				await this.progress(sessionId, issueId, {
					action: describeAction(content.action, content.parameter),
				});
				return { id: "" };
			case "response":
				await this.finishProgress(sessionId);
				this.store.setQuestion(sessionId, []); // an open question is moot now
				return this.post(issueId, content.body ?? "", "response");
			case "elicitation":
				await this.finishProgress(sessionId);
				return this.postQuestion(
					sessionId,
					issueId,
					content.body ?? "",
					input.signalMetadata as SignalMetadata | undefined,
				);
			case "error":
				await this.finishProgress(sessionId);
				this.store.setQuestion(sessionId, []);
				return this.post(
					issueId,
					`⚠️ ${content.body || "Something went wrong."}`,
					"error",
				);
			default:
				return { id: "" }; // prompts are the user's side
		}
	}

	/** Cancel pending progress edits (on shutdown). */
	dispose(): void {
		for (const created of this.notes.values()) {
			void created.then((note) => clearTimeout(note.timer)).catch(() => {});
		}
		this.notes.clear();
	}

	private async post(
		issueId: string,
		markdown: string,
		kind: "response" | "question" | "error",
	): Promise<{ id: string }> {
		const comment = await this.tracker.postComment(issueId, markdown, {
			kind,
		});
		this.store.rememberOwnComment(comment.id);
		return comment;
	}

	private postQuestion(
		sessionId: string,
		issueId: string,
		body: string,
		metadata: SignalMetadata | undefined,
	): Promise<{ id: string }> {
		const options = metadata?.options ?? [];
		this.store.setQuestion(sessionId, options);
		let text = body;
		if (options.length > 0) {
			const list = options
				.map((o, i) =>
					o.label && o.label !== o.value
						? `${i + 1}. ${o.label} (\`${o.value}\`)`
						: `${i + 1}. \`${o.value}\``,
				)
				.join("\n");
			text += `\n\n${list}\n\nReply with the number or the name.`;
		} else {
			text += "\n\n_Reply with a comment._";
		}
		if (metadata?.url) text += `\n\n${metadata.url}`;
		return this.post(issueId, text, "question");
	}

	/** Never throws: progress is a nicety, not worth failing the session for. */
	private async progress(
		sessionId: string,
		issueId: string,
		step: { thought?: string; action?: string },
	): Promise<void> {
		try {
			const created = this.notes.get(sessionId);
			if (!created) {
				const creating = this.createNote(issueId, step);
				this.notes.set(sessionId, creating);
				try {
					await creating;
				} catch (error) {
					// Let a later step try again.
					if (this.notes.get(sessionId) === creating) {
						this.notes.delete(sessionId);
					}
					throw error;
				}
				return;
			}
			const note = await created;
			if (step.thought) note.latest = step.thought;
			if (step.action) {
				note.steps.push(step.action);
				if (note.steps.length > MAX_STEPS) note.steps.shift();
			}
			this.schedule(note);
		} catch (error) {
			this.logger.warn(
				`Progress comment for session ${sessionId} failed`,
				error,
			);
		}
	}

	private async createNote(
		issueId: string,
		step: { thought?: string; action?: string },
	): Promise<ProgressNote> {
		const note: ProgressNote = {
			issueId,
			commentId: "",
			latest: step.thought,
			steps: step.action ? [step.action] : [],
			shown: "",
			lastUpdate: Date.now(),
		};
		const body = progressMarkdown(note);
		const comment = await this.tracker.postComment(issueId, body, {
			progress: true,
			kind: "progress",
		});
		this.store.rememberOwnComment(comment.id);
		note.commentId = comment.id;
		note.shown = body;
		return note;
	}

	private schedule(note: ProgressNote): void {
		if (note.timer) return;
		const wait = Math.max(
			0,
			note.lastUpdate +
				(this.options.minUpdateMs ?? MIN_UPDATE_MS) -
				Date.now(),
		);
		const flush = () => {
			note.timer = undefined;
			const body = progressMarkdown(note);
			if (body === note.shown) return;
			note.lastUpdate = Date.now();
			void this.tracker
				.updateComment(note.issueId, note.commentId, body, {
					progress: true,
					kind: "progress",
				})
				.then(() => {
					// Only once the tracker has it, so a failed edit is retried by the next step.
					note.shown = body;
				})
				.catch((error) =>
					this.logger.warn("Progress comment update failed", error),
				);
		};
		if (wait === 0) flush();
		else {
			note.timer = setTimeout(flush, wait);
			note.timer.unref?.();
		}
	}

	/** Delete the session's progress comment, if it has one. Never throws. */
	private async finishProgress(sessionId: string): Promise<void> {
		const created = this.notes.get(sessionId);
		if (!created) return;
		this.notes.delete(sessionId);
		const note = await created.catch(() => undefined);
		if (!note) return;
		clearTimeout(note.timer);
		await this.tracker
			.deleteComment(note.issueId, note.commentId)
			.catch((error) =>
				this.logger.warn(
					`Could not delete progress comment ${note.commentId}`,
					error,
				),
			);
	}
}

function describeAction(
	action: string | undefined,
	parameter: unknown,
): string {
	const name = action ?? "action";
	if (parameter === undefined || parameter === null || parameter === "") {
		return name;
	}
	const text =
		typeof parameter === "string" ? parameter : JSON.stringify(parameter);
	return `${name}: ${text}`;
}

function truncate(text: string, max: number): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** The "working on it" comment. Exported for tests. */
export function progressMarkdown(note: {
	latest?: string;
	steps: string[];
}): string {
	const parts = [
		"⏳ **Working on it.** This comment goes away when I post my answer.",
	];
	if (note.latest) {
		parts.push(`**Now:** ${truncate(note.latest, MAX_THOUGHT)}`);
	}
	if (note.steps.length) {
		parts.push(
			`**Recent steps:**\n${note.steps
				.map((step) => `- \`${truncate(step, MAX_STEP).replace(/`/g, "'")}\``)
				.join("\n")}`,
		);
	}
	return parts.join("\n\n");
}
