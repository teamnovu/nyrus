/** An inBudget project, as `/api/projects` lists it (archived ones are left out). */
export interface InbudgetProject {
	id: number;
	name: string;
	nr?: string | number | null;
	client?: { name?: string | null } | string | null;
}

/** A link or note on a project (`/api/project_infos`). */
export interface InbudgetProjectInfo {
	id: number;
	kind?: string | null;
	name?: string | null;
	url?: string | null;
	value?: string | null;
	/** The project, as an IRI (`/api/projects/12`) or an object with its id. */
	project?: string | { id?: number; "@id"?: string } | null;
}

export interface InbudgetClientOptions {
	/** inBudget's API, e.g. `https://api.inbudget.ch` (without `/api`) */
	baseUrl: string;
	/**
	 * An inBudget access token (user → Access Tokens): a long-lived JWT,
	 * sent as Bearer token.
	 */
	token: string;
	fetch?: typeof fetch;
	pageSize?: number;
}

/** inBudget's REST API (API Platform), read-only, with an access token. */
export class InbudgetClient {
	readonly baseUrl: string;
	private readonly pageSize: number;

	constructor(private readonly options: InbudgetClientOptions) {
		this.baseUrl = options.baseUrl
			.trim()
			.replace(/\/+$/, "")
			.replace(/\/api$/, "");
		this.pageSize = options.pageSize ?? 500;
		if (!options.token) {
			throw new Error("inBudget needs INBUDGET_TOKEN (an access token)");
		}
	}

	/** Active (not archived) projects. */
	listProjects(): Promise<InbudgetProject[]> {
		return this.allPages<InbudgetProject>("/api/projects");
	}

	listProjectInfos(): Promise<InbudgetProjectInfo[]> {
		return this.allPages<InbudgetProjectInfo>("/api/project_infos");
	}

	private async allPages<T>(path: string): Promise<T[]> {
		const items: T[] = [];
		for (let page = 1; page <= 1000; page++) {
			const batch = await this.get<unknown>(
				`${path}?page=${page}&itemsPerPage=${this.pageSize}`,
			);
			const list = Array.isArray(batch)
				? (batch as T[])
				: ((batch as { "hydra:member"?: T[]; member?: T[] })?.[
						"hydra:member"
					] ??
					(batch as { member?: T[] })?.member ??
					[]);
			items.push(...list);
			if (list.length < this.pageSize) break;
		}
		return items;
	}

	private async get<T>(path: string): Promise<T> {
		const response = await (this.options.fetch ?? fetch)(
			`${this.baseUrl}${path}`,
			{
				headers: {
					// Some resources (project_infos) only speak JSON-LD.
					Accept: "application/ld+json, application/json;q=0.9",
					Authorization: `Bearer ${this.options.token}`,
				},
			},
		);
		if (response.status === 401) {
			throw new Error(
				"inBudget rejected INBUDGET_TOKEN (expired or invalid): create a new access token",
			);
		}
		if (!response.ok) {
			throw new Error(
				`inBudget GET ${path} failed: ${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`,
			);
		}
		const type = response.headers.get("content-type") ?? "";
		if (!type.includes("json")) {
			throw new Error(
				`inBudget answered ${path} with ${type.split(";")[0] || "no content type"} instead of JSON: INBUDGET_URL must be inBudget's API (e.g. https://api.inbudget.ch), not its web app`,
			);
		}
		return (await response.json()) as T;
	}
}

/** The id of an info's project, from its IRI or object. */
export function projectIdOf(info: InbudgetProjectInfo): number | undefined {
	const project = info.project;
	const iri =
		typeof project === "string" ? project : (project?.["@id"] ?? undefined);
	if (iri) {
		const id = Number(/\/(\d+)$/.exec(iri)?.[1]);
		return Number.isFinite(id) ? id : undefined;
	}
	return typeof project === "object" && project?.id ? project.id : undefined;
}
