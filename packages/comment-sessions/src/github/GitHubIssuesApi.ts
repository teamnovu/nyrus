/**
 * The few GitHub REST calls the GitHub issue layer makes: open an issue, and
 * post, edit and delete its comments.
 */
export interface GitHubIssuesApi {
	createIssue(
		repo: string,
		issue: { title: string; body: string },
	): Promise<{ number: number; url: string }>;
	createComment(
		repo: string,
		issueNumber: number,
		body: string,
	): Promise<{ id: number }>;
	updateComment(repo: string, commentId: number, body: string): Promise<void>;
	deleteComment(repo: string, commentId: number): Promise<void>;
}

/** GitHub limits issue and comment bodies to 65,536 characters. */
export const MAX_BODY = 65_000;

/** GitHub's REST API, with a token looked up per call (App tokens expire). */
export class GitHubRestIssuesApi implements GitHubIssuesApi {
	constructor(
		private readonly token: () => Promise<string | undefined>,
		private readonly options: {
			fetch?: typeof fetch;
			apiUrl?: string;
		} = {},
	) {}

	async createIssue(
		repo: string,
		issue: { title: string; body: string },
	): Promise<{ number: number; url: string }> {
		const created = await this.request<{ number: number; html_url: string }>(
			"POST",
			`/repos/${repo}/issues`,
			{ title: issue.title.slice(0, 256), body: clip(issue.body) },
		);
		return { number: created.number, url: created.html_url };
	}

	async createComment(
		repo: string,
		issueNumber: number,
		body: string,
	): Promise<{ id: number }> {
		const created = await this.request<{ id: number }>(
			"POST",
			`/repos/${repo}/issues/${issueNumber}/comments`,
			{ body: clip(body) },
		);
		return { id: created.id };
	}

	async updateComment(
		repo: string,
		commentId: number,
		body: string,
	): Promise<void> {
		await this.request("PATCH", `/repos/${repo}/issues/comments/${commentId}`, {
			body: clip(body),
		});
	}

	async deleteComment(repo: string, commentId: number): Promise<void> {
		await this.request("DELETE", `/repos/${repo}/issues/comments/${commentId}`);
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const token = await this.token();
		if (!token) {
			throw new Error(
				"No GitHub token: set up the GitHub App (GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID) or GITHUB_TOKEN",
			);
		}
		const doFetch = this.options.fetch ?? fetch;
		const response = await doFetch(
			`${this.options.apiUrl ?? "https://api.github.com"}${path}`,
			{
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
					"User-Agent": "cyrus-comment-sessions",
					...(body !== undefined && { "Content-Type": "application/json" }),
				},
				...(body !== undefined && { body: JSON.stringify(body) }),
			},
		);
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(
				`GitHub ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`,
			);
		}
		if (response.status === 204) return undefined as T;
		return (await response.json()) as T;
	}
}

function clip(body: string): string {
	return body.length > MAX_BODY
		? `${body.slice(0, MAX_BODY)}\n\n_(cut off: too long for GitHub)_`
		: body;
}

/**
 * `owner/name` of a github.com repository URL (https or ssh, with or without
 * `.git`), or undefined for anything else.
 */
export function parseGitHubRepo(url: string | undefined): string | undefined {
	if (!url) return undefined;
	const match =
		/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
			url.trim(),
		);
	return match ? `${match[1]}/${match[2]}` : undefined;
}
