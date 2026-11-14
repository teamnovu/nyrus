import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type {
	GitHubIssueData,
	GitHubIssueReadApi,
} from "../src/github/GitHubIssuesApi.js";
import { createGitHubIssuesIntegrationFactory } from "../src/github/GitHubIssuesIntegration.js";
import {
	GitHubIssueThreads,
	type GitHubPayload,
	type GitHubThreadSource,
} from "../src/github/GitHubIssueThreads.js";
import {
	type GitHubIssueTrackerService,
	githubIssueId,
	githubIssueIdentifier,
	parseGitHubIssueId,
} from "../src/github/GitHubIssueTrackerService.js";
import { OWN_MARKER } from "../src/github/text.js";
import type {
	LinearShapedWebhook,
	SessionState,
	TrackerIntegrationHost,
} from "../src/types.js";
import { fakeTracker } from "./fakeTracker.js";

const SECRET = "s3cret";
const SESSION = "gh-issues-acme/web#7";

function fakeGitHub() {
	let next = 100;
	const issue: GitHubIssueData = {
		number: 7,
		title: "Login broken",
		body: "Login fails on mobile.",
		html_url: "https://github.com/acme/web/issues/7",
		state: "open",
		labels: [{ name: "bug" }],
		assignees: [],
		user: { login: "ada", type: "User" },
	};
	const comments = new Map<number, string>();
	const api: GitHubIssueReadApi = {
		createIssue: vi.fn(async () => ({ number: 1, url: "" })),
		createComment: vi.fn(async (_repo, _n, body) => {
			const id = next++;
			comments.set(id, body);
			return { id };
		}),
		updateComment: vi.fn(async (_repo, id, body) => {
			comments.set(id, body);
		}),
		deleteComment: vi.fn(async (_repo, id) => {
			comments.delete(id);
		}),
		getIssue: vi.fn(async () => issue),
		listComments: vi.fn(async () => []),
		getComment: vi.fn(async (_repo, id) => ({ id, body: comments.get(id) })),
		updateIssue: vi.fn(async () => issue),
	};
	return { api, issue, comments };
}

function setup(options: { otherTracker?: boolean } = {}) {
	const github = fakeGitHub();
	const threads = new GitHubIssueThreads({
		webhookSecret: SECRET,
		createApi: () => github.api,
	});
	const states: Record<string, SessionState> = {};
	const dispatched: LinearShapedWebhook[] = [];
	const fastify = Fastify();
	const host = {
		fastify,
		dispatch: vi.fn(async (w: LinearShapedWebhook) => {
			dispatched.push(w);
			const session = w.agentSession as { id: string };
			states[session.id] ??= "working";
		}),
		getSessionState: (id: string) => states[id] ?? "unknown",
		logger: { info() {}, warn() {}, error() {}, debug() {} },
		githubToken: vi.fn(async () => "token"),
		repositories: () => [
			{
				id: "repo-web",
				name: "web",
				githubUrl: "https://github.com/acme/web",
				workspaceKey: "github",
				teamKeys: ["acme/web"],
			},
			{
				id: "repo-jira",
				name: "api",
				githubUrl: "https://github.com/acme/api",
				workspaceKey: "jira-acme",
				teamKeys: ["API"],
			},
		],
	} as unknown as TrackerIntegrationHost;

	// A ticket tracker whose tickets are worked in GitHub issues (mirrors).
	const source = Object.assign(fakeTracker(), {
		trackerName: "Jira",
		ticketComments: vi.fn(async () => []),
	}) satisfies GitHubThreadSource;
	const sourceCoordinator = { handle: vi.fn(async () => {}) };
	if (options.otherTracker) {
		threads.attach(source).wrapCoordinator(sourceCoordinator, host);
	}

	const integration = createGitHubIssuesIntegrationFactory({
		createApi: () => github.api,
		dispatchTiming: { promptSettleMs: 1, startPollMs: 1, startSettleMaxMs: 20 },
	})({
		env: {},
		cyrusHome: "/tmp/unused",
		logger: host.logger,
		githubIssues: threads,
	})!;
	integration.register(host);
	const tracker = integration.tracker as GitHubIssueTrackerService;
	return {
		github,
		threads,
		tracker,
		host,
		states,
		dispatched,
		fastify,
		integration,
		sourceCoordinator,
	};
}

const issuesEvent = (
	action: string,
	issue: GitHubIssueData,
	extra: Partial<GitHubPayload> = {},
): GitHubPayload => ({
	action,
	repository: { full_name: "acme/web" },
	issue: { ...issue },
	sender: { login: "grace", type: "User" },
	...extra,
});

let commentId = 500;
const commentEvent = (
	issue: GitHubIssueData,
	body: string,
	over: Record<string, unknown> = {},
): GitHubPayload => ({
	action: "created",
	repository: { full_name: "acme/web" },
	issue: { ...issue },
	sender: { login: "grace", type: "User" },
	comment: {
		id: ++commentId,
		body,
		author_association: "MEMBER",
		user: { login: "grace", type: "User" },
		...over,
	},
});

