import { SlackMessageService } from "cyrus-slack-event-transport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";

/** nyrus: "@nyrus triage NOV-1" runs the integration's command, not a chat session. */
describe("EdgeWorker Slack chat commands", () => {
	afterEach(() => vi.restoreAllMocks());

	function setup(allowed = true) {
		const run = vi.fn(async () => "triaged!");
		const self = {
			trackerIntegrations: [
				{ workspaceKey: "other" },
				{
					workspaceKey: "servicedesk-triage",
					chatCommand: (text: string) =>
						text.startsWith("triage")
							? { name: "triage NOV-1", run }
							: undefined,
				},
			],
			logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
		};
		const adapter = {
			checkAccess: vi.fn(() => ({ allowed })),
			acknowledgeReceipt: vi.fn(async () => {}),
			acknowledgeProcessed: vi.fn(async () => {}),
		};
		const post = vi
			.spyOn(SlackMessageService.prototype, "postMessage")
			.mockResolvedValue(undefined);
		const handle = (text: string, eventType = "app_mention") =>
			(
				EdgeWorker.prototype as unknown as {
					runSlackChatCommand: (event: unknown, adapter: unknown) => boolean;
				}
			).runSlackChatCommand.call(
				self,
				{
					eventType,
					eventId: "e1",
					teamId: "T1",
					slackBotToken: "xoxb-test",
					payload: { text, user: "U1", channel: "C1", ts: "1.1" },
				},
				adapter,
			);
		return { run, adapter, post, handle };
	}

	it("runs a recognized command and replies in the thread", async () => {
		const { run, adapter, post, handle } = setup();
		expect(handle("<@UBOT> triage NOV-1")).toBe(true);
		await vi.waitFor(() =>
			expect(adapter.acknowledgeProcessed).toHaveBeenCalled(),
		);
		expect(run).toHaveBeenCalledOnce();
		expect(adapter.acknowledgeReceipt).toHaveBeenCalled();
		expect(post).toHaveBeenCalledWith({
			token: "xoxb-test",
			channel: "C1",
			text: "triaged!",
			thread_ts: "1.1",
		});
	});

	it("leaves other messages, thread replies and blocked users to the chat session", () => {
		expect(setup().handle("<@UBOT> what is up?")).toBe(false);
		expect(setup().handle("triage NOV-1", "message")).toBe(false);
		const blocked = setup(false);
		expect(blocked.handle("<@UBOT> triage NOV-1")).toBe(false);
		expect(blocked.run).not.toHaveBeenCalled();
	});
});
