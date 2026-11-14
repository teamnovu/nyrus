import type {
	CommentSessionCoordinator,
	CommentTrackerEvent,
	TrackerUser,
} from "cyrus-comment-sessions";
import type { ILogger } from "cyrus-core";
import {
	type ClickUpIssueTrackerService,
	commentMarkdown,
	commentText,
} from "./ClickUpIssueTrackerService.js";
import { parseCommand } from "./ClickUpText.js";
import type {
	ClickUpHistoryItem,
	ClickUpTriggerOptions,
	ClickUpUser,
	ClickUpWebhookPayload,
} from "./types.js";

/** Deliveries that report a comment. */
const COMMENT_EVENTS = new Set(["taskCommentPosted"]);

/**
 * Deliveries that may hand a task over or take it away. Others (comment
 * edits, time tracking, due dates...) are ignored.
 */
const TASK_EVENTS = new Set([
	"taskCreated",
	"taskUpdated",
	"taskTagUpdated",
	"taskAssigneeUpdated",
	"taskStatusUpdated",
	"taskMoved",
]);

/**
 * Turns verified ClickUp deliveries into cyrus-comment-sessions events.
 *
 * ClickUp's deliveries are thin and their exact shapes not yet confirmed, so
 * the handler reads the task (and, if the delivery lacks it, the comment)
 * from the API, and reads as little as it can from the delivery: the task
 * id, the comment, who did it, and which tag or assignee changed. Whether
 * the task is handed over is decided from the fresh task; a change of that
 * since the last delivery for the task counts as a hand-over or take-away
 * when the delivery itself doesn't say.
 *
 * - The tag (default `nyrus`) hands a task over; removing it takes it away.
 *   With `triggerOnAssign`, so does assigning the token's person.
 * - A comment starting with `/nyrus` addresses nyrus, like an @mention.
 * - nyrus's own comments (posted ids, "🤖 nyrus:" signature) are ignored.
 * - Tasks outside the configured Spaces are ignored.
 *
 * Deliveries for one task are handled one at a time, in order.
 */
export class ClickUpEventHandler {
	private readonly queues = new Map<string, Promise<void>>();
	/** Whether each task was handed over at its last delivery. */
	private readonly handedOver = new Map<string, boolean>();

	constructor(
		private readonly tracker: ClickUpIssueTrackerService,
		private readonly coordinator: Pick<CommentSessionCoordinator, "handle">,
		private readonly logger: ILogger,
	) {}

	handle(payload: ClickUpWebhookPayload): Promise<void> {
		const taskId = payload.task_id;
		if (
			!taskId ||
			!(COMMENT_EVENTS.has(payload.event) || TASK_EVENTS.has(payload.event))
		) {
			return Promise.resolve();
		}
		const previous = this.queues.get(taskId) ?? Promise.resolve();
		const next = previous
			.then(() => this.process(taskId, payload))
			.catch((error) => {
				this.logger.error(
					`ClickUp task ${taskId}: failed to handle ${payload.event}`,
					error,
				);
			});
		this.queues.set(taskId, next);
		void next.finally(() => {
			if (this.queues.get(taskId) === next) this.queues.delete(taskId);
		});
		return next;
	}

