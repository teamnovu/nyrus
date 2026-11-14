import { describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";

/**
 * notifyAgentRunFinished hands a finished run to the tracker integration of
 * the session's workspace (e.g. Jira logs the time) — but only for that
 * tracker's own sessions, not for a GitHub PR session on the same repository.
 */
describe("EdgeWorker.notifyAgentRunFinished", () => {
	function run(session: Record<string, unknown>) {
		const onAgentRunFinished = vi.fn();
		const fakeThis = {
			repositories: new Map([
				["sayflowers", { id: "sayflowers", linearWorkspaceId: "jira-novu" }],
			]),
			trackerIntegrations: [
				{ workspaceKey: "jira-novu", onAgentRunFinished },
			],
			agentSessionManager: { getSession: () => session },
			logger: { warn: vi.fn() },
		};
		const notify = (
			EdgeWorker.prototype as unknown as {
				notifyAgentRunFinished: (
					sessionId: string,
					result: unknown,
					repositoryId: string,
				) => Promise<void>;
			}
		).notifyAgentRunFinished.bind(fakeThis);
		return notify(
			"s-1",
			{ duration_ms: 60_000, is_error: false },
			"sayflowers",
		).then(() => onAgentRunFinished);
	}

	it("reports runs of the tracker's own (Linear-shaped) sessions", async () => {
		const onAgentRunFinished = await run({
			issueContext: {
				trackerId: "linear",
				issueId: "99179",
				issueIdentifier: "SAY-687",
			},
		});

		expect(onAgentRunFinished).toHaveBeenCalledWith(
			expect.objectContaining({ issueId: "99179", durationMs: 60_000 }),
		);
	});

	it("skips GitHub sessions on the same repository", async () => {
		const onAgentRunFinished = await run({
			issueContext: {
				trackerId: "github",
				issueId: "github:teamnovu/sayflowers#28",
				issueIdentifier: "sayflowers#28",
			},
		});

		expect(onAgentRunFinished).not.toHaveBeenCalled();
	});
});
