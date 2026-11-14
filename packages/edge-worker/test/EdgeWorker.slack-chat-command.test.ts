import { SlackMessageService } from "cyrus-slack-event-transport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";

const BOT = "UBOT";

/**
 * nyrus: "@nyrus triage NOV-1" runs the integration's command, not a chat
 * session, whichever of Slack's two deliveries (app_mention or its message
 * twin in a followed thread) the transport emits.
 */
describe("EdgeWorker Slack chat commands", () => {
	afterEach(() => vi.restoreAllMocks());

	function setup(options: { allowed?: boolean; botUserId?: string } = {}) {
		const run = vi.fn(async () => "triaged!");
		const handleEvent = vi.fn(async () => {});
		const proto = EdgeWorker.prototype as unknown as Record<string, unknown>;
		const self: Record<string, unknown> = {
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
			chatSessionHandler: { handleEvent },
			logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
		};
		for (const name of [
			"dispatchSlackEvent",
			"handleSlackChatEvent",
			"slackChatCommandCandidate",
			"routeSlackChatCommand",
			"slackBotUserId",
			"runSlackChatCommand",
		]) {
			self[name] = (proto[name] as (...args: unknown[]) => unknown).bind(self);
		}
		const adapter = {
			checkAccess: vi.fn(() => ({ allowed: options.allowed ?? true })),
			acknowledgeReceipt: vi.fn(async () => {}),
			acknowledgeProcessed: vi.fn(async () => {}),
		};
		const post = vi
			.spyOn(SlackMessageService.prototype, "postMessage")
			.mockResolvedValue(undefined);
		const identity = vi
			.spyOn(SlackMessageService.prototype, "getIdentity")
			.mockResolvedValue({ user_id: options.botUserId ?? BOT, bot_id: "B1" });
		const dispatch = (
			text: string,
			eventType: "app_mention" | "message" = "app_mention",
			mentionsBot?: boolean,
		) =>
			(self.dispatchSlackEvent as (event: unknown, adapter: unknown) => void)(
				{
					eventType,
					eventId: "e1",
					teamId: "T1",
					slackBotToken: "xoxb-test",
					mentionsBot,
					payload: {
						text,
						user: "U1",
						channel: "C1",
						ts: "1.2",
						thread_ts: "1.1",
					},
				},
				adapter,
			);
		return { run, handleEvent, adapter, post, identity, dispatch };
	}

	it("runs a command from an app_mention and replies in the thread", async () => {
		const t = setup();
		t.dispatch(`<@${BOT}> triage NOV-1`);
		await vi.waitFor(() =>
			expect(t.adapter.acknowledgeProcessed).toHaveBeenCalled(),
		);
		expect(t.run).toHaveBeenCalledOnce();
		expect(t.handleEvent).not.toHaveBeenCalled();
		expect(t.post).toHaveBeenCalledWith({
			token: "xoxb-test",
			channel: "C1",
			text: "triaged!",
			thread_ts: "1.1",
		});
	});

	it("runs the command when the mention's message twin arrives first (flagged by the transport)", async () => {
		const t = setup();
		t.dispatch(`<@${BOT}> triage NOV-1`, "message", true);
		await vi.waitFor(() => expect(t.run).toHaveBeenCalledOnce());
		expect(t.handleEvent).not.toHaveBeenCalled();
		expect(t.identity).not.toHaveBeenCalled();
	});

	it("checks an unflagged message twin against the bot's own user id", async () => {
		const t = setup();
		t.dispatch(`<@${BOT}> triage NOV-1`, "message");
		await vi.waitFor(() => expect(t.run).toHaveBeenCalledOnce());
		expect(t.identity).toHaveBeenCalledOnce();

		const other = setup();
		other.dispatch("<@UANNA> triage NOV-1", "message");
		await vi.waitFor(() => expect(other.handleEvent).toHaveBeenCalledOnce());
		expect(other.run).not.toHaveBeenCalled();
	});

	it("sends plain replies and other text to the chat session right away", () => {
		const reply = setup();
		reply.dispatch("triage NOV-1", "message");
		expect(reply.handleEvent).toHaveBeenCalledOnce();
		expect(reply.run).not.toHaveBeenCalled();

		const chat = setup();
		chat.dispatch(`<@${BOT}> what is up?`);
		expect(chat.handleEvent).toHaveBeenCalledOnce();
	});

	it("leaves blocked users to the chat session, which tells them", async () => {
		const t = setup({ allowed: false });
		t.dispatch(`<@${BOT}> triage NOV-1`);
		await vi.waitFor(() => expect(t.handleEvent).toHaveBeenCalledOnce());
		expect(t.run).not.toHaveBeenCalled();
	});
});
