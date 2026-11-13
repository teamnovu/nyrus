// Shared helpers for the ClickUp spike scripts. No dependencies; Node 18+.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const API = "https://api.clickup.com/api/v2";

/** Where spike output goes. Outside the repository: it contains real ticket data. */
export const OUT_DIR =
	process.env.CLICKUP_SPIKE_OUT ?? join(homedir(), ".cyrus", "clickup-spike");

export function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		console.error(`Set ${name} (see docs/nyrus/clickup-spike.md)`);
		process.exit(1);
	}
	return value;
}

/** Rate-limit headers of the most recent response. */
export const lastRateLimit = {};

/**
 * Call the ClickUp API as the bot. Personal tokens (pk_...) go in the
 * Authorization header as is, without "Bearer". Returns { status, body }
 * and never throws on HTTP errors, so a probe can report them.
 */
export async function clickup(method, path, body) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			Authorization: requireEnv("CLICKUP_API_TOKEN"),
			...(body !== undefined && { "Content-Type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	for (const header of [
		"x-ratelimit-limit",
		"x-ratelimit-remaining",
		"x-ratelimit-reset",
	]) {
		const value = response.headers.get(header);
		if (value !== null) lastRateLimit[header] = value;
	}
	const text = await response.text();
	let parsed = text;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		// not JSON: keep the text
	}
	return { status: response.status, body: parsed };
}

/** Save a JSON result to OUT_DIR/<group>/<name>.json and return the path. */
export function save(group, name, data) {
	const dir = join(OUT_DIR, group);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${name}.json`);
	writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
	return file;
}

export function parseArgs(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("--")) {
				args[key] = true;
			} else {
				args[key] = next;
				i++;
			}
		} else {
			args._.push(arg);
		}
	}
	return args;
}
