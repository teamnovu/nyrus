import { createHmac, timingSafeEqual } from "node:crypto";
import type {
	TrackerIntegration,
	TrackerIntegrationFactory,
} from "cyrus-comment-sessions";
import type { ILogger } from "cyrus-core";
import { InbudgetClient } from "cyrus-inbudget-sync";
import { isSigned, JiraApiClient } from "cyrus-jira-event-transport";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createClaudeClassifier } from "./claudeClassifier.js";
import { TRIAGE_HEADING } from "./comment.js";
import { InbudgetTriageSource } from "./InbudgetTriageSource.js";
import { FREE_MAIL_DOMAINS } from "./Triage.js";
import { type TriageOutcome, TriageService } from "./TriageService.js";

/** Jira sends new service desk tickets here. */
export const TRIAGE_WEBHOOK_PATH = "/jira-triage-webhook";
/** Triage a ticket by hand (CYRUS_API_KEY): POST {"issueKey", "dryRun"?, "force"?}. */
export const TRIAGE_API_PATH = "/api/dashboard/triage";

const DEFAULT_IGNORED_SENDERS = [
	"noreply",
	"no-reply",
	"donotreply",
	"mailer-daemon",
	"postmaster",
];

/**
 * Triage of incoming Jira service desk tickets. On with
 * TRIAGE_JIRA_PROJECTS (e.g. `NOV`), the Jira account (JIRA_*) and inBudget
 * (INBUDGET_URL, INBUDGET_TOKEN). For each new, unassigned ticket nyrus finds
 * the customer and project in inBudget and posts an internal comment with
 * the people who booked the most hours on it (and assigns the first with
 * TRIAGE_ASSIGN=true).
 */
export function createServicedeskTriageIntegrationFactory(
	options: { fetch?: typeof fetch } = {},
): TrackerIntegrationFactory {
	return ({ env, cyrusHome, logger }): TrackerIntegration | null => {
		const projectKeys = list(env.TRIAGE_JIRA_PROJECTS).map((k) =>
			k.toUpperCase(),
		);
		if (projectKeys.length === 0) return null;

		const baseUrl = env.JIRA_BASE_URL?.trim().replace(/\/+$/, "");
		const email = env.JIRA_EMAIL?.trim();
		const apiToken = env.JIRA_API_TOKEN?.trim();
		const inbudgetUrl = env.INBUDGET_URL?.trim();
		const missing = [
			!baseUrl && "JIRA_BASE_URL",
			!email && "JIRA_EMAIL",
			!apiToken && "JIRA_API_TOKEN",
			!inbudgetUrl && "INBUDGET_URL",
			!env.INBUDGET_TOKEN?.trim() && "INBUDGET_TOKEN",
		].filter(Boolean);
		if (missing.length > 0) {
			logger.error(
				`Service desk triage stays off: TRIAGE_JIRA_PROJECTS is set but ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} missing`,
			);
			return null;
		}
		const secret =
			env.TRIAGE_WEBHOOK_SECRET?.trim() ||
			env.JIRA_WEBHOOK_SECRET?.trim() ||
			"";

		const jira = new JiraApiClient(
			{ baseUrl: baseUrl!, email: email!, apiToken: apiToken! },
			{ logger, fetch: options.fetch },
		);
		const source = new InbudgetTriageSource(
			new InbudgetClient({
				baseUrl: inbudgetUrl!,
				token: env.INBUDGET_TOKEN!.trim(),
				fetch: options.fetch,
			}),
		);
		const useClaude =
			env.TRIAGE_CLAUDE?.trim().toLowerCase() !== "false" &&
			Boolean(
				env.ANTHROPIC_API_KEY?.trim() ||
					env.CLAUDE_CODE_OAUTH_TOKEN?.trim() ||
					env.ANTHROPIC_AUTH_TOKEN?.trim(),
			);
		const ownDomains = list(env.TRIAGE_OWN_DOMAINS ?? "novu.ch");
		const hoursMonths = Number(env.TRIAGE_HOURS_MONTHS ?? 0);
		const assign = env.TRIAGE_ASSIGN?.trim().toLowerCase() === "true";
		const service = new TriageService({
			jira,
			source,
			classify: useClaude
				? createClaudeClassifier({
						cyrusHome,
						model: env.TRIAGE_MODEL?.trim() || "haiku",
						logger,
					})
				: undefined,
			triage: {
				ignoredDomains: new Set(
					[...FREE_MAIL_DOMAINS, ...ownDomains].map((d) => d.toLowerCase()),
				),
				hoursMonths:
					Number.isFinite(hoursMonths) && hoursMonths >= 0 ? hoursMonths : 0,
				maxPeople: 3,
			},
			projectKeys: new Set(projectKeys),
			assign,
			ignoredSenders: [
				...DEFAULT_IGNORED_SENDERS,
				...list(env.TRIAGE_IGNORE_SENDERS).map((s) => s.toLowerCase()),
			],
			cyrusHome,
			logger,
		});
		const queue = new SerialQueue(logger);

		return {
			workspaceKey: "servicedesk-triage",
			chatCommand(text) {
				const parsed = parseTriageCommand(text);
				if (!parsed) return undefined;
				if (!parsed.issueKey) {
					return {
						name: "triage",
						run: async () =>
							"Write `triage NOV-123` to triage a ticket (internal comment), or `triage NOV-123 dry` to only see the result.",
					};
				}
				const issueKey = parsed.issueKey;
				return {
					name: `triage ${issueKey}${parsed.dryRun ? " (dry run)" : ""}`,
					run: async () =>
						triageReply(
							issueKey,
							jira.issueUrl(issueKey),
							await service.handle(issueKey, {
								force: true,
								dryRun: parsed.dryRun,
							}),
							parsed.dryRun,
						),
				};
			},
			register(host) {
				registerRoutes(host.fastify, {
					service,
					queue,
					secret,
					env,
					logger,
					projectKeys,
				});
				logger.info(
					`✅ Service desk triage registered for ${projectKeys.join(", ")} (${useClaude ? "with" : "without"} Claude, ${assign ? "assigns" : "suggests only"})${secret ? "" : `; ${TRIAGE_WEBHOOK_PATH} is off until TRIAGE_WEBHOOK_SECRET or JIRA_WEBHOOK_SECRET is set`}`,
				);
			},
		};
	};
}

