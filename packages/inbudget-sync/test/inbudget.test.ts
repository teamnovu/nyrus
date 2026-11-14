import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { applyPlan, type RepoEntry } from "../src/ConfigSync.js";
import { InbudgetClient } from "../src/InbudgetClient.js";
import { createInbudgetIntegrationFactory } from "../src/integration.js";
import { parseProjectLink } from "../src/links.js";
import { type DesiredRepository, planRepositories } from "../src/plan.js";

describe("parseProjectLink", () => {
	it.each([
		[
			{ url: "https://github.com/teamnovu/sayflowers" },
			{ type: "github", repo: "teamnovu/sayflowers" },
		],
		[
			{ url: "https://github.com/teamnovu/shop.git" },
			{ type: "github", repo: "teamnovu/shop" },
		],
		[
			{ url: "https://github.com/teamnovu/shop/tree/release/2.0" },
			{ type: "github", repo: "teamnovu/shop", branch: "release/2.0" },
		],
		[
			{ url: "git@github.com:teamnovu/shop.git" },
			{ type: "github", repo: "teamnovu/shop" },
		],
		[
			{
				url: "https://novu.atlassian.net/jira/software/c/projects/SAY/boards/12",
			},
			{ type: "jira", host: "novu.atlassian.net", projectKey: "SAY" },
		],
		[
			{ url: "https://novu.atlassian.net/browse/SAY-123" },
			{ type: "jira", host: "novu.atlassian.net", projectKey: "SAY" },
		],
		[
			{
				url: "https://novu.atlassian.net/secure/RapidBoard.jspa?rapidView=3&projectKey=ZOO",
			},
			{ type: "jira", host: "novu.atlassian.net", projectKey: "ZOO" },
		],
		[
			{ kind: "jira", value: "say" },
			{ type: "jira", projectKey: "SAY" },
		],
		[
			{ url: "https://app.clickup.com/14278081/v/o/s/90150001" },
			{ type: "clickup", teamId: "14278081", target: "space", id: "90150001" },
		],
		[
			{ url: "https://app.clickup.com/14278081/v/li/901500012345" },
			{
				type: "clickup",
				teamId: "14278081",
				target: "list",
				id: "901500012345",
			},
		],
		[
			{ url: "https://app.clickup.com/14278081/v/f/9015/90150001" },
			{ type: "clickup", teamId: "14278081", target: "folder", id: "9015" },
		],
	])("reads %j", (info, link) => {
		expect(parseProjectLink(info)).toEqual(link);
	});

	it("ignores what it can't use", () => {
		expect(
			parseProjectLink({ url: "https://gitlab.com/acme/web" }),
		).toBeUndefined();
		expect(
			parseProjectLink({
				kind: "documentation",
				url: "https://docs.example.com",
			}),
		).toBeUndefined();
		expect(parseProjectLink({ kind: "text", value: "SAY" })).toBeUndefined();
	});
});

const context = {
	jira: { host: "novu.atlassian.net", workspaceKey: "jira-novu" },
	clickup: { teamId: "14278081", workspaceKey: "clickup-14278081" },
	listName: async (id: string) => (id === "901" ? "Website" : undefined),
};
const info = (id: number, project: number, url: string, kind = "git") => ({
	id,
	kind,
	url,
	project: `/api/projects/${project}`,
});

