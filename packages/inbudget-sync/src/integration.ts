import { timingSafeEqual } from "node:crypto";
import type {
	TrackerIntegration,
	TrackerIntegrationFactory,
} from "cyrus-comment-sessions";
import type { FastifyReply, FastifyRequest } from "fastify";
import { InbudgetClient } from "./InbudgetClient.js";
import { InbudgetSync } from "./InbudgetSync.js";
import { writeGroup } from "./manual.js";
import type { DesiredRepository, PlanContext } from "./plan.js";

/** Dashboard endpoint: GET the sync status, POST to sync now. */
export const INBUDGET_STATUS_PATH = "/api/dashboard/inbudget";

/** A POST waits this long for the sync before answering with "running". */
const POST_WAIT_MS = 25_000;

/**
 * inBudget in nyrus: repositories and their routing come from inBudget's
 * projects (their GitHub, Jira and ClickUp links). Enabled by INBUDGET_URL
 * with INBUDGET_TOKEN, an access token of a user who can read all projects. Syncs at startup and every
 * INBUDGET_SYNC_INTERVAL_MINUTES (default 30, 0 for only at startup and on
 * demand from the dashboard).
 */
export function createInbudgetIntegrationFactory(
	options: { fetch?: typeof fetch } = {},
): TrackerIntegrationFactory {
	return ({
		env,
		cyrusHome,
		logger,
		provisioning,
	}): TrackerIntegration | null => {
		const baseUrl = env.INBUDGET_URL?.trim();
		if (!baseUrl) return null;
		const client = new InbudgetClient({
			baseUrl,
			token: env.INBUDGET_TOKEN?.trim() ?? "",
			fetch: options.fetch,
		});
		const githubIssues = Boolean(env.GITHUB_ISSUES_WEBHOOK_SECRET?.trim());
		const sync = new InbudgetSync({
			client,
			cyrusHome,
			context: planContextFromEnv(env, options.fetch),
			instructions: (repo) => defaultInstructions(repo, githubIssues),
			logger,
		});
		provisioning?.register((platform, repo) =>
			platform === "github" ? sync.provideGitHub(repo) : Promise.resolve(false),
		);
		const minutes = Number(env.INBUDGET_SYNC_INTERVAL_MINUTES ?? 30);
		const timers: NodeJS.Timeout[] = [];

		return {
			workspaceKey: "inbudget",
			register(host) {
				registerRoutes(host.fastify, sync, env, cyrusHome);
				const first = setTimeout(() => void sync.sync(), 5_000);
				first.unref?.();
				timers.push(first);
				if (Number.isFinite(minutes) && minutes > 0) {
					const every = setInterval(() => void sync.sync(), minutes * 60_000);
					every.unref?.();
					timers.push(every);
				}
				logger.info(
					`✅ inBudget registered (${client.baseUrl}, repositories synced ${minutes > 0 ? `every ${minutes} min` : "at startup and on demand"})`,
				);
			},
			dispose() {
				for (const timer of timers) clearTimeout(timer);
			},
		};
	};
}

/** The inBudget integration, for the edge worker's list. */
export const createInbudgetIntegration: TrackerIntegrationFactory =
	createInbudgetIntegrationFactory();

/**
 * Which Jira site and ClickUp workspace nyrus works on, with the workspace
 * keys their integrations use (see JiraIntegration / ClickUp integration).
 */
export function planContextFromEnv(
	env: NodeJS.ProcessEnv,
	fetchImpl: typeof fetch = fetch,
): PlanContext {
	const context: PlanContext = {};
	const jiraUrl = env.JIRA_BASE_URL?.trim();
	if (jiraUrl && env.JIRA_EMAIL?.trim() && env.JIRA_API_TOKEN?.trim()) {
		try {
			const host = new URL(jiraUrl).hostname.toLowerCase();
			const site = host.split(".")[0] ?? "";
			context.jira = {
				host,
				workspaceKey: env.JIRA_WORKSPACE_KEY?.trim() || `jira-${site}`,
			};
		} catch {
			// JIRA_BASE_URL is not a URL; the Jira integration reports it.
		}
	}
	if (env.GITHUB_ISSUES_WEBHOOK_SECRET?.trim()) {
		context.github = { workspaceKey: "github" };
	}
	const clickUpToken = env.CLICKUP_API_TOKEN?.trim();
	if (env.CLICKUP_WEBHOOK_SECRET?.trim() && clickUpToken) {
		const teamId = env.CLICKUP_TEAM_ID?.trim() || undefined;
		context.clickup = {
			teamId,
			workspaceKey: teamId ? `clickup-${teamId}` : "clickup",
		};
		const names = new Map<string, Promise<string | undefined>>();
		context.listName = (listId) => {
			let name = names.get(listId);
			if (!name) {
				name = fetchImpl(
					`https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}`,
					{
						headers: {
							Authorization: clickUpToken,
							Accept: "application/json",
						},
					},
				)
					.then(async (r) =>
						r.ok ? ((await r.json()) as { name?: string }).name : undefined,
					)
					.catch(() => undefined);
				names.set(listId, name);
			}
			return name;
		};
	}
	return context;
}

