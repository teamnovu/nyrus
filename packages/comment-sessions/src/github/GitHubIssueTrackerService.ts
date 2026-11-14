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
import { CommentAgentSessions } from "../CommentAgentSessions.js";
import type { DispatchTiming } from "../CommentSessionCoordinator.js";
import type {
	CommentTracker,
	HostRepository,
	TrackerIntegrationHost,
} from "../types.js";
import {
	type GitHubCommentData,
	type GitHubIssueData,
	type GitHubIssueReadApi,
	GitHubRestIssuesApi,
} from "./GitHubIssuesApi.js";
import { directIssueInstructions, marked } from "./text.js";

type IssueTrackerAgentSession = Awaited<
	ReturnType<IIssueTrackerService["fetchAgentSession"]>
>;
type IssueTrackerAgentSessionPayload = Awaited<
	ReturnType<IIssueTrackerService["createAgentSessionOnIssue"]>
>;

/**
 * Workspace key of GitHub issues worked directly: the webhooks'
 * `organizationId`, and the `linearWorkspaceId` of the repositories that take
 * them (with the repository's full name, lowercase, in `teamKeys`).
 */
export const GITHUB_WORKSPACE_KEY = "github";

/**
 * Prefix of the session ids (`gh-issues-<issue id>`). Not `github-`: the
 * edge worker takes sessions starting with `github-` for its pull request
 * sessions.
 */
export const GITHUB_ISSUES_PLATFORM = "gh-issues";

/** The default GitHub login of nyrus: assigning it hands an issue over. */
export const DEFAULT_AGENT_LOGIN = "nyrus";

/** An issue read this recently is fresh enough to decide on (webhook, then coordinator). */
const FRESH_ISSUE_MS = 5 * 1000;

/** The Linear-shaped issue id of a GitHub issue: `owner/repo#12`, lowercase. */
export function githubIssueId(repo: string, issueNumber: number): string {
	return `${repo.toLowerCase()}#${issueNumber}`;
}

/** `owner/repo` and number of an id made by {@link githubIssueId}. */
export function parseGitHubIssueId(
	id: string,
): { repo: string; number: number } | undefined {
	const match = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(id.trim());
	return match
		? { repo: match[1]!.toLowerCase(), number: Number(match[2]) }
		: undefined;
}

/**
 * The issue's identifier, used for its branch and worktree directory:
 * `<repository name>-<number>` with only `[a-z0-9-]`, e.g. `sayflowers-12`.
 */
