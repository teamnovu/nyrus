import type { ILogger } from "cyrus-core";
import { InbudgetClient } from "cyrus-inbudget-sync";
import type { JiraIssue } from "cyrus-jira-event-transport";
import { describe, expect, it, vi } from "vitest";
import {
	type Classifier,
	customerLabel,
	InbudgetTriageSource,
	newIssueKey,
	type PersonHours,
	type TriageOptions,
	type TriageProject,
	TriageService,
	type TriageSource,
	toTicket,
	triage,
	triageComment,
} from "../src/index.js";

const logger: ILogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
} as unknown as ILogger;

const zoo = { id: "1", name: "Zoo Zürich" };
const siba = { id: "2", name: "SIBA" };
const projects: TriageProject[] = [
	{
		id: "10",
		name: "Website",
		nr: "P-10",
		client: zoo,
		lastWorkHourAt: "2026-11-01",
	},
	{
		id: "11",
		name: "Shop",
		nr: "P-11",
		client: zoo,
		lastWorkHourAt: "2026-10-01",
	},
	{ id: "20", name: "Ombudsstelle", client: siba },
];

function fakeSource(
	hours: Record<string, PersonHours[]>,
	recent = true,
): TriageSource & {
	sinces: (Date | undefined)[];
} {
	const sinces: (Date | undefined)[] = [];
	return {
		sinces,
		clientsByEmail: async (email) =>
			email === "decurtins@zoo.ch" ? [zoo] : [],
		clientsByDomain: async (domain) =>
			domain === "siba.ch" ? [siba] : domain === "zoo.ch" ? [zoo] : [],
		activeProjects: async () => projects,
		hoursByPerson: async (projectId, since) => {
			sinces.push(since);
			return since && !recent ? [] : (hours[projectId] ?? []);
		},
		activeUsers: async () =>
			new Map([
				["u1", { name: "Anna Muster", email: "anna@novu.ch" }],
				["u2", { name: "Marco Rossi", email: "marco@novu.ch" }],
				["u3", { name: "Lea Meier", email: "lea@novu.ch" }],
			]),
	};
}

const options: TriageOptions = {
	ignoredDomains: new Set(["novu.ch", "gmail.com"]),
	hoursMonths: 12,
	maxPeople: 3,
	now: () => new Date("2026-11-14T10:00:00Z"),
};

const ticket = (senderEmail?: string) => ({
	key: "NOV-1",
	summary: "Anfrage Sponsoren-Logos",
	description: "Bitte Logos auf der Homepage tauschen",
	senderEmail,
});

