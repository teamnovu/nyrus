import { createLogger, type ILogger } from "cyrus-core";
import type {
	JiraComment,
	JiraCredentials,
	JiraIssue,
	JiraIssueTypeStatuses,
	JiraProject,
	JiraStatus,
	JiraTransition,
	JiraUser,
} from "./types.js";

/** Issue fields Cyrus reads; asking for fewer keeps responses small. */
const ISSUE_FIELDS = [
	"summary",
	"description",
	"status",
	"assignee",
	"reporter",
	"labels",
	"priority",
	"project",
	"issuetype",
	"parent",
	"created",
	"updated",
	"attachment",
].join(",");

/** Stop paging a list after this many pages. */
const MAX_PAGES = 100;

/** Atlassian service accounts have emails in this domain. */
const SERVICE_ACCOUNT_DOMAIN = "@serviceaccount.atlassian.com";

export class JiraApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: string,
	) {
		super(message);
		this.name = "JiraApiError";
	}
}

type FetchLike = typeof fetch;

/**
 * Minimal client for Jira Cloud's REST API v2, authenticated as the agent
 * account with Basic auth (email + API token). v2 is used rather than v3
 * because it reads and writes descriptions and comments as wiki markup
 * strings instead of Atlassian Document Format.
 */
export class JiraApiClient {
	private readonly logger: ILogger;
	private readonly fetchImpl: FetchLike;
	private apiRootPromise: Promise<string> | null = null;

	constructor(
		private readonly credentials: JiraCredentials,
		options: { logger?: ILogger; fetch?: FetchLike } = {},
	) {
		this.logger =
			options.logger ?? createLogger({ component: "JiraApiClient" });
		this.fetchImpl = options.fetch ?? fetch;
	}

	get baseUrl(): string {
		return this.credentials.baseUrl;
	}

	/** A copy of the credentials in use, e.g. to start the Jira tools as the same account. */
	getCredentials(): JiraCredentials {
		return { ...this.credentials };
	}

	issueUrl(key: string): string {
		return `${this.credentials.baseUrl}/browse/${key}`;
	}

	// ----- users -----

	myself(): Promise<JiraUser> {
		return this.request("GET", "/myself");
	}

	getUser(accountId: string): Promise<JiraUser> {
		return this.request("GET", "/user", undefined, { accountId });
	}

	// ----- issues -----

	getIssue(idOrKey: string): Promise<JiraIssue> {
		return this.request(
			"GET",
			`/issue/${encodeURIComponent(idOrKey)}`,
			undefined,
			{
				fields: ISSUE_FIELDS,
			},
		);
	}

	async updateIssue(
		idOrKey: string,
		fields: Record<string, unknown>,
	): Promise<void> {
		await this.request("PUT", `/issue/${encodeURIComponent(idOrKey)}`, {
			fields,
		});
	}

	async listTransitions(idOrKey: string): Promise<JiraTransition[]> {
		const data = await this.request<{ transitions?: JiraTransition[] }>(
			"GET",
			`/issue/${encodeURIComponent(idOrKey)}/transitions`,
		);
		return data?.transitions ?? [];
	}

	async transitionIssue(idOrKey: string, transitionId: string): Promise<void> {
		await this.request(
			"POST",
			`/issue/${encodeURIComponent(idOrKey)}/transitions`,
			{ transition: { id: transitionId } },
		);
	}

	/**
	 * Attach a link (e.g. a pull request) to an issue. Jira updates the link
	 * that has the same `globalId`, so the URL is used as one: linking the same
	 * PR again retitles it.
	 */
	async upsertRemoteLink(
		idOrKey: string,
		url: string,
		title: string,
	): Promise<{ id: number }> {
		return this.request(
			"POST",
			`/issue/${encodeURIComponent(idOrKey)}/remotelink`,
			{ globalId: url, object: { url, title } },
		);
	}

	// ----- comments -----

	/** All of an issue's comments, oldest first. */
	listComments(idOrKey: string): Promise<JiraComment[]> {
		return this.allPages(
			`/issue/${encodeURIComponent(idOrKey)}/comment`,
			"comments",
			100,
			{ orderBy: "created" },
		);
	}

	getComment(idOrKey: string, commentId: string): Promise<JiraComment> {
		return this.request(
			"GET",
			`/issue/${encodeURIComponent(idOrKey)}/comment/${commentId}`,
		);
	}

	createComment(idOrKey: string, body: string): Promise<JiraComment> {
		return this.request(
			"POST",
			`/issue/${encodeURIComponent(idOrKey)}/comment`,
			{ body },
		);
	}

	/** Edits don't notify watchers, so progress notes don't send a mail each time. */
	updateComment(
		idOrKey: string,
		commentId: string,
		body: string,
	): Promise<JiraComment> {
		return this.request(
			"PUT",
			`/issue/${encodeURIComponent(idOrKey)}/comment/${commentId}`,
			{ body },
			{ notifyUsers: "false" },
		);
	}

	async deleteComment(idOrKey: string, commentId: string): Promise<void> {
		await this.request(
			"DELETE",
			`/issue/${encodeURIComponent(idOrKey)}/comment/${commentId}`,
		);
	}