/** The service desk triage, for the edge worker's list. */
export const createServicedeskTriageIntegration: TrackerIntegrationFactory =
	createServicedeskTriageIntegrationFactory();

interface RouteContext {
	service: TriageService;
	queue: SerialQueue;
	secret: string;
	env: NodeJS.ProcessEnv;
	logger: ILogger;
	projectKeys: string[];
}

function registerRoutes(fastify: FastifyInstance, context: RouteContext): void {
	const { service, queue, secret, env, logger, projectKeys } = context;
	if (secret) {
		fastify.post(TRIAGE_WEBHOOK_PATH, async (request, reply) => {
			if (!webhookAuthorized(request, secret)) {
				reply.code(401).send({ error: "Invalid webhook signature" });
				return;
			}
			const issueKey = newIssueKey(request.body);
			reply.code(200).send({ ok: true });
			if (!issueKey) return;
			const project = issueKey.split("-")[0]?.toUpperCase() ?? "";
			if (!projectKeys.includes(project)) return;
			queue.push(async () => {
				const outcome = await service.handle(issueKey);
				if (outcome.status === "skipped") {
					logger.debug(`Triage ${issueKey} skipped: ${outcome.reason}`);
				}
			}, issueKey);
		});
	}
	fastify.post(TRIAGE_API_PATH, async (request, reply) => {
		if (!apiAuthorized(request, env)) {
			reply.code(401).send({ success: false, error: "Unauthorized" });
			return;
		}
		const body = (request.body ?? {}) as {
			issueKey?: unknown;
			dryRun?: unknown;
			force?: unknown;
		};
		if (typeof body.issueKey !== "string" || !body.issueKey.trim()) {
			reply.code(400).send({ success: false, error: "issueKey is required" });
			return;
		}
		try {
			const outcome = await service.handle(body.issueKey.trim(), {
				dryRun: body.dryRun !== false,
				force: body.force === true,
			});
			reply.send({ success: true, data: outcome });
		} catch (error) {
			logger.error(`Triage ${body.issueKey} failed`, error);
			reply.code(502).send({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});
}

/**
 * "triage NOV-123", "triage <https://site.atlassian.net/browse/NOV-123|…>",
 * optionally with "dry" (or "test", "preview") for a dry run. Only text that
 * starts with "triage" counts. Exported for tests.
 */
export function parseTriageCommand(
	text: string,
): { issueKey?: string; dryRun: boolean } | undefined {
	const match = /^\s*triage\b(.*)$/is.exec(text);
	if (!match) return undefined;
	const rest = match[1] ?? "";
	const key = /(?:^|[\s/<|])([A-Za-z][A-Za-z0-9_]*-\d+)(?=$|[\s>|.,!?])/.exec(
		rest,
	);
	return {
		issueKey: key?.[1]?.toUpperCase(),
		dryRun: /\b(dry|test|preview)\b/i.test(rest),
	};
}

/** The Slack reply (mrkdwn) for a triage run from chat. Exported for tests. */
export function triageReply(
	issueKey: string,
	issueUrl: string,
	outcome: TriageOutcome,
	dryRun: boolean,
): string {
	const link = `<${issueUrl}|${issueKey}>`;
	if (outcome.status === "skipped") {
		return `Triage for ${link} skipped: ${outcome.reason}.`;
	}
	const heading = dryRun
		? `:mag: Triage preview for ${link} (nothing posted):`
		: `:white_check_mark: Triage for ${link}: internal comment posted${outcome.assigned ? " and assigned" : ""}.`;
	const body = outcome.comment
		.split("\n")
		.filter((line) => !isSigned(line) && !line.includes(TRIAGE_HEADING))
		.map((line) => `> ${line}`)
		.join("\n");
	return `${heading}\n${body}`;
}

/**
 * The key of a newly created issue. A Jira admin webhook sends
 * `jira:issue_created` with the issue; a Jira Automation rule ("Issue
 * created" → Send web request) sends `{"issueKey": "{{issue.key}}"}`.
 * Exported for tests.
 */
export function newIssueKey(body: unknown): string | undefined {
	if (!body || typeof body !== "object") return undefined;
	const payload = body as {
		webhookEvent?: string;
		issueKey?: unknown;
		issue?: { key?: unknown };
	};
	if (payload.webhookEvent && payload.webhookEvent !== "jira:issue_created") {
		return undefined;
	}
	const key = payload.issue?.key ?? payload.issueKey;
	return typeof key === "string" &&
		/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(key.trim())
		? key.trim().toUpperCase()
		: undefined;
}

/** Same rules as /jira-webhook: signed body, or the secret in a header or `?secret=`. */
function webhookAuthorized(request: FastifyRequest, secret: string): boolean {
	const signature = header(request, "x-hub-signature");
	if (signature) {
		const rawBody =
			(request as FastifyRequest & { rawBody?: string }).rawBody ??
			JSON.stringify(request.body ?? {});
		const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
		return safeEqual(expected, signature.trim().toLowerCase());
	}
	const token =
		header(request, "x-cyrus-webhook-secret") ??
		(request.query as Record<string, string> | undefined)?.secret;
	return token !== undefined && safeEqual(secret, token);
}

function apiAuthorized(
	request: FastifyRequest,
	env: NodeJS.ProcessEnv,
): boolean {
	const apiKey = env.CYRUS_API_KEY?.trim();
	if (!apiKey) return false;
	return safeEqual(`Bearer ${apiKey}`, request.headers.authorization ?? "");
}

function header(request: FastifyRequest, name: string): string | undefined {
	const value = request.headers[name];
	return typeof value === "string" ? value : undefined;
}

function safeEqual(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

function list(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

/** One ticket at a time, so a burst of mails doesn't hammer inBudget or Claude. */
class SerialQueue {
	private tail: Promise<void> = Promise.resolve();
	private readonly pending = new Set<string>();

	constructor(private readonly logger: ILogger) {}

	push(task: () => Promise<void>, id: string): void {
		if (this.pending.has(id)) return;
		this.pending.add(id);
		this.tail = this.tail.then(async () => {
			try {
				await task();
			} catch (error) {
				this.logger.error(`Triage ${id} failed`, error);
			} finally {
				this.pending.delete(id);
			}
		});
	}
}