	private async process(
		taskId: string,
		payload: ClickUpWebhookPayload,
	): Promise<void> {
		const items = payload.history_items ?? [];
		for (const item of items) this.tracker.rememberUser(item.user);

		const commentItem = COMMENT_EVENTS.has(payload.event)
			? items.find((item) => item.field === "comment" || item.comment)
			: undefined;
		const commentId = commentItem
			? String(commentItem.comment?.id ?? commentItem.after ?? "")
			: undefined;
		if (COMMENT_EVENTS.has(payload.event) && !commentId) {
			this.logger.warn(
				`ClickUp task ${taskId}: ${payload.event} without a comment id, ignored`,
			);
			return;
		}
		// Cheap check first: many comment deliveries are nyrus's own.
		if (
			commentId &&
			this.tracker.isOwnComment(
				commentId,
				commentItem?.comment ? commentText(commentItem.comment) : undefined,
			)
		) {
			return;
		}

		const task = await this.tracker.fetchTask(taskId);
		if (!this.tracker.inScope(task)) {
			this.logger.info(
				`ClickUp task ${taskId} is in Space ${task.space?.id ?? "?"}, outside CLICKUP_SPACE_IDS: ignored`,
			);
			return;
		}
		const agent = await this.tracker.agent();
		const now = this.tracker.isHandedToAgent(task, agent);
		const before = this.handedOver.get(task.id);
		this.handedOver.set(task.id, now);
		const actor = toActor(commentItem?.comment?.user ?? items[0]?.user);

		if (commentId) {
			this.tracker.rememberComment(commentId, task.id);
			const markdown = await this.commentMarkdown(
				task.id,
				commentId,
				commentItem!,
			);
			if (markdown === undefined) return;
			const { addressed, body } = parseCommand(markdown);
			await this.coordinator.handle({
				kind: "comment",
				// A comment is posted once; a second delivery of it is a retry.
				eventId: `clickup:comment:${commentId}`,
				issueId: task.id,
				commentId,
				body,
				mentionsAgent: addressed,
				actor,
			});
			return;
		}

		const event: CommentTrackerEvent = {
			kind: "issue",
			...(items.length > 0 && {
				eventId: `clickup:history:${items.map((i) => i.id).join(",")}`,
			}),
			issueId: task.id,
			handOver:
				handOverChange(items, this.tracker.options, agent) ??
				(before !== undefined && before !== now
					? now
						? "added"
						: "removed"
					: undefined),
			actor,
		};
		await this.coordinator.handle(event);
	}

	/**
	 * The comment as Markdown, from the delivery or else from the API.
	 * Undefined if it can't be read, or turns out to be nyrus's own.
	 */
	private async commentMarkdown(
		taskId: string,
		commentId: string,
		item: ClickUpHistoryItem,
	): Promise<string | undefined> {
		if (item.comment && (item.comment.comment || item.comment.text_content)) {
			return commentMarkdown({
				comment: item.comment.comment,
				comment_text: item.comment.text_content,
			});
		}
		const comment = await this.tracker.findComment(taskId, commentId);
		if (!comment) {
			this.logger.warn(
				`ClickUp task ${taskId}: comment ${commentId} not found, ignored`,
			);
			return undefined;
		}
		if (this.tracker.isOwnComment(commentId, commentText(comment))) {
			return undefined;
		}
		return commentMarkdown(comment);
	}
}

/**
 * Whether a delivery's history items show the task being handed to nyrus
 * ("added") or taken away ("removed"): the trigger tag added or removed, or
 * (with `triggerOnAssign`) the token's person assigned or unassigned.
 */
export function handOverChange(
	items: ClickUpHistoryItem[],
	options: Pick<ClickUpTriggerOptions, "triggerTag" | "triggerOnAssign">,
	agent: Pick<ClickUpUser, "id">,
): "added" | "removed" | undefined {
	const tag = options.triggerTag.trim().toLowerCase();
	for (const item of items) {
		if (tag && (item.field === "tag" || item.field === "tag_removed")) {
			const before = tagNames(item.before).includes(tag);
			const after = tagNames(item.after).includes(tag);
			if (item.field === "tag_removed" && (before || after)) return "removed";
			if (item.field === "tag" && after && !before) return "added";
			if (item.field === "tag" && before && !after) return "removed";
		}
		if (
			options.triggerOnAssign &&
			(item.field === "assignee_add" || item.field === "assignee_rem")
		) {
			const user = item.field === "assignee_add" ? item.after : item.before;
			if (userId(user) === String(agent.id)) {
				return item.field === "assignee_add" ? "added" : "removed";
			}
		}
	}
	return undefined;
}

function tagNames(value: unknown): string[] {
	const list = Array.isArray(value) ? value : value ? [value] : [];
	return list
		.map((tag) =>
			typeof tag === "string"
				? tag
				: String((tag as { name?: unknown })?.name ?? ""),
		)
		.map((name) => name.toLowerCase());
}

function userId(value: unknown): string | undefined {
	if (typeof value === "number" || typeof value === "string") {
		return String(value);
	}
	const id = (value as { id?: unknown } | null | undefined)?.id;
	return id === undefined || id === null ? undefined : String(id);
}

function toActor(user: ClickUpUser | undefined): TrackerUser | undefined {
	return user?.id !== undefined && user.id !== null
		? {
				id: String(user.id),
				name: user.username ?? undefined,
				email: user.email ?? undefined,
			}
		: undefined;
}
