import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

export interface GitHubAppTokenProviderConfig {
	appId: string;
	installationId: string;
	privateKeyPath: string;
	/** GitHub API base URL (default: https://api.github.com) */
	apiBaseUrl?: string;
}

/**
 * Mints and caches GitHub App installation tokens for self-hosted users.
 *
 * Uses the App's private key to sign a JWT, then exchanges it for a
 * short-lived installation access token via the GitHub API.
 * Tokens are cached and refreshed 5 minutes before expiry.
 */
export class GitHubAppTokenProvider {
	private config: GitHubAppTokenProviderConfig;
	private cachedToken: string | null = null;
	private expiresAt = 0;
	private privateKeyPromise: Promise<string> | null = null;

	constructor(config: GitHubAppTokenProviderConfig) {
		this.config = config;
	}

	/**
	 * Get a valid installation access token.
	 * Returns the cached token if it stays valid for at least `minValidityMs`
	 * (default 5 minutes), otherwise mints a new one. Agent sessions keep the
	 * token they start with, so they ask for a long remaining validity.
	 */
	async getToken(options?: { minValidityMs?: number }): Promise<string> {
		const minValidityMs = options?.minValidityMs ?? 5 * 60 * 1000;
		if (this.cachedToken && Date.now() < this.expiresAt - minValidityMs) {
			return this.cachedToken;
		}

		const pem = await this.loadPrivateKey();
		const jwt = createAppJwt(this.config.appId, pem);
		const apiBase = this.config.apiBaseUrl ?? "https://api.github.com";

		const response = await fetch(
			`${apiBase}/app/installations/${this.config.installationId}/access_tokens`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${jwt}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			},
		);

		if (!response.ok) {
			const body = await response.text();
			throw new Error(
				`[GitHubAppTokenProvider] Failed to create installation token: ${response.status} ${response.statusText} - ${body}`,
			);
		}

		const data = (await response.json()) as {
			token: string;
			expires_at: string;
		};

		this.cachedToken = data.token;
		this.expiresAt = new Date(data.expires_at).getTime();

		return this.cachedToken;
	}

	private loadPrivateKey(): Promise<string> {
		if (!this.privateKeyPromise) {
			// Don't cache a failed read: a key file put in place after the
			// first attempt is picked up without a restart.
			this.privateKeyPromise = readFile(
				this.config.privateKeyPath,
				"utf-8",
			).catch((error: unknown) => {
				this.privateKeyPromise = null;
				throw error;
			});
		}
		return this.privateKeyPromise;
	}
}

/**
 * Create a JWT for GitHub App authentication.
 * Uses Node's native crypto — no external JWT library needed.
 *
 * @see https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
export function createAppJwt(appId: string, privateKey: string): string {
	const now = Math.floor(Date.now() / 1000);
	const header = Buffer.from(
		JSON.stringify({ alg: "RS256", typ: "JWT" }),
	).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			iat: now - 60,
			exp: now + 10 * 60,
			iss: appId,
		}),
	).toString("base64url");

	const sign = createSign("RSA-SHA256");
	sign.update(`${header}.${payload}`);
	const signature = sign.sign(privateKey, "base64url");

	return `${header}.${payload}.${signature}`;
}
