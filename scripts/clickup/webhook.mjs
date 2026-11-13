#!/usr/bin/env node
// Manage the ClickUp webhooks of a workspace. ClickUp has no UI for API
// webhooks, so they are created, listed and deleted through the API.
//
//   node scripts/clickup/webhook.mjs list
//   node scripts/clickup/webhook.mjs create --endpoint https://<host>/clickup-webhook [--space <id> | --folder <id> | --list <id> | --task <id>] [--events a,b,c]
//   node scripts/clickup/webhook.mjs reactivate <webhook id>
//   node scripts/clickup/webhook.mjs delete <webhook id>
//
// Env (or <cyrus-home>/.env): CLICKUP_API_TOKEN, CLICKUP_TEAM_ID (the
// workspace id). create saves the webhook's secret to <cyrus-home>/.env.
import { clickup, ENV_FILE, parseArgs, requireEnv, saveEnv } from "./lib.mjs";

/** The events nyrus needs: tags and assignment (triggers), comments and status changes. */
const DEFAULT_EVENTS = [
	"taskTagUpdated",
	"taskAssigneeUpdated",
	"taskCommentPosted",
	"taskCommentUpdated",
	"taskStatusUpdated",
	"taskUpdated",
	"taskDeleted",
];

const args = parseArgs(process.argv.slice(2));
const [command, id] = args._;
const teamId = requireEnv("CLICKUP_TEAM_ID");

function fail(result) {
	console.error(`HTTP ${result.status}`, JSON.stringify(result.body, null, 2));
	process.exit(1);
}

switch (command) {
	case "list": {
		const result = await clickup("GET", `/team/${teamId}/webhook`);
		if (result.status !== 200) fail(result);
		for (const hook of result.body.webhooks ?? []) {
			const scope =
				["space_id", "folder_id", "list_id", "task_id"]
					.filter((key) => hook[key])
					.map((key) => `${key}=${hook[key]}`)
					.join(" ") || "whole workspace";
			console.log(
				`${hook.id}  ${hook.health?.status ?? "?"} (fails: ${hook.health?.fail_count ?? 0})  ${hook.endpoint}  [${scope}]  ${hook.events.join(",")}`,
			);
		}
		break;
	}

	case "create": {
		if (typeof args.endpoint !== "string") {
			console.error("--endpoint is required");
			process.exit(1);
		}
		const body = {
			endpoint: args.endpoint,
			events:
				typeof args.events === "string"
					? args.events.split(",")
					: DEFAULT_EVENTS,
			...(args.space && { space_id: Number(args.space) }),
			...(args.folder && { folder_id: Number(args.folder) }),
			...(args.list && { list_id: Number(args.list) }),
			...(args.task && { task_id: String(args.task) }),
		};
		const result = await clickup("POST", `/team/${teamId}/webhook`, body);
		if (result.status !== 200) fail(result);
		console.log(`Created webhook ${result.body.id}`);
		// ClickUp returns the signing secret only now; save it, don't print it.
		saveEnv(
			"CLICKUP_WEBHOOK_SECRET",
			result.body.webhook?.secret ?? result.body.secret,
		);
		console.log(`Saved CLICKUP_WEBHOOK_SECRET to ${ENV_FILE}`);
		break;
	}

	case "reactivate": {
		// ClickUp suspends a webhook after repeated failed deliveries.
		const result = await clickup("PUT", `/webhook/${id}`, {
			status: "active",
		});
		if (result.status !== 200) fail(result);
		console.log(`Webhook ${id} is active again`);
		break;
	}

	case "delete": {
		const result = await clickup("DELETE", `/webhook/${id}`);
		if (result.status !== 200) fail(result);
		console.log(`Deleted webhook ${id}`);
		break;
	}

	default:
		console.error(
			"Usage: webhook.mjs list | create --endpoint <url> [--space|--folder|--list|--task <id>] [--events a,b] | reactivate <id> | delete <id>",
		);
		process.exit(1);
}
