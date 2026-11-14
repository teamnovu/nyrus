import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { GitHubIssuesApi } from "../src/github/GitHubIssuesApi.js";
import { parseGitHubRepo } from "../src/github/GitHubIssuesApi.js";
import {
	GitHubIssueThreads,
	type GitHubThreadSource,
} from "../src/github/GitHubIssueThreads.js";
import { closingReferences, OWN_MARKER } from "../src/github/text.js";
import type { TrackerIntegrationHost } from "../src/types.js";
import { fakeTracker } from "./fakeTracker.js";

const SECRET = "s3cret";

function fakeGitHub() {
	let next = 100;
	const issues: Array<{ repo: string; title: string; body: string }> = [];
	const comments = new Map<
		number,
		{ repo: string; issue: number; body: string }
	>();
	const api: GitHubIssuesApi = {
		createIssue: vi.fn(async (repo, issue) => {
			issues.push({ repo, ...issue });
			return { number: 7, url: `https://github.com/${repo}/issues/7` };
		}),
		createComment: vi.fn(async (repo, issue, body) => {
			const id = next++;
			comments.set(id, { repo, issue, body });
			return { id };
		}),
		updateComment: vi.fn(async (repo, id, body) => {
			comments.set(id, { ...comments.get(id)!, repo, body });
		}),
		deleteComment: vi.fn(async (_repo, id) => {
			comments.delete(id);
		}),
	};
	return { api, issues, comments };
}

function setup() {
	const github = fakeGitHub();
	const base = fakeTracker();
	const source = Object.assign(base, {
		trackerName: "Jira",
		ticketComments: vi.fn(async () => [
			{
				author: "Ada",
				createdAt: new Date("2026-11-01T10:00:00Z"),
				body: "Also on Safari.",
			},
		]),
		attachPullRequest: vi.fn(async () => {}),
		moveToStage: vi.fn(async () => {}),
	}) satisfies GitHubThreadSource;
	const threads = new GitHubIssueThreads({
		webhookSecret: SECRET,
		createApi: () => github.api,
	});
	const tracker = threads.attach(source);
	const fastify = Fastify();
	const repository = {
		id: "repo-1",
		name: "web",
		githubUrl: "https://github.com/acme/web.git",
	};
	const host = {
		fastify,
		dispatch: vi.fn(),
		getSessionState: () => "unknown",
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		repositoryForIssue: vi.fn((issueId: string) =>
			issueId === "t-1" ? repository : undefined,
		),
	} as unknown as TrackerIntegrationHost;
	const coordinator = { handle: vi.fn(async () => {}) };
	const handle = tracker.wrapCoordinator(coordinator, host).handle;
	const issue = () =>
		({
			id: "t-1",
			identifier: "TCK-1",
			title: "Login broken",
			url: "https://tracker.example/t/TCK-1",
			description: "Login fails on mobile.",
			labelIds: ["bug"],
		}) as never;
	return {
		github,
		source,
		threads,
		tracker,
		fastify,
		host,
		coordinator,
		handle,
		issue,
	};
}

/** Make the ticket "being worked on", as its tracker's webhook would. */
async function activate(handle: (e: never) => Promise<void>) {
	await handle({ kind: "issue", issueId: "TCK-1" } as never);
}

