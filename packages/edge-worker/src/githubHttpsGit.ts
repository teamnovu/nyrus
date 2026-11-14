/**
 * Git over HTTPS with the agent's GitHub token, for every repository.
 *
 * Inside the sandbox, sessions have no SSH keys, no port 22 and can't read
 * `~/.gitconfig`, so pushing needs HTTPS with a token, and repositories cloned
 * later (dashboard, inBudget) need it without per-repository setup. Git reads
 * config from the environment (GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n /
 * GIT_CONFIG_VALUE_n); set in nyrus's own environment, it reaches nyrus's git
 * calls (fetch, worktrees) and every session, inside the sandbox too.
 */

/** Credential helper: the session's GH_TOKEN, else GITHUB_TOKEN. */
const TOKEN_HELPER =
	'!f() { test "$1" = get || exit 0; t="${GH_TOKEN:-$GITHUB_TOKEN}"; [ -n "$t" ] || exit 0; echo username=x-access-token; echo "password=$t"; }; f';

export const GITHUB_HTTPS_GIT_CONFIG: ReadonlyArray<readonly [string, string]> =
	[
		// SSH remotes (git@github.com:owner/repo) go over HTTPS instead
		["url.https://github.com/.insteadOf", "git@github.com:"],
		["url.https://github.com/.insteadOf", "ssh://git@github.com/"],
		["credential.https://github.com.helper", TOKEN_HELPER],
	];

/**
 * Add git config entries to an environment, after any it already has.
 * Entries already there are not added twice. Returns whether it changed.
 */
export function addGitConfigToEnv(
	env: NodeJS.ProcessEnv,
	entries: ReadonlyArray<readonly [string, string]>,
): boolean {
	const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10) || 0;
	const existing = new Set<string>();
	for (let i = 0; i < count; i++) {
		existing.add(
			`${env[`GIT_CONFIG_KEY_${i}`]}=${env[`GIT_CONFIG_VALUE_${i}`]}`,
		);
	}
	let next = count;
	for (const [key, value] of entries) {
		if (existing.has(`${key}=${value}`)) continue;
		env[`GIT_CONFIG_KEY_${next}`] = key;
		env[`GIT_CONFIG_VALUE_${next}`] = value;
		next++;
	}
	if (next === count) return false;
	env.GIT_CONFIG_COUNT = String(next);
	return true;
}

/**
 * With the sandbox on and a GitHub token in the environment (GITHUB_TOKEN or
 * GH_TOKEN), make git use HTTPS with that token for GitHub. Returns whether
 * it applied (false without a token: git keeps its own setup).
 */
export function shouldUseGitHubHttpsGit(env: NodeJS.ProcessEnv): boolean {
	if (!env.GITHUB_TOKEN?.trim() && !env.GH_TOKEN?.trim()) {
		return false;
	}
	addGitConfigToEnv(env, GITHUB_HTTPS_GIT_CONFIG);
	return true;
}
