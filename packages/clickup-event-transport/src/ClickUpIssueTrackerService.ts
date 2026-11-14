import {
	CommentAgentSessions,
	type CommentTracker,
	type DispatchTiming,
	type GitHubIssueThreads,
	type GitHubThreadedTracker,
	type GitHubThreadSource,
	type PullRequestRef,
	sessionIdFor,
	issueIdFromSessionId as sessionIssueId,
	type TicketComment,
} from "cyrus-comment-sessions";
import {
	type AgentActivityCreateInput,
	type AgentActivityPayload,
	type AgentEventTransportConfig,
	type AgentSessionCreateOnCommentInput,
	type AgentSessionCreateOnIssueInput,
	type Comment,
	type CommentCreateInput,
	type CommentWithAttachments,
	type Connection,
	createLogger,
	type FetchChildrenOptions,
	type FileUploadRequest,
	type FileUploadResponse,
	type IAgentEventTransport,
	type IIssueTrackerService,
	type ILogger,
	type Issue,
	type IssueUpdateInput,
	type IssueWithChildren,
	type Label,
	type PaginationOptions,
	type Team,
	type User,
	type WorkflowState,
} from "cyrus-core";
import type { ClickUpApiClient } from "./ClickUpApiClient.js";
import {
	isSigned,
	markdownToRichText,
	plainText,
	richTextToMarkdown,
	signed,
} from "./ClickUpText.js";
import { clickUpToolsMcpServerConfig } from "./mcp/ClickUpToolsServer.js";
import type {
	ClickUpComment,
	ClickUpSpace,
	ClickUpStatus,
	ClickUpTask,
	ClickUpTriggerOptions,
	ClickUpUser,
} from "./types.js";

type IssueTrackerAgentSession = Awaited<
	ReturnType<IIssueTrackerService["fetchAgentSession"]>
>;
type IssueTrackerAgentSessionPayload = Awaited<
	ReturnType<IIssueTrackerService["createAgentSessionOnIssue"]>
>;

const CACHE_TTL_MS = 5 * 60 * 1000;
/** A task read this recently is fresh enough to decide on (one webhook, two reads). */
const FRESH_TASK_MS = 5 * 1000;

/** ClickUp status types onto Linear state types. */
const STATE_TYPES: Record<string, string> = {
	open: "unstarted",
	custom: "started",
	done: "completed",
	closed: "completed",
};

const PLATFORM = "clickup";

/** Prefix of task identifiers; ClickUp's GitHub integration links `CU-<id>` branches. */
const IDENTIFIER_PREFIX = "CU-";

/**
 * ClickUp has no agent sessions, so nyrus keeps one session per task, with
 * an id derived from the task's id (`clickup-<id>`, see
 * cyrus-comment-sessions): comments on the task continue it, also after a
 * restart.
 */
export function clickUpSessionId(taskId: string): string {
	return sessionIdFor(PLATFORM, taskId);
}

export function issueIdFromSessionId(sessionId: string): string | undefined {
	return sessionIssueId(PLATFORM, sessionId);
}

/** The task id in "CU-abc123" or "abc123". */
export function taskIdFrom(idOrIdentifier: string): string {
	return idOrIdentifier.trim().replace(/^CU-/i, "");
}

export interface ClickUpIssueTrackerOptions extends ClickUpTriggerOptions {
	logger?: ILogger;
	/** Minimum time between edits of a progress comment (tests). */
	progressMinUpdateMs?: number;
	/** Hand-off timing of the session coordinator (tests). */
	dispatchTiming?: Partial<DispatchTiming>;
	/** Work tasks in GitHub issues (see cyrus-comment-sessions). */
	githubIssues?: GitHubIssueThreads;
	/**
	 * Status a task moves to when a pull request for it is opened. Default:
	 * the List's first status whose name contains "review"; empty to never
	 * move it.
	 */
	reviewStatus?: string;
	/**
	 * Status a task moves to when its GitHub issue is closed. Default: the
	 * List's first "done" status (else its first "closed" one); empty to never
	 * move it.
	 */
	doneStatus?: string;
}

