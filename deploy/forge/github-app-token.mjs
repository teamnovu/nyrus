#!/usr/bin/env node
/**
 * Prints an installation token of nyrus's GitHub App, for git's credential
 * helper (see "Sandbox" in deploy/forge/README.md): nyrus itself fetches with
 * it, agent sessions push with the token they get as GH_TOKEN.
 *
 * Needs GITHUB_APP_ID and GITHUB_APP_INSTALLATION_ID (from the environment,
 * or the site's .env next to this repository) and the App's private key in
 * <CYRUS_HOME or ~/.cyrus>/github-app.pem. Run from the built repository.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function fromEnvFile(key) {
	const file = process.env.CYRUS_ENV_FILE || join(root, ".env");
	if (!existsSync(file)) return undefined;
	for (const line of readFileSync(file, "utf8").split("\n")) {
		const match = line.match(new RegExp(`^${key}=(.*)$`));
		if (match) return match[1].trim().replace(/^["']|["']$/g, "");
	}
	return undefined;
}

const appId = process.env.GITHUB_APP_ID || fromEnvFile("GITHUB_APP_ID");
const installationId =
	process.env.GITHUB_APP_INSTALLATION_ID ||
	fromEnvFile("GITHUB_APP_INSTALLATION_ID");
if (!appId || !installationId) {
	console.error("GITHUB_APP_ID / GITHUB_APP_INSTALLATION_ID are not set");
	process.exit(1);
}

const { GitHubAppTokenProvider } = await import(
	pathToFileURL(
		join(root, "packages/github-event-transport/dist/index.js"),
	).href
);
const provider = new GitHubAppTokenProvider({
	appId,
	installationId,
	privateKeyPath: join(
		process.env.CYRUS_HOME || join(homedir(), ".cyrus"),
		"github-app.pem",
	),
});
process.stdout.write(`${await provider.getToken()}\n`);