describe("GitHubIssueThreads", () => {
	it("leaves tickets alone that nyrus isn't working on", async () => {
		const { github, tracker, issue } = setup();
		const result = (await tracker.decorateIssue(issue())) as {
			description: string;
		};
		expect(github.api.createIssue).not.toHaveBeenCalled();
		expect(result.description).toBe("Login fails on mobile.");
	});

	it("opens one GitHub issue with the ticket's details and tells the agent how to work", async () => {
		const { github, source, tracker, handle, issue } = setup();
		await activate(handle);

		const [first, second] = await Promise.all([
			tracker.decorateIssue(issue()),
			tracker.decorateIssue(issue()),
		]);
		expect(github.api.createIssue).toHaveBeenCalledTimes(1);
		const created = github.issues[0]!;
		expect(created.repo).toBe("acme/web");
		expect(created.title).toBe("[TCK-1] Login broken");
		expect(created.body).toContain("Login fails on mobile.");
		expect(created.body).toContain("**Labels:** bug");
		expect(created.body).toContain("> Also on Safari.");
		expect(created.body).toContain(OWN_MARKER);

		// The ticket gets the link, once.
		expect(source.postComment).toHaveBeenCalledTimes(1);
		expect(source.postComment.mock.calls[0]![1]).toContain(
			"https://github.com/acme/web/issues/7",
		);

		for (const decorated of [first, second] as Array<{ description: string }>) {
			expect(decorated.description).toMatch(
				/^Login fails on mobile\.\n\n<github_issue /,
			);
			expect(decorated.description).toContain("Clarify first");
			expect(decorated.description).toContain("AskUserQuestion");
			expect(decorated.description).toContain("Closes acme/web#7");
		}
	});

	it("doesn't open an issue before the repository is known, or off GitHub", async () => {
		const { github, tracker, handle, host, issue } = setup();
		await activate(handle);
		vi.mocked(host.repositoryForIssue!).mockReturnValueOnce(undefined);
		await tracker.decorateIssue(issue());
		vi.mocked(host.repositoryForIssue!).mockReturnValueOnce({
			id: "repo-2",
			name: "gl",
			githubUrl: "https://gitlab.com/acme/web",
		});
		await tracker.decorateIssue(issue());
		expect(github.api.createIssue).not.toHaveBeenCalled();
	});

	it("posts the session's comments on GitHub, and only the result on the ticket", async () => {
		const { github, source, tracker, handle, issue } = setup();
		// Before the GitHub issue exists (e.g. picking a repository): on the ticket.
		const early = await tracker.postComment("t-1", "Which repository?", {
			kind: "question",
		});
		expect(early.id).toMatch(/^c-/);

		await activate(handle);
		await tracker.decorateIssue(issue());
		source.postComment.mockClear();

		const note = await tracker.postComment("t-1", "⏳ Working", {
			progress: true,
			kind: "progress",
		});
		expect(note.id).toMatch(/^gh:\d+$/);
		await tracker.updateComment("t-1", note.id, "⏳ Still working", {
			progress: true,
		});
		await tracker.deleteComment("t-1", note.id);
		expect(github.comments.size).toBe(0);

		await tracker.postComment("t-1", "What should happen on timeout?", {
			kind: "question",
		});
		expect(source.postComment).not.toHaveBeenCalled();

		await tracker.postComment("t-1", "Fixed, see PR.", { kind: "response" });
		expect([...github.comments.values()].map((c) => c.body)).toEqual([
			`What should happen on timeout?\n\n${OWN_MARKER}`,
			`Fixed, see PR.\n\n${OWN_MARKER}`,
		]);
		expect(source.postComment).toHaveBeenCalledTimes(1);
		expect(source.postComment.mock.calls[0]![1]).toBe(
			"Fixed, see PR.\n\n---\nDetails and discussion: [acme/web#7](https://github.com/acme/web/issues/7)",
		);
		// Comments posted on the ticket earlier are still edited there.
		await tracker.deleteComment("t-1", early.id);
		expect(source.deleteComment).toHaveBeenCalledWith("t-1", early.id);
	});

	it("copies the ticket's comments to the GitHub issue and passes them on", async () => {
		const { github, coordinator, tracker, handle, issue } = setup();
		await activate(handle);
		await tracker.decorateIssue(issue());
		const event = {
			kind: "comment",
			issueId: "TCK-1",
			commentId: "c-9",
			body: "Use the staging DB.",
			mentionsAgent: false,
			actor: { id: "u1", name: "Grace" },
		};
		await handle(event as never);
		await handle({ ...event, commentId: "c-10", own: true } as never);
		expect(coordinator.handle).toHaveBeenCalledWith(event);
		expect([...github.comments.values()].map((c) => c.body)).toEqual([
			`💬 **Grace** commented in [Jira](https://tracker.example/t/TCK-1):\n\n> Use the staging DB.\n\n${OWN_MARKER}`,
		]);
	});

	it("hands replies on the GitHub issue to the ticket's session, from members only", async () => {
		const { threads, coordinator, tracker, handle, issue } = setup();
		await activate(handle);
		await tracker.decorateIssue(issue());
		coordinator.handle.mockClear();
		const comment = (over: Record<string, unknown>) => ({
			action: "created",
			repository: { full_name: "acme/web" },
			issue: { number: 7 },
			comment: {
				id: 555,
				body: "Timeouts should retry once.",
				author_association: "MEMBER",
				user: { login: "grace", type: "User" },
				...over,
			},
		});
		await threads.handleWebhook("issue_comment", comment({}));
		await threads.handleWebhook(
			"issue_comment",
			comment({ id: 556, author_association: "NONE" }),
		);
		await threads.handleWebhook(
			"issue_comment",
			comment({ id: 557, user: { login: "nyrus[bot]", type: "Bot" } }),
		);
		await threads.handleWebhook(
			"issue_comment",
			comment({ id: 558, body: `Plan\n${OWN_MARKER}` }),
		);
		await threads.handleWebhook("issue_comment", {
			...comment({ id: 559 }),
			issue: { number: 8 },
		});
		expect(coordinator.handle).toHaveBeenCalledTimes(1);
		expect(coordinator.handle).toHaveBeenCalledWith({
			kind: "comment",
			eventId: "github:comment:555",
			issueId: "t-1",
			commentId: "gh:555",
			body: "Timeouts should retry once.",
			mentionsAgent: true,
			actor: { id: "github:grace", name: "grace" },
		});
	});

	it("links the closing pull request, moves the ticket to review, and to done when the issue closes", async () => {
		const { threads, source, tracker, handle, issue } = setup();
		await activate(handle);
		await tracker.decorateIssue(issue());
		const pr = {
			number: 12,
			html_url: "https://github.com/acme/web/pull/12",
			title: "Fix login",
			body: "Fixes the timeout.\n\nCloses #7",
			head: { ref: "feature/x" },
		};
		await threads.handleWebhook("pull_request", {
			action: "opened",
			repository: { full_name: "acme/web" },
			pull_request: pr,
		});
		await threads.handleWebhook("pull_request", {
			action: "edited",
			repository: { full_name: "acme/web" },
			pull_request: pr,
		});
		expect(source.attachPullRequest).toHaveBeenCalledTimes(1);
		expect(source.attachPullRequest).toHaveBeenCalledWith("t-1", {
			repo: "acme/web",
			number: 12,
			url: pr.html_url,
			title: "Fix login",
		});
		expect(source.moveToStage).toHaveBeenCalledWith("t-1", "review");

		await threads.handleWebhook("pull_request", {
			action: "closed",
			repository: { full_name: "acme/web" },
			pull_request: { ...pr, merged: true },
		});
		await threads.handleWebhook("issues", {
			action: "closed",
			repository: { full_name: "acme/web" },
			issue: { number: 7, state_reason: "completed" },
		});
		expect(source.moveToStage.mock.calls).toEqual([
			["t-1", "review"],
			["t-1", "done"],
		]);
	});

	it("matches a pull request by its branch named after the ticket", async () => {
		const { threads, source, tracker, handle, issue } = setup();
		await activate(handle);
		await tracker.decorateIssue(issue());
		await threads.handleWebhook("pull_request", {
			action: "opened",
			repository: { full_name: "acme/web" },
			pull_request: {
				number: 3,
				html_url: "https://github.com/acme/web/pull/3",
				body: "",
				head: { ref: "tck-1-login-broken" },
			},
		});
		expect(source.attachPullRequest).toHaveBeenCalledTimes(1);
	});

	it("only accepts webhooks signed with the secret", async () => {
		const { fastify } = setup();
		const payload = {
			action: "created",
			repository: { full_name: "acme/web" },
		};
		const signature = `sha256=${createHmac("sha256", SECRET).update(JSON.stringify(payload)).digest("hex")}`;
		const send = (sig: string) =>
			fastify.inject({
				method: "POST",
				url: "/github-issues-webhook",
				headers: {
					"x-github-event": "issue_comment",
					"x-hub-signature-256": sig,
				},
				payload,
			});
		expect((await send(signature)).statusCode).toBe(200);
		expect((await send("sha256=0000")).statusCode).toBe(401);
	});
});

describe("closingReferences", () => {
	it("reads the issues a pull request closes", () => {
		expect(
			closingReferences(
				"Closes #7, fixes acme/api#3 and resolves https://github.com/acme/web/issues/9. Refs #10",
				"acme/web",
			),
		).toEqual([
			{ repo: "acme/web", number: 7 },
			{ repo: "acme/api", number: 3 },
			{ repo: "acme/web", number: 9 },
		]);
	});
});

describe("parseGitHubRepo", () => {
	it("reads github.com URLs only", () => {
		expect(parseGitHubRepo("https://github.com/acme/web")).toBe("acme/web");
		expect(parseGitHubRepo("git@github.com:acme/web.git")).toBe("acme/web");
		expect(parseGitHubRepo("https://gitlab.com/acme/web")).toBeUndefined();
	});
});