/**
 * IIssueTrackerService for ClickUp.
 *
 * Cyrus's issue-tracker abstraction is shaped after Linear's SDK, so this
 * service translates ClickUp into those shapes: a Space (one per customer at
 * novu) is Linear's team, its id the team key that `teamKeys` routing
 * matches; a List is Linear's project, its name what `projectKeys` matches.
 * Tags are labels, and a status's name is its id, since ClickUp sets
 * statuses by name and each List may have its own.
 *
 * Sessions are cyrus-comment-sessions': agent activities become comments,
 * written with the token of the person nyrus acts as and signed
 * "🤖 nyrus:". This service is the `CommentTracker` they use.
 */
export class ClickUpIssueTrackerService
	implements IIssueTrackerService, CommentTracker, GitHubThreadSource
{
	readonly platform = PLATFORM;
	readonly trackerName = "ClickUp";
	/** Set when tasks are worked in GitHub issues. */
	readonly githubThread?: GitHubThreadedTracker;
	/** Session handling shared with the other comment trackers (Jira). */
	readonly sessions: CommentAgentSessions;
	private readonly logger: ILogger;
	private readonly commentTasks = new Map<string, string>();
	private readonly users = new Map<string, ClickUpUser>();
	private readonly spaces = new Map<string, { id: string; name: string }>();
	private readonly recentTasks = new Map<
		string,
		{ at: number; task: ClickUpTask }
	>();
	private readonly cache = new Map<string, { at: number; value: unknown }>();
	private agentRequest: Promise<ClickUpUser> | null = null;

	constructor(
		readonly api: ClickUpApiClient,
		readonly workspaceKey: string,
		readonly options: ClickUpIssueTrackerOptions,
	) {
		this.logger =
			options.logger ??
			createLogger({ component: "ClickUpIssueTrackerService" });
		this.githubThread = options.githubIssues?.attach(this);
		this.sessions = new CommentAgentSessions(this.githubThread ?? this, {
			minUpdateMs: options.progressMinUpdateMs,
			timing: options.dispatchTiming,
			logger: this.logger,
		});
	}

	/** The person nyrus acts as: whoever the API token belongs to. */
	agent(): Promise<ClickUpUser> {
		this.agentRequest ??= this.api.me().catch((error) => {
			this.agentRequest = null;
			throw error;
		});
		return this.agentRequest;
	}

	/** True if the task is handed to nyrus: has the trigger tag, or (if enabled) is assigned to its person. */
	isHandedToAgent(task: ClickUpTask, agent: ClickUpUser): boolean {
		const { triggerTag, triggerOnAssign } = this.options;
		if (
			triggerOnAssign &&
			(task.assignees ?? []).some((a) => String(a.id) === String(agent.id))
		) {
			return true;
		}
		const tag = triggerTag.trim().toLowerCase();
		return (
			Boolean(tag) &&
			(task.tags ?? []).some((t) => t.name.toLowerCase() === tag)
		);
	}

	/** Whether nyrus works on tasks in this task's Space. */
	inScope(task: ClickUpTask): boolean {
		const { spaceIds } = this.options;
		return spaceIds.length === 0 || spaceIds.includes(task.space?.id ?? "");
	}

	/**
	 * Read a task. `maxAgeMs` accepts one read that recently (a webhook's
	 * handler and the session coordinator both read the task).
	 */
	async fetchTask(idOrIdentifier: string, maxAgeMs = 0): Promise<ClickUpTask> {
		const id = taskIdFrom(idOrIdentifier);
		const recent = this.recentTasks.get(id);
		if (maxAgeMs > 0 && recent && Date.now() - recent.at < maxAgeMs) {
			return recent.task;
		}
		const task = await this.api.getTask(id);
		this.rememberTask(task);
		return task;
	}

	/** Remember a person from a webhook or API answer, for `fetchUser`. */
	rememberUser(user: ClickUpUser | undefined | null): void {
		if (user?.id === undefined || user.id === null) return;
		const key = String(user.id);
		const known = this.users.get(key);
		this.users.set(key, {
			...known,
			...Object.fromEntries(
				Object.entries(user).filter(([, v]) => v !== undefined && v !== null),
			),
			id: user.id,
		} as ClickUpUser);
	}

	/** Remember which task a comment is on (to find it again). */
	rememberComment(commentId: string, taskId: string): void {
		this.commentTasks.set(commentId, taskId);
	}

	/** True for comments nyrus wrote itself; their webhooks are ignored. */
	isOwnComment(commentId: string, text?: string): boolean {
		return this.sessions.store.isOwnComment(commentId) || isSigned(text);
	}

	/** A comment on a task (top-level or a threaded reply), or undefined if not found. */
	async findComment(
		taskId: string,
		commentId: string,
	): Promise<ClickUpComment | undefined> {
		const comments = await this.api.listComments(taskId);
		const top = comments.find((c) => c.id === commentId);
		if (top) return top;
		for (const parent of comments) {
			if (!Number(parent.reply_count)) continue;
			const reply = (await this.api.listReplies(parent.id)).find(
				(c) => c.id === commentId,
			);
			if (reply) return reply;
		}
		return undefined;
	}

	// ========================================================================
	// COMMENT TRACKER (for cyrus-comment-sessions)
	// ========================================================================

	async fetchIssueState(
		idOrIdentifier: string,
	): Promise<{ issue: Issue; handedOver: boolean }> {
		const [agent, task] = await Promise.all([
			this.agent(),
			this.fetchTask(idOrIdentifier, FRESH_TASK_MS),
		]);
		return {
			issue: this.toIssue(task),
			handedOver: this.inScope(task) && this.isHandedToAgent(task, agent),
		};
	}

	/** Markdown as signed rich text. ClickUp notifies watchers either way. */
	async postComment(taskId: string, markdown: string): Promise<{ id: string }> {
		const comment = await this.api.createComment(
			taskIdFrom(taskId),
			signed(markdownToRichText(markdown)),
		);
		this.rememberComment(comment.id, taskIdFrom(taskId));
		return comment;
	}

	async updateComment(
		_taskId: string,
		commentId: string,
		markdown: string,
	): Promise<void> {
		await this.api.updateComment(
			commentId,
			signed(markdownToRichText(markdown)),
		);
	}

	async deleteComment(_taskId: string, commentId: string): Promise<void> {
		await this.api.deleteComment(commentId);
	}

	// ========================================================================
	// ISSUES (= tasks)
	// ========================================================================

	async fetchIssue(idOrIdentifier: string): Promise<Issue> {
		const issue = this.toIssue(await this.fetchTask(idOrIdentifier));
		return this.githubThread ? this.githubThread.decorateIssue(issue) : issue;
	}

	// ========================================================================
	// GITHUB ISSUES (for cyrus-comment-sessions' GitHubIssueThreads)
	// ========================================================================

	async ticketComments(issueId: string): Promise<TicketComment[]> {
		const comments = await this.api.listComments(taskIdFrom(issueId));
		return comments
			.filter((c) => !isSigned(c.comment_text))
			.map((c) => ({
				author:
					c.user?.username || c.user?.email || String(c.user?.id ?? "Someone"),
				createdAt: c.date ? toDate(c.date) : undefined,
				body: commentMarkdown(c),
			}));
	}

	/** ClickUp has no links to other systems, so the pull request goes in a comment. */
	async attachPullRequest(issueId: string, pr: PullRequestRef): Promise<void> {
		await this.postComment(
			issueId,
			`🔗 Pull request: [${pr.repo}#${pr.number}${pr.title ? ` ${pr.title}` : ""}](${pr.url})`,
		);
	}

	async moveToStage(issueId: string, stage: "review" | "done"): Promise<void> {
		const wanted =
			stage === "review" ? this.options.reviewStatus : this.options.doneStatus;
		if (wanted === "") return; // turned off
		const task = await this.fetchTask(issueId);
		if (!task.list?.id) return;
		const list = await this.cached(`list:${task.list.id}`, () =>
			this.api.getList(task.list!.id),
		);
		const statuses = sortStatuses(list.statuses ?? []);
		const status = wanted
			? statuses.find((s) => sameStatus(s.status, wanted))
			: stage === "review"
				? statuses.find((s) => /review/i.test(s.status))
				: (statuses.find((s) => s.type === "done") ??
					statuses.find((s) => s.type === "closed"));
		if (!status) {
			this.logger.warn(
				`ClickUp task ${task.id}: no ${wanted ? `status "${wanted}"` : `${stage} status`} in its List (possible: ${statuses.map((s) => s.status).join(", ") || "none"})`,
			);
			return;
		}
		await this.api.updateTask(task.id, { status: status.status });
	}

	async fetchIssueChildren(
		issueId: string,
		_options?: FetchChildrenOptions,
	): Promise<IssueWithChildren> {
		const issue = await this.fetchIssue(issueId);
		return { ...issue, children: [], childCount: 0 } as IssueWithChildren;
	}

	async updateIssue(
		issueId: string,
		updates: IssueUpdateInput,
	): Promise<Issue> {
		const id = taskIdFrom(issueId);
		const fields: Record<string, unknown> = {};
		if (updates.title !== undefined) fields.name = updates.title;
		if (updates.description !== undefined)
			fields.markdown_content = updates.description;
		if (updates.priority !== undefined) {
			const priority = Number(updates.priority);
			fields.priority = priority >= 1 && priority <= 4 ? priority : null;
		}
		if (updates.parentId) fields.parent = taskIdFrom(updates.parentId);

		const needsTask =
			updates.assigneeId !== undefined ||
			updates.stateId !== undefined ||
			updates.labelIds !== undefined;
		const task = needsTask ? await this.fetchTask(id) : undefined;
		if (task && updates.assigneeId !== undefined) {
			const current = (task.assignees ?? []).map((a) => a.id);
			fields.assignees = updates.assigneeId
				? { add: [Number(updates.assigneeId)], rem: [] }
				: { add: [], rem: current };
		}
		if (task && updates.stateId) {
			fields.status = await this.statusFor(task, updates.stateId);
		}
		if (Object.keys(fields).length > 0) {
			await this.api.updateTask(id, fields);
		}
		if (task && updates.labelIds !== undefined) {
			await this.setTags(task, updates.labelIds);
		}
		return this.toIssue(await this.fetchTask(id));
	}

	async fetchIssueAttachments(
		_issueId: string,
	): Promise<Array<{ title: string; url: string }>> {
		// Attachments may need the token; sessions download them with the
		// clickup MCP server's download_attachments tool.
		return [];
	}

	// ========================================================================
	// COMMENTS
	// ========================================================================

	async fetchComments(
		issueId: string,
		_options?: PaginationOptions,
	): Promise<Connection<Comment>> {
		const taskId = taskIdFrom(issueId);
		const comments = await this.api.listComments(taskId);
		for (const c of comments) {
			this.rememberComment(c.id, taskId);
			this.rememberUser(c.user);
		}
		return { nodes: comments.map((c) => this.toComment(c, taskId)) };
	}

	async fetchComment(commentId: string): Promise<Comment> {
		const taskId = this.commentTasks.get(commentId);
		const comment = taskId
			? await this.findComment(taskId, commentId)
			: undefined;
		if (!taskId || !comment) {
			throw new Error(`ClickUp comment ${commentId}: unknown task`);
		}
		return this.toComment(comment, taskId);
	}

	async fetchCommentWithAttachments(
		commentId: string,
	): Promise<CommentWithAttachments> {
		return { ...(await this.fetchComment(commentId)), attachments: [] };
	}

	async createComment(
		issueId: string,
		input: CommentCreateInput,
	): Promise<Comment> {
		const taskId = taskIdFrom(issueId);
		const rich = signed(markdownToRichText(input.body));
		const { id } = await this.api.createComment(taskId, rich);
		this.sessions.store.rememberOwnComment(id);
		this.rememberComment(id, taskId);
		return this.toComment(
			{ id, comment: rich, date: String(Date.now()) },
			taskId,
		);
	}

	// ========================================================================
	// TEAMS (= Spaces)
	// ========================================================================

	/**
	 * The configured Spaces, or without a configuration the Spaces nyrus has
	 * seen tasks of: a token sees every Space of the workspace (hundreds at
	 * novu), too many for a prompt.
	 */
	async fetchTeams(_options?: PaginationOptions): Promise<Connection<Team>> {
		const ids = this.options.spaceIds.length
			? this.options.spaceIds
			: [...this.spaces.keys()];
		const spaces = await Promise.all(
			ids.map((id) => this.space(id).catch(() => undefined)),
		);
		return {
			nodes: spaces
				.filter((s): s is ClickUpSpace => s !== undefined)
				.map((s) => this.toTeam(s)),
		};
	}

	async fetchTeam(idOrKey: string): Promise<Team> {
		return this.toTeam(await this.space(idOrKey));
	}

	// ========================================================================
	// LABELS (= tags; the name is the id)
	// ========================================================================

	async fetchLabels(_options?: PaginationOptions): Promise<Connection<Label>> {
		const names = new Set<string>();
		for (const spaceId of this.options.spaceIds) {
			const tags = await this.cached(`tags:${spaceId}`, () =>
				this.api.listSpaceTags(spaceId),
			).catch(() => []);
			for (const tag of tags) names.add(tag.name);
		}
		return { nodes: [...names].map(toLabel) };
	}

	async fetchLabel(idOrName: string): Promise<Label> {
		return toLabel(idOrName);
	}

	async getIssueLabels(issueId: string): Promise<string[]> {
		return ((await this.fetchTask(issueId)).tags ?? []).map((t) => t.name);
	}

	// ========================================================================
	// WORKFLOW STATES (= statuses; the name is the id)
	// ========================================================================

	async fetchWorkflowStates(
		teamId: string,
		_options?: PaginationOptions,
	): Promise<Connection<WorkflowState>> {
		const space = await this.space(teamId);
		return { nodes: (space.statuses ?? []).map(toWorkflowState) };
	}

	async fetchWorkflowState(stateId: string): Promise<WorkflowState> {
		for (const [key, entry] of this.cache) {
			if (!key.startsWith("space:")) continue;
			const status = ((entry.value as ClickUpSpace).statuses ?? []).find((s) =>
				sameStatus(s.status, stateId),
			);
			if (status) return toWorkflowState(status);
		}
		return toWorkflowState({ status: stateId });
	}

	// ========================================================================
	// USERS
	// ========================================================================

	/**
	 * A person nyrus has seen on a task, a comment or a webhook. ClickUp only
	 * lets workspace admins look people up by id; an unknown one comes back
	 * with just the id.
	 */
	async fetchUser(userId: string): Promise<User> {
		const known = this.users.get(String(userId));
		if (known) return toUser(known);
		const agent = await this.agent().catch(() => undefined);
		if (agent && String(agent.id) === String(userId)) return toUser(agent);
		return { ...toUser({ id: 0, username: userId }), id: String(userId) };
	}

	/**
	 * Cyrus calls this to keep a Linear OAuth token fresh. For ClickUp it
	 * checks that the API token still works.
	 */
	async fetchCurrentUser(): Promise<User> {
		return toUser(await this.agent());
	}

	// ========================================================================
	// AGENT SESSIONS (one per task, see cyrus-comment-sessions)
	// ========================================================================

	createAgentSessionOnIssue(
		input: AgentSessionCreateOnIssueInput,
	): Promise<IssueTrackerAgentSessionPayload> {
		return this.sessions.createAgentSessionOnIssue(input);
	}

	createAgentSessionOnComment(
		input: AgentSessionCreateOnCommentInput,
	): Promise<IssueTrackerAgentSessionPayload> {
		return this.sessions.createAgentSessionOnComment(input);
	}

	fetchAgentSession(sessionId: string): Promise<IssueTrackerAgentSession> {
		return this.sessions.fetchAgentSession(sessionId);
	}

	emitStopSignalEvent(sessionId: string): Promise<void> {
		// Stops come from ClickUp: removing the tag, or a "/nyrus stop" comment.
		return this.sessions.emitStopSignalEvent(sessionId);
	}

	/** Activities become comments (cyrus-comment-sessions' publisher). */
	createAgentActivity(
		input: AgentActivityCreateInput,
	): Promise<AgentActivityPayload> {
		return this.sessions.createAgentActivity(input);
	}

	// ========================================================================
	// UNSUPPORTED / PLATFORM
	// ========================================================================

	async requestFileUpload(
		_request: FileUploadRequest,
	): Promise<FileUploadResponse> {
		throw new Error("File uploads are not supported for ClickUp yet");
	}

	getPlatformType(): string {
		return PLATFORM;
	}

	getPlatformMetadata(): Record<string, unknown> {
		return { teamId: this.api.teamId };
	}

	/** MCP server that gives sessions ClickUp tools, as the token's person. */
	toolsMcpServerConfig(): ReturnType<typeof clickUpToolsMcpServerConfig> {
		return clickUpToolsMcpServerConfig(this.api.getCredentials());
	}

	createEventTransport(
		_config: AgentEventTransportConfig,
	): IAgentEventTransport {
		throw new Error(
			"ClickUp webhooks are received by ClickUpEventTransport, registered by the edge worker",
		);
	}

	/** Stop pending progress-comment edits (on shutdown). */
	dispose(): void {
		this.sessions.dispose();
	}

	// ========================================================================
	// HELPERS
	// ========================================================================

	private rememberTask(task: ClickUpTask): void {
		const now = Date.now();
		for (const [id, entry] of this.recentTasks) {
			if (now - entry.at > FRESH_TASK_MS) this.recentTasks.delete(id);
		}
		this.recentTasks.set(task.id, { at: now, task });
		for (const user of [
			task.creator,
			...(task.assignees ?? []),
			...(task.watchers ?? []),
		]) {
			this.rememberUser(user);
		}
		if (task.space?.id && !this.spaces.has(task.space.id)) {
			this.spaces.set(task.space.id, {
				id: task.space.id,
				name: task.space.name ?? task.space.id,
			});
		}
	}

	private space(spaceId: string): Promise<ClickUpSpace> {
		return this.cached(`space:${spaceId}`, () => this.api.getSpace(spaceId));
	}

	/**
	 * The status to set for a state. States come from the Space's statuses
	 * (fetchWorkflowStates), but a List can have its own; if the task's List
	 * has no status of that name, take its first status of the same type
	 * (e.g. its own "in progress").
	 */
	private async statusFor(task: ClickUpTask, stateId: string): Promise<string> {
		if (!task.list?.id) return stateId;
		const list = await this.cached(`list:${task.list.id}`, () =>
			this.api.getList(task.list!.id),
		);
		const statuses = sortStatuses(list.statuses ?? []);
		const named = statuses.find((s) => sameStatus(s.status, stateId));
		if (named) return named.status;
		const { type } = await this.fetchWorkflowState(stateId);
		const sameType = statuses.find((s) => stateType(s) === type);
		if (!sameType) {
			throw new Error(
				`ClickUp task ${task.id} has no status "${stateId}" (possible: ${statuses.map((s) => s.status).join(", ") || "none"})`,
			);
		}
		return sameType.status;
	}

	/** Add and remove tags so the task has exactly these. */
	private async setTags(task: ClickUpTask, names: string[]): Promise<void> {
		const current = (task.tags ?? []).map((t) => t.name);
		const lower = (list: string[]) => list.map((n) => n.toLowerCase());
		for (const name of names) {
			if (!lower(current).includes(name.toLowerCase())) {
				await this.api.addTag(task.id, name);
			}
		}
		for (const name of current) {
			if (!lower(names).includes(name.toLowerCase())) {
				await this.api.removeTag(task.id, name);
			}
		}
	}

	/** Linear-shaped issue. Public for the webhook handler. */
	toIssue(task: ClickUpTask): Issue {
		const service = this;
		const status = task.status;
		const assignee = task.assignees?.[0];
		const spaceId = task.space?.id ?? "";
		const tags = (task.tags ?? []).map((t) => t.name);

		const issue = {
			id: task.id,
			identifier: `${IDENTIFIER_PREFIX}${task.id}`,
			title: task.name,
			description: taskDescription(task),
			url: task.url || this.api.taskUrl(task.id),
			branchName: branchName(task.id, task.name),
			assigneeId: assignee ? String(assignee.id) : undefined,
			stateId: status?.status,
			teamId: spaceId,
			labelIds: tags,
			priority: Number(task.priority?.id) || 0,
			createdAt: toDate(task.date_created),
			updatedAt: toDate(task.date_updated ?? task.date_created),
			archivedAt: undefined,
			get state() {
				return status ? Promise.resolve(toWorkflowState(status)) : undefined;
			},
			get assignee() {
				return assignee ? Promise.resolve(toUser(assignee)) : undefined;
			},
			get team() {
				return service
					.fetchTeam(spaceId)
					.catch(() => service.toTeam({ id: spaceId, name: spaceId }));
			},
			get parent() {
				return task.parent
					? service.fetchIssue(task.parent).catch(() => undefined)
					: undefined;
			},
			get project() {
				return task.list
					? Promise.resolve({
							id: task.list.id,
							name: task.list.name ?? task.list.id,
						})
					: undefined;
			},
			labels: async () => ({ nodes: tags.map(toLabel) }),
			comments: () => service.fetchComments(task.id),
			attachments: () => Promise.resolve({ nodes: [] }),
			children: () => Promise.resolve({ nodes: [] }),
			inverseRelations: () => Promise.resolve({ nodes: [] }),
			update: async (input?: IssueUpdateInput) => {
				const updated = await service.updateIssue(task.id, input ?? {});
				return {
					success: true,
					issue: Promise.resolve(updated),
					lastSyncId: 0,
				};
			},
		};
		return issue as unknown as Issue;
	}

	private toComment(comment: ClickUpComment, taskId: string): Comment {
		const service = this;
		const author = comment.user;
		const result = {
			id: comment.id,
			body: commentMarkdown(comment),
			createdAt: toDate(comment.date),
			updatedAt: toDate(comment.date),
			get user() {
				return author ? Promise.resolve(toUser(author)) : undefined;
			},
			get parent() {
				return undefined;
			},
			get issue() {
				return service.fetchIssue(taskId);
			},
			children: () => Promise.resolve({ nodes: [] }),
		};
		return result as unknown as Comment;
	}

	private toTeam(space: {
		id: string;
		name: string;
		statuses?: ClickUpStatus[];
	}): Team {
		const team = {
			id: space.id,
			name: space.name,
			key: space.id,
			description: undefined,
			color: undefined,
			displayName: space.name,
			states: async () => ({
				nodes: (space.statuses ?? []).map(toWorkflowState),
			}),
			members: async () => ({ nodes: [] }),
		};
		return team as unknown as Team;
	}

	private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
		const hit = this.cache.get(key);
		if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
			return hit.value as T;
		}
		const value = await load();
		this.cache.set(key, { at: Date.now(), value });
		return value;
	}
}