export function githubIssueIdentifier(
	repo: string,
	issueNumber: number,
): string {
	const name = repo.split("/").pop() ?? "";
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${slug || "issue"}-${issueNumber}`;
}

export interface GitHubIssueTrackerOptions {
	/**
	 * GitHub logins of nyrus (case-insensitive): assigning one hands an issue
	 * over, `@<login>` mentions it, and its comments are its own. Default
	 * `nyrus`.
	 */
	agentLogins?: string[];
	/** The API for a repository (tests); default: GitHub's REST API with the host's token. */
	createApi?: (repositoryId: string) => GitHubIssueReadApi;
	/** Minimum time between edits of a progress comment (tests). */
	progressMinUpdateMs?: number;
	/** Hand-off timing of the session coordinator (tests). */
	dispatchTiming?: Partial<DispatchTiming>;
	logger?: ILogger;
}

/**
 * GitHub issues worked directly, without a ticket in another tracker: the
 * GitHub issue is the ticket. An issue is handed to nyrus by assigning its
 * GitHub account; a comment mentioning `@<login>` starts a conversation on
 * an issue that isn't. Sessions are cyrus-comment-sessions': questions,
 * progress and answers become comments on the issue, marked as nyrus's own.
 *
 * Mapped onto Cyrus's Linear-shaped types: the repository (`owner/repo`,
 * lowercase) is the team and its key, so repositories with
 * `linearWorkspaceId: "github"` and `teamKeys: ["owner/repo"]` take the
 * repository's issues; labels are labels; open/closed are the states.
 */
export class GitHubIssueTrackerService
	implements IIssueTrackerService, CommentTracker
{
	readonly platform = GITHUB_ISSUES_PLATFORM;
	readonly workspaceKey = GITHUB_WORKSPACE_KEY;
	readonly sessions: CommentAgentSessions;
	readonly agentLogins: string[];
	private readonly logger: ILogger;
	private host?: TrackerIntegrationHost;
	private readonly recent = new Map<
		string,
		{ at: number; issue: GitHubIssueData }
	>();
	/** Comment id → issue id, to find a comment's issue again. */
	private readonly commentIssues = new Map<string, string>();
	/** Identifier → issue id, of issues seen. */
	private readonly identifiers = new Map<string, string>();
	private readonly warnedKeys = new Set<string>();

	constructor(private readonly options: GitHubIssueTrackerOptions = {}) {
		this.logger =
			options.logger ?? createLogger({ component: "GitHubIssueTracker" });
		const logins = (options.agentLogins ?? [])
			.map((login) => login.trim().replace(/^@/, ""))
			.filter(Boolean);
		this.agentLogins = logins.length ? logins : [DEFAULT_AGENT_LOGIN];
		this.sessions = new CommentAgentSessions(this, {
			minUpdateMs: options.progressMinUpdateMs,
			timing: options.dispatchTiming,
			logger: this.logger,
		});
	}

	/** Use the edge worker's repositories and GitHub tokens. */
	connect(host: TrackerIntegrationHost): void {
		this.host = host;
	}

	// ========================================================================
	// GITHUB
	// ========================================================================

	/** The configured repository that takes a GitHub repository's issues, if any. */
	repositoryFor(repo: string): HostRepository | undefined {
		const name = repo.toLowerCase();
		const repository = this.host
			?.repositories?.()
			.find(
				(r) =>
					r.workspaceKey === GITHUB_WORKSPACE_KEY &&
					r.teamKeys?.some((key) => key.toLowerCase() === name),
			);
		if (repository && !repository.teamKeys?.includes(name)) {
			this.warnOnce(
				`${repository.id}:${name}`,
				`Repository ${repository.name}: write its team key in lowercase ("${name}"), or routing won't find it`,
			);
		}
		return repository;
	}

	/** Whether nyrus works this GitHub repository's issues (a repository takes them). */
	takesIssuesOf(repo: string): boolean {
		if (!this.host?.repositories) return true;
		return this.repositoryFor(repo) !== undefined;
	}

	api(repo: string): GitHubIssueReadApi {
		const repositoryId = this.repositoryFor(repo)?.id ?? "";
		if (this.options.createApi) return this.options.createApi(repositoryId);
		return new GitHubRestIssuesApi(async () =>
			this.host?.githubToken?.(repositoryId),
		);
	}

	/** True if one of nyrus's logins is the given one. */
	isAgentLogin(login: string | undefined): boolean {
		const name = login?.toLowerCase();
		return Boolean(
			name && this.agentLogins.some((l) => l.toLowerCase() === name),
		);
	}

	/** Handed to nyrus: open, not a pull request, and assigned to its account. */
	isHandedOver(issue: GitHubIssueData): boolean {
		return (
			issue.state === "open" &&
			!issue.pull_request &&
			(issue.assignees ?? []).some((a) => this.isAgentLogin(a.login))
		);
	}

	/** Remember an issue from a webhook, so the coordinator needn't read it again. */
	rememberIssue(repo: string, issue: GitHubIssueData): void {
		const now = Date.now();
		for (const [id, entry] of this.recent) {
			if (now - entry.at > FRESH_ISSUE_MS) this.recent.delete(id);
		}
		this.recent.set(githubIssueId(repo, issue.number), { at: now, issue });
	}

	rememberComment(commentId: string, issueId: string): void {
		this.commentIssues.set(commentId, issueId);
	}

	/** Read an issue; `maxAgeMs` accepts one remembered that recently. */
	async fetchGitHubIssue(
		idOrIdentifier: string,
		maxAgeMs = 0,
	): Promise<{ repo: string; issue: GitHubIssueData }> {
		const { repo, number } = this.resolve(idOrIdentifier);
		const id = githubIssueId(repo, number);
		const recent = this.recent.get(id);
		if (maxAgeMs > 0 && recent && Date.now() - recent.at < maxAgeMs) {
			return { repo, issue: recent.issue };
		}
		const issue = await this.api(repo).getIssue(repo, number);
		this.rememberIssue(repo, issue);
		return { repo, issue };
	}

	// ========================================================================
	// COMMENT TRACKER (for cyrus-comment-sessions)
	// ========================================================================

	async fetchIssueState(
		idOrIdentifier: string,
	): Promise<{ issue: Issue; handedOver: boolean }> {
		const { repo, issue } = await this.fetchGitHubIssue(
			idOrIdentifier,
			FRESH_ISSUE_MS,
		);
		return {
			issue: this.toIssue(repo, issue),
			handedOver: this.isHandedOver(issue),
		};
	}

	/** Markdown, marked as nyrus's own. GitHub notifies watchers either way. */
	async postComment(
		issueId: string,
		markdown: string,
	): Promise<{ id: string }> {
		const { repo, number } = this.resolve(issueId);
		const comment = await this.api(repo).createComment(
			repo,
			number,
			marked(markdown),
		);
		const id = String(comment.id);
		this.rememberComment(id, githubIssueId(repo, number));
		return { id };
	}

	async updateComment(
		issueId: string,
		commentId: string,
		markdown: string,
	): Promise<void> {
		const { repo } = this.resolve(issueId);
		await this.api(repo).updateComment(
			repo,
			Number(commentId),
			marked(markdown),
		);
	}

	async deleteComment(issueId: string, commentId: string): Promise<void> {
		const { repo } = this.resolve(issueId);
		await this.api(repo).deleteComment(repo, Number(commentId));
	}

	// ========================================================================
	// ISSUES
	// ========================================================================

	async fetchIssue(idOrIdentifier: string): Promise<Issue> {
		const { repo, issue } = await this.fetchGitHubIssue(idOrIdentifier);
		return this.toIssue(repo, issue);
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
		const { repo, number } = this.resolve(issueId);
		const fields: Parameters<GitHubIssueReadApi["updateIssue"]>[2] = {};
		if (updates.title !== undefined) fields.title = updates.title;
		if (updates.description !== undefined) {
			fields.body = updates.description ?? "";
		}
		if (updates.stateId) {
			const state = toWorkflowState(updates.stateId);
			fields.state = state.type === "started" ? "open" : "closed";
			if (state.type === "canceled") fields.state_reason = "not_planned";
		}
		if (updates.labelIds !== undefined) fields.labels = updates.labelIds;
		if (updates.assigneeId !== undefined) {
			fields.assignees = updates.assigneeId
				? [loginOf(updates.assigneeId)]
				: [];
		}
		const updated = await this.api(repo).updateIssue(repo, number, fields);
		this.rememberIssue(repo, updated);
		return this.toIssue(repo, updated);
	}

	async fetchIssueAttachments(
		_issueId: string,
	): Promise<Array<{ title: string; url: string }>> {
		// Files are links in the issue body; the agent reads them with `gh`.
		return [];
	}

	// ========================================================================
	// COMMENTS
	// ========================================================================

	async fetchComments(
		issueId: string,
		_options?: PaginationOptions,
	): Promise<Connection<Comment>> {
		const { repo, number } = this.resolve(issueId);
		const id = githubIssueId(repo, number);
		const comments = await this.api(repo).listComments(repo, number);
		for (const c of comments) this.rememberComment(String(c.id), id);
		return { nodes: comments.map((c) => this.toComment(c, id)) };
	}

	async fetchComment(commentId: string): Promise<Comment> {
		const issueId = this.commentIssues.get(commentId);
		if (!issueId) {
			throw new Error(`GitHub comment ${commentId}: unknown issue`);
		}
		const { repo } = this.resolve(issueId);
		const comment = await this.api(repo).getComment(repo, Number(commentId));
		return this.toComment(comment, issueId);
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
		const { id } = await this.postComment(issueId, input.body);
		this.sessions.store.rememberOwnComment(id);
		return this.toComment(
			{
				id: Number(id),
				body: input.body,
				created_at: new Date().toISOString(),
			},
			issueId,
		);
	}

	// ========================================================================
	// TEAMS (= repositories), LABELS, STATES, USERS
	// ========================================================================

	/** The GitHub repositories whose issues are worked. */
	async fetchTeams(_options?: PaginationOptions): Promise<Connection<Team>> {
		const keys = new Set<string>();
		for (const repository of this.host?.repositories?.() ?? []) {
			if (repository.workspaceKey !== GITHUB_WORKSPACE_KEY) continue;
			for (const key of repository.teamKeys ?? []) keys.add(key.toLowerCase());
		}
		return { nodes: [...keys].map(toTeam) };
	}

	async fetchTeam(idOrKey: string): Promise<Team> {
		return toTeam(idOrKey.toLowerCase());
	}

	async fetchLabels(_options?: PaginationOptions): Promise<Connection<Label>> {
		return { nodes: [] };
	}

	async fetchLabel(idOrName: string): Promise<Label> {
		return toLabel(idOrName);
	}

	async getIssueLabels(issueId: string): Promise<string[]> {
		return labelNames((await this.fetchGitHubIssue(issueId)).issue);
	}

	async fetchWorkflowStates(
		_teamId: string,
		_options?: PaginationOptions,
	): Promise<Connection<WorkflowState>> {
		return { nodes: ["open", "closed"].map(toWorkflowState) };
	}

	async fetchWorkflowState(stateId: string): Promise<WorkflowState> {
		return toWorkflowState(stateId);
	}

	/** A GitHub user by `github:<login>` (or the login); no lookup needed. */
	async fetchUser(userId: string): Promise<User> {
		return toUser(loginOf(userId));
	}

	async fetchCurrentUser(): Promise<User> {
		return toUser(this.agentLogins[0]!);
	}

	// ========================================================================
	// AGENT SESSIONS (one per issue, see cyrus-comment-sessions)
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
		// Stops come from GitHub: unassigning nyrus, closing, or a "stop" comment.
		return this.sessions.emitStopSignalEvent(sessionId);
	}

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
		throw new Error("File uploads are not supported for GitHub issues");
	}

	getPlatformType(): string {
		return "github";
	}

	getPlatformMetadata(): Record<string, unknown> {
		return { agentLogins: this.agentLogins };
	}

	createEventTransport(
		_config: AgentEventTransportConfig,
	): IAgentEventTransport {
		throw new Error(
			"GitHub issue webhooks are received by GitHubIssueThreads' /github-issues-webhook route",
		);
	}

	dispose(): void {
		this.sessions.dispose();
	}

	// ========================================================================
	// HELPERS
	// ========================================================================

	/** `owner/repo` and number of an issue id (`owner/repo#12`) or identifier (`repo-12`). */
	private resolve(idOrIdentifier: string): { repo: string; number: number } {
		const parsed = parseGitHubIssueId(idOrIdentifier);
		if (parsed) return parsed;
		const key = idOrIdentifier.trim().toLowerCase();
		const known = this.identifiers.get(key);
		if (known) return parseGitHubIssueId(known)!;
		const match = /^(.+)-(\d+)$/.exec(key);
		if (match) {
			const number = Number(match[2]);
			for (const repository of this.host?.repositories?.() ?? []) {
				if (repository.workspaceKey !== GITHUB_WORKSPACE_KEY) continue;
				for (const repo of repository.teamKeys ?? []) {
					if (githubIssueIdentifier(repo, number) === key) {
						return { repo: repo.toLowerCase(), number };
					}
				}
			}
		}
		throw new Error(`Not a GitHub issue: ${idOrIdentifier}`);
	}

	/** Linear-shaped issue. */
	toIssue(repo: string, data: GitHubIssueData): Issue {
		const name = repo.toLowerCase();
		const id = githubIssueId(name, data.number);
		const identifier = githubIssueIdentifier(name, data.number);
		this.identifiers.set(identifier, id);
		const labels = labelNames(data);
		const assignee = data.assignees?.[0]?.login;
		const state =
			data.state === "open"
				? "open"
				: data.state_reason === "not_planned"
					? "not planned"
					: "closed";
		const issue = {
			id,
			identifier,
			title: data.title,
			description:
				`${data.body?.trim() ?? ""}\n\n${directIssueInstructions({ repo: name, number: data.number, url: data.html_url })}`.trim(),
			url: data.html_url,
			branchName: branchName(identifier, data.title),
			assigneeId: assignee ? `github:${assignee}` : undefined,
			stateId: state,
			teamId: name,
			labelIds: labels,
			priority: 0,
			createdAt: toDate(data.created_at),
			updatedAt: toDate(data.updated_at ?? data.created_at),
			archivedAt: undefined,
			get state() {
				return Promise.resolve(toWorkflowState(state));
			},
			get assignee() {
				return assignee ? Promise.resolve(toUser(assignee)) : undefined;
			},
			get creator() {
				return data.user?.login
					? Promise.resolve(toUser(data.user.login))
					: undefined;
			},
			get team() {
				return Promise.resolve(toTeam(name));
			},
			get parent() {
				return undefined;
			},
			get project() {
				return undefined;
			},
			labels: async () => ({ nodes: labels.map(toLabel) }),
			comments: () => this.fetchComments(id),
			attachments: () => Promise.resolve({ nodes: [] }),
			children: () => Promise.resolve({ nodes: [] }),
			inverseRelations: () => Promise.resolve({ nodes: [] }),
			update: async (input?: IssueUpdateInput) => {
				const updated = await this.updateIssue(id, input ?? {});
				return {
					success: true,
					issue: Promise.resolve(updated),
					lastSyncId: 0,
				};
			},
		};
		return issue as unknown as Issue;
	}

	private toComment(comment: GitHubCommentData, issueId: string): Comment {
		const service = this;
		const login = comment.user?.login;
		const result = {
			id: String(comment.id),
			body: comment.body ?? "",
			createdAt: toDate(comment.created_at),
			updatedAt: toDate(comment.updated_at ?? comment.created_at),
			get user() {
				return login ? Promise.resolve(toUser(login)) : undefined;
			},
			get parent() {
				return undefined;
			},
			get issue() {
				return service.fetchIssue(issueId);
			},
			children: () => Promise.resolve({ nodes: [] }),
		};
		return result as unknown as Comment;
	}

	private warnOnce(key: string, message: string): void {
		if (this.warnedKeys.has(key)) return;
		this.warnedKeys.add(key);
		this.logger.warn(message);
	}
}

