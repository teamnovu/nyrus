import type { InbudgetClient } from "cyrus-inbudget-sync";
import {
	hostOf,
	type PersonHours,
	sameSite,
	type TriageClient,
	type TriageProject,
	type TriageSource,
} from "./Triage.js";

/** Projects and users are read again after this long. */
const CACHE_MS = 15 * 60_000;

type Ref =
	| string
	| { "@id"?: string; id?: number | string; name?: string }
	| null;

interface RawProject {
	id?: number | string;
	"@id"?: string;
	name?: string;
	nr?: string | null;
	internal?: boolean;
	client?: Ref;
	lastWorkHourAt?: string | null;
}

interface RawPerson {
	email?: string | null;
	disabled?: boolean;
	client?: Ref;
}

interface RawResource {
	client?: Ref;
	primaryDomain?: string | null;
	domainAliases?: unknown[];
	url?: string | null;
	probeUrl?: string | null;
	otherUrls?: unknown[];
}

interface RawUser {
	id?: number | string;
	"@id"?: string;
	email?: string | null;
	enabled?: boolean;
	fullName?: string;
	givenName?: string;
	familyName?: string;
}

interface RawEmployment {
	user?: Ref;
	activeFrom?: string | null;
	activeUntil?: string | null;
}

interface RawInsights {
	users?: { id?: number | string; name?: string; hours?: number }[];
}

/** {@link TriageSource} on inBudget's API (read-only). */
export class InbudgetTriageSource implements TriageSource {
	private projects?: { at: number; value: Promise<TriageProject[]> };
	private users?: {
		at: number;
		value: Promise<Map<string, { email?: string; name: string }>>;
	};

	constructor(
		private readonly client: InbudgetClient,
		private readonly now: () => number = Date.now,
	) {}

	async clientsByEmail(email: string): Promise<TriageClient[]> {
		const wanted = email.trim().toLowerCase();
		const people = await this.client.listAll<RawPerson>(
			"/api/people",
			`search=${encodeURIComponent(wanted)}`,
		);
		const refs = people
			.filter((p) => !p.disabled && p.email?.trim().toLowerCase() === wanted)
			.map((p) => p.client);
		return this.resolveClients(refs);
	}

	async clientsByDomain(domain: string): Promise<TriageClient[]> {
		// The base domain finds resources on it and its subdomains.
		const base = domain.split(".").slice(-2).join(".");
		const resources = await this.client.listAll<RawResource>(
			"/api/client_resources",
			`search=${encodeURIComponent(base)}`,
		);
		const refs = resources
			.filter((resource) =>
				resourceHosts(resource).some((host) => sameSite(domain, host)),
			)
			.map((resource) => resource.client);
		return this.resolveClients(refs);
	}

	activeProjects(): Promise<TriageProject[]> {
		if (!this.projects || this.now() - this.projects.at > CACHE_MS) {
			const value = this.client
				.listAll<RawProject>("/api/projects", "archived=false")
				.then((raw) =>
					raw
						.filter((p) => !p.internal)
						.map(toProject)
						.filter((p): p is TriageProject => Boolean(p)),
				);
			value.catch(() => {
				this.projects = undefined;
			});
			this.projects = { at: this.now(), value };
		}
		return this.projects.value;
	}

	async hoursByPerson(projectId: string, since?: Date): Promise<PersonHours[]> {
		const query = since
			? `?startDate=${day(since)}&endDate=${day(new Date(this.now()))}`
			: "";
		const insights = await this.client.getJson<RawInsights>(
			`/api/projects/${encodeURIComponent(projectId)}/work_hour_insights${query}`,
		);
		return (insights.users ?? [])
			.filter((u) => u.id !== undefined && u.id !== null)
			.map((u) => ({
				userId: String(u.id),
				name: u.name ?? "",
				hours: Number(u.hours) || 0,
			}));
	}

