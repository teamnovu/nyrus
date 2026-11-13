import { join } from "node:path";
import type {
	TrackerIntegration,
	TrackerIntegrationFactory,
} from "cyrus-comment-sessions";
import { ClickUpEventTransport } from "./ClickUpEventTransport.js";

/**
 * ClickUp in nyrus, configured by environment variables:
 *
 * - `CLICKUP_WEBHOOK_SECRET` (required): the secret of the ClickUp webhook
 *   that delivers to `<CYRUS_BASE_URL>/clickup-webhook`. Without it ClickUp
 *   stays off.
 * - `CLICKUP_TEAM_ID`: the ClickUp workspace id; the workspace key is
 *   `clickup-<id>`.
 * - `CLICKUP_WEBHOOK_RECORD=1`: save every delivery to
 *   `<cyrus-home>/clickup-webhooks/`.
 *
 * Receive-only for now: deliveries are verified, logged and optionally
 * recorded, but start no sessions yet.
 */
export const createClickUpIntegration: TrackerIntegrationFactory = ({
	env,
	cyrusHome,
	logger,
}): TrackerIntegration | null => {
	const webhookSecret = env.CLICKUP_WEBHOOK_SECRET?.trim();
	if (!webhookSecret) {
		return null;
	}
	const teamId = env.CLICKUP_TEAM_ID?.trim();
	const recordDir =
		env.CLICKUP_WEBHOOK_RECORD?.trim() === "1"
			? join(cyrusHome, "clickup-webhooks")
			: undefined;
	let transport: ClickUpEventTransport | undefined;

	return {
		workspaceKey: teamId ? `clickup-${teamId}` : "clickup",
		register(host) {
			transport = new ClickUpEventTransport(
				{ fastifyServer: host.fastify, webhookSecret, recordDir },
				logger,
			);
			transport.on("error", (error) =>
				logger.error("ClickUp transport error", error),
			);
			transport.register();
		},
		dispose() {
			transport?.removeAllListeners();
		},
	};
};
