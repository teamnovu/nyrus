/**
 * Shared session environment and MCP config utilities.
 *
 * These helpers DRY up logic that was previously duplicated between
 * ClaudeRunner (query options) and EdgeWorker (warmup / startup).
 */

/**
 * Auth-related env vars forwarded from the parent process.
 * The SDK subprocess needs these for API calls.
 */
const AUTH_ENV_KEYS = [
	"ANTHROPIC_API_KEY",
	"CLAUDE_CODE_OAUTH_TOKEN",
	"ANTHROPIC_AUTH_TOKEN",
] as const;

/**
 * Secrets of Cyrus's own integrations: webhook secrets, tracker and chat
 * tokens, the config API key. Agent sessions never need them — the MCP
 * servers that act on those platforms get their credentials explicitly in
 * their own config — so they are kept out of the session env. A prompt
 * injected through an issue then cannot read them with `env`.
 *
 * Not listed (sessions need them): the Claude credentials, the agent's
 * GitHub/GitLab credentials (GH_TOKEN, GITHUB_TOKEN, GITLAB_ACCESS_TOKEN)
 * and other runners' API keys.
 */
export const CYRUS_INTERNAL_SECRET_ENV_KEYS = [
	"CYRUS_API_KEY",
	"CLOUDFLARE_TOKEN",
	"SLACK_BOT_TOKEN",
	"SLACK_SIGNING_SECRET",
	"JIRA_API_TOKEN",
	"JIRA_WEBHOOK_SECRET",
	"CLICKUP_API_TOKEN",
	"CLICKUP_WEBHOOK_SECRET",
	"GITHUB_WEBHOOK_SECRET",
	"GITHUB_ISSUES_WEBHOOK_SECRET",
	"INBUDGET_TOKEN",
	"GITLAB_WEBHOOK_SECRET",
	"LINEAR_CLIENT_SECRET",
	"LINEAR_WEBHOOK_SECRET",
	"PLANE_CLIENT_SECRET",
	"PLANE_WEBHOOK_SECRET",
	"ZULIP_API_KEY",
	"ZULIP_WEBHOOK_TOKEN",
] as const;

/**
 * Cyrus-specific env vars injected into every Claude Code subprocess.
 * Both `ClaudeRunner.start()` and `EdgeWorker.warmupRecentSessions()`
 * must use the same set — keep this as the single source of truth.
 *
 * Note: CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is intentionally not included
 * while the Linux bubblewrap sandbox side effects it triggers are being
 * investigated. See CYPACK-1108.
 *
 * - MCP_CONNECTION_NONBLOCKING lets MCP servers connect in the background so
 *   both cold-start and pre-warm sessions return faster.
 */
export const CYRUS_SESSION_ENV = {
	CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1",
	CLAUDE_CODE_ENABLE_TASKS: "true",
	CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
	CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
	MCP_CONNECTION_NONBLOCKING: "true",
} as const;

/**
 * Build the base `env` object for a Claude SDK session.
 *
 * Overlays the parent `process.env` so HOME (and other inherited vars) are
 * available to tools that depend on them — GPG-signed commits, `gh` CLI auth,
 * etc. — minus Cyrus's own integration secrets
 * ({@link CYRUS_INTERNAL_SECRET_ENV_KEYS}). claude-agent-sdk v0.2.113 reverted to no longer overlaying process.env
 * itself, so we must do it here. Then applies the shared Cyrus session flags
 * on top. Callers can spread additional vars on top (e.g., repository .env
 * for live runs).
 */
export function buildBaseSessionEnv(
	extra?: Record<string, string>,
): Record<string, string> {
	const env: Record<string, string> = {
		...(process.env as Record<string, string>),
	};

	// Keep Cyrus's own integration secrets out of the agent's reach
	for (const key of CYRUS_INTERNAL_SECRET_ENV_KEYS) {
		delete env[key];
	}

	// Forward PATH
	if (process.env.PATH) {
		env.PATH = process.env.PATH;
	}

	// Forward auth credentials from the parent process — the SDK needs these
	// for API calls. See: https://code.claude.com/docs/en/env-vars
	for (const key of AUTH_ENV_KEYS) {
		if (process.env[key]) {
			env[key] = process.env[key];
		}
	}

	return {
		...env,
		...CYRUS_SESSION_ENV,
		...extra,
	};
}

/**
 * Normalize MCP server configs loaded from JSON files.
 *
 * Config files (.mcp.json, mcp-*.json) often omit the `type` field,
 * but the SDK requires an explicit discriminator for non-stdio transports.
 * If a config has a `url` but no `type`, set `type = "http"`.
 *
 * Mutates the input records in place.
 */
export function normalizeMcpHttpTransport(
	servers: Record<string, Record<string, unknown>>,
): void {
	for (const cfg of Object.values(servers)) {
		if (!cfg.type && typeof cfg.url === "string") {
			cfg.type = "http";
		}
	}
}