function labelNames(issue: GitHubIssueData): string[] {
	return (issue.labels ?? [])
		.map((l) => (typeof l === "string" ? l : (l.name ?? "")))
		.filter(Boolean);
}

/** `github:<login>` (as comment authors are reported) or a plain login. */
function loginOf(userId: string): string {
	return userId.replace(/^github:/, "");
}

function toUser(login: string): User {
	return {
		id: `github:${login}`,
		name: login,
		displayName: login,
		email: "",
		gitHubUserId: undefined,
		url: `https://github.com/${login}`,
	} as unknown as User;
}

/** A repository (`owner/repo`, lowercase) as a team, keyed by its name. */
function toTeam(repo: string): Team {
	return {
		id: repo,
		key: repo,
		name: repo,
		displayName: repo,
		description: undefined,
		color: undefined,
		states: async () => ({ nodes: ["open", "closed"].map(toWorkflowState) }),
		members: async () => ({ nodes: [] }),
	} as unknown as Team;
}

function toLabel(name: string): Label {
	return { id: name, name, color: "#999999" } as unknown as Label;
}

/**
 * Open issues count as started (so the edge worker doesn't try to move
 * them), closed ones as completed, or canceled if not planned.
 */
function toWorkflowState(stateId: string): WorkflowState {
	const id = stateId.trim().toLowerCase();
	const type =
		id === "not planned" || id === "canceled"
			? "canceled"
			: id === "closed" || id === "completed" || id === "done"
				? "completed"
				: "started";
	const name =
		type === "started"
			? "Open"
			: type === "canceled"
				? "Not planned"
				: "Closed";
	return {
		id:
			type === "started"
				? "open"
				: type === "canceled"
					? "not planned"
					: "closed",
		name,
		type,
		color: type === "started" ? "#1a7f37" : "#8250df",
		position: type === "started" ? 0 : 1,
	} as unknown as WorkflowState;
}

function toDate(value: string | undefined): Date {
	const date = value ? new Date(value) : new Date(0);
	return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

/** e.g. `sayflowers-12-fix-login-on-mobile`. */
export function branchName(identifier: string, title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50)
		.replace(/-+$/, "");
	return slug ? `${identifier}-${slug}` : identifier;
}