/** `appendInstruction` for a new managed repository. */
export function defaultInstructions(
	repo: DesiredRepository,
	githubIssues: boolean,
): string {
	const intro = `This repository belongs to the inBudget project${repo.projects.length > 1 ? "s" : ""} ${repo.projects.join(", ")}.`;
	if (repo.platform === "github") {
		return `Your name is nyrus, novu's coding agent. ${intro} Your work comes from GitHub issues in this repository: read the issue with \`gh issue view\`, and close it from your pull request (\`Closes #<number>\`).`;
	}
	if (repo.platform === "jira") {
		return `Your name is Nyrus, novu's coding agent. ${intro} Your work comes from Jira: use the mcp__jira__* tools (not Linear's) to read the issue${githubIssues ? " and download its attachments" : ", comment on it, attach your pull request and change its status"}.`;
	}
	return `Your name is nyrus, novu's coding agent. ${intro} Your work comes from ClickUp: use the mcp__clickup__* tools (not Linear's) to read the task${githubIssues ? " and download its attachments" : ", comment on it and change its status"}.`;
}

function registerRoutes(
	fastify: Parameters<TrackerIntegration["register"]>[0]["fastify"],
	sync: InbudgetSync,
	env: NodeJS.ProcessEnv,
	cyrusHome: string,
): void {
	const authorized = (request: FastifyRequest, reply: FastifyReply) => {
		const apiKey = env.CYRUS_API_KEY?.trim();
		const given = request.headers.authorization ?? "";
		const expected = `Bearer ${apiKey}`;
		if (
			!apiKey ||
			given.length !== expected.length ||
			!timingSafeEqual(Buffer.from(given), Buffer.from(expected))
		) {
			reply.code(401).send({ success: false, error: "Unauthorized" });
			return false;
		}
		return true;
	};
	fastify.get(INBUDGET_STATUS_PATH, async (request, reply) => {
		if (!authorized(request, reply)) return;
		reply.send({ success: true, data: { status: sync.getStatus() } });
	});
	fastify.post(`${INBUDGET_STATUS_PATH}/manual`, async (request, reply) => {
		if (!authorized(request, reply)) return;
		const body = (request.body ?? {}) as Record<string, unknown>;
		const repo = typeof body.repo === "string" ? body.repo.trim() : "";
		const platform = body.platform;
		const hasGroup =
			"group" in body &&
			(body.group === null || typeof body.group === "string");
		if (
			!/^[\w.-]+\/[\w.-]+$/.test(repo) ||
			(platform !== "jira" && platform !== "clickup" && !hasGroup) ||
			(platform !== undefined && platform !== "jira" && platform !== "clickup")
		) {
			reply.code(400).send({
				success: false,
				error:
					'repo (owner/name) and platform (jira or clickup) or group (name, "" or null) are required',
			});
			return;
		}
		if (hasGroup && platform === undefined) {
			const status = await Promise.race([
				sync.setGroup(repo, body.group as string | null),
				new Promise<undefined>((resolve) => {
					const timer = setTimeout(() => resolve(undefined), POST_WAIT_MS);
					timer.unref?.();
				}),
			]);
			reply.send({
				success: true,
				data: { status: status ?? sync.getStatus() },
			});
			return;
		}
		if (hasGroup) {
			writeGroup(cyrusHome, repo, body.group as string | null);
		}
		const list = (value: unknown) =>
			Array.isArray(value)
				? value.filter((v): v is string => typeof v === "string")
				: [];
		const running = sync.setManual(
			repo,
			platform as "jira" | "clickup",
			{ teamKeys: list(body.teamKeys), projectKeys: list(body.projectKeys) },
			typeof body.detached === "boolean" ? body.detached : undefined,
		);
		const status = await Promise.race([
			running,
			new Promise<undefined>((resolve) => {
				const timer = setTimeout(() => resolve(undefined), POST_WAIT_MS);
				timer.unref?.();
			}),
		]);
		reply.send({ success: true, data: { status: status ?? sync.getStatus() } });
	});
	fastify.post(INBUDGET_STATUS_PATH, async (request, reply) => {
		if (!authorized(request, reply)) return;
		const running = sync.sync();
		const status = await Promise.race([
			running,
			new Promise<undefined>((resolve) => {
				const timer = setTimeout(() => resolve(undefined), POST_WAIT_MS);
				timer.unref?.();
			}),
		]);
		reply.send({ success: true, data: { status: status ?? sync.getStatus() } });
	});
}
