import type { ILogger } from "cyrus-core";
import type { CommentSessionCoordinator } from "../CommentSessionCoordinator.js";
import { sessionIdFor } from "../SessionStore.js";
import type {
	CommentTrackerEvent,
	TrackerIntegration,
	TrackerIntegrationFactory,
	TrackerIntegrationHost,
} from "../types.js";
import type { GitHubIssueData } from "./GitHubIssuesApi.js";
import type {
	GitHubIssueThreads,
	GitHubPayload,
	UnthreadedIssueListener,
} from "./GitHubIssueThreads.js";
import {
	GITHUB_WORKSPACE_KEY,
	type GitHubIssueTrackerOptions,
	GitHubIssueTrackerService,
	githubIssueId,
} from "./GitHubIssueTrackerService.js";
import { isMarked } from "./text.js";

/**
 * Turns the GitHub webhook events of issues that are no ticket's thread
 * into comment-session events for the GitHub issue tracker:
 *
 * - `issues` `opened` / `assigned` / `unassigned` / `reopened` / `closed`:
 *   the hand-over (nyrus's account among the assignees) may have changed.
 *   Assigning needs triage access to the repository on GitHub, so who
 *   assigned isn't checked again. Closing only stops a session that is
 *   working or waiting for an answer.
 * - `issue_comment` `created`: a comment, with `@<login>` mentions of nyrus
 *   removed; only from allowed authors (author association), never nyrus's
 *   own or a bot's.
 *
 * Issues of repositories no configured repository takes, and issues nyrus
 * opened itself (marked), are ignored.
 */
export function githubIssueEventHandler(
	tracker: GitHubIssueTrackerService,
	threads: Pick<GitHubIssueThreads, "commentVerdict">,
	coordinator: Pick<CommentSessionCoordinator, "handle">,
	host: Pick<TrackerIntegrationHost, "getSessionState">,
	logger: ILogger,
): UnthreadedIssueListener {
	const mention = mentionPattern(tracker.agentLogins);
	return async (name, payload, deliveryId) => {
		const repo = payload.repository?.full_name?.toLowerCase();
		const issue = payload.issue as GitHubIssueData | undefined;
		if (!repo || !issue || issue.pull_request) return;
		if (!tracker.takesIssuesOf(repo)) return;
		if (isMarked(issue.body)) return; // opened by nyrus
		const issueId = githubIssueId(repo, issue.number);
		const sender = payload.sender?.login;
		const actor = sender ? { id: `github:${sender}`, name: sender } : undefined;
		const label = `${repo}#${issue.number}`;

		if (name === "issue_comment") {
			const { comment } = payload;
			if (payload.action !== "created" || !comment) return;
			if (tracker.isAgentLogin(comment.user?.login)) return;
			const verdict = threads.commentVerdict(comment);
			if (verdict === "own") return;
			if (verdict === "not-allowed") {
				logger.info(
					`${label}: ignoring comment by @${comment.user?.login ?? "?"} (${comment.author_association || "no association"}): not allowed to steer nyrus`,
				);
				return;
			}
			const body = comment.body ?? "";
			mention.lastIndex = 0;
			const mentionsAgent = mention.test(body);
			const commentId = String(comment.id);
			tracker.rememberIssue(repo, issue);
			tracker.rememberComment(commentId, issueId);
			const login = comment.user?.login ?? "someone";
			await coordinator.handle({
				kind: "comment",
				eventId: `github:comment:${comment.id}`,
				issueId,
				commentId,
				body: body.replace(mention, "$1").trim(),
				mentionsAgent,
				actor: { id: `github:${login}`, name: login },
			});
			return;
		}

		const handOver = handOverChange(tracker, payload, issue, () =>
			host.getSessionState(sessionIdFor(tracker.platform, issueId)),
		);
		if (handOver === null) return;
		tracker.rememberIssue(repo, issue);
		const event: CommentTrackerEvent = {
			kind: "issue",
			issueId,
			...(handOver && { handOver }),
			...(deliveryId && { eventId: `github:delivery:${deliveryId}` }),
			...(actor && { actor }),
		};
		logger.debug(
			`${label}: issues ${payload.action}${handOver ? ` (hand-over ${handOver})` : ""}`,
		);
		await coordinator.handle(event);
	};
}

/**
 * What an `issues` event did to the hand-over: `added`, `removed`,
 * undefined (report it, nothing changed for sure), or null (ignore it).
 */
function handOverChange(
	tracker: GitHubIssueTrackerService,
	payload: GitHubPayload,
	issue: GitHubIssueData,
	sessionState: () => string,
): "added" | "removed" | undefined | null {
	switch (payload.action) {
		case "opened":
			return tracker.isHandedOver(issue) ? undefined : null;
		case "assigned":
			return tracker.isAgentLogin(payload.assignee?.login) ? "added" : null;
		case "unassigned":
			return tracker.isAgentLogin(payload.assignee?.login) ? "removed" : null;
		case "reopened":
			return tracker.isHandedOver(issue) ? "added" : null;
		case "closed": {
			const state = sessionState();
			return state === "working" || state === "awaiting-input"
				? "removed"
				: null;
		}
		default:
			return null;
	}
}

/** `@login` for any of the logins, not inside a word, email or path. */
function mentionPattern(logins: string[]): RegExp {
	const names = logins
		.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|");
	return new RegExp(`(^|[^\\w@/.-])@(?:${names})(?![\\w-])`, "gi");
}

/**
 * GitHub issues worked directly, without a ticket elsewhere: on when GitHub
 * issues are (GITHUB_ISSUES_WEBHOOK_SECRET), and they share its webhook.
 * Only issues of repositories configured with `linearWorkspaceId: "github"`
 * and the repository (`owner/repo`, lowercase) in `teamKeys` are worked.
 *
 * - `GITHUB_BOT_USERNAME` (default `nyrus`, comma-separated for several):
 *   nyrus's GitHub account. Assigning it hands an issue over; `@<login>`
 *   in a comment starts a conversation.
 * - `GITHUB_ISSUES_ALLOWED_ASSOCIATIONS`: who may steer nyrus by comment
 *   (see GitHubIssueThreads).
 */
export function createGitHubIssuesIntegrationFactory(
	options: Omit<GitHubIssueTrackerOptions, "agentLogins" | "logger"> = {},
): TrackerIntegrationFactory {
	return ({ env, logger, githubIssues }): TrackerIntegration | null => {
		if (!githubIssues) return null;
		const tracker = new GitHubIssueTrackerService({
			...options,
			agentLogins: (env.GITHUB_BOT_USERNAME ?? "")
				.split(",")
				.map((l) => l.trim())
				.filter(Boolean),
			logger,
		});
		return {
			workspaceKey: GITHUB_WORKSPACE_KEY,
			tracker,
			register(host) {
				tracker.connect(host);
				const coordinator = tracker.sessions.createCoordinator(host);
				githubIssues.onUnthreadedIssueEvent(
					githubIssueEventHandler(
						tracker,
						githubIssues,
						coordinator,
						host,
						logger,
					),
				);
				githubIssues.connect(host);
				logger.info(
					`✅ GitHub issues worked directly (assign or mention @${tracker.agentLogins.join(", @")}; repositories with linearWorkspaceId "${GITHUB_WORKSPACE_KEY}")`,
				);
			},
			dispose: () => tracker.dispose(),
		};
	};
}

/** GitHub issues worked directly, for the edge worker's list. */
export const createGitHubIssuesIntegration: TrackerIntegrationFactory =
	createGitHubIssuesIntegrationFactory();
