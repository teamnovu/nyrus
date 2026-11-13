import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleCyrusEnv } from "../../src/handlers/cyrusEnv.js";
import { handleDashboardEnv } from "../../src/handlers/dashboard.js";

// nyrus on Forge is started with --env-file pointing at the site .env that
// Forge manages; the CLI exports that path as CYRUS_ENV_FILE.
describe("env file location (CYRUS_ENV_FILE)", () => {
	let home: string;
	let site: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "nyrus-home-"));
		site = mkdtempSync(join(tmpdir(), "nyrus-site-"));
	});

	afterEach(() => {
		delete process.env.CYRUS_ENV_FILE;
		rmSync(home, { recursive: true, force: true });
		rmSync(site, { recursive: true, force: true });
	});

	it("writes and reads <cyrusHome>/.env by default", async () => {
		await handleCyrusEnv({ variables: { GITHUB_TOKEN: "a" } } as any, home);
		expect(readFileSync(join(home, ".env"), "utf-8")).toBe("GITHUB_TOKEN=a\n");
		expect(await handleDashboardEnv(home)).toMatchObject({
			data: { exists: true, keys: [{ key: "GITHUB_TOKEN", hasValue: true }] },
		});
	});

	it("uses the file from CYRUS_ENV_FILE and keeps existing values", async () => {
		const envFile = join(site, ".env");
		writeFileSync(envFile, 'APP_NAME="nyrus"\nCYRUS_SERVER_PORT=3456\n');
		process.env.CYRUS_ENV_FILE = envFile;

		const result = await handleCyrusEnv(
			{ variables: { GITHUB_TOKEN: "b" } } as any,
			home,
		);

		expect(result.success).toBe(true);
		expect(readFileSync(envFile, "utf-8")).toBe(
			'APP_NAME="nyrus"\nCYRUS_SERVER_PORT=3456\nGITHUB_TOKEN=b\n',
		);
		expect(() => readFileSync(join(home, ".env"))).toThrow();
		expect(await handleDashboardEnv(home)).toMatchObject({
			data: {
				exists: true,
				keys: [
					{ key: "APP_NAME" },
					{ key: "CYRUS_SERVER_PORT" },
					{ key: "GITHUB_TOKEN", hasValue: true },
				],
			},
		});
	});
});
