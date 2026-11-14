import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ILogger } from "cyrus-core";
import {
	isSigned,
	type JiraApiClient,
	type JiraIssue,
} from "cyrus-jira-event-transport";
import { TRIAGE_HEADING, triageComment } from "./comment.js";
import {
	type Classifier,
	type TriageOptions,
	type TriageResult,
	type TriageSource,
	type TriageTicket,
	triage,
} from "./Triage.js";

/** The store keeps the newest this many tickets. */
const MAX_STORED = 5_000;

export interface TriageServiceOptions {
	jira: Pick<
		JiraApiClient,
		| "getIssue"
		| "listComments"
		| "createInternalComment"
		| "findUserByEmail"
		| "assignIssue"
	>;
	source: TriageSource;
	classify?: Classifier;
	triage: TriageOptions;
	/** Jira project keys whose tickets are triaged, e.g. ["NOV"]. */
	projectKeys: Set<string>;
	/** Assign the ticket to the first suggested person. */
	assign: boolean;
	/** Senders (substrings of the email, lower case) that are never triaged. */
	ignoredSenders: string[];
	/** Where triaged tickets are remembered; undefined keeps them in memory. */
	cyrusHome?: string;
	logger: ILogger;
}

export type TriageOutcome =
	| {
			status: "triaged";
			result: TriageResult;
			comment: string;
			assigned: boolean;
	  }
	| { status: "skipped"; reason: string };

/** Triage one Jira ticket: read it, triage it, comment (and assign). */
export class TriageService {
	private readonly done: Map<string, string>;
	private readonly storePath?: string;

	constructor(private readonly options: TriageServiceOptions) {
		this.storePath = options.cyrusHome
			? join(options.cyrusHome, "servicedesk-triage.json")
			: undefined;
		this.done = this.load();
	}

	/**
	 * `dryRun` triages without commenting, assigning or remembering it;
	 * `force` triages again a ticket that is assigned or was triaged.
	 */
	async handle(
		issueKey: string,
		flags: { dryRun?: boolean; force?: boolean } = {},
	): Promise<TriageOutcome> {
		const { jira, logger } = this.options;
		const issue = await jira.getIssue(issueKey);
		const key = issue.key;
		const projectKey = issue.fields.project?.key ?? key.split("-")[0] ?? "";
		if (!this.options.projectKeys.has(projectKey.toUpperCase())) {
			return {
				status: "skipped",
				reason: `project ${projectKey} is not triaged`,
			};
		}
		if (!flags.force) {
			if (issue.fields.assignee) {
				return { status: "skipped", reason: "already assigned" };
			}
			if (this.done.has(key)) {
				return { status: "skipped", reason: "already triaged" };
			}
			const comments = await jira.listComments(key);
			if (
				comments.some(
					(c) => isSigned(c.body) && c.body?.includes(TRIAGE_HEADING),
				)
			) {
				this.remember(key);
				return { status: "skipped", reason: "already triaged" };
			}
		}
		const ticket = toTicket(issue);
		const sender = ticket.senderEmail?.toLowerCase() ?? "";
		const ignored = this.options.ignoredSenders.find(
			(pattern) => sender !== "" && sender.includes(pattern),
		);
		if (ignored) {
			if (!flags.dryRun) this.remember(key);
			return { status: "skipped", reason: `sender matches "${ignored}"` };
		}

		const result = await triage(
			ticket,
			this.options.source,
			this.options.classify,
			this.options.triage,
		);
		let assigned = false;
		let assignProblem: string | undefined;
		const first = result.people[0];
		if (this.options.assign && first && !flags.dryRun) {
			const user = first.email
				? await jira.findUserByEmail(first.email).catch(() => undefined)
				: undefined;
			if (!user) {
				assignProblem = `${first.name} in Jira nicht gefunden`;
			} else {
				try {
					await jira.assignIssue(key, user.accountId);
					assigned = true;
				} catch (error) {
					logger.warn(`Triage ${key}: assigning ${first.name} failed`, error);
					assignProblem = `${first.name} kann in diesem Projekt keine Tickets übernehmen`;
				}
			}
		}
		const comment = triageComment(result, { assigned, assignProblem });
		if (!flags.dryRun) {
			await jira.createInternalComment(key, comment);
			this.remember(key);
		}
		logger.info(
			`Triage ${key}${flags.dryRun ? " (dry run)" : ""}: ${result.project?.name ?? (result.clients.map((c) => c.name).join(", ") || "-")} → ${first?.name ?? "nobody"}${assigned ? " (assigned)" : ""}`,
		);
		return { status: "triaged", result, comment, assigned };
	}

	private remember(key: string): void {
		this.done.set(key, new Date().toISOString());
		while (this.done.size > MAX_STORED) {
			const oldest = this.done.keys().next().value;
			if (oldest === undefined) break;
			this.done.delete(oldest);
		}
		if (!this.storePath) return;
		try {
			writeFileSync(
				this.storePath,
				`${JSON.stringify({ triaged: Object.fromEntries(this.done) }, null, 2)}\n`,
			);
		} catch (error) {
			this.options.logger.warn("Could not save the triage store", error);
		}
	}

	private load(): Map<string, string> {
		if (!this.storePath || !existsSync(this.storePath)) return new Map();
		try {
			const data = JSON.parse(readFileSync(this.storePath, "utf8")) as {
				triaged?: Record<string, string>;
			};
			return new Map(Object.entries(data.triaged ?? {}));
		} catch (error) {
			this.options.logger.warn("Could not read the triage store", error);
			return new Map();
		}
	}
}

/**
 * The ticket as triage sees it. Jira shows a customer's email only when its
 * profile allows it; customers created from an email are named by it.
 */
export function toTicket(issue: JiraIssue): TriageTicket {
	const reporter = issue.fields.reporter ?? undefined;
	const name = reporter?.displayName?.trim();
	const email =
		reporter?.emailAddress?.trim() ||
		(name && EMAIL.test(name) ? name : undefined);
	return {
		key: issue.key,
		summary: issue.fields.summary ?? "",
		description: issue.fields.description ?? undefined,
		senderEmail: email?.toLowerCase(),
		senderName: name,
	};
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
