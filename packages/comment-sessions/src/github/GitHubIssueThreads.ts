import { createHmac, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { createLogger, type ILogger, type Issue, type User } from "cyrus-core";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { CommentSessionCoordinator } from "../CommentSessionCoordinator.js";
import type {
	CommentPostOptions,
	CommentTracker,
	CommentTrackerEvent,
	TrackerIntegrationHost,
} from "../types.js";
import {
	type GitHubIssuesApi,
	GitHubRestIssuesApi,
	parseGitHubRepo,
} from "./GitHubIssuesApi.js";
import { type GitHubThread, ThreadStore } from "./ThreadStore.js";
import {
	closingReferences,
	githubIssueBody,
	githubIssueTitle,
	isMarked,
	marked,
	mirroredComment,
	resultNote,
	startNote,
	type TicketComment,
	workflowInstructions,
} from "./text.js";

/** The webhook route GitHub sends issue, comment and pull request events to. */
export const GITHUB_ISSUES_WEBHOOK_PATH = "/github-issues-webhook";

/** Who may answer the agent on GitHub, by their association with the repository. */
export const DEFAULT_ALLOWED_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

/** Comment ids on GitHub are prefixed, so they never clash with the tracker's. */
const GH_PREFIX = "gh:";

/** A ticket nyrus got an event for is "active" this long: its session may open a GitHub issue. */
const ACTIVE_MS = 12 * 60 * 60 * 1000;

export interface PullRequestRef {
	repo: string;
	number: number;
	url: string;
	title: string;
}

/**
 * A tracker whose tickets are worked in GitHub issues: a comment tracker
 * that can also list a ticket's comments for the GitHub issue and report the
 * result on the ticket.
 */
export interface GitHubThreadSource extends CommentTracker {
	/** e.g. "Jira", "ClickUp" */
	readonly trackerName: string;
	/** The ticket's comments, oldest first, without the agent's own. */
	ticketComments(issueId: string): Promise<TicketComment[]>;
	/** A pull request that closes the ticket's GitHub issue was opened. */
	attachPullRequest?(issueId: string, pr: PullRequestRef): Promise<void>;
	/** Move the ticket on: "review" when a pull request is open, "done" when the issue was closed. */
	moveToStage?(issueId: string, stage: "review" | "done"): Promise<void>;
}

export interface GitHubIssueThreadsOptions {
	/** Secret of the GitHub webhook (HMAC-SHA256, `X-Hub-Signature-256`). */
	webhookSecret: string;
	/** Where the ticket↔issue mapping is kept; in memory without one. */
	storePath?: string;
	/** Author associations whose comments reach the agent. */
	allowedAssociations?: string[];
	/** GitHub logins whose comments are nyrus's own (e.g. a bot account's). */
	botLogins?: string[];
	/** The API to use for a repository (tests); defaults to GitHub's REST API with the host's token. */
	createApi?: (repositoryId: string) => GitHubIssuesApi;
	logger?: ILogger;
}

/**
 * Tickets worked in GitHub issues. Shared by all comment trackers (Jira,
 * ClickUp): each one attaches itself and gets a {@link GitHubThreadedTracker}
 * to use instead of itself. When a ticket's session has a repository on
 * GitHub, a GitHub issue is opened with everything the ticket says, and the
 * session's questions, progress and answers go there; answers on GitHub come
 * back to the session. The ticket only gets a link at the start and the
 * result at the end, and moves to review / done when a pull request that
 * closes the issue is opened / the issue is closed.
 */
export class GitHubIssueThreads {
	readonly store: ThreadStore;
	private readonly sources = new Map<string, GitHubThreadedTracker>();
	private readonly logger: ILogger;
	private readonly allowedAssociations: Set<string>;
	private readonly botLogins: Set<string>;
	private host?: TrackerIntegrationHost;

	constructor(private readonly options: GitHubIssueThreadsOptions) {
		this.logger =
			options.logger ?? createLogger({ component: "GitHubIssueThreads" });
		this.store = new ThreadStore(options.storePath);
		this.allowedAssociations = new Set(
			(options.allowedAssociations ?? DEFAULT_ALLOWED_ASSOCIATIONS).map((a) =>
				a.toUpperCase(),
			),
		);
		this.botLogins = new Set(
			(options.botLogins ?? []).map((login) => login.toLowerCase()),
		);
	}

	/** Work a tracker's tickets in GitHub issues; use the returned tracker for its sessions. */
	attach(source: GitHubThreadSource): GitHubThreadedTracker {
		const tracker = new GitHubThreadedTracker(source, this, this.logger);
		this.sources.set(source.workspaceKey, tracker);
		return tracker;
	}

	/** Register the webhook route; the first tracker's registration does it. */
	connect(host: TrackerIntegrationHost): void {
		if (this.host) return;
		this.host = host;
		host.fastify.post(
			GITHUB_ISSUES_WEBHOOK_PATH,
			async (request: FastifyRequest, reply: FastifyReply) => {
				if (!this.isAuthorized(request)) {
					reply.code(401).send({ error: "Invalid webhook signature" });
					return;
				}
				reply.code(200).send({ ok: true });
				const name = request.headers["x-github-event"];
				void this.handleWebhook(
					typeof name === "string" ? name : "",
					request.body as GitHubPayload,
				).catch((error) =>
					this.logger.error("GitHub issues webhook failed", error),
				);
			},
		);
		this.logger.info(
			`✅ Tickets are worked in GitHub issues (webhook POST ${GITHUB_ISSUES_WEBHOOK_PATH})`,
		);
	}

	api(repositoryId: string): GitHubIssuesApi {
		if (this.options.createApi) return this.options.createApi(repositoryId);
		return new GitHubRestIssuesApi(async () =>
			this.host?.githubToken?.(repositoryId),
		);
	}

	repositoryForIssue(issueId: string) {
		return this.host?.repositoryForIssue?.(issueId);
	}

	/** Handle a verified GitHub webhook. Public for tests. */
	async handleWebhook(name: string, payload: GitHubPayload): Promise<void> {
		const repo = payload?.repository?.full_name;
		if (!repo) return;
		if (name === "issue_comment") {
			await this.onIssueComment(repo, payload);
		} else if (name === "pull_request") {
			await this.onPullRequest(repo, payload);
		} else if (name === "issues") {
			if (
				payload.action === "closed" &&
				payload.issue &&
				payload.issue.state_reason !== "not_planned"
			) {
				const thread = this.store.forGitHubIssue(repo, payload.issue.number);
				if (thread) await this.moveTo(thread, "done");
			}
		}
	}

	private async onIssueComment(
		repo: string,
		payload: GitHubPayload,
	): Promise<void> {
		const { issue, comment } = payload;
		if (payload.action !== "created" || !issue || !comment) return;
		if (issue.pull_request) return; // comments on pull requests are the edge worker's
		const thread = this.store.forGitHubIssue(repo, issue.number);
		if (!thread) return;
		const login = comment.user?.login ?? "";
		if (
			comment.user?.type === "Bot" ||
			this.botLogins.has(login.toLowerCase()) ||
			isMarked(comment.body)
		) {
			return;
		}
		const association = (comment.author_association ?? "").toUpperCase();
		if (!this.allowedAssociations.has(association)) {
			this.logger.info(
				`${repo}#${issue.number}: ignoring comment by @${login} (${association || "no association"}): not allowed to steer nyrus`,
			);
			return;
		}
		const source = this.sources.get(thread.workspaceKey);
		await source?.relayGitHubComment(thread, {
			id: comment.id,
			login,
			body: comment.body ?? "",
		});
	}

	private async onPullRequest(
		repo: string,
		payload: GitHubPayload,
	): Promise<void> {
		const pr = payload.pull_request;
		if (!pr) return;
		const ref: PullRequestRef = {
			repo,
			number: pr.number,
			url: pr.html_url,
			title: pr.title ?? "",
		};
		const threads = this.threadsOf(repo, pr);
		if (payload.action === "closed") {
			if (!pr.merged) return;
			for (const thread of threads) await this.moveTo(thread, "done");
			return;
		}
		if (
			!["opened", "reopened", "ready_for_review", "edited"].includes(
				payload.action ?? "",
			)
		) {
			return;
		}
		for (const thread of threads) {
			if (thread.pullRequests.includes(ref.url)) continue;
			thread.pullRequests = [...thread.pullRequests, ref.url];
			this.store.save(thread);
			const source = this.sources.get(thread.workspaceKey);
			await source?.reportPullRequest(thread, ref);
			if (!thread.stage) await this.moveTo(thread, "review");
		}
	}

	/** Threads a pull request belongs to: issues it closes, or its branch named after the ticket. */
	private threadsOf(repo: string, pr: GitHubPullRequest): GitHubThread[] {
		const threads = new Map<string, GitHubThread>();
		const add = (thread: GitHubThread | undefined) => {
			if (thread)
				threads.set(`${thread.workspaceKey}:${thread.issueId}`, thread);
		};
		for (const ref of closingReferences(pr.body, repo)) {
			add(this.store.forGitHubIssue(ref.repo, ref.number));
		}
		for (const thread of this.store.inRepo(repo)) {
			if (thread.pullRequests.includes(pr.html_url)) add(thread);
		}
		const branch = pr.head?.ref?.toLowerCase();
		if (branch) {
			for (const thread of this.store.inRepo(repo)) {
				const key = thread.identifier.toLowerCase();
				if (branch === key || branch.startsWith(`${key}-`)) add(thread);
			}
		}
		return [...threads.values()];
	}

	private async moveTo(
		thread: GitHubThread,
		stage: "review" | "done",
	): Promise<void> {
		if (thread.stage === stage || thread.stage === "done") return;
		const source = this.sources.get(thread.workspaceKey);
		if (!source) return;
		thread.stage = stage;
		this.store.save(thread);
		await source.moveTicket(thread, stage);
	}

	private isAuthorized(request: FastifyRequest): boolean {
		const signature = request.headers["x-hub-signature-256"];
		if (typeof signature !== "string" || !this.options.webhookSecret) {
			return false;
		}
		const raw =
			(request as FastifyRequest & { rawBody?: string }).rawBody ??
			JSON.stringify(request.body ?? {});
		const expected = `sha256=${createHmac("sha256", this.options.webhookSecret).update(raw).digest("hex")}`;
		const a = Buffer.from(expected);
		const b = Buffer.from(signature.trim().toLowerCase());
		return a.length === b.length && timingSafeEqual(a, b);
	}
}

/**
 * A comment tracker whose tickets are worked in GitHub issues: what the
 * tracker's sessions use instead of the tracker itself (see
 * {@link GitHubIssueThreads}). Until a ticket has a GitHub issue (no
 * repository picked yet, or one not on GitHub), everything goes to the
 * ticket as before.
 */
export class GitHubThreadedTracker implements CommentTracker {
	readonly platform: string;
	readonly workspaceKey: string;
	private coordinator?: Pick<CommentSessionCoordinator, "handle">;
	/** Tickets that got an event lately, by id and key. */
	private readonly active = new Map<string, number>();
	private readonly creating = new Map<
		string,
		Promise<GitHubThread | undefined>
	>();
	private readonly logger: ILogger;

	constructor(
		readonly source: GitHubThreadSource,
		private readonly threads: GitHubIssueThreads,
		logger?: ILogger,
	) {
		this.platform = source.platform;
		this.workspaceKey = source.workspaceKey;
		this.logger =
			logger ?? createLogger({ component: `GitHubIssues:${source.platform}` });
	}

	/** The ticket's GitHub issue, if it has one. */
	threadFor(idOrKey: string): GitHubThread | undefined {
		return this.threads.store.forTicket(this.workspaceKey, idOrKey);
	}

	/**
	 * The coordinator the tracker's transport should hand its events to: it
	 * notes which tickets are being worked on, copies the ticket's comments to
	 * its GitHub issue, and passes everything on. Also registers the GitHub
	 * webhook (once for all trackers).
	 */
	wrapCoordinator(
		coordinator: Pick<CommentSessionCoordinator, "handle">,
		host: TrackerIntegrationHost,
	): Pick<CommentSessionCoordinator, "handle"> {
		this.coordinator = coordinator;
		this.threads.connect(host);
		return {
			handle: async (event: CommentTrackerEvent) => {
				this.markActive(event.issueId);
				if (event.kind === "comment" && !event.own) {
					await this.mirrorToGitHub(event);
				}
				return coordinator.handle(event);
			},
		};
	}

	/**
	 * Give the agent the ticket with its GitHub issue: open one if the
	 * ticket is being worked on and its repository is on GitHub, and add the
	 * issue and how to work the ticket to the description. Call it on every
	 * issue the tracker's `fetchIssue` returns.
	 */
	async decorateIssue(issue: Issue): Promise<Issue> {
		let thread = this.threadFor(issue.id);
		if (!thread && this.isActive(issue)) {
			thread = await this.ensureThread(issue);
		}
		if (thread) {
			const writable = issue as unknown as { description?: string };
			writable.description =
				`${writable.description ?? ""}\n\n${workflowInstructions(thread, this.source.trackerName)}`.trim();
		}
		return issue;
	}

	// ----- CommentTracker -----

	fetchIssueState(issueId: string) {
		return this.source.fetchIssueState(issueId);
	}

	fetchUser(userId: string): Promise<User> {
		return this.source.fetchUser(userId);
	}

	async postComment(
		issueId: string,
		markdown: string,
		options?: CommentPostOptions,
	): Promise<{ id: string }> {
		const thread = this.threadFor(issueId);
		if (!thread) return this.source.postComment(issueId, markdown, options);
		const comment = await this.threads
			.api(thread.repositoryId)
			.createComment(thread.repo, thread.number, marked(markdown));
		if (options?.kind === "response" || options?.kind === "error") {
			await this.source
				.postComment(issueId, resultNote(thread, markdown))
				.catch((error) =>
					this.logger.warn(
						`${thread.identifier}: could not post the result on the ticket`,
						error,
					),
				);
		}
		return { id: `${GH_PREFIX}${comment.id}` };
	}

	async updateComment(
		issueId: string,
		commentId: string,
		markdown: string,
		options?: CommentPostOptions,
	): Promise<void> {
		const thread = this.threadFor(issueId);
		const githubId = githubCommentId(commentId);
		if (githubId === undefined || !thread) {
			return this.source.updateComment(issueId, commentId, markdown, options);
		}
		await this.threads
			.api(thread.repositoryId)
			.updateComment(thread.repo, githubId, marked(markdown));
	}

	async deleteComment(issueId: string, commentId: string): Promise<void> {
		const thread = this.threadFor(issueId);
		const githubId = githubCommentId(commentId);
		if (githubId === undefined || !thread) {
			return this.source.deleteComment(issueId, commentId);
		}
		await this.threads
			.api(thread.repositoryId)
			.deleteComment(thread.repo, githubId);
	}

	// ----- from the GitHub webhook -----

	/** A reply on the ticket's GitHub issue: a comment for the ticket's session. */
	async relayGitHubComment(
		thread: GitHubThread,
		comment: { id: number; login: string; body: string },
	): Promise<void> {
		if (!this.coordinator) return;
		this.markActive(thread.issueId);
		await this.coordinator.handle({
			kind: "comment",
			eventId: `github:comment:${comment.id}`,
			issueId: thread.issueId,
			commentId: `${GH_PREFIX}${comment.id}`,
			body: comment.body,
			// The issue exists to talk to nyrus: every reply addresses it.
			mentionsAgent: true,
			actor: { id: `github:${comment.login}`, name: comment.login },
		});
	}

	async reportPullRequest(
		thread: GitHubThread,
		pr: PullRequestRef,
	): Promise<void> {
		if (!this.source.attachPullRequest) return;
		try {
			await this.source.attachPullRequest(thread.issueId, pr);
		} catch (error) {
			this.logger.warn(
				`${thread.identifier}: could not link pull request ${pr.url}`,
				error,
			);
		}
	}

	async moveTicket(
		thread: GitHubThread,
		stage: "review" | "done",
	): Promise<void> {
		if (!this.source.moveToStage) return;
		try {
			await this.source.moveToStage(thread.issueId, stage);
			this.logger.info(`${thread.identifier}: moved to ${stage}`);
		} catch (error) {
			this.logger.warn(
				`${thread.identifier}: could not move the ticket to ${stage}`,
				error,
			);
		}
	}

	// ----- helpers -----

	private markActive(idOrKey: string): void {
		const now = Date.now();
		for (const [key, at] of this.active) {
			if (now - at < ACTIVE_MS) break; // insertion order = time order
			this.active.delete(key);
		}
		this.active.delete(idOrKey);
		this.active.set(idOrKey, now);
	}

	private isActive(issue: Issue): boolean {
		const now = Date.now();
		return [issue.id, issue.identifier].some((key) => {
			const at = key ? this.active.get(key) : undefined;
			return at !== undefined && now - at < ACTIVE_MS;
		});
	}

	/** The ticket's GitHub issue, opened now if its repository is known and on GitHub. */
	private ensureThread(issue: Issue): Promise<GitHubThread | undefined> {
		const pending = this.creating.get(issue.id);
		if (pending) return pending;
		const creating = this.createThread(issue)
			.catch((error) => {
				this.logger.error(
					`${issue.identifier}: could not open a GitHub issue; working on the ticket instead`,
					error,
				);
				return undefined;
			})
			.finally(() => this.creating.delete(issue.id));
		this.creating.set(issue.id, creating);
		return creating;
	}

	private async createThread(issue: Issue): Promise<GitHubThread | undefined> {
		const existing = this.threadFor(issue.id);
		if (existing) return existing;
		const repository = this.threads.repositoryForIssue(issue.id);
		const repo = parseGitHubRepo(repository?.githubUrl);
		if (!repository || !repo) return undefined;

		const body = githubIssueBody({
			trackerName: this.source.trackerName,
			identifier: issue.identifier,
			title: issue.title,
			url: issue.url,
			description: issue.description ?? undefined,
			fields: await ticketFields(issue),
			comments: await this.source.ticketComments(issue.id).catch((error) => {
				this.logger.warn(
					`${issue.identifier}: could not read the ticket's comments`,
					error,
				);
				return [];
			}),
		});
		const created = await this.threads.api(repository.id).createIssue(repo, {
			title: githubIssueTitle(issue.identifier, issue.title),
			body,
		});
		const thread: GitHubThread = {
			workspaceKey: this.workspaceKey,
			issueId: issue.id,
			identifier: issue.identifier,
			issueUrl: issue.url,
			repositoryId: repository.id,
			repo,
			number: created.number,
			url: created.url,
			createdAt: new Date().toISOString(),
			pullRequests: [],
		};
		this.threads.store.save(thread);
		this.logger.info(
			`${issue.identifier}: working in GitHub issue ${repo}#${created.number}`,
		);
		await this.source
			.postComment(issue.id, startNote(thread))
			.catch((error) =>
				this.logger.warn(
					`${issue.identifier}: could not post the GitHub link on the ticket`,
					error,
				),
			);
		return thread;
	}

	private async mirrorToGitHub(
		event: Extract<CommentTrackerEvent, { kind: "comment" }>,
	): Promise<void> {
		const thread = this.threadFor(event.issueId);
		if (!thread || !event.body.trim()) return;
		try {
			await this.threads
				.api(thread.repositoryId)
				.createComment(
					thread.repo,
					thread.number,
					mirroredComment(
						this.source.trackerName,
						event.actor?.name ?? event.actor?.id ?? "Someone",
						event.body,
						thread.issueUrl,
					),
				);
		} catch (error) {
			this.logger.warn(
				`${thread.identifier}: could not copy a comment to the GitHub issue`,
				error,
			);
		}
	}
}

function githubCommentId(commentId: string): number | undefined {
	if (!commentId.startsWith(GH_PREFIX)) return undefined;
	const id = Number(commentId.slice(GH_PREFIX.length));
	return Number.isFinite(id) ? id : undefined;
}

/** Status, assignee and labels of a ticket, for the GitHub issue. */
async function ticketFields(
	issue: Issue,
): Promise<Array<[string, string | undefined]>> {
	const loose = issue as unknown as {
		state?: Promise<{ name?: string } | undefined>;
		assignee?: Promise<{ name?: string } | undefined>;
		labelIds?: string[];
	};
	const [state, assignee] = await Promise.all([
		Promise.resolve(loose.state).catch(() => undefined),
		Promise.resolve(loose.assignee).catch(() => undefined),
	]);
	return [
		["Status", state?.name],
		["Assignee", assignee?.name],
		["Labels", loose.labelIds?.length ? loose.labelIds.join(", ") : undefined],
	];
}

/**
 * GitHub issues from the environment: on when GITHUB_ISSUES_WEBHOOK_SECRET
 * is set (answers on GitHub can't reach nyrus without the webhook).
 * GITHUB_ISSUES_ALLOWED_ASSOCIATIONS (comma-separated, default
 * OWNER,MEMBER,COLLABORATOR) limits who can steer it there;
 * GITHUB_BOT_USERNAME is a bot account whose comments are ignored.
 */
export function createGitHubIssueThreadsFromEnv(context: {
	env: NodeJS.ProcessEnv;
	cyrusHome: string;
	logger: ILogger;
}): GitHubIssueThreads | undefined {
	const { env, cyrusHome, logger } = context;
	const webhookSecret = env.GITHUB_ISSUES_WEBHOOK_SECRET?.trim();
	if (!webhookSecret) return undefined;
	const list = (value: string | undefined) =>
		(value ?? "")
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	const associations = list(env.GITHUB_ISSUES_ALLOWED_ASSOCIATIONS);
	return new GitHubIssueThreads({
		webhookSecret,
		storePath: join(cyrusHome, "github-issue-threads.json"),
		allowedAssociations: associations.length ? associations : undefined,
		botLogins: list(env.GITHUB_BOT_USERNAME),
		logger,
	});
}

// ----- the parts of GitHub's webhook payloads used here -----

interface GitHubPullRequest {
	number: number;
	html_url: string;
	title?: string;
	body?: string | null;
	merged?: boolean;
	head?: { ref?: string };
}

export interface GitHubPayload {
	action?: string;
	repository?: { full_name?: string };
	issue?: {
		number: number;
		state_reason?: string | null;
		pull_request?: unknown;
	};
	comment?: {
		id: number;
		body?: string | null;
		author_association?: string;
		user?: { login?: string; type?: string };
	};
	pull_request?: GitHubPullRequest;
}
