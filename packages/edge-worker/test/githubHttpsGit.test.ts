import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
	addGitConfigToEnv,
	GITHUB_HTTPS_GIT_CONFIG,
	shouldUseGitHubHttpsGit,
} from "../src/githubHttpsGit.js";

describe("githubHttpsGit", () => {
	it("adds its git config after entries the environment already has, once", () => {
		const env: NodeJS.ProcessEnv = {
			GITHUB_TOKEN: "ghp_x",
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "core.autocrlf",
			GIT_CONFIG_VALUE_0: "input",
		};

		expect(shouldUseGitHubHttpsGit(env)).toBe(true);
		expect(addGitConfigToEnv(env, GITHUB_HTTPS_GIT_CONFIG)).toBe(false);

		expect(env.GIT_CONFIG_COUNT).toBe("4");
		expect(env.GIT_CONFIG_KEY_0).toBe("core.autocrlf");
		expect(env.GIT_CONFIG_KEY_1).toBe("url.https://github.com/.insteadOf");
		expect(env.GIT_CONFIG_VALUE_1).toBe("git@github.com:");
		expect(env.GIT_CONFIG_KEY_3).toBe("credential.https://github.com.helper");
	});

	it("leaves git alone without a GitHub token", () => {
		const env: NodeJS.ProcessEnv = {};
		expect(shouldUseGitHubHttpsGit(env)).toBe(false);
		expect(env.GIT_CONFIG_COUNT).toBeUndefined();
	});

	it("makes git rewrite SSH remotes and hand out the token", () => {
		const env: NodeJS.ProcessEnv = {
			...process.env,
			GITHUB_TOKEN: "ghp_test_token",
			GH_TOKEN: "",
			GIT_CONFIG_NOSYSTEM: "1",
			HOME: "/nonexistent",
		};
		delete env.GIT_CONFIG_COUNT;
		shouldUseGitHubHttpsGit(env);

		const rewritten = execFileSync(
			"git",
			["ls-remote", "--get-url", "git@github.com:acme/web.git"],
			{ env, encoding: "utf8" },
		).trim();
		expect(rewritten).toBe("https://github.com/acme/web.git");

		const credential = execFileSync("git", ["credential", "fill"], {
			env,
			input: "protocol=https\nhost=github.com\npath=acme/web.git\n\n",
			encoding: "utf8",
		});
		expect(credential).toContain("username=x-access-token");
		expect(credential).toContain("password=ghp_test_token");
	});
});
