import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** A ticket and the GitHub issue it is worked in. */
export interface GitHubThread {
	/** The tracker workspace (e.g. `jira-novu`). */
	workspaceKey: string;
	/** The ticket's id in the tracker (the Linear-shaped issue id). */
	issueId: string;
	/** The ticket's key, e.g. `SAY-12` or `CU-abc`. */
	identifier: string;
	/** The ticket's URL in the tracker. */
	issueUrl?: string;
	repositoryId: string;
	/** `owner/name` */
	repo: string;
	number: number;
	url: string;
	createdAt: string;
	/** Pull requests that close the issue, by URL. */
	pullRequests: string[];
	/** Last stage reported on the ticket. */
	stage?: "review" | "done";
}

/**
 * Which ticket is worked in which GitHub issue, kept in a JSON file so
 * answers on GitHub still reach the ticket's session after a restart.
 */
export class ThreadStore {
	private threads: GitHubThread[] = [];

	/** Without a file, the store only lives in memory (tests). */
	constructor(private readonly file?: string) {
		if (!file) return;
		try {
			const data = JSON.parse(readFileSync(file, "utf8")) as {
				threads?: GitHubThread[];
			};
			this.threads = Array.isArray(data.threads) ? data.threads : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	/** The thread of a ticket, by its id or key. */
	forTicket(workspaceKey: string, idOrKey: string): GitHubThread | undefined {
		return this.threads.find(
			(t) =>
				t.workspaceKey === workspaceKey &&
				(t.issueId === idOrKey ||
					t.identifier.toLowerCase() === idOrKey.toLowerCase()),
		);
	}

	forGitHubIssue(repo: string, number: number): GitHubThread | undefined {
		const name = repo.toLowerCase();
		return this.threads.find(
			(t) => t.repo.toLowerCase() === name && t.number === number,
		);
	}

	/** Threads in a repository, e.g. to match a pull request's branch. */
	inRepo(repo: string): GitHubThread[] {
		const name = repo.toLowerCase();
		return this.threads.filter((t) => t.repo.toLowerCase() === name);
	}

	/** Add or replace a thread (by ticket) and write the file. */
	save(thread: GitHubThread): void {
		const index = this.threads.findIndex(
			(t) =>
				t.workspaceKey === thread.workspaceKey && t.issueId === thread.issueId,
		);
		if (index >= 0) this.threads[index] = thread;
		else this.threads.push(thread);
		this.write();
	}

	private write(): void {
		if (!this.file) return;
		mkdirSync(dirname(this.file), { recursive: true });
		const tmp = `${this.file}.tmp`;
		writeFileSync(
			tmp,
			`${JSON.stringify({ version: 1, threads: this.threads }, null, 2)}\n`,
		);
		renameSync(tmp, this.file);
	}
}