describe("planRepositories", () => {
	it("routes each project's repository from its Jira project and ClickUp Space or List", async () => {
		const plan = await planRepositories(
			[
				{ id: 1, nr: "2041", name: "Webshop", client: { name: "Sayflowers" } },
				{
					id: 2,
					nr: "2050",
					name: "Webshop Support",
					client: { name: "Sayflowers" },
				},
				{ id: 3, nr: "3001", name: "Website", client: { name: "Zoo" } },
				{ id: 4, nr: "4000", name: "Intern" },
				{ id: 5, nr: "5000", name: "Ohne Repo" },
				{ id: 6, nr: "6000", name: "Anderes Jira" },
			],
			[
				info(1, 1, "https://github.com/teamnovu/sayflowers"),
				info(2, 1, "https://novu.atlassian.net/browse/SAY", "jira"),
				info(3, 2, "https://github.com/teamnovu/sayflowers.git"),
				info(
					4,
					2,
					"https://novu.atlassian.net/jira/software/projects/SAYS/boards/1",
					"jira",
				),
				info(5, 3, "https://github.com/teamnovu/zoo/tree/develop"),
				info(6, 3, "https://app.clickup.com/14278081/v/o/s/9015", "text"),
				info(7, 3, "https://app.clickup.com/14278081/v/li/901", "text"),
				info(8, 4, "https://github.com/teamnovu/intern"),
				info(9, 5, "https://novu.atlassian.net/browse/NOPE", "jira"),
				info(10, 6, "https://github.com/teamnovu/other"),
				info(11, 6, "https://elsewhere.atlassian.net/browse/OTH", "jira"),
			],
			context,
		);
		expect(plan.repositories).toEqual([
			{
				repo: "teamnovu/sayflowers",
				platform: "jira",
				workspaceKey: "jira-novu",
				teamKeys: ["SAY", "SAYS"],
				projectKeys: [],
				projects: [
					"2041 Webshop (Sayflowers)",
					"2050 Webshop Support (Sayflowers)",
				],
			},
			{
				repo: "teamnovu/zoo",
				branch: "develop",
				platform: "clickup",
				workspaceKey: "clickup-14278081",
				teamKeys: ["9015"],
				projectKeys: ["Website"],
				projects: ["3001 Website (Zoo)"],
			},
		]);
		expect(plan.unrouted).toEqual(["4000 Intern"]);
		expect(plan).toMatchObject({
			infoCount: 11,
			matchedInfoCount: 11,
			linkCount: 11,
		});
		expect(plan.warnings).toEqual([
			{
				project: "5000 Ohne Repo",
				message: "has a Jira/ClickUp link but no GitHub repository link",
			},
			{
				project: "6000 Anderes Jira",
				message:
					"Jira project OTH is on elsewhere.atlassian.net, nyrus works on novu.atlassian.net",
			},
		]);
	});
});

describe("planRepositories with inBudget's IRIs", () => {
	it("matches infos by IRI, also when it doesn't use the numeric id", async () => {
		const plan = await planRepositories(
			[
				{
					id: 1,
					"@id": "/api/projects/p-abc",
					publicId: "p-abc",
					nr: "2041",
					name: "Webshop",
				},
				{ id: 2, nr: "2050", name: "Archiv" },
			],
			[
				{
					id: 1,
					kind: "git",
					url: "https://github.com/teamnovu/shop",
					project: "/api/projects/p-abc",
				},
				{
					id: 2,
					kind: "jira",
					value: "SAY",
					project: { "@id": "/api/projects/p-abc" },
				},
				{
					id: 3,
					kind: "git",
					url: "https://github.com/teamnovu/old",
					project: "/api/projects/99",
				},
			],
			context,
		);
		expect(plan.repositories.map((r) => [r.repo, r.teamKeys])).toEqual([
			["teamnovu/shop", ["SAY"]],
		]);
		expect(plan).toMatchObject({
			infoCount: 3,
			matchedInfoCount: 2,
			linkCount: 2,
		});
	});

	it("warns about git links that aren't on GitHub", async () => {
		const plan = await planRepositories(
			[{ id: 1, nr: "2041", name: "Webshop" }],
			[
				{
					id: 1,
					kind: "git",
					url: "https://gitlab.com/novu/shop",
					project: "/api/projects/1",
				},
				{ id: 2, kind: "jira", value: "SAY", project: "/api/projects/1" },
			],
			context,
		);
		expect(plan.warnings).toEqual([
			{
				project: "2041 Webshop",
				message:
					"git link https://gitlab.com/novu/shop is not a GitHub repository (nyrus clones from GitHub only)",
			},
			{
				project: "2041 Webshop",
				message: "has a Jira/ClickUp link but no GitHub repository link",
			},
		]);
	});
});

function home(repositories: RepoEntry[] = []) {
	const dir = mkdtempSync(join(tmpdir(), "inbudget-sync-"));
	writeFileSync(
		join(dir, "config.json"),
		JSON.stringify({ ngrokAuthToken: "keep", repositories }),
	);
	const read = () =>
		JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as {
			ngrokAuthToken: string;
			repositories: RepoEntry[];
		};
	return { dir, read };
}

const desired = (over: Partial<DesiredRepository> = {}): DesiredRepository => ({
	repo: "teamnovu/sayflowers",
	platform: "jira",
	workspaceKey: "jira-novu",
	teamKeys: ["SAY"],
	projectKeys: [],
	projects: ["2041 Webshop (Sayflowers)"],
	...over,
});

