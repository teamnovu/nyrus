/** The session of a ticket: one per ticket, so comments continue it after a restart too. */
export function sessionIdFor(platform: string, issueId: string): string {
	return `${platform}-${issueId}`;
}

/** The ticket of a session id made by {@link sessionIdFor}, or undefined. */
export function issueIdFromSessionId(
	platform: string,
	sessionId: string,
): string | undefined {
	const prefix = `${platform}-`;
	return sessionId.startsWith(prefix) && sessionId.length > prefix.length
		? sessionId.slice(prefix.length)
		: undefined;
}

export interface QuestionOption {
	value: string;
	label?: string;
}

/** How many own comment ids to remember; their webhooks come within minutes. */
const MAX_OWN_COMMENTS = 5000;

/**
 * What the coordinator and the publisher share, in memory: the comments the
 * agent posted (so their webhooks are ignored), the options of questions
 * waiting for an answer (so a reply "2" can be resolved), and the comment
 * that started each conversational session.
 */
export class SessionStore {
	private readonly ownComments = new Set<string>();
	private readonly questions = new Map<string, QuestionOption[]>();
	private readonly startComments = new Map<
		string,
		{ id: string; body: string }
	>();

	/**
	 * The comment that started a session (a mention). Linear sends it with
	 * every webhook of the session, and the edge worker reads it from there,
	 * e.g. after the user picked a repository.
	 */
	setStartComment(sessionId: string, comment: { id: string; body: string }) {
		this.startComments.set(sessionId, comment);
	}

	startComment(sessionId: string): { id: string; body: string } | undefined {
		return this.startComments.get(sessionId);
	}

	rememberOwnComment(commentId: string): void {
		this.ownComments.add(commentId);
		if (this.ownComments.size > MAX_OWN_COMMENTS) {
			const oldest = this.ownComments.values().next().value;
			if (oldest !== undefined) this.ownComments.delete(oldest);
		}
	}

	isOwnComment(commentId: string): boolean {
		return this.ownComments.has(commentId);
	}

	setQuestion(sessionId: string, options: QuestionOption[]): void {
		if (options.length > 0) this.questions.set(sessionId, options);
		else this.questions.delete(sessionId);
	}

	/**
	 * Resolve a reply to the session's open question: "2" or "2." is the
	 * second option, the label of an option is its value. Anything else is
	 * passed on as written. The question is closed either way.
	 */
	resolveAnswer(sessionId: string, reply: string): string {
		const options = this.questions.get(sessionId);
		if (!options) return reply;
		this.questions.delete(sessionId);
		const text = reply.trim();
		const number = /^(\d+)[.)]?$/.exec(text);
		if (number) {
			return options[Number(number[1]) - 1]?.value ?? reply;
		}
		const byLabel = options.find(
			(o) => o.label?.toLowerCase() === text.toLowerCase(),
		);
		return byLabel?.value ?? reply;
	}
}