describe("triage", () => {
	it("finds the customer by the contact's email and ranks people by hours on its one project", async () => {
		const source = fakeSource({
			20: [
				{ userId: "u2", name: "Marco", hours: 5 },
				{ userId: "u1", name: "Anna", hours: 40.25 },
				{ userId: "gone", name: "Left the company", hours: 99 },
			],
		});
		const result = await triage(
			ticket("x@siba.ch"),
			source,
			undefined,
			options,
		);
		expect(result.match).toBe("domain");
		expect(result.matchDetail).toBe("Absender-Domain siba.ch");
		expect(result.project?.id).toBe("20");
		expect(result.people).toEqual([
			{
				userId: "u1",
				name: "Anna Muster",
				email: "anna@novu.ch",
				hours: 40.25,
			},
			{ userId: "u2", name: "Marco Rossi", email: "marco@novu.ch", hours: 5 },
		]);
		expect(source.sinces[0]?.toISOString().slice(0, 10)).toBe("2025-11-14");
	});

	it("lets Claude pick among the customer's projects", async () => {
		const classify = vi.fn<Classifier>(async () => "11");
		const result = await triage(
			ticket("decurtins@zoo.ch"),
			fakeSource({ 11: [{ userId: "u3", name: "Lea", hours: 3 }] }),
			classify,
			options,
		);
		expect(result.match).toBe("email");
		expect(classify).toHaveBeenCalledWith(expect.anything(), "project", [
			{ id: "10", label: "P-10 Website" },
			{ id: "11", label: "P-11 Shop" },
		]);
		expect(result.project?.id).toBe("11");
		expect(result.projectByClaude).toBe(true);
		expect(result.people.map((p) => p.userId)).toEqual(["u3"]);
	});

	it("sums hours over all the customer's projects when the project stays open", async () => {
		const result = await triage(
			ticket("decurtins@zoo.ch"),
			fakeSource({
				10: [{ userId: "u1", name: "Anna", hours: 4 }],
				11: [
					{ userId: "u2", name: "Marco", hours: 3 },
					{ userId: "u1", name: "Anna", hours: 1 },
				],
			}),
			async () => undefined,
			options,
		);
		expect(result.project).toBeUndefined();
		expect(result.candidates).toHaveLength(2);
		expect(result.people.map((p) => [p.userId, p.hours])).toEqual([
			["u1", 5],
			["u2", 3],
		]);
	});

	it("never matches novu's own or free-mail domains, and asks Claude for the customer instead", async () => {
		const classify = vi.fn<Classifier>(async (_t, question) =>
			question === "customer" ? "2" : undefined,
		);
		const source = fakeSource({
			20: [{ userId: "u1", name: "Anna", hours: 1 }],
		});
		const clientsByDomain = vi.spyOn(source, "clientsByDomain");
		const result = await triage(
			ticket("meryem@novu.ch"),
			source,
			classify,
			options,
		);
		expect(clientsByDomain).not.toHaveBeenCalled();
		expect(classify.mock.calls[0]?.[1]).toBe("customer");
		expect(classify.mock.calls[0]?.[2]).toEqual([
			{ id: "2", label: "SIBA (projects: Ombudsstelle)" },
			{ id: "1", label: "Zoo Zürich (projects: Website, Shop)" },
		]);
		expect(result.match).toBe("claude");
		expect(result.project?.id).toBe("20");
	});

	it("falls back to all-time hours when nobody booked in the window", async () => {
		const source = fakeSource(
			{ 20: [{ userId: "u1", name: "Anna", hours: 2 }] },
			false,
		);
		const result = await triage(
			ticket("x@siba.ch"),
			source,
			undefined,
			options,
		);
		expect(result.hoursWindow).toBe("all");
		expect(result.people.map((p) => p.userId)).toEqual(["u1"]);
		expect(source.sinces).toEqual([expect.any(Date), undefined]);
	});

	it("reports no customer without a match and without Claude", async () => {
		const result = await triage(
			ticket("someone@gmail.com"),
			fakeSource({}),
			undefined,
			options,
		);
		expect(result.match).toBe("none");
		expect(result.clients).toEqual([]);
	});
});

describe("customerLabel", () => {
	it("lists the project names, cut after about 200 characters", () => {
		const client = { id: "540", name: "Lumina Marketing & Branding" };
		expect(customerLabel(client, [])).toBe("Lumina Marketing & Branding");
		expect(
			customerLabel(client, ["the-clinic.ch Support novu", "neuro-uro.ch"]),
		).toBe(
			"Lumina Marketing & Branding (projects: the-clinic.ch Support novu, neuro-uro.ch)",
		);
		const label = customerLabel(
			client,
			Array.from({ length: 30 }, (_, i) => `project-${i}.ch`),
		);
		expect(label.endsWith(", …)")).toBe(true);
		expect(label.length).toBeLessThan(260);
	});
});

describe("triageComment", () => {
	it("names customer, project and people as an internal note", async () => {
		const result = await triage(
			ticket("x@siba.ch"),
			fakeSource({
				20: [
					{ userId: "u1", name: "Anna", hours: 40.25 },
					{ userId: "u2", name: "Marco", hours: 5 },
				],
			}),
			undefined,
			options,
		);
		expect(triageComment(result, { assigned: false })).toBe(
			[
				"🤖 *Nyrus*",
				"*Triage-Vorschlag*",
				"*Kunde:* SIBA (erkannt über Absender-Domain siba.ch)",
				"*Projekt:* Ombudsstelle",
				"*Vorschlag Bearbeitung:* Anna Muster (40.3 h)",
				"*Weitere:* Marco Rossi (5 h)",
				"_Gebuchte Stunden auf dem Projekt in den letzten 12 Monaten, aus inBudget._",
			].join("\n"),
		);
	});
});