describe("applyPlan", () => {
	it("clones and adds a managed repository, then keeps its routing in line", async () => {
		const { dir, read } = home();
		const clone = vi.fn(async (_repo: DesiredRepository, name: string) => ({
			path: `/repos/${name}`,
			defaultBranch: "staging",
		}));
		const result = await applyPlan([desired()], {
			cyrusHome: dir,
			clone,
			instructions: () => "Hi",
		});
		expect(result.added).toEqual(["inbudget-sayflowers-jira"]);
		const [entry] = read().repositories;
		expect(entry).toMatchObject({
			id: "inbudget-sayflowers-jira",
			name: "inbudget-sayflowers-jira",
			repositoryPath: "/repos/sayflowers",
			baseBranch: "staging",
			githubUrl: "https://github.com/teamnovu/sayflowers",
			linearWorkspaceId: "jira-novu",
			teamKeys: ["SAY"],
			isActive: true,
			appendInstruction: "Hi",
		});
		expect(read().ngrokAuthToken).toBe("keep");

		// A person changes the instructions; inBudget adds a project key.
		const edited = read();
		edited.repositories[0]!.appendInstruction = "Custom";
		writeFileSync(join(dir, "config.json"), JSON.stringify(edited));
		const again = await applyPlan([desired({ teamKeys: ["SAY", "SAYS"] })], {
			cyrusHome: dir,
			clone,
		});
		expect(again.updated).toEqual(["inbudget-sayflowers-jira"]);
		expect(clone).toHaveBeenCalledTimes(1);
		expect(read().repositories[0]).toMatchObject({
			teamKeys: ["SAY", "SAYS"],
			appendInstruction: "Custom",
			baseBranch: "staging",
		});
	});

	it("turns managed repositories off when inBudget no longer has them, and on again, unless a person turned them off", async () => {
		const { dir, read } = home();
		const clone = async (_r: DesiredRepository, name: string) => ({
			path: `/repos/${name}`,
		});
		await applyPlan([desired()], { cyrusHome: dir, clone });
		expect(
			(await applyPlan([], { cyrusHome: dir, clone })).deactivated,
		).toEqual(["inbudget-sayflowers-jira"]);
		expect(read().repositories[0]!.isActive).toBe(false);
		expect(
			(await applyPlan([desired()], { cyrusHome: dir, clone })).reactivated,
		).toEqual(["inbudget-sayflowers-jira"]);
		expect(read().repositories[0]!.isActive).toBe(true);

		// Turned off by a person: stays off.
		const edited = read();
		edited.repositories[0]!.isActive = false;
		writeFileSync(join(dir, "config.json"), JSON.stringify(edited));
		await applyPlan([desired()], { cyrusHome: dir, clone });
		expect(read().repositories[0]!.isActive).toBe(false);
	});

	it("leaves repositories configured by hand alone and reports failed clones", async () => {
		const manual: RepoEntry = {
			id: "sayflowers",
			name: "sayflowers",
			repositoryPath: "/repos/sayflowers",
			baseBranch: "main",
			workspaceBaseDir: "/wt",
			githubUrl: "https://github.com/teamnovu/sayflowers.git",
			linearWorkspaceId: "jira-novu",
			teamKeys: ["SAY"],
		};
		const { dir, read } = home([manual]);
		const result = await applyPlan(
			[desired(), desired({ repo: "teamnovu/broken" })],
			{
				cyrusHome: dir,
				clone: async () => {
					throw new Error("no access");
				},
			},
		);
		expect(result.manual).toEqual(["sayflowers"]);
		expect(result.errors).toEqual([
			{ repository: "teamnovu/broken", message: "no access" },
		]);
		expect(read().repositories).toEqual([manual]);
	});

	it("names clones after the owner when two repositories share a name", async () => {
		const { dir, read } = home();
		const clone = async (_r: DesiredRepository, name: string) => ({
			path: `/repos/${name}`,
		});
		await applyPlan(
			[desired({ repo: "teamnovu/web" }), desired({ repo: "acme/web" })],
			{ cyrusHome: dir, clone },
		);
		expect(read().repositories.map((r) => r.repositoryPath)).toEqual([
			"/repos/teamnovu-web",
			"/repos/acme-web",
		]);
	});
});

