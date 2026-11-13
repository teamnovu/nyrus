import { join } from "node:path";
import type {
	DispatchTiming,
	TrackerIntegration,
	TrackerIntegrationFactory,
} from "cyrus-comment-sessions";
import { ClickUpApiClient } from "./ClickUpApiClient.js";
import { ClickUpEventHandler } from "./ClickUpEventHandler.js";
import { ClickUpEventTransport } from "./ClickUpEventTransport.js";
import { ClickUpIssueTrackerService } from "./ClickUpIssueTrackerService.js";
import { AGENT_COMMAND } from "./ClickUpText.js";

/**
 * ClickUp in nyrus, configured by environment variables:
 *
 * - `CLICKUP_WEBHOOK_SECRET` (required): the secret of the ClickUp webhook
 *   that delivers to `<CYRUS_BASE_URL>/clickup-webhook`. Without it ClickUp
 *   stays off.
 * - `CLICKUP_API_TOKEN`: personal token of the person nyrus acts as. Without
 *   it deliveries are only verified, logged and optionally recorded.
 * - `CLICKUP_TEAM_ID`: the ClickUp workspace id; the workspace key (the
 *   `linearWorkspaceId` of repositories that take ClickUp work) is
 *   `clickup-<id>`.
 * - `CLICKUP_SPACE_IDS`: comma-separated Spaces nyrus works in. The token
 *   sees every Space, so set it; without it every Space the webhook covers.
 * - `CLICKUP_TRIGGER_TAG` (default `nyrus`, empty to disable): the tag that
 *   hands a task to nyrus.
 * - `CLICKUP_TRIGGER_ON_ASSIGN=true`: assigning the token's person also
 *   hands a task over. Off by default, since that person gets real
 *   assignments too.
 * - `CLICKUP_WEBHOOK_RECORD=1`: save every delivery to
 *   `<cyrus-home>/clickup-webhooks/`.
 */
export function createClickUpIntegrationFactory(
	options: {
		dispatchTiming?: Partial<DispatchTiming>;
		fetch?: typeof fetch;
	} = {},
): TrackerIntegrationFactory {
	return ({ env, cyrusHome, logger }): TrackerIntegration | null => {
		const webhookSecret = env.CLICKUP_WEBHOOK_SECRET?.trim();
		if (!webhookSecret) {
			return null;
		}
		const teamId = env.CLICKUP_TEAM_ID?.trim() || undefined;
		const workspaceKey = teamId ? `clickup-${teamId}` : "clickup";
		const recordDir =
			env.CLICKUP_WEBHOOK_RECORD?.trim() === "1"
				? join(cyrusHome, "clickup-webhooks")
				: undefined;
		const apiToken = env.CLICKUP_API_TOKEN?.trim();
		let transport: ClickUpEventTransport | undefined;

		const startTransport = (
			host: Parameters<TrackerIntegration["register"]>[0],
		) => {
			transport = new ClickUpEventTransport(
				{ fastifyServer: host.fastify, webhookSecret, recordDir },
				logger,
			);
			transport.on("error", (error) =>
				logger.error("ClickUp transport error", error),
			);
			transport.register();
			return transport;
		};

		if (!apiToken) {
			// Receive-only: verify, log and record deliveries, start no sessions.
			return {
				workspaceKey,
				register(host) {
					startTransport(host);
					logger.info(
						"ClickUp: CLICKUP_API_TOKEN is not set, so deliveries are only logged; no sessions start",
					);
				},
				dispose() {
					transport?.removeAllListeners();
				},
			};
		}

		const tracker = new ClickUpIssueTrackerService(
			new ClickUpApiClient(
				{ apiToken, teamId },
				{ logger, ...(options.fetch && { fetch: options.fetch }) },
			),
			workspaceKey,
			{
				triggerTag: env.CLICKUP_TRIGGER_TAG?.trim() ?? "nyrus",
				triggerOnAssign:
					env.CLICKUP_TRIGGER_ON_ASSIGN?.trim().toLowerCase() === "true",
				spaceIds: (env.CLICKUP_SPACE_IDS ?? "")
					.split(",")
					.map((id) => id.trim())
					.filter(Boolean),
				dispatchTiming: options.dispatchTiming,
				logger,
			},
		);

		return {
			workspaceKey,
			tracker,
			// Named after the platform, so its tools are mcp__clickup__*.
			mcpServers: () => ({ clickup: tracker.toolsMcpServerConfig() }),
			register(host) {
				const handler = new ClickUpEventHandler(
					tracker,
					tracker.sessions.createCoordinator(host),
					logger,
				);
				startTransport(host).on("webhook", (payload) => {
					void handler.handle(payload);
				});

				const { triggerTag, triggerOnAssign, spaceIds } = tracker.options;
				const triggers = [
					triggerTag && `tag "${triggerTag}"`,
					triggerOnAssign && "assignment",
					`"${AGENT_COMMAND}" comments`,
				].filter(Boolean);
				logger.info(
					`✅ ClickUp registered (key ${workspaceKey}, starts on ${triggers.join(" or ")}, ${spaceIds.length ? `Spaces ${spaceIds.join(", ")}` : "every Space the webhook covers"})`,
				);
				if (spaceIds.length === 0) {
					logger.warn(
						"ClickUp: CLICKUP_SPACE_IDS is not set. The token sees every Space of the workspace; nyrus works on any task the webhook reports.",
					);
				}
				// Check the token now; a wrong one would otherwise only show at the first delivery.
				tracker.agent().then(
					(agent) =>
						logger.info(
							`   ClickUp acts as: ${agent.username ?? agent.id} (${agent.id})`,
						),
					(error) =>
						logger.error(
							"ClickUp API token check failed (CLICKUP_API_TOKEN)",
							error,
						),
				);
			},
			dispose() {
				transport?.removeAllListeners();
				tracker.dispose();
			},
		};
	};
}

/** The ClickUp integration with default timing, for the edge worker's list. */
export const createClickUpIntegration: TrackerIntegrationFactory =
	createClickUpIntegrationFactory();
