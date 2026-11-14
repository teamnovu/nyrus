import { signed } from "cyrus-jira-event-transport";
import { projectLabel, type TriageResult } from "./Triage.js";

/** The heading of a triage comment; also how an earlier one is recognized. */
export const TRIAGE_HEADING = "Triage-Vorschlag";

export interface CommentContext {
	/** The ticket was assigned to the first suggested person. */
	assigned: boolean;
	/** Assigning was on but didn't happen: why. */
	assignProblem?: string;
}

/** The internal comment for a triage result, in Jira wiki markup. */
export function triageComment(
	result: TriageResult,
	context: CommentContext,
): string {
	const lines = [`*${TRIAGE_HEADING}*`];
	const clientNames = result.clients.map((c) => c.name).join(", ");
	if (result.clients.length === 0) {
		lines.push(
			"Kunde nicht erkannt: weder Absender noch Ticket-Text passen zu einem Kunden in inBudget.",
		);
		return signed(lines.join("\n"));
	}
	const via = result.matchDetail ? ` (erkannt über ${result.matchDetail})` : "";
	lines.push(`*Kunde:* ${clientNames}${via}`);

	if (result.project) {
		const how = result.projectByClaude
			? ` (von ${result.candidates.length} aktiven Projekten, gewählt nach Ticket-Text)`
			: "";
		lines.push(`*Projekt:* ${projectLabel(result.project)}${how}`);
	} else if (result.candidates.length === 0) {
		lines.push("*Projekt:* keines aktiv in inBudget");
	} else {
		lines.push(
			`*Projekt:* nicht eindeutig, aktive Projekte: ${result.candidates
				.slice(0, 8)
				.map(projectLabel)
				.join(", ")}${result.candidates.length > 8 ? ", …" : ""}`,
		);
	}

	if (result.people.length === 0) {
		if (result.candidates.length > 0) {
			lines.push("*Bearbeitung:* keine gebuchten Stunden gefunden");
		}
		return signed(lines.join("\n"));
	}
	const window =
		result.hoursWindow === "all"
			? "insgesamt"
			: `in den letzten ${result.hoursWindow} Monaten`;
	const scope = result.project
		? "auf dem Projekt"
		: "auf den Projekten des Kunden";
	const [first, ...others] = result.people;
	const suggestion = `${first!.name} (${hours(first!.hours)})`;
	lines.push(
		context.assigned
			? `*Zugewiesen an:* ${suggestion}`
			: `*Vorschlag Bearbeitung:* ${suggestion}`,
	);
	if (others.length > 0) {
		lines.push(
			`*Weitere:* ${others.map((p) => `${p.name} (${hours(p.hours)})`).join(", ")}`,
		);
	}
	lines.push(`_Gebuchte Stunden ${scope} ${window}, aus inBudget._`);
	if (context.assignProblem) {
		lines.push(`_Nicht zugewiesen: ${context.assignProblem}._`);
	}
	return signed(lines.join("\n"));
}

function hours(value: number): string {
	return `${Math.round(value * 10) / 10} h`;
}