	/**
	 * Enabled users who still work here: users whose employments in inBudget
	 * have all ended (`activeUntil` in the past) are left out. Users without
	 * employments are kept. If the token can't read employments, only
	 * disabled users are left out.
	 */
	activeUsers(): Promise<Map<string, { email?: string; name: string }>> {
		if (!this.users || this.now() - this.users.at > CACHE_MS) {
			const value = Promise.all([
				this.client.listAll<RawUser>("/api/users", "enabled=true"),
				this.client
					.listAll<RawEmployment>("/api/employments")
					.catch(() => undefined),
			]).then(([raw, employments]) => {
				const left = employments
					? formerEmployees(employments, day(new Date(this.now())))
					: new Set<string>();
				const users = new Map<string, { email?: string; name: string }>();
				for (const user of raw) {
					const id = idOf(user);
					if (!id || user.enabled === false || left.has(id)) continue;
					users.set(id, {
						email: user.email?.trim() || undefined,
						name:
							user.fullName ??
							[user.givenName, user.familyName].filter(Boolean).join(" "),
					});
				}
				return users;
			});
			value.catch(() => {
				this.users = undefined;
			});
			this.users = { at: this.now(), value };
		}
		return this.users.value;
	}

	/** Clients by reference, named from the projects (or inBudget), each once. */
	private async resolveClients(
		refs: (Ref | undefined)[],
	): Promise<TriageClient[]> {
		const names = new Map<string, string>();
		for (const project of await this.activeProjects()) {
			names.set(project.client.id, project.client.name);
		}
		const clients = new Map<string, TriageClient>();
		for (const ref of refs) {
			const id = refId(ref);
			if (!id || clients.has(id)) continue;
			let name = (typeof ref === "object" && ref?.name) || names.get(id);
			if (!name) {
				const client = await this.client
					.getJson<{ name?: string }>(`/api/clients/${encodeURIComponent(id)}`)
					.catch(() => undefined);
				name = client?.name;
			}
			clients.set(id, { id, name: name ?? `Kunde ${id}` });
		}
		return [...clients.values()];
	}
}

function toProject(raw: RawProject): TriageProject | undefined {
	const id = idOf(raw);
	const clientId = refId(raw.client ?? null);
	if (!id || !clientId) return undefined;
	const clientName =
		(typeof raw.client === "object" && raw.client?.name) || `Kunde ${clientId}`;
	return {
		id,
		name: raw.name ?? `Projekt ${id}`,
		nr: raw.nr ?? undefined,
		client: { id: clientId, name: clientName },
		lastWorkHourAt: raw.lastWorkHourAt ?? undefined,
	};
}

/**
 * Users whose every employment ended before `today` (YYYY-MM-DD). A user
 * with one open employment (no end, or an end today or later) still works
 * here. Exported for tests.
 */
export function formerEmployees(
	employments: RawEmployment[],
	today: string,
): Set<string> {
	const current = new Set<string>();
	const ended = new Set<string>();
	for (const employment of employments) {
		const id = refId(employment.user);
		if (!id) continue;
		const until = employment.activeUntil?.slice(0, 10);
		if (!until || until >= today) current.add(id);
		else ended.add(id);
	}
	for (const id of current) ended.delete(id);
	return ended;
}

function resourceHosts(resource: RawResource): string[] {
	const values: unknown[] = [
		resource.primaryDomain,
		resource.url,
		resource.probeUrl,
		...(resource.domainAliases ?? []),
		...(resource.otherUrls ?? []),
	];
	return values
		.map((value) => {
			if (typeof value === "string") return hostOf(value);
			if (value && typeof value === "object") {
				const v = value as Record<string, unknown>;
				const text = v.domain ?? v.url ?? v.name ?? v.value;
				return typeof text === "string" ? hostOf(text) : undefined;
			}
			return undefined;
		})
		.filter((host): host is string => Boolean(host));
}

/** The id of an IRI (`/api/clients/5` → `5`) or an embedded object. */
function refId(ref: Ref | undefined): string | undefined {
	if (!ref) return undefined;
	if (typeof ref === "string") return ref.split("/").filter(Boolean).pop();
	return idOf(ref);
}

function idOf(item: {
	id?: number | string;
	"@id"?: string;
}): string | undefined {
	if (item.id !== undefined && item.id !== null && item.id !== "") {
		return String(item.id);
	}
	return item["@id"]?.split("/").filter(Boolean).pop();
}

function day(date: Date): string {
	return date.toISOString().slice(0, 10);
}
