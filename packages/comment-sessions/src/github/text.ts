import type { GitHubThread } from "./ThreadStore.js";

/**
 * Hidden marker in every GitHub comment nyrus writes, so its webhook is
 * never taken for a reply, whoever's token posted it. The agent is asked to
 * put it in comments it posts with `gh` too.
 */
export const OWN_MARKER = "<!-- nyrus -->";

export function marked(markdown: string): string {
	return `${markdown}\n\n${OWN_MARKER}`;
}

export function isMarked(body: string | null | undefined): boolean {
	return body?.includes(OWN_MARKER) ?? false;
}

/** A comment on the ticket, for the GitHub issue's history. */
export interface TicketComment {
	author: string;
	createdAt?: Date;
	/** Markdown */
	body: string;
}

/** What the GitHub issue's body is made of. */
export interface TicketDump {
	trackerName: string;
	identifier: string;
	title: string;
	url?: string;
	/** Markdown, as the agent gets it (with the list of attached files). */
	description?: string;
	fields: Array<[string, string | undefined]>;
	comments: TicketComment[];
}

export function githubIssueTitle(identifier: string, title: string): string {
	return `[${identifier}] ${title}`;
}

/** The GitHub issue's body: everything the ticket says, in one place. */
export function githubIssueBody(dump: TicketDump): string {
	const ref = dump.url
		? `[${dump.identifier}](${dump.url})`
		: `\`${dump.identifier}\``;
	const parts = [
		`> From ${dump.trackerName} ${ref}. nyrus works on this ticket here: its questions, progress and plan are comments on this issue, so **answer here**. The pull request that solves it closes this issue; ${dump.trackerName} only gets the result.`,
		`## Description\n\n${dump.description?.trim() || "_No description._"}`,
	];
	const fields = dump.fields.filter(([, value]) => value);
	if (fields.length > 0) {
		parts.push(
			`## Details\n\n${fields.map(([name, value]) => `- **${name}:** ${value}`).join("\n")}`,
		);
	}
	if (dump.comments.length > 0) {
		parts.push(
			`## Comments in ${dump.trackerName}\n\n${dump.comments
				.map(
					(c) =>
						`**${c.author}**${c.createdAt ? ` · ${c.createdAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}\n\n${quote(c.body)}`,
				)
				.join("\n\n")}`,
		);
	}
	return marked(parts.join("\n\n"));
}

/** Posted on the ticket once the GitHub issue exists. */
export function startNote(thread: GitHubThread): string {
	return `🔗 Working on this in GitHub: [${thread.repo}#${thread.number}](${thread.url}). Questions, progress and the plan are posted there, so please answer there. The result will be posted here.`;
}

/** The agent's answer (or error), as reported on the ticket. */
export function resultNote(thread: GitHubThread, markdown: string): string {
	return `${markdown}\n\n---\nDetails and discussion: [${thread.repo}#${thread.number}](${thread.url})`;
}

/** A comment from the ticket, copied to the GitHub issue. */
export function mirroredComment(
	trackerName: string,
	author: string,
	body: string,
	ticketUrl?: string,
): string {
	const where = ticketUrl ? `[${trackerName}](${ticketUrl})` : trackerName;
	return marked(`💬 **${author}** commented in ${where}:\n\n${quote(body)}`);
}

/**
 * What the agent is told about the GitHub issue and how to work the ticket:
 * clear everything up first, ask in the GitHub issue, and only start when it
 * knows it can solve it. Added to the ticket's description as the agent
 * sees it.
 */
export function workflowInstructions(
	thread: GitHubThread,
	trackerName: string,
): string {
	const issue = `${thread.repo}#${thread.number}`;
	const gh = `--repo ${thread.repo}`;
	return `<github_issue repository="${thread.repo}" number="${thread.number}" url="${thread.url}">
This ticket is worked in the GitHub issue ${issue} (${thread.url}). All discussion happens there: your questions, your progress and the answers you get. ${trackerName} only gets the final result, and nyrus posts it there for you.

How to work this ticket:
1. Clarify first. Before you change any file, read the GitHub issue with all its comments (\`gh issue view ${thread.number} ${gh} --comments\`), the ticket's attachments, and the code involved. Work out what has to change, how you will verify it, and whether you can do it.
2. Ask, don't guess. If anything you need is missing or ambiguous (expected behavior, acceptance criteria, edge cases, data, access, a decision only a person can make), ask with the AskUserQuestion tool: all open questions at once, each one concrete, with what you already found. Your questions are posted on the GitHub issue and the answers come back to you. Then check again, and ask again if something is still open.
3. Start only when you know what to build and that you can build it. Then post your understanding and plan on the GitHub issue: write it to a file that starts with the line \`${OWN_MARKER}\`, with a "## Plan" section (approach, files, how you will verify), and run \`gh issue comment ${thread.number} ${gh} --body-file <file>\`. Then implement it.
4. If the ticket can't or shouldn't be done, stop and explain why in your final answer instead of opening a pull request.
5. The pull request's body must contain \`Closes ${issue}\`, so that merging it closes the issue.
6. Don't comment on, link or move the ${trackerName} ticket yourself: nyrus reports the result there.
</github_issue>`;
}

/**
 * What the agent is told about a GitHub issue it works directly (no ticket
 * elsewhere): where the conversation is, to clear things up first, and that
 * its pull request closes the issue. Added to the issue's description as
 * the agent sees it.
 */
export function directIssueInstructions(issue: {
	repo: string;
	number: number;
	url: string;
}): string {
	const gh = `--repo ${issue.repo}`;
	return `<github_issue repository="${issue.repo}" number="${issue.number}" url="${issue.url}">
This is GitHub issue ${issue.repo}#${issue.number} (${issue.url}), and it is the whole ticket: there is no Linear, Jira or ClickUp issue for it. nyrus posts your questions, your progress and your final answer as comments on it, and replies there come back to you.

How to work this issue:
1. Clarify first. Before you change any file, read the issue with all its comments (\`gh issue view ${issue.number} ${gh} --comments\`) and the code involved. Work out what has to change, how you will verify it, and whether you can do it.
2. Ask, don't guess. If anything you need is missing or ambiguous, ask with the AskUserQuestion tool: all open questions at once, each one concrete. Your questions are posted on the issue and the answers come back to you.
3. Then implement it. If the issue can't or shouldn't be done, stop and explain why in your final answer instead of opening a pull request.
4. The pull request's body must contain \`Closes #${issue.number}\`, so that merging it closes this issue.
5. Don't comment on, label, assign or close the issue yourself: nyrus posts your answer there. If you must comment with \`gh\`, start the comment with the line \`${OWN_MARKER}\`.
</github_issue>`;
}

/**
 * The issues a pull request's body says it closes ("Closes #12",
 * "fixes owner/repo#12", or an issue URL), as `owner/name` and number.
 * `#12` means an issue of the pull request's own repository.
 */
export function closingReferences(
	body: string | null | undefined,
	repo: string,
): Array<{ repo: string; number: number }> {
	if (!body) return [];
	const refs: Array<{ repo: string; number: number }> = [];
	const pattern =
		/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?\s+(?:([\w.-]+\/[\w.-]+)?#(\d+)|https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+))/gi;
	for (const match of body.matchAll(pattern)) {
		const target = match[1] ?? match[3] ?? repo;
		const number = Number(match[2] ?? match[4]);
		if (
			number > 0 &&
			!refs.some(
				(r) =>
					r.number === number && r.repo.toLowerCase() === target.toLowerCase(),
			)
		) {
			refs.push({ repo: target, number });
		}
	}
	return refs;
}

function quote(text: string): string {
	return text
		.trim()
		.split(/\r?\n/)
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
}
