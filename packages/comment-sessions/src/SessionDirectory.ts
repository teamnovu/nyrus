import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** What Cyrus remembers about a comment session. */
export interface SessionRecord {
	sessionId: string;
	issueId: string;
	/** Comment that started the session (a mention); none for an assignment. */
	triggerCommentId?: string;
	/** The "working on it" comment, while there is one. */
	progressCommentId?: string;
	/** Option values of an open question, so a reply "2" can be resolved. */
	pendingOptions?: string[];
	createdAt: number;
}

/** Records older than this are dropped when the file is loaded. */
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Which sessions belong to which ticket. Linear and Plane hand out the
 * session id with every webhook; comment trackers don't, so Cyrus keeps the
 * ticket ↔ session mapping itself. It is saved to a JSON file (when given a
 * path) so follow-ups after a restart still reach the right session.
 */
export class SessionDirectory {
	private readonly records = new Map<string, SessionRecord>();

	constructor(
		private readonly prefix: string,
		private readonly filePath?: string,
		private readonly now: () => number = Date.now,
	) {
		this.load();
	}

	/** Start a new session on a ticket. */
	create(issueId: string, triggerCommentId?: string): SessionRecord {
		const record: SessionRecord = {
			sessionId: `${this.prefix}-${randomUUID()}`,
			issueId,
			...(triggerCommentId && { triggerCommentId }),
			createdAt: this.now(),
		};
		this.records.set(record.sessionId, record);
		this.save();
		return record;
	}

	get(sessionId: string): SessionRecord | undefined {
		return this.records.get(sessionId);
	}

	/** The ticket's most recently started session. */
	latestForIssue(issueId: string): SessionRecord | undefined {
		let latest: SessionRecord | undefined;
		for (const record of this.records.values()) {
			if (
				record.issueId === issueId &&
				(!latest || record.createdAt >= latest.createdAt)
			) {
				latest = record;
			}
		}
		return latest;
	}

	update(
		sessionId: string,
		changes: Partial<Omit<SessionRecord, "sessionId" | "issueId">>,
	): void {
		const record = this.records.get(sessionId);
		if (!record) return;
		for (const [key, value] of Object.entries(changes)) {
			if (value === undefined) {
				delete record[key as keyof SessionRecord];
			} else {
				(record as unknown as Record<string, unknown>)[key] = value;
			}
		}
		this.save();
	}

	private load(): void {
		if (!this.filePath) return;
		let saved: SessionRecord[];
		try {
			saved = JSON.parse(readFileSync(this.filePath, "utf8"));
		} catch {
			return; // no file yet, or unreadable: start empty
		}
		const cutoff = this.now() - RETENTION_MS;
		for (const record of saved) {
			if (record?.sessionId && record.issueId && record.createdAt >= cutoff) {
				this.records.set(record.sessionId, record);
			}
		}
	}

	private save(): void {
		if (!this.filePath) return;
		mkdirSync(dirname(this.filePath), { recursive: true });
		const tmp = `${this.filePath}.tmp`;
		writeFileSync(tmp, JSON.stringify([...this.records.values()], null, 2), {
			mode: 0o600,
		});
		renameSync(tmp, this.filePath);
	}
}
