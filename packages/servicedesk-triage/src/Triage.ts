/**
 * Triage of an incoming service desk ticket: which inBudget project it is
 * about, and who has worked on that project the most. Pure logic; inBudget
 * and Claude come in through {@link TriageSource} and {@link Classifier}.
 */

export interface TriageTicket {
	key: string;
	summary: string;
	description?: string;
	/** The sender's email, if Jira shows it. */
	senderEmail?: string;
	senderName?: string;
}

export interface TriageClient {
	id: string;
	name: string;
}

export interface TriageProject {
	id: string;
	name: string;
	nr?: string;
	client: TriageClient;
	lastWorkHourAt?: string;
}

/** Hours one person booked on a project. */
export interface PersonHours {
	userId: string;
	name: string;
	hours: number;
}

export interface TriagePerson {
	userId: string;
	name: string;
	email?: string;
	hours: number;
}

/** What triage needs from inBudget. */
export interface TriageSource {
	/** Clients of the contacts (people) with exactly this email. */
	clientsByEmail(email: string): Promise<TriageClient[]>;
	/** Clients with a resource (website) on this domain or a subdomain of it. */
	clientsByDomain(domain: string): Promise<TriageClient[]>;
	/** Active (not archived), non-internal projects. */
	activeProjects(): Promise<TriageProject[]>;
	/** Hours per person on a project; `since` undefined means all time. */
	hoursByPerson(projectId: string, since?: Date): Promise<PersonHours[]>;
	/** Enabled inBudget users with their email; disabled users are left out. */
	activeUsers(): Promise<Map<string, { email?: string; name: string }>>;
}

/** One option for Claude to pick, by id. */
export interface ClassifierOption {
	id: string;
	label: string;
}

/**
 * Picks the option the ticket is about, or undefined when it can't tell.
 * `question` says what is picked ("customer", "project").
 */
export type Classifier = (
	ticket: TriageTicket,
	question: "customer" | "project",
	options: ClassifierOption[],
) => Promise<string | undefined>;

export type MatchMethod = "email" | "domain" | "claude" | "none";

export interface TriageResult {
	ticketKey: string;
	/** How the customer was found. */
	match: MatchMethod;
	/** e.g. "Absender-Domain zoo.ch" */
	matchDetail?: string;
	clients: TriageClient[];
	/** The project, when one was settled on. */
	project?: TriageProject;
	/** The client's active projects; several when the project stayed open. */
	candidates: TriageProject[];
	/** The project was chosen by Claude among several. */
	projectByClaude: boolean;
	/** Most hours first, at most `maxPeople`. */
	people: TriagePerson[];
	/** Months the hours cover, or "all" when the recent window was empty. */
	hoursWindow: number | "all";
}

export interface TriageOptions {
	/** Domains that never identify a customer (novu's own, free mail). */
	ignoredDomains: Set<string>;
	/** Count hours of the last N months; 0 for all time. */
	hoursMonths: number;
	maxPeople: number;
	now?: () => Date;
}

export const FREE_MAIL_DOMAINS = [
	"gmail.com",
	"googlemail.com",
	"gmx.ch",
	"gmx.net",
	"gmx.de",
	"bluewin.ch",
	"hotmail.com",
	"hotmail.ch",
	"outlook.com",
	"live.com",
	"icloud.com",
	"me.com",
	"yahoo.com",
	"yahoo.de",
	"sunrise.ch",
	"hispeed.ch",
	"swissonline.ch",
	"protonmail.com",
	"proton.me",
	"web.de",
	"t-online.de",
];

