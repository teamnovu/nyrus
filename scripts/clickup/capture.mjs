#!/usr/bin/env node
// Receive ClickUp webhooks and save each delivery, to learn their real shape
// and to build test fixtures. Expose the port publicly (ngrok, Cloudflare
// Tunnel) and register https://<host>/clickup-webhook with webhook.mjs.
//
//   node scripts/clickup/capture.mjs [--port 3457]
//
// Env: CLICKUP_WEBHOOK_SECRET (from webhook.mjs create). Without it every
// delivery is accepted and marked unverified.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { OUT_DIR, parseArgs, save } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? 3457);
const secret = process.env.CLICKUP_WEBHOOK_SECRET?.trim();
let count = 0;

function verify(rawBody, signature) {
	if (!secret) return "unverified";
	if (typeof signature !== "string") return "missing";
	const expected = Buffer.from(
		createHmac("sha256", secret).update(rawBody).digest("hex"),
	);
	const actual = Buffer.from(signature.trim().toLowerCase());
	return expected.length === actual.length && timingSafeEqual(expected, actual)
		? "valid"
		: "invalid";
}

/** One line per history item: what changed, by whom. */
function summarize(body) {
	const items = (body.history_items ?? []).map((item) => {
		const who = item.user?.username ?? item.user?.id ?? "?";
		const change =
			item.field === "assignee_add" || item.field === "assignee_rem"
				? `${item.field} ${item.after?.username ?? item.after?.id ?? ""}`
				: item.field === "comment"
					? `comment ${item.comment?.id ?? ""}: ${JSON.stringify(item.comment?.text_content ?? "").slice(0, 80)}`
					: `${item.field}: ${JSON.stringify(item.before)} → ${JSON.stringify(item.after)}`;
		return `    item ${item.id} by ${who}: ${change}`;
	});
	return [`${body.event} task ${body.task_id}`, ...items].join("\n");
}

createServer((request, response) => {
	if (request.method !== "POST") {
		response.writeHead(200).end("clickup capture is running\n");
		return;
	}
	const chunks = [];
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", () => {
		const rawBody = Buffer.concat(chunks).toString("utf8");
		const signature = verify(rawBody, request.headers["x-signature"]);
		// ClickUp suspends a webhook that gets 401s: reject with 400.
		if (signature === "invalid" || signature === "missing") {
			console.warn(`Rejected a delivery: signature ${signature}`);
			response.writeHead(400).end();
			return;
		}
		response.writeHead(200).end();

		let body;
		try {
			body = JSON.parse(rawBody);
		} catch {
			body = { unparsed: rawBody };
		}
		const name = `${String(++count).padStart(3, "0")}-${new Date().toISOString().replace(/[:.]/g, "-")}-${body.event ?? "unknown"}`;
		const file = save("webhooks", name, {
			receivedAt: new Date().toISOString(),
			signature,
			headers: request.headers,
			body,
		});
		console.log(`${summarize(body)}\n    → ${file}`);
	});
}).listen(port, () => {
	console.log(
		`Listening on http://localhost:${port}, saving to ${OUT_DIR}/webhooks (signature check ${secret ? "on" : "OFF"})`,
	);
});
