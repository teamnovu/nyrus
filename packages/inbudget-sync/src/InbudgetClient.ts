/** An inBudget project, as `/api/projects` lists it (archived ones are left out). */
export interface InbudgetProject {
	id: number;
	/** The project's IRI, e.g. `/api/projects/12` (JSON-LD). */
	"@id"?: string;
	publicId?: string | null;
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

/** Projects per `project_infos` request (keeps URLs well below 8 KB). */
const PROJECTS_PER_REQUEST = 50;
const PARALLEL_REQUESTS = 4;

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

	/**
	 * The infos of these projects. inBudget lists project infos only when
	 * asked for by project (without a `project` filter it answers with an
	 * empty collection), so they are read in batches of `project[]=<iri>`.
	 */
	async listProjectInfos(
		projects: Pick<InbudgetProject, "id" | "@id">[],
	): Promise<InbudgetProjectInfo[]> {
		const iris = [
			...new Set(projects.map((p) => p["@id"] ?? `/api/projects/${p.id}`)),
		];
		const batches: string[][] = [];
		for (let i = 0; i < iris.length; i += PROJECTS_PER_REQUEST) {
			batches.push(iris.slice(i, i + PROJECTS_PER_REQUEST));
		}
		const results: InbudgetProjectInfo[][] = new Array(batches.length);
		let next = 0;
		const worker = async () => {
			while (next < batches.length) {
				const index = next++;
				const query = batches[index]!.map(
					(iri) => `project[]=${encodeURIComponent(iri)}`,
				).join("&");
				results[index] = await this.allPages<InbudgetProjectInfo>(
					"/api/project_infos",
					query,
				);
			}
		};
		await Promise.all(
			Array.from(
				{ length: Math.min(PARALLEL_REQUESTS, batches.length) },
				worker,
			),
		);
		return results.flat();
	}

	/** Every item of a collection, e.g. `listAll("/api/people", "search=x")`. */
	listAll<T>(path: string, query = ""): Promise<T[]> {
		return this.allPages<T>(path, query);
	}

	/** One resource, e.g. `getJson("/api/projects/12/work_hour_insights")`. */
	getJson<T>(path: string): Promise<T> {
		return this.get<T>(path);
	}

	private async allPages<T>(path: string, query = ""): Promise<T[]> {
		const items: T[] = [];
		for (let page = 1; page <= 1000; page++) {
			const batch = await this.get<unknown>(
				`${path}?${query ? `${query}&` : ""}page=${page}&itemsPerPage=${this.pageSize}`,
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

/**
 * The key of an info's project: the last segment of its IRI
 * (`/api/projects/12` → `12`), or the id of an embedded project. Compared
 * with {@link projectKeysOf}, so it doesn't matter whether inBudget's IRIs
 * use the numeric id or another identifier.
 */
export function projectRefOf(info: InbudgetProjectInfo): string | undefined {
	const project = info.project;
	if (project === null || project === undefined) return undefined;
	if (typeof project === "string") return lastSegment(project);
	const iri = project["@id"];
	if (iri) return lastSegment(iri);
	return project.id === undefined || project.id === null
		? undefined
		: String(project.id);
}

/** The keys an info's project reference may use for this project. */
export function projectKeysOf(project: InbudgetProject): string[] {
	const keys = [
		project.id === undefined || project.id === null
			? undefined
			: String(project.id),
		project["@id"] ? lastSegment(project["@id"]) : undefined,
		project.publicId ?? undefined,
	].filter((key): key is string => Boolean(key));
	return [...new Set(keys)];
}

function lastSegment(iri: string): string | undefined {
	const path = iri.split(/[?#]/)[0] ?? "";
	const segment = path.replace(/\/+$/, "").split("/").pop();
	return segment ? decodeURIComponent(segment) : undefined;
}