type Session = {
	id: string;
	issueId: string;
	comment?: { id: string; body: string };
	issue: { id: string; identifier: string; team: { key: string } };
};
const session = (w: LinearShapedWebhook) => w.agentSession as Session;
const activity = (w: LinearShapedWebhook) =>
	w.agentActivity as { content: { body: string }; signal?: string };

describe("GitHub issues worked directly", () => {
	it("starts a delegation when nyrus is assigned, routed by the repository as team key", async () => {
		const { threads, github, dispatched } = setup();
		github.issue.assignees = [{ login: "Nyrus" }];
		await threads.handleWebhook(
			"issues",
			issuesEvent("assigned", github.issue, { assignee: { login: "Nyrus" } }),
			"d-1",
		);
		expect(dispatched).toHaveLength(1);
		const webhook = dispatched[0]!;
		expect(webhook.action).toBe("created");
		expect(webhook.organizationId).toBe("github");
		expect(session(webhook).id).toBe(SESSION);
		expect(session(webhook).issue).toMatchObject({
			id: "acme/web#7",
			identifier: "web-7",
			team: { key: "acme/web" },
		});
		expect(session(webhook).comment).toBeUndefined();
	});

	it("starts once when an issue is opened already assigned (opened + assigned)", async () => {
		const { threads, github, dispatched } = setup();
		github.issue.assignees = [{ login: "nyrus" }];
		await threads.handleWebhook("issues", issuesEvent("opened", github.issue));
		await threads.handleWebhook(
			"issues",
			issuesEvent("assigned", github.issue, { assignee: { login: "nyrus" } }),
		);
		expect(dispatched.map((w) => w.action)).toEqual(["created"]);
	});

	it("ignores assignments of other people and issues opened without nyrus", async () => {
		const { threads, github, dispatched } = setup();
		github.issue.assignees = [{ login: "grace" }];
		await threads.handleWebhook("issues", issuesEvent("opened", github.issue));
		await threads.handleWebhook(
			"issues",
			issuesEvent("assigned", github.issue, { assignee: { login: "grace" } }),
		);
		expect(dispatched).toHaveLength(0);
	});

	it("stops the session when nyrus is unassigned", async () => {
		const { threads, github, dispatched, states } = setup();
		states[SESSION] = "working";
		github.issue.assignees = [];
		await threads.handleWebhook(
			"issues",
			issuesEvent("unassigned", github.issue, { assignee: { login: "nyrus" } }),
		);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]!.action).toBe("prompted");
		expect(activity(dispatched[0]!).signal).toBe("stop");
	});

	it("stops a working session when the issue is closed, but leaves a finished one alone", async () => {
		const { threads, github, dispatched, states } = setup();
		github.issue.assignees = [{ login: "nyrus" }];
		github.issue.state = "closed";
		states[SESSION] = "idle";
		await threads.handleWebhook("issues", issuesEvent("closed", github.issue));
		expect(dispatched).toHaveLength(0);
		states[SESSION] = "working";
		await threads.handleWebhook("issues", issuesEvent("closed", github.issue));
		expect(activity(dispatched[0]!).signal).toBe("stop");
	});

	it("starts a conversation on a comment mentioning @nyrus, without the mention", async () => {
		const { threads, github, dispatched } = setup();
		await threads.handleWebhook(
			"issue_comment",
			commentEvent(github.issue, "@nyrus why does this fail?"),
		);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]!.action).toBe("created");
		expect(session(dispatched[0]!).comment).toEqual({
			id: String(commentId),
			body: "why does this fail?",
		});
		// Not a mention: an email, or another login.
		await threads.handleWebhook(
			"issue_comment",
			commentEvent(github.issue, "mail me at a@nyrus.dev, cc @nyrusfan"),
		);
		expect(dispatched).toHaveLength(1);
	});

	it("passes comments on an assigned issue to its session", async () => {
		const { threads, github, dispatched, states } = setup();
		github.issue.assignees = [{ login: "nyrus" }];
		states[SESSION] = "working";
		await threads.handleWebhook(
			"issue_comment",
			commentEvent(github.issue, "Use the staging DB."),
		);
		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]!.action).toBe("prompted");
		expect(activity(dispatched[0]!).content.body).toBe("Use the staging DB.");
	});

	it("ignores comments by people who aren't allowed, bots, nyrus's account and its own", async () => {
		const { threads, github, dispatched, states } = setup();
		github.issue.assignees = [{ login: "nyrus" }];
		states[SESSION] = "working";
		const ignored = [
			commentEvent(github.issue, "@nyrus do it", {
				author_association: "NONE",
			}),
			commentEvent(github.issue, "@nyrus hi", {
				user: { login: "renovate[bot]", type: "Bot" },
			}),
			commentEvent(github.issue, "Working on it", {
				user: { login: "nyrus", type: "User" },
			}),
			commentEvent(github.issue, `Plan\n\n${OWN_MARKER}`),
		];
		for (const payload of ignored) {
			await threads.handleWebhook("issue_comment", payload);
		}
		expect(dispatched).toHaveLength(0);
	});

	it("ignores issues of repositories that don't take GitHub issues, and pull requests", async () => {
		const { threads, github, dispatched } = setup();
		github.issue.assignees = [{ login: "nyrus" }];
		await threads.handleWebhook("issues", {
			...issuesEvent("opened", github.issue),
			repository: { full_name: "acme/api" },
		});
		await threads.handleWebhook("issue_comment", {
			...commentEvent(github.issue, "@nyrus look"),
			issue: { ...github.issue, pull_request: {} },
		});
		expect(dispatched).toHaveLength(0);
	});

	it("leaves events of mirrored ticket threads to GitHubIssueThreads", async () => {
		const { threads, github, dispatched, sourceCoordinator } = setup({
			otherTracker: true,
		});
		threads.store.save({
			workspaceKey: "fake-ws",
			issueId: "t-1",
			identifier: "TCK-1",
			repositoryId: "repo-web",
			repo: "acme/web",
			number: 7,
			url: github.issue.html_url,
			createdAt: new Date().toISOString(),
			pullRequests: [],
		});
		await threads.handleWebhook(
			"issue_comment",
			commentEvent(github.issue, "@nyrus the answer is 42"),
		);
		github.issue.assignees = [{ login: "nyrus" }];
		await threads.handleWebhook(
			"issues",
			issuesEvent("assigned", github.issue, { assignee: { login: "nyrus" } }),
		);
		expect(dispatched).toHaveLength(0);
		expect(sourceCoordinator.handle).toHaveBeenCalledWith(
			expect.objectContaining({ issueId: "t-1", kind: "comment" }),
		);
	});

	it("registers the webhook route without any other tracker", async () => {
		const { fastify, github, dispatched } = setup();
		github.issue.assignees = [{ login: "nyrus" }];
		const payload = issuesEvent("assigned", github.issue, {
			assignee: { login: "nyrus" },
		});
		const signature = `sha256=${createHmac("sha256", SECRET).update(JSON.stringify(payload)).digest("hex")}`;
		const response = await fastify.inject({
			method: "POST",
			url: "/github-issues-webhook",
			headers: {
				"x-github-event": "issues",
				"x-github-delivery": "d-9",
				"x-hub-signature-256": signature,
			},
			payload,
		});
		expect(response.statusCode).toBe(200);
		await vi.waitFor(() => expect(dispatched).toHaveLength(1));
	});

	it("posts the session's activities as marked comments on the issue", async () => {
		const { tracker, github } = setup();
		await tracker.createAgentActivity({
			agentSessionId: SESSION,
			content: { type: "response", body: "Fixed, see PR." },
		} as never);
		expect([...github.comments.values()]).toEqual([
			`Fixed, see PR.\n\n${OWN_MARKER}`,
		]);
		expect(github.api.createComment).toHaveBeenCalledWith(
			"acme/web",
			7,
			expect.any(String),
		);
	});

	it("gives the agent the issue with how to work it and that its PR closes the issue", async () => {
		const { tracker } = setup();
		const issue = (await tracker.fetchIssue("acme/web#7")) as unknown as {
			description: string;
			branchName: string;
			labelIds: string[];
		};
		expect(issue.description).toMatch(
			/^Login fails on mobile\.\n\n<github_issue repository="acme\/web" number="7"/,
		);
		expect(issue.description).toContain("`Closes #7`");
		expect(issue.description).toContain("gh issue view 7 --repo acme/web");
		expect(issue.branchName).toBe("web-7-login-broken");
		expect(issue.labelIds).toEqual(["bug"]);
		// The identifier resolves too.
		await expect(tracker.fetchIssue("web-7")).resolves.toBeTruthy();
		const state = await (
			(await tracker.fetchIssue("acme/web#7")) as unknown as {
				state: Promise<{ type: string }>;
			}
		).state;
		expect(state.type).toBe("started");
	});
});

describe("GitHub issue ids", () => {
	it("maps an issue to a lowercase id and a branch-safe identifier", () => {
		expect(githubIssueId("TeamNovu/SayFlowers", 12)).toBe(
			"teamnovu/sayflowers#12",
		);
		expect(parseGitHubIssueId("teamnovu/sayflowers#12")).toEqual({
			repo: "teamnovu/sayflowers",
			number: 12,
		});
		expect(githubIssueIdentifier("teamnovu/sayflowers", 12)).toBe(
			"sayflowers-12",
		);
		expect(githubIssueIdentifier("Acme/My.Repo_X", 3)).toBe("my-repo-x-3");
	});
});
