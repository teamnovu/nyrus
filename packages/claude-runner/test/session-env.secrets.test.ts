import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildBaseSessionEnv,
	CYRUS_INTERNAL_SECRET_ENV_KEYS,
} from "../src/session-env.js";

describe("buildBaseSessionEnv secrets", () => {
	const saved: Record<string, string | undefined> = {};
	const set = (key: string, value: string) => {
		if (!(key in saved)) saved[key] = process.env[key];
		process.env[key] = value;
	};

	beforeEach(() => {
		for (const key of CYRUS_INTERNAL_SECRET_ENV_KEYS) set(key, `secret-${key}`);
		set("CLAUDE_CODE_OAUTH_TOKEN", "claude-token");
		set("GH_TOKEN", "ghs_agent");
		set("JIRA_BASE_URL", "https://acme.atlassian.net");
	});

	afterEach(() => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		for (const key of Object.keys(saved)) delete saved[key];
	});

	it("keeps Cyrus's own integration secrets out of the session", () => {
		const env = buildBaseSessionEnv();

		for (const key of CYRUS_INTERNAL_SECRET_ENV_KEYS) {
			expect(env[key]).toBeUndefined();
		}
	});

	it("keeps what sessions need: Claude and GitHub credentials, plain settings", () => {
		const env = buildBaseSessionEnv();

		expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("claude-token");
		expect(env.GH_TOKEN).toBe("ghs_agent");
		expect(env.JIRA_BASE_URL).toBe("https://acme.atlassian.net");
	});

	it("still lets callers pass a value on purpose", () => {
		const env = buildBaseSessionEnv({ SLACK_BOT_TOKEN: "explicit" });

		expect(env.SLACK_BOT_TOKEN).toBe("explicit");
	});
});