function issue(
	overrides: Partial<JiraIssue["fields"]> = {},
	key = "NOV-9019",
): JiraIssue {
	return {
		id: "1",
		key,
		fields: {
			summary: "Anfrage Sponsoren-Logos - Homepage",
			description: "Hallo",
			project: { id: "1", key: key.split("-")[0]!, name: "novu Support" },
			reporter: { accountId: "qm:1", displayName: "x@siba.ch" },
			assignee: null,
			created: "2026-11-12",
			updated: "2026-11-12",
			...overrides,
		} as JiraIssue["fields"],
	};
}

function fakeJira(current: JiraIssue) {
	return {
		getIssue: vi.fn(async () => current),
		listComments: vi.fn(
			async () =>
				[] as { id: string; body?: string; created: string; updated: string }[],
		),
		createInternalComment: vi.fn(async () => ({
			id: "c1",
			created: "",
			updated: "",
		})),
		findUserByEmail: vi.fn(async (email: string) =>
			email === "anna@novu.ch" ? { accountId: "acc-anna" } : undefined,
		),
		assignIssue: vi.fn(async () => {}),
	};
}

function service(jira: ReturnType<typeof fakeJira>, assign = false) {
	return new TriageService({
		jira,
		source: fakeSource({ 20: [{ userId: "u1", name: "Anna", hours: 8 }] }),
		triage: options,
		projectKeys: new Set(["NOV"]),
		assign,
		ignoredSenders: ["noreply"],
		logger,
	});
}

describe("TriageService", () => {
	it("posts an internal comment once per ticket", async () => {
		const jira = fakeJira(issue());
		const triager = service(jira);
		const outcome = await triager.handle("NOV-9019");
		expect(outcome.status).toBe("triaged");
		expect(jira.createInternalComment).toHaveBeenCalledWith(
			"NOV-9019",
			expect.stringContaining("*Vorschlag Bearbeitung:* Anna Muster (8 h)"),
		);
		expect(jira.assignIssue).not.toHaveBeenCalled();
		expect(await triager.handle("NOV-9019")).toEqual({
			status: "skipped",
			reason: "already triaged",
		});
	});

	it("assigns the first person with TRIAGE_ASSIGN", async () => {
		const jira = fakeJira(issue());
		const outcome = await service(jira, true).handle("NOV-9019");
		expect(jira.assignIssue).toHaveBeenCalledWith("NOV-9019", "acc-anna");
		expect(outcome.status === "triaged" && outcome.comment).toContain(
			"*Zugewiesen an:* Anna Muster (8 h)",
		);
	});

	it("dry run comments nothing and remembers nothing", async () => {
		const jira = fakeJira(issue());
		const triager = service(jira, true);
		const outcome = await triager.handle("NOV-9019", { dryRun: true });
		expect(outcome.status).toBe("triaged");
		expect(jira.createInternalComment).not.toHaveBeenCalled();
		expect(jira.assignIssue).not.toHaveBeenCalled();
		expect((await triager.handle("NOV-9019")).status).toBe("triaged");
	});

	it("skips assigned tickets, other projects, ignored senders and earlier triage comments", async () => {
		expect(
			await service(fakeJira(issue({ assignee: { accountId: "a" } }))).handle(
				"NOV-1",
			),
		).toEqual({ status: "skipped", reason: "already assigned" });
		expect(await service(fakeJira(issue({}, "SAY-1"))).handle("SAY-1")).toEqual(
			{
				status: "skipped",
				reason: "project SAY is not triaged",
			},
		);
		expect(
			await service(
				fakeJira(
					issue({
						reporter: { accountId: "q", displayName: "noreply@google.com" },
					}),
				),
			).handle("NOV-1"),
		).toEqual({ status: "skipped", reason: 'sender matches "noreply"' });
		const jira = fakeJira(issue());
		jira.listComments.mockResolvedValue([
			{
				id: "1",
				body: "🤖 *Nyrus*\n*Triage-Vorschlag*\n…",
				created: "",
				updated: "",
			},
		]);
		expect(await service(jira).handle("NOV-1")).toEqual({
			status: "skipped",
			reason: "already triaged",
		});
	});
});

