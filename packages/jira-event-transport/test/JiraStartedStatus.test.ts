import type { ILogger } from "cyrus-core";
import { describe, expect, it, vi } from "vitest";
import { JiraIssueTrackerService } from "../src/JiraIssueTrackerService.js";

const logger = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
} as unknown as ILogger;

const statuses = [
	{ id: "1", name: "To Do", statusCategory: { key: "new" } },
	{ id: "2", name: "REVIEW", statusCategory: { key: "indeterminate" } },
	{ id: "3", name: "In Progress", statusCategory: { key: "indeterminate" } },
	{ id: "4", name: "Done", statusCategory: { key: "done" } },
];

async function firstStartedState(startedStatus?: string) {
	const service = new JiraIssueTrackerService(
		{
			listProjectStatuses: vi.fn().mockResolvedValue([{ statuses }]),
		} as never,
		"jira-test",
		{ triggerLabel: "nyrus", triggerOnAssign: false, startedStatus, logger },
	);
	const states = await service.fetchWorkflowStates("SAY");
	return states.nodes
		.filter((s) => s.type === "started")
		.sort((a, b) => a.position - b.position)[0]?.name;
}

describe("JiraIssueTrackerService started status", () => {
	it("starts work in the configured status (JIRA_STARTED_STATUS)", async () => {
		expect(await firstStartedState("in progress")).toBe("In Progress");
	});

	it("keeps Jira's order without one: the first In Progress-category status", async () => {
		expect(await firstStartedState()).toBe("REVIEW");
	});
});
