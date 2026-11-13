import type { FastifyInstance } from "fastify";

/**
 * Jira Cloud types.
 *
 * Jira has no agent API like Linear's or Plane's: Cyrus works through a
 * normal Jira account (its "agent" account), authenticated with an API
 * token. Assigning an issue to that account, or adding the trigger label,
 * starts a session; comments on the issue talk to it. These types cover the
 * parts of Jira's REST API v2 and webhook payloads Cyrus reads. In v2,
 * descriptions and comment bodies are wiki markup strings.
 *
 * @see https://developer.atlassian.com/cloud/jira/platform/rest/v2/intro/
 * @see https://developer.atlassian.com/cloud/jira/platform/webhooks/
 */

export interface JiraUser {
	accountId: string;
	displayName?: string;
	emailAddress?: string;
	active?: boolean;
}

/** `new` (To Do), `indeterminate` (In Progress) or `done`. */
export interface JiraStatusCategory {
	id?: number;
	key: string;
	name?: string;
	colorName?: string;
}

export interface JiraStatus {
	id: string;
	name: string;
	description?: string;
	statusCategory?: JiraStatusCategory;
}

export interface JiraProject {
	id: string;
	key: string;
	name: string;
	description?: string;
}

export interface JiraPriority {
	id?: string;
	name: string;
}

/** A file attached to an issue; `content` is the (authenticated) download URL. */
export interface JiraAttachment {
	id: string;
	filename: string;
	mimeType?: string;
	size?: number;
	content: string;
}

export interface JiraComment {
	id: string;
	body?: string;
	author?: JiraUser;
	created: string;
	updated: string;
}

export interface JiraIssueFields {
	summary: string;
	description?: string | null;
	status?: JiraStatus;
	assignee?: JiraUser | null;
	reporter?: JiraUser | null;
	labels?: string[];
	priority?: JiraPriority | null;
	project: JiraProject;
	issuetype?: { id?: string; name: string };
	parent?: { id: string; key: string } | null;
	created: string;
	updated: string;
	attachment?: JiraAttachment[];
}

export interface JiraIssue {
	id: string;
	key: string;
	fields: JiraIssueFields;
}

export interface JiraTransition {
	id: string;
	name: string;
	to: JiraStatus;
}

/** One status list per issue type, as `GET /project/{key}/statuses` answers. */
export interface JiraIssueTypeStatuses {
	id: string;
	name: string;
	statuses: JiraStatus[];
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface JiraChangelogItem {
	field: string;
	fieldId?: string;
	from?: string | null;
	fromString?: string | null;
	to?: string | null;
	toString?: string | null;
}

/**
 * What arrives at `POST /jira-webhook`. A Jira admin webhook (Settings →
 * System → WebHooks) sends `webhookEvent` ("jira:issue_created",
 * "jira:issue_updated", "comment_created", ...), the issue, the changelog and
 * the comment. A Jira Automation "Send web request" can send the same shape,
 * a bare issue, or just `{ "issueKey": "{{issue.key}}" }`.
 */
export interface JiraWebhookPayload {
	webhookEvent?: string;
	timestamp?: number;
	user?: JiraUser;
	issue?: { id?: string; key?: string; fields?: Partial<JiraIssueFields> };
	issueKey?: string;
	key?: string;
	changelog?: { id?: string; items?: JiraChangelogItem[] };
	comment?: Partial<JiraComment>;
}

/** A webhook, normalized by the transport. */
export interface JiraWebhookEvent {
	kind: "issue" | "comment";
	/** e.g. "jira:issue_updated", "comment_created", or "automation" */
	webhookEvent: string;
	/** Issue key or id */
	issueKey: string;
	changelog: JiraChangelogItem[];
	comment?: {
		id: string;
		/** Wiki markup */
		body: string;
		authorAccountId?: string;
		authorName?: string;
	};
	/** Who caused the event, if Jira says */
	actor?: JiraUser;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** A Jira Cloud site and the agent account's API token. */
export interface JiraCredentials {
	/** e.g. https://novu.atlassian.net (no trailing slash) */
	baseUrl: string;
	/** The agent account's email */
	email: string;
	/** An API token of the agent account (id.atlassian.com → Security) */
	apiToken: string;
}

export interface JiraTriggerOptions {
	/** Adding this label to an issue starts a session. Empty to disable. */
	triggerLabel: string;
	/** Assigning an issue to the agent account starts a session. */
	triggerOnAssign: boolean;
}

export interface JiraEventTransportConfig {
	fastifyServer: FastifyInstance;
	/**
	 * Checked against `X-Hub-Signature` (HMAC-SHA256 of the raw body, as Jira
	 * admin webhooks with a secret send it), or compared with an
	 * `X-Cyrus-Webhook-Secret` header or `?secret=` query parameter (for Jira
	 * Automation, which cannot sign). Empty accepts every request.
	 */
	webhookSecret: string;
}

export interface JiraEventTransportEvents {
	event: (event: JiraWebhookEvent) => void;
	error: (error: Error) => void;
}