export async function triage(
	ticket: TriageTicket,
	source: TriageSource,
	classify: Classifier | undefined,
	options: TriageOptions,
): Promise<TriageResult> {
	const result: TriageResult = {
		ticketKey: ticket.key,
		match: "none",
		clients: [],
		candidates: [],
		projectByClaude: false,
		people: [],
		hoursWindow: options.hoursMonths > 0 ? options.hoursMonths : "all",
	};
	const projects = await source.activeProjects();

	// 1. The customer: by the sender's exact email, then by their domain.
	const email = ticket.senderEmail?.trim().toLowerCase();
	if (email) {
		const clients = await source.clientsByEmail(email);
		if (clients.length > 0) {
			result.match = "email";
			result.matchDetail = `Kontakt ${email}`;
			result.clients = clients;
		}
	}
	const domain = email ? domainOf(email) : undefined;
	if (
		result.clients.length === 0 &&
		domain &&
		!options.ignoredDomains.has(domain)
	) {
		const clients = await source.clientsByDomain(domain);
		if (clients.length > 0) {
			result.match = "domain";
			result.matchDetail = `Absender-Domain ${domain}`;
			result.clients = clients;
		}
	}
	// 2. Not found that way: Claude reads the ticket and picks a customer.
	if (result.clients.length === 0 && classify) {
		const byId = new Map<string, TriageClient>();
		for (const project of projects) byId.set(project.client.id, project.client);
		const picked = await classify(
			ticket,
			"customer",
			[...byId.values()]
				.sort((a, b) => a.name.localeCompare(b.name))
				.map((client) => ({ id: client.id, label: client.name })),
		);
		const client = picked ? byId.get(picked) : undefined;
		if (client) {
			result.match = "claude";
			result.matchDetail = "Ticket-Text (Claude)";
			result.clients = [client];
		}
	}
	if (result.clients.length === 0) return result;

	// 3. The project among the customer's active projects.
	const clientIds = new Set(result.clients.map((c) => c.id));
	result.candidates = projects
		.filter((p) => clientIds.has(p.client.id))
		.sort(byRecentWork);
	if (result.candidates.length === 1) {
		result.project = result.candidates[0];
	} else if (result.candidates.length > 1 && classify) {
		const picked = await classify(
			ticket,
			"project",
			result.candidates.map((p) => ({ id: p.id, label: projectLabel(p) })),
		);
		result.project = result.candidates.find((p) => p.id === picked);
		result.projectByClaude = Boolean(result.project);
	}
	if (result.candidates.length === 0) return result;

	// 4. Who worked on it most: on the project, or on all the customer's
	// projects when the project stayed open.
	const counted = result.project ? [result.project] : result.candidates;
	const since =
		options.hoursMonths > 0
			? monthsBefore((options.now ?? (() => new Date()))(), options.hoursMonths)
			: undefined;
	let hours = await sumHours(source, counted, since);
	if (hours.size === 0 && since) {
		hours = await sumHours(source, counted, undefined);
		result.hoursWindow = "all";
	}
	const users = await source.activeUsers();
	result.people = [...hours.values()]
		.filter((person) => person.hours > 0 && users.has(person.userId))
		.sort((a, b) => b.hours - a.hours)
		.slice(0, options.maxPeople)
		.map((person) => {
			const user = users.get(person.userId);
			return {
				...person,
				name: user?.name || person.name,
				email: user?.email,
			};
		});
	return result;
}

async function sumHours(
	source: TriageSource,
	projects: TriageProject[],
	since: Date | undefined,
): Promise<Map<string, PersonHours>> {
	const total = new Map<string, PersonHours>();
	for (const project of projects) {
		for (const person of await source.hoursByPerson(project.id, since)) {
			const sum = total.get(person.userId);
			if (sum) sum.hours += person.hours;
			else total.set(person.userId, { ...person });
		}
	}
	return total;
}

export function projectLabel(project: TriageProject): string {
	return [project.nr, project.name].filter(Boolean).join(" ");
}

/** `anna@mail.zoo.ch` → `mail.zoo.ch` (lower case). */
export function domainOf(email: string): string | undefined {
	const at = email.lastIndexOf("@");
	const domain =
		at >= 0
			? email
					.slice(at + 1)
					.trim()
					.toLowerCase()
			: "";
	return domain.includes(".") ? domain : undefined;
}

/**
 * Whether a resource's domain belongs to the sender's domain: the same
 * domain, one a subdomain of the other (`www.zoo.ch` / `mail.zoo.ch`).
 */
export function sameSite(senderDomain: string, resourceHost: string): boolean {
	const a = stripWww(senderDomain);
	const b = stripWww(resourceHost);
	if (!a || !b) return false;
	return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** `https://www.zoo.ch/path` or `www.zoo.ch` → `zoo.ch` */
export function hostOf(value: string | null | undefined): string | undefined {
	const text = value?.trim().toLowerCase();
	if (!text) return undefined;
	try {
		return stripWww(
			new URL(text.includes("://") ? text : `https://${text}`).hostname,
		);
	} catch {
		return undefined;
	}
}

function stripWww(host: string): string {
	return host
		.trim()
		.toLowerCase()
		.replace(/^www\./, "")
		.replace(/\.$/, "");
}

function monthsBefore(date: Date, months: number): Date {
	const result = new Date(date);
	result.setMonth(result.getMonth() - months);
	return result;
}

function byRecentWork(a: TriageProject, b: TriageProject): number {
	return (b.lastWorkHourAt ?? "").localeCompare(a.lastWorkHourAt ?? "");
}