/** A comment as Markdown: its rich text if there is any, else its plain text. */
export function commentMarkdown(comment: {
	comment?: ClickUpComment["comment"];
	comment_text?: string;
}): string {
	return comment.comment?.length
		? richTextToMarkdown(comment.comment)
		: (comment.comment_text ?? "");
}

/** The comment's plain text, for the signature check. */
export function commentText(comment: {
	comment?: ClickUpComment["comment"];
	comment_text?: string;
	text_content?: string;
}): string {
	return (
		comment.text_content ??
		comment.comment_text ??
		(comment.comment ? plainText(comment.comment) : "")
	);
}

/** The description as Markdown, plus a list of attached files. */
function taskDescription(task: ClickUpTask): string {
	const description =
		task.markdown_description ?? task.description ?? task.text_content ?? "";
	const files = (task.attachments ?? []).map((a) => a.title || a.id);
	if (files.length === 0) {
		return description;
	}
	return `${description}\n\n---\nAttached files (download them with the clickup tool download_attachments): ${files.join(", ")}`.trim();
}

function sameStatus(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function stateType(status: ClickUpStatus): string {
	return STATE_TYPES[status.type ?? ""] ?? "unstarted";
}

function sortStatuses(statuses: ClickUpStatus[]): ClickUpStatus[] {
	return [...statuses].sort(
		(a, b) => Number(a.orderindex ?? 0) - Number(b.orderindex ?? 0),
	);
}

function toWorkflowState(status: ClickUpStatus): WorkflowState {
	return {
		id: status.status,
		name: status.status,
		type: stateType(status),
		color: status.color ?? "#999999",
		position: Number(status.orderindex ?? 0),
	} as unknown as WorkflowState;
}

function toLabel(name: string): Label {
	return { id: name, name, color: "#999999" } as unknown as Label;
}

function toUser(user: ClickUpUser): User {
	const name = user.username || user.email || String(user.id);
	return {
		id: String(user.id),
		name,
		displayName: name,
		email: user.email ?? "",
		gitHubUserId: undefined,
		url: "",
	} as unknown as User;
}

/** ClickUp dates are milliseconds since the epoch, as strings. */
function toDate(value: string | number | undefined): Date {
	const ms = Number(value);
	return Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date(0);
}

/**
 * e.g. "CU-86c1abcde-fix-login-on-mobile". ClickUp's GitHub integration
 * links branches, commits and pull requests that name `CU-<task id>`.
 */
export function branchName(taskId: string, title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50)
		.replace(/-+$/, "");
	const prefix = `${IDENTIFIER_PREFIX}${taskId}`;
	return slug ? `${prefix}-${slug}` : prefix;
}
