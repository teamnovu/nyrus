#!/usr/bin/env node
//
// nyrus-screenshot: one PNG of one web page, for before/after comparisons in
// agent sessions (skill `before-after-screenshots`).
//
// Installed to /opt/nyrus-screenshots by the Forge recipe in
// deploy/forge/README.md ("Screenshots"), next to playwright-core and a
// headless Chromium, because sandboxed sessions can't read anything under ~.
//
// Each Bash call of a sandboxed session may get its own network namespace, so
// a dev server started in one call is gone in the next. That's why this tool
// can start the server itself (--serve or --server) and stops it when done.
//
//   nyrus-screenshot --serve <dir> [--path /page.html] --out <file.png>
//   nyrus-screenshot --server "<command>" --url <url> --out <file.png>
//   nyrus-screenshot --url <url> --out <file.png>
//
// Options: --width 1440 --height 900 --full-page --selector <css>
//          --wait <ms after load, 1000> --timeout <seconds, 90>
//
// Prints one JSON line ({ out, url, status, title, viewport }) on success.

import { spawn } from "node:child_process";
import {
	createReadStream,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `Usage:
  nyrus-screenshot --serve <dir> [--path /page.html] --out <file.png>
  nyrus-screenshot --server "<command>" --url <url> --out <file.png>
  nyrus-screenshot --url <url> --out <file.png>
Options:
  --width <px>        viewport width (default 1440)
  --height <px>       viewport height (default 900)
  --full-page         capture the whole page, not just the viewport
  --selector <css>    capture only the first element matching this selector
  --wait <ms>         extra wait after the page loaded (default 1000)
  --timeout <s>       time limit for server start and page load (default 90)`;

function fail(message) {
	process.stderr.write(`nyrus-screenshot: ${message}\n`);
	process.exit(1);
}

let args;
try {
	({ values: args } = parseArgs({
		options: {
			url: { type: "string" },
			serve: { type: "string" },
			path: { type: "string", default: "/" },
			server: { type: "string" },
			out: { type: "string" },
			width: { type: "string", default: "1440" },
			height: { type: "string", default: "900" },
			"full-page": { type: "boolean", default: false },
			selector: { type: "string" },
			wait: { type: "string", default: "1000" },
			timeout: { type: "string", default: "90" },
			help: { type: "boolean", default: false },
		},
	}));
} catch (error) {
	fail(`${error.message}\n${USAGE}`);
}
if (args.help) {
	process.stdout.write(`${USAGE}\n`);
	process.exit(0);
}
if (!args.out) fail(`--out is required\n${USAGE}`);
if (!/\.(png|jpe?g)$/i.test(args.out)) fail("--out must end in .png or .jpg");
if (!args.url && !args.serve) fail(`--url or --serve is required\n${USAGE}`);
if (args.url && args.serve) fail("use either --url or --serve, not both");
if (args.server && !args.url)
	fail("--server needs --url (the page the server will answer on)");

const width = Number.parseInt(args.width, 10);
const height = Number.parseInt(args.height, 10);
const waitMs = Number.parseInt(args.wait, 10);
const timeoutMs = Number.parseInt(args.timeout, 10) * 1000;
for (const [name, value] of Object.entries({
	width,
	height,
	wait: waitMs,
	timeout: timeoutMs,
})) {
	if (!Number.isFinite(value) || value < 0) fail(`--${name} must be a number`);
}

const out = resolve(args.out);
mkdirSync(dirname(out), { recursive: true });

// Scratch directory for the browser profile, HOME and caches. The sandbox
// denies ~, and /tmp may not be writable either; fall back to the output folder.
let scratch;
for (const base of [tmpdir(), dirname(out)]) {
	try {
		scratch = mkdtempSync(join(base, ".nyrus-shot-"));
		break;
	} catch {}
}
if (!scratch)
	fail("no writable scratch directory (tried $TMPDIR and the --out folder)");

const cleanups = [() => rmSync(scratch, { recursive: true, force: true })];
async function cleanup() {
	for (const fn of cleanups.reverse()) {
		try {
			await fn();
		} catch {}
	}
}
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, async () => {
		await cleanup();
		process.exit(1);
	});
}

const CONTENT_TYPES = {
	".html": "text/html; charset=utf-8",
	".htm": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".txt": "text/plain; charset=utf-8",
	".xml": "application/xml",
	".map": "application/json",
};

