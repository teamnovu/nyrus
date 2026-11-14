import { describe, expect, it } from "vitest";
import { JiraIssueTrackerService } from "../src/JiraIssueTrackerService.js";
import { AGENT_SIGNATURE } from "../src/JiraText.js";
import { fakeJira, jiraIssue } from "./fakeJira.js";

function setup(routes: Record<string, unknown> = {}) {
	const fake = fakeJira({
		"GET /issue/10001": jiraIssue(),
		"POST /issue/10001/comment": { id: "note-1", created: "", updated: "" },
		"PUT /issue/10001/comment/note-1": {
			id: "note-1",
			created: "",
			updated: "",
		},
		"DELETE /issue/10001/comment/note-1": undefined,
		...routes,
	});
	const tracker = new JiraIssueTrackerService(fake.api, "jira-novu", {
		triggerLabel: "nyrus",
		triggerOnAssign: true,
		progressMinUpdateMs: 0,
	});
	return { tracker, ...fake };
}

const session = "jira-10001";

describe("JiraIssueTrackerService", () => {
	it("maps a Jira issue onto Cyrus's issue shape", async () => {
		const { tracker } = setup();
		const issue = await tracker.fetchIssue("10001");
		expect(issue).toMatchObject({
			id: "10001",
			identifier: "ZOO-12",
			title: "Mobile menu broken",
			description: "## Steps\n- open the **shop**\n- tap `menu`",
			branchName: "zoo-12-mobile-menu-broken",
			priority: 2,
		});
		expect(await issue.team).toMatchObject({ key: "ZOO", name: "Zoo Test" });
		expect(await issue.state).toMatchObject({
			name: "To Do",
			type: "unstarted",
		});
	});

	it("keeps one progress comment for thoughts and actions, and replaces it with the answer", async () => {
		const { tracker, calls } = setup();
		await tracker.createAgentActivity({
			agentSessionId: session,
			content: { type: "thought", body: "Looking at Header.vue" },
		} as never);
		await tracker.createAgentActivity({
			agentSessionId: session,
			content: { type: "action", action: "Bash", parameter: "pnpm test" },
		} as never);
		await tracker.createAgentActivity({
			agentSessionId: session,
			content: { type: "response", body: "Fixed in **PR #20**." },
		} as never);

		const posts = calls.filter((c) => c.method === "POST");
		expect(posts).toHaveLength(2);
		const note = (posts[0]!.body as { body: string }).body;
		expect(note).toContain(AGENT_SIGNATURE);
		expect(note).toContain("Working on it.");
		expect(note).toContain("Looking at Header.vue");

		const edit = calls.find((c) => c.method === "PUT");
		expect((edit!.body as { body: string }).body).toContain(
			"{{Bash: pnpm test}}",
		);
		expect(edit!.url).toContain("notifyUsers=false");

		expect(calls.some((c) => c.method === "DELETE")).toBe(true);
		expect((posts[1]!.body as { body: string }).body).toBe(
			`${AGENT_SIGNATURE}\nFixed in *PR #20*.`,
		);
		// Cyrus's own comments are recognised when their webhooks come back.
		expect(tracker.isOwnComment("note-1")).toBe(true);
	});

	it("lists the options of a question", async () => {
		const { tracker, calls } = setup();
		await tracker.createAgentActivity({
			agentSessionId: session,
			content: {
				type: "elicitation",
				body: "Which repository should I work in for this issue?",
			},
			signal: "select",
			signalMetadata: {
				options: [{ value: "https://github.com/teamnovu/zoo-zurich" }],
			},
		} as never);
		// A numbered list in wiki markup; a reply "1" means the first option.
		expect((calls[0]!.body as { body: string }).body).toBe(
			`${AGENT_SIGNATURE}\nWhich repository should I work in for this issue?\n\n# {{https://github.com/teamnovu/zoo-zurich}}\n\nReply with the number or the name.`,
		);
		expect(tracker.sessions.store.resolveAnswer(session, "1")).toBe(
			"https://github.com/teamnovu/zoo-zurich",
		);
	});

	it("moves an issue to review and done for its GitHub pull request", async () => {
		const routes = {
			"GET /issue/10001/transitions": {
				transitions: [
					{
						id: "11",
						name: "Start",
						to: {
							id: "3",
							name: "In Progress",
							statusCategory: { key: "indeterminate" },
						},
					},
					{
						id: "21",
						name: "Review",
						to: {
							id: "5",
							name: "In Review",
							statusCategory: { key: "indeterminate" },
						},
					},
					{
						id: "31",
						name: "Finish",
						to: { id: "4", name: "Done", statusCategory: { key: "done" } },
					},
				],
			},
			"POST /issue/10001/transitions": undefined,
		};
		const posted = (
			calls: Array<{ url: string; method: string; body?: unknown }>,
		) =>
			calls
				.filter((c) => c.url.endsWith("/transitions") && c.method === "POST")
				.map((c) => c.body);

		const { tracker, calls } = setup(routes);
		await tracker.moveToStage("10001", "review");
		await tracker.moveToStage("10001", "done");
		expect(posted(calls)).toEqual([
			{ transition: { id: "21" } },
			{ transition: { id: "31" } },
		]);

		// Named statuses win; an empty name turns the move off.
		const named = setup(routes);
		Object.assign(named.tracker.options, {
			reviewStatus: "in progress",
			doneStatus: "",
		});
		await named.tracker.moveToStage("10001", "review");
		await named.tracker.moveToStage("10001", "done");
		expect(posted(named.calls)).toEqual([{ transition: { id: "11" } }]);
	});

	it("moves an issue to a state through the workflow transition that leads there", async () => {
		const { tracker, calls } = setup({
			"GET /issue/10001/transitions": {
				transitions: [
					{ id: "11", name: "Start", to: { id: "3", name: "In Progress" } },
					{ id: "31", name: "Finish", to: { id: "4", name: "Done" } },
				],
			},
			"POST /issue/10001/transitions": undefined,
		});
		await tracker.updateIssue("10001", { stateId: "3" });
		expect(
			calls.find((c) => c.url.endsWith("/transitions") && c.method === "POST")
				?.body,
		).toEqual({
			transition: { id: "11" },
		});
	});

	it("takes a transition to a status of the same category when the issue's workflow lacks the one asked for", async () => {
		const { tracker, calls } = setup({
			// Tasks go to "In Progress"; this issue is a Bug, whose workflow has "Fixing".
			"GET /project/100/statuses": [
				{
					id: "t1",
					name: "Task",
					statuses: [
						{
							id: "3",
							name: "In Progress",
							statusCategory: { key: "indeterminate" },
						},
					],
				},
			],
			"GET /issue/10001/transitions": {
				transitions: [
					{
						id: "21",
						name: "Start fixing",
						to: {
							id: "7",
							name: "Fixing",
							statusCategory: { key: "indeterminate" },
						},
					},
				],
			},
			"POST /issue/10001/transitions": undefined,
		});
		await tracker.fetchWorkflowStates("100");
		await tracker.updateIssue("10001", { stateId: "3" });
		expect(
			calls.find((c) => c.url.endsWith("/transitions") && c.method === "POST")
				?.body,
		).toEqual({ transition: { id: "21" } });
	});

	it("maps a project's statuses onto state types, once each", async () => {
		const status = (id: string, name: string, key: string) => ({
			id,
			name,
			statusCategory: { key },
		});
		const { tracker } = setup({
			"GET /project/100/statuses": [
				{
					id: "t1",
					name: "Task",
					statuses: [status("4", "Done", "done"), status("1", "To Do", "new")],
				},
				{
					id: "t2",
					name: "Bug",
					statuses: [
						status("3", "In Progress", "indeterminate"),
						status("1", "To Do", "new"),
					],
				},
			],
		});
		const { nodes } = await tracker.fetchWorkflowStates("100");
		expect(nodes.map((s) => [s.name, s.type])).toEqual([
			["To Do", "unstarted"],
			["In Progress", "started"],
			["Done", "completed"],
		]);
	});
});