describe("InbudgetClient", () => {
	it("sends the access token and pages through results", async () => {
		const calls: string[] = [];
		const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
			calls.push(url.replace("https://inbudget.test", ""));
			expect((init?.headers as Record<string, string>).Authorization).toBe(
				"Bearer at-1",
			);
			const page = Number(/page=(\d+)/.exec(url)![1]);
			return Response.json(page === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }]);
		}) as unknown as typeof fetch;
		const client = new InbudgetClient({
			baseUrl: "https://inbudget.test/api/",
			token: "at-1",
			fetch: fetchImpl,
			pageSize: 2,
		});
		expect((await client.listProjects()).map((p) => p.id)).toEqual([1, 2, 3]);
		expect(calls).toEqual([
			"/api/projects?page=1&itemsPerPage=2",
			"/api/projects?page=2&itemsPerPage=2",
		]);
	});

	it("asks for JSON-LD and reads its member lists", async () => {
		const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
			expect((init?.headers as Record<string, string>).Accept).toBe(
				"application/ld+json, application/json;q=0.9",
			);
			return new Response(
				JSON.stringify({
					"@context": "/api/contexts/ProjectInfo",
					"hydra:member": [
						{
							id: 7,
							kind: "git",
							url: "https://github.com/teamnovu/web",
							project: "/api/projects/3",
						},
					],
					"hydra:totalItems": 1,
				}),
				{ headers: { "content-type": "application/ld+json; charset=utf-8" } },
			);
		}) as unknown as typeof fetch;
		const client = new InbudgetClient({
			baseUrl: "https://inbudget.test",
			token: "t",
			fetch: fetchImpl,
		});
		expect(await client.listProjectInfos([{ id: 3 }])).toEqual([
			{
				id: 7,
				kind: "git",
				url: "https://github.com/teamnovu/web",
				project: "/api/projects/3",
			},
		]);
	});

	it("reads project infos by project, in batches", async () => {
		const calls: string[] = [];
		const fetchImpl = vi.fn(async (url: string) => {
			calls.push(decodeURIComponent(url.replace("https://inbudget.test", "")));
			const ids = [
				...url.matchAll(/project\[\]=%2Fapi%2Fprojects%2F(\d+)/g),
			].map((m) => Number(m[1]));
			return Response.json({
				member: ids.map((id) => ({
					id: id * 10,
					kind: "git",
					project: `/api/projects/${id}`,
				})),
			});
		}) as unknown as typeof fetch;
		const client = new InbudgetClient({
			baseUrl: "https://inbudget.test",
			token: "t",
			fetch: fetchImpl,
		});
		const projects = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
		const infos = await client.listProjectInfos(projects);
		expect(infos).toHaveLength(120);
		expect(infos[0]).toMatchObject({ id: 10, project: "/api/projects/1" });
		expect(calls).toHaveLength(3);
		expect(calls[0]).toMatch(
			/^\/api\/project_infos\?project\[\]=\/api\/projects\/1&project\[\]=\/api\/projects\/2&.*&page=1&itemsPerPage=500$/,
		);
	});

	it("says when INBUDGET_URL is the web app instead of the API", async () => {
		const client = new InbudgetClient({
			baseUrl: "https://app.inbudget.test",
			token: "t",
			fetch: (async () =>
				new Response("<!DOCTYPE html><html></html>", {
					headers: { "content-type": "text/html; charset=UTF-8" },
				})) as unknown as typeof fetch,
		});
		await expect(client.listProjects()).rejects.toThrow(
			"inBudget answered /api/projects?page=1&itemsPerPage=500 with text/html instead of JSON: INBUDGET_URL must be inBudget's API",
		);
	});

	it("says when the token is no longer valid", async () => {
		const client = new InbudgetClient({
			baseUrl: "https://inbudget.test",
			token: "old",
			fetch: (async () =>
				new Response("Expired", { status: 401 })) as unknown as typeof fetch,
		});
		await expect(client.listProjectInfos([{ id: 3 }])).rejects.toThrow(
			"inBudget rejected INBUDGET_TOKEN",
		);
	});
});

describe("inBudget dashboard endpoint", () => {
	it("needs nyrus's API key", async () => {
		const fastify = Fastify();
		const integration = createInbudgetIntegrationFactory({
			fetch: (async () => Response.json([])) as unknown as typeof fetch,
		})({
			env: {
				INBUDGET_URL: "https://inbudget.test",
				INBUDGET_TOKEN: "jwt",
				CYRUS_API_KEY: "key",
				INBUDGET_SYNC_INTERVAL_MINUTES: "0",
			},
			cyrusHome: home().dir,
			logger: { info() {}, warn() {}, error() {}, debug() {} } as never,
		})!;
		integration.register({ fastify } as never);
		try {
			expect(
				(await fastify.inject({ url: "/api/dashboard/inbudget" })).statusCode,
			).toBe(401);
			const ok = await fastify.inject({
				url: "/api/dashboard/inbudget",
				headers: { authorization: "Bearer key" },
			});
			expect(ok.json()).toEqual({
				success: true,
				data: { status: { running: false } },
			});
			const synced = await fastify.inject({
				method: "POST",
				url: "/api/dashboard/inbudget",
				headers: { authorization: "Bearer key" },
			});
			expect(synced.json().data.status).toMatchObject({
				running: false,
				projectCount: 0,
				repositories: [],
			});
		} finally {
			integration.dispose?.();
		}
	});
});