// Minimal static file server for --serve, bound to 127.0.0.1 on a free port.
async function serveStatic(dir) {
	const root = resolve(dir);
	try {
		if (!statSync(root).isDirectory())
			fail(`--serve ${dir} is not a directory`);
	} catch {
		fail(`--serve ${dir} does not exist`);
	}
	const server = createServer((req, res) => {
		let pathname;
		try {
			pathname = decodeURIComponent(
				new URL(req.url, "http://localhost").pathname,
			);
		} catch {
			res.writeHead(400).end();
			return;
		}
		let file = resolve(root, `.${pathname}`);
		if (file !== root && !file.startsWith(root + sep)) {
			res.writeHead(403).end();
			return;
		}
		try {
			if (statSync(file).isDirectory()) file = join(file, "index.html");
			statSync(file);
		} catch {
			res.writeHead(404, { "content-type": "text/plain" }).end("not found");
			return;
		}
		res.writeHead(200, {
			"content-type":
				CONTENT_TYPES[extname(file).toLowerCase()] ??
				"application/octet-stream",
			"cache-control": "no-store",
		});
		createReadStream(file).pipe(res);
	});
	await new Promise((ok, ko) =>
		server.once("error", ko).listen(0, "127.0.0.1", ok),
	);
	cleanups.push(() => new Promise((ok) => server.close(ok)));
	const pagePath = args.path.startsWith("/") ? args.path : `/${args.path}`;
	return `http://127.0.0.1:${server.address().port}${pagePath}`;
}

// Starts `--server` in its own process group and waits until --url answers.
async function startServer(command, url) {
	const child = spawn("sh", ["-c", command], {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});
	const tail = [];
	const keep = (chunk) => {
		tail.push(...chunk.toString().split("\n"));
		tail.splice(0, Math.max(0, tail.length - 30));
	};
	child.stdout.on("data", keep);
	child.stderr.on("data", keep);
	let exited = null;
	child.on("exit", (code, signal) => {
		exited = signal ?? code;
	});
	cleanups.push(async () => {
		if (exited !== null) return;
		try {
			process.kill(-child.pid, "SIGTERM");
		} catch {}
		for (let i = 0; i < 30 && exited === null; i++) await sleep(100);
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {}
	});

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (exited !== null) {
			throw new Error(
				`--server exited (${exited}) before ${url} answered:\n${tail.join("\n")}`,
			);
		}
		try {
			await fetch(url, {
				redirect: "manual",
				signal: AbortSignal.timeout(5000),
			});
			return;
		} catch {}
		await sleep(500);
	}
	throw new Error(
		`${url} did not answer within ${args.timeout}s:\n${tail.join("\n")}`,
	);
}

// The sandbox only lets traffic out through nyrus's egress proxy (HTTP(S)_PROXY).
// Chromium doesn't read those variables by itself; local addresses stay direct.
function proxyFromEnv() {
	const server =
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		process.env.HTTP_PROXY ||
		process.env.http_proxy;
	if (!server) return undefined;
	// Playwright sends loopback through the proxy too unless this is set.
	process.env.PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK = "1";
	return { server, bypass: "localhost,127.0.0.1,[::1]" };
}

function sleep(ms) {
	return new Promise((ok) => setTimeout(ok, ms));
}

async function main() {
	let url = args.url;
	if (args.serve) url = await serveStatic(args.serve);
	if (args.server) await startServer(args.server, url);

	process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(HERE, "browsers");
	const { chromium } = await import("playwright-core");

	const browser = await chromium.launch({
		args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
		env: {
			...process.env,
			HOME: scratch,
			XDG_CONFIG_HOME: join(scratch, "config"),
			XDG_CACHE_HOME: join(scratch, "cache"),
		},
		proxy: proxyFromEnv(),
		timeout: timeoutMs,
	});
	cleanups.push(() => browser.close());

	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 1,
		ignoreHTTPSErrors: true,
		reducedMotion: "reduce",
	});
	const page = await context.newPage();
	const response = await page.goto(url, {
		waitUntil: "load",
		timeout: timeoutMs,
	});
	await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
	if (waitMs > 0) await page.waitForTimeout(waitMs);

	const options = { path: out, animations: "disabled", timeout: timeoutMs };
	if (args.selector) {
		await page.locator(args.selector).first().screenshot(options);
	} else {
		await page.screenshot({ ...options, fullPage: args["full-page"] });
	}

	process.stdout.write(
		`${JSON.stringify({
			out,
			url: page.url(),
			status: response?.status() ?? null,
			title: await page.title(),
			viewport: `${width}x${height}`,
		})}\n`,
	);
}

try {
	await main();
	await cleanup();
	process.exit(0);
} catch (error) {
	await cleanup();
	fail(error instanceof Error ? error.message : String(error));
}