describe("toTicket", () => {
	it("takes the sender's email from the reporter, or its email-shaped name", () => {
		expect(
			toTicket(
				issue({
					reporter: {
						accountId: "a",
						displayName: "Peter",
						emailAddress: "Peter@SIBA.ch",
					},
				}),
			).senderEmail,
		).toBe("peter@siba.ch");
		expect(toTicket(issue()).senderEmail).toBe("x@siba.ch");
		expect(
			toTicket(
				issue({ reporter: { accountId: "a", displayName: "Meryem Riahi" } }),
			).senderEmail,
		).toBeUndefined();
	});
});

describe("newIssueKey", () => {
	it("reads Jira admin webhooks and Automation requests, only for new issues", () => {
		expect(
			newIssueKey({
				webhookEvent: "jira:issue_created",
				issue: { key: "NOV-9030" },
			}),
		).toBe("NOV-9030");
		expect(newIssueKey({ issueKey: "nov-12" })).toBe("NOV-12");
		expect(
			newIssueKey({
				webhookEvent: "jira:issue_updated",
				issue: { key: "NOV-1" },
			}),
		).toBeUndefined();
		expect(newIssueKey({ issueKey: "not a key" })).toBeUndefined();
		expect(newIssueKey(undefined)).toBeUndefined();
	});
});

describe("InbudgetTriageSource", () => {
	function inbudget(routes: Record<string, unknown>) {
		const calls: string[] = [];
		const fetchImpl = (async (url: string) => {
			const path = url.replace("https://api.inbudget.test", "");
			calls.push(path);
			const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
			return new Response(JSON.stringify(key ? routes[key] : { member: [] }), {
				headers: { "content-type": "application/ld+json" },
			});
		}) as typeof fetch;
		const source = new InbudgetTriageSource(
			new InbudgetClient({
				baseUrl: "https://api.inbudget.test",
				token: "t",
				fetch: fetchImpl,
			}),
			() => Date.parse("2026-11-14T10:00:00Z"),
		);
		return { source, calls };
	}

	it("matches resources by domain, aliases and subdomains", async () => {
		const { source } = inbudget({
			"/api/projects": {
				member: [
					{
						id: 10,
						name: "Website",
						client: { "@id": "/api/clients/1", name: "Zoo Zürich" },
					},
					{ id: 99, name: "Intern", internal: true, client: "/api/clients/9" },
				],
			},
			"/api/client_resources": {
				member: [
					{
						client: { id: 1, name: "Zoo Zürich" },
						primaryDomain: "www.zoo.ch",
					},
					{
						client: { id: 3, name: "Other" },
						primaryDomain: "zoo.chat",
						domainAliases: ["shop.example.ch"],
					},
					{ client: "/api/clients/1", primaryDomain: "tickets.zoo.ch" },
				],
			},
		});
		expect(await source.clientsByDomain("mail.zoo.ch")).toEqual([
			{ id: "1", name: "Zoo Zürich" },
		]);
		expect(await source.clientsByDomain("example.ch")).toEqual([
			{ id: "3", name: "Other" },
		]);
		expect((await source.activeProjects()).map((p) => p.id)).toEqual(["10"]);
	});

	it("matches contacts by exact email and reads hours for the window", async () => {
		const { source, calls } = inbudget({
			"/api/projects/10/work_hour_insights": {
				users: [{ id: 7, name: "Anna", hours: 12.5 }],
			},
			"/api/projects": {
				member: [
					{ id: 10, name: "Website", client: { id: 1, name: "Zoo Zürich" } },
				],
			},
			"/api/people": {
				member: [
					{ email: "Decurtins@zoo.ch", client: "/api/clients/1" },
					{ email: "other.decurtins@zoo.ch", client: "/api/clients/5" },
				],
			},
		});
		expect(await source.clientsByEmail("decurtins@zoo.ch")).toEqual([
			{ id: "1", name: "Zoo Zürich" },
		]);
		expect(
			await source.hoursByPerson("10", new Date("2025-11-14T00:00:00Z")),
		).toEqual([{ userId: "7", name: "Anna", hours: 12.5 }]);
		expect(calls).toContain(
			"/api/projects/10/work_hour_insights?startDate=2025-11-14&endDate=2026-11-14",
		);
	});
});
