// Shared helpers for the ClickUp spike scripts. No dependencies; Node 18+.
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const API = "https://api.clickup.com/api/v2";

/**
 * nyrus's env file, `<cyrus-home>/.env` (CYRUS_HOME, default ~/.cyrus). The
 * scripts read CLICKUP_* settings from it when they are not in the
 * environment, so tokens and secrets never have to be pasted into a shell.
 */
export const ENV_FILE = join(
	process.env.CYRUS_HOME ?? join(homedir(), ".cyrus"),
	".env",
);

function loadEnvFile() {
	if (!existsSync(ENV_FILE)) return;
	for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
		const match = /^\s*(CLICKUP_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
		if (!match) continue;
		const [, key, raw] = match;
		// Quoted values are taken as is; unquoted ones lose a trailing # comment.
		const quoted = /^(['"])(.*)\1$/.exec(raw);
		const value = quoted ? quoted[2] : raw.replace(/\s+#.*$/, "");
		if (!process.env[key]?.trim()) process.env[key] = value;
	}
}
loadEnvFile();

/**
 * Where spike output goes. Outside the repository: it contains real ticket
 * data. Defined after the env file is read, so CLICKUP_SPIKE_OUT there counts.
 */
export const OUT_DIR =
	process.env.CLICKUP_SPIKE_OUT ?? join(homedir(), ".cyrus", "clickup-spike");

/** Set KEY=value in the env file (replacing an earlier value) and in this process. */
export function saveEnv(key, value) {
	mkdirSync(join(ENV_FILE, ".."), { recursive: true });
	const lines = existsSync(ENV_FILE)
		? readFileSync(ENV_FILE, "utf8")
				.split("\n")
				.filter((line) => !new RegExp(`^\\s*${key}\\s*=`).test(line))
		: [];
	while (lines.length && lines[lines.length - 1] === "") lines.pop();
	writeFileSync(ENV_FILE, `${[...lines, `${key}=${value}`].join("\n")}\n`);
	chmodSync(ENV_FILE, 0o600); // it holds secrets
	process.env[key] = value;
}

export function requireEnv(name) {
	const value = process.env[name]?.trim();
	if (!value) {
		console.error(
			`Set ${name} in ${ENV_FILE} or the environment (see docs/nyrus/clickup-spike.md)`,
		);
		process.exit(1);
	}
	return value;
}

/** Rate-limit headers of the most recent response. */
export const lastRateLimit = {};

/**
 * Call the ClickUp API with the configured token. Personal tokens (pk_...) go in the
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

/**
 * Save a JSON result to OUT_DIR/<group>/<name>.json and return the path. The
 * name may come from a webhook, so anything but letters, digits, `-` and `_`
 * is replaced: it can't leave the directory.
 */
export function save(group, name, data) {
	const dir = join(OUT_DIR, group);
	// Real ticket data: readable only by the owner.
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	const file = join(
		dir,
		`${String(name).replace(/[^A-Za-z0-9_-]/g, "_")}.json`,
	);
	writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
	chmodSync(file, 0o600);
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