	// ----- projects, statuses, labels -----

	listProjects(): Promise<JiraProject[]> {
		return this.allPages("/project/search", "values", 100);
	}

	getProject(idOrKey: string): Promise<JiraProject> {
		return this.request("GET", `/project/${encodeURIComponent(idOrKey)}`);
	}

	listProjectStatuses(idOrKey: string): Promise<JiraIssueTypeStatuses[]> {
		return this.request(
			"GET",
			`/project/${encodeURIComponent(idOrKey)}/statuses`,
		);
	}

	getStatus(id: string): Promise<JiraStatus> {
		return this.request("GET", `/status/${encodeURIComponent(id)}`);
	}

	listLabels(): Promise<string[]> {
		return this.allPages("/label", "values", 1000);
	}

	// ----- files -----

	/** Download an attachment's `content` URL, authenticated. */
	async download(url: string): Promise<Buffer> {
		const response = await this.fetchImpl(await this.toApiUrl(url), {
			headers: { Authorization: this.authorization() },
		});
		if (!response.ok) {
			throw new JiraApiError(
				`Jira download failed: ${response.status}`,
				response.status,
				(await response.text()).slice(0, 500),
			);
		}
		return Buffer.from(await response.arrayBuffer());
	}

	// ----- plumbing -----

	/**
	 * Every page of a list Jira pages with `startAt` / `maxResults`, until it
	 * says that was the last one (`isLast`, `total`) or returns nothing.
	 */
	private async allPages<T>(
		path: string,
		key: "values" | "comments",
		pageSize: number,
		query: Record<string, string> = {},
	): Promise<T[]> {
		const items: T[] = [];
		for (let page = 0; page < MAX_PAGES; page++) {
			const data = await this.request<{
				values?: T[];
				comments?: T[];
				total?: number;
				isLast?: boolean;
			}>("GET", path, undefined, {
				...query,
				startAt: String(items.length),
				maxResults: String(pageSize),
			});
			const batch = data?.[key] ?? [];
			items.push(...batch);
			if (
				batch.length === 0 ||
				data?.isLast === true ||
				(typeof data?.total === "number" && items.length >= data.total)
			) {
				break;
			}
		}
		return items;
	}

	/**
	 * Where REST calls go. API tokens of Atlassian service accounts
	 * (`…@serviceaccount.atlassian.com`) are rejected on the site URL and only
	 * work through Atlassian's API gateway, `api.atlassian.com/ex/jira/<cloudId>`;
	 * the site's cloud id is looked up once. Links to issues stay on the site.
	 */
	private apiRoot(): Promise<string> {
		if (!this.apiRootPromise) {
			this.apiRootPromise = this.resolveApiRoot().catch((error: unknown) => {
				this.apiRootPromise = null;
				throw error;
			});
		}
		return this.apiRootPromise;
	}

	private async resolveApiRoot(): Promise<string> {
		const { baseUrl, email } = this.credentials;
		if (!email.toLowerCase().endsWith(SERVICE_ACCOUNT_DOMAIN)) {
			return baseUrl;
		}
		const response = await this.fetchImpl(`${baseUrl}/_edge/tenant_info`, {
			headers: { Accept: "application/json" },
		});
		const text = await response.text();
		let cloudId: string | undefined;
		try {
			cloudId = response.ok
				? (JSON.parse(text) as { cloudId?: string }).cloudId
				: undefined;
		} catch {
			cloudId = undefined;
		}
		if (!cloudId) {
			throw new JiraApiError(
				`Jira site lookup (cloud id for the service account) failed: ${response.status}`,
				response.status,
				text.slice(0, 500),
			);
		}
		return `https://api.atlassian.com/ex/jira/${cloudId}`;
	}

	/** A site URL Jira handed out (e.g. an attachment's `content`), routed like REST calls. */
	private async toApiUrl(url: string): Promise<string> {
		const { baseUrl } = this.credentials;
		return url.startsWith(`${baseUrl}/`)
			? `${await this.apiRoot()}${url.slice(baseUrl.length)}`
			: url;
	}

	private authorization(): string {
		const { email, apiToken } = this.credentials;
		return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
		query?: Record<string, string>,
	): Promise<T> {
		const url = new URL(`${await this.apiRoot()}/rest/api/2${path}`);
		for (const [key, value] of Object.entries(query ?? {})) {
			url.searchParams.set(key, value);
		}
		const response = await this.fetchImpl(url.toString(), {
			method,
			headers: {
				Authorization: this.authorization(),
				Accept: "application/json",
				...(body !== undefined && { "Content-Type": "application/json" }),
			},
			...(body !== undefined && { body: JSON.stringify(body) }),
		});
		const text = await response.text();
		if (!response.ok) {
			this.logger.debug(`Jira ${method} ${path} failed: ${response.status}`);
			throw new JiraApiError(
				`Jira ${method} ${path} failed: ${response.status} ${text.slice(0, 200)}`,
				response.status,
				text.slice(0, 500),
			);
		}
		return (text ? JSON.parse(text) : undefined) as T;
	}
}
