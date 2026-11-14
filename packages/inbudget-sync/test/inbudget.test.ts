import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { applyPlan, type RepoEntry } from "../src/ConfigSync.js";
import { InbudgetClient } from "../src/InbudgetClient.js";
import { InbudgetSync } from "../src/InbudgetSync.js";
import { createInbudgetIntegrationFactory } from "../src/integration.js";
import { parseProjectLink } from "../src/links.js";
import {
	mergeManual,
	readManual,
	writeGroup,
	writeManual,
} from "../src/manual.js";
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

describe("planRepositories with client resources", () => {
	const resource = (over: Record<string, unknown>) => ({
		id: 1,
		name: "Sayflowers Shopware",
		environment: "production",
		client: { "@id": "/api/clients/2203", name: "SayFlowers Concepts GmbH" },
		repositoryUrl: null,
		repositoryBranch: null,
		otherUrls: [],
		...over,
	});
	const sayflowers = {
		id: 1780,
		nr: "P-22093",
		name: "sayflowers.ch",
		client: { "@id": "/api/clients/2203", name: "SayFlowers Concepts GmbH" },
	};

	it("takes the repository from the client's resources when the project has no git link", async () => {
		const plan = await planRepositories(
			[sayflowers],
			[{ id: 1, kind: "jira", value: "SAY", project: "/api/projects/1780" }],
			context,
			[
				resource({
					id: 2,
					environment: "staging",
					repositoryUrl: "git@github.com:teamnovu/sayflowers.git",
					repositoryBranch: "develop",
				}),
				resource({
					repositoryUrl: "https://github.com/teamnovu/sayflowers/",
					repositoryBranch: "main",
					otherUrls: [
						{
							url: "https://github.com/teamnovu/sayflowers-deploy",
							label: "PROD",
						},
					],
				}),
			],
		);
		expect(plan.repositories).toEqual([
			{
				repo: "teamnovu/sayflowers",
				branch: "main",
				platform: "jira",
				workspaceKey: "jira-novu",
				teamKeys: ["SAY"],
				projectKeys: [],
				projects: ["P-22093 sayflowers.ch (SayFlowers Concepts GmbH)"],
			},
		]);
		expect(plan).toMatchObject({ resourceCount: 2, resourceRepoCount: 2 });
	});

	it("routes from a Jira link among the resource's other URLs", async () => {
		const plan = await planRepositories([sayflowers], [], context, [
			resource({
				repositoryUrl: "https://github.com/teamnovu/sayflowers",
				otherUrls: [
					{ url: "https://novu.atlassian.net/browse/SAY", label: "Jira" },
				],
			}),
		]);
		expect(plan.repositories.map((r) => [r.repo, r.teamKeys])).toEqual([
			["teamnovu/sayflowers", ["SAY"]],
		]);
	});

	it("prefers the project's own git link and lists repos without routing as unrouted", async () => {
		const plan = await planRepositories(
			[sayflowers, { ...sayflowers, id: 1781, nr: "P-1", name: "Support" }],
			[
				{
					id: 1,
					kind: "git",
					url: "https://github.com/teamnovu/sayflowers-app",
					project: "/api/projects/1780",
				},
				{ id: 2, kind: "jira", value: "SAY", project: "/api/projects/1780" },
			],
			context,
			[resource({ repositoryUrl: "https://github.com/teamnovu/sayflowers" })],
		);
		expect(plan.repositories.map((r) => r.repo)).toEqual([
			"teamnovu/sayflowers-app",
		]);
		expect(plan.unrouted).toEqual(["P-1 Support (SayFlowers Concepts GmbH)"]);
	});
});

describe("planRepositories with GitHub issues", () => {
	const github = { ...context, github: { workspaceKey: "github" } };

	it("gives every repository a GitHub issues entry, also without Jira or ClickUp", async () => {
		const plan = await planRepositories(
			[
				{ id: 1, nr: "2041", name: "Webshop" },
				{ id: 2, nr: "4000", name: "Intern" },
			],
			[
				info(1, 1, "https://github.com/teamnovu/Sayflowers"),
				info(2, 1, "https://novu.atlassian.net/browse/SAY", "jira"),
				info(3, 2, "https://github.com/teamnovu/intern"),
			],
			github,
		);
		expect(
			plan.repositories.map((r) => [
				r.repo,
				r.platform,
				r.workspaceKey,
				r.teamKeys,
			]),
		).toEqual([
			["teamnovu/intern", "github", "github", ["teamnovu/intern"]],
			["teamnovu/Sayflowers", "github", "github", ["teamnovu/sayflowers"]],
			["teamnovu/Sayflowers", "jira", "jira-novu", ["SAY"]],
		]);
		expect(plan.unrouted).toEqual(["4000 Intern"]);
	});

	it("without GitHub issues, a repository without tracker link gets no entry", async () => {
		const plan = await planRepositories(
			[{ id: 2, nr: "4000", name: "Intern" }],
			[info(3, 2, "https://github.com/teamnovu/intern")],
			context,
		);
		expect(plan.repositories).toEqual([]);
	});
});

describe("manual routing from the dashboard", () => {
	const projects = [
		{ id: 1, nr: "2041", name: "Webshop" },
		{ id: 2, nr: "3001", name: "Website" },
	];

	it("supplements inBudget where it has nothing and is overwritten where it has something", async () => {
		const plan = await planRepositories(
			projects,
			[
				info(1, 1, "https://github.com/teamnovu/sayflowers"),
				info(2, 2, "https://github.com/teamnovu/zoo"),
				info(3, 2, "https://novu.atlassian.net/browse/ZOO", "jira"),
			],
			context,
		);
		const { desired, repos } = mergeManual(
			plan,
			{
				"teamnovu/sayflowers": { jira: { teamKeys: ["SAY"], projectKeys: [] } },
				"teamnovu/zoo": { jira: { teamKeys: ["OLD"], projectKeys: [] } },
			},
			context,
		);
		expect(desired.map((d) => [d.repo, d.platform, d.teamKeys])).toEqual([
			["teamnovu/sayflowers", "jira", ["SAY"]],
			["teamnovu/zoo", "jira", ["ZOO"]],
		]);
		expect(repos.map((r) => [r.repo, r.platforms.jira])).toEqual([
			[
				"teamnovu/sayflowers",
				{
					inbudget: { teamKeys: [], projectKeys: [] },
					manual: { teamKeys: ["SAY"], projectKeys: [] },
					detached: false,
					effective: { teamKeys: ["SAY"], projectKeys: [] },
					inherited: { teamKeys: [], projectKeys: [] },
				},
			],
			[
				"teamnovu/zoo",
				{
					inbudget: { teamKeys: ["ZOO"], projectKeys: [] },
					manual: { teamKeys: ["OLD"], projectKeys: [] },
					detached: false,
					effective: { teamKeys: ["ZOO"], projectKeys: [] },
					inherited: { teamKeys: [], projectKeys: [] },
				},
			],
		]);
		expect(repos[0]!.platforms.clickup).toMatchObject({
			effective: { teamKeys: [], projectKeys: [] },
		});
	});

	it("uses the manual keys over inBudget's only after unlinking, until linked again", async () => {
		const { dir } = home();
		const plan = await planRepositories(
			[{ id: 2, nr: "3001", name: "Website" }],
			[
				info(2, 2, "https://github.com/teamnovu/zoo"),
				info(3, 2, "https://novu.atlassian.net/browse/ZOO", "jira"),
			],
			context,
		);
		const keysOf = () =>
			mergeManual(plan, readManual(dir), context).desired.map(
				(d) => d.teamKeys,
			);
		writeManual(dir, "teamnovu/zoo", "jira", {
			teamKeys: ["NEW"],
			projectKeys: [],
		});
		expect(keysOf()).toEqual([["ZOO"]]);
		writeManual(
			dir,
			"teamnovu/zoo",
			"jira",
			{ teamKeys: ["NEW"], projectKeys: [] },
			true,
		);
		expect(keysOf()).toEqual([["NEW"]]);
		expect(
			mergeManual(plan, readManual(dir), context).repos[0]!.platforms.jira,
		).toMatchObject({ detached: true, effective: { teamKeys: ["NEW"] } });
		// Unlinked with no keys: no Jira for it, although inBudget has one.
		writeManual(dir, "teamnovu/zoo", "jira", { teamKeys: [], projectKeys: [] });
		expect(keysOf()).toEqual([]);
		writeManual(
			dir,
			"teamnovu/zoo",
			"jira",
			{ teamKeys: [], projectKeys: [] },
			false,
		);
		expect(keysOf()).toEqual([["ZOO"]]);
		expect(readManual(dir)).toEqual({});
	});

	it("keeps manual routing per repository and tracker, empty keys clear it", () => {
		const { dir } = home();
		writeManual(dir, "TeamNovu/Sayflowers", "jira", {
			teamKeys: [" SAY ", "SAY"],
			projectKeys: [],
		});
		writeManual(dir, "teamnovu/sayflowers", "clickup", {
			teamKeys: [],
			projectKeys: ["Website"],
		});
		expect(readManual(dir)).toEqual({
			"teamnovu/sayflowers": {
				jira: { teamKeys: ["SAY"], projectKeys: [] },
				clickup: { teamKeys: [], projectKeys: ["Website"] },
			},
		});
		writeManual(dir, "teamnovu/sayflowers", "jira", {
			teamKeys: [],
			projectKeys: [],
		});
		writeManual(dir, "teamnovu/sayflowers", "clickup", {
			teamKeys: [],
			projectKeys: [],
		});
		expect(readManual(dir)).toEqual({});
	});
});

describe("GitHub issues entries on demand", () => {
	it("clones a repository for GitHub issues only when its first issue asks for it", async () => {
		const { dir, read } = home();
		const clone = vi.fn(async (_repo: DesiredRepository, name: string) => ({
			path: `/repos/${name}`,
			defaultBranch: "main",
		}));
		const sync = new InbudgetSync({
			client: {
				listProjects: async () => [
					{ id: 1, nr: "2041", name: "Webshop", client: "/api/clients/7" },
				],
				listProjectInfos: async () => [],
				listClientResources: async () => [
					{
						id: 1,
						environment: "production",
						client: "/api/clients/7",
						repositoryUrl: "git@github.com:teamnovu/sayflowers.git",
					},
				],
			},
			cyrusHome: dir,
			context: { ...context, github: { workspaceKey: "github" } },
			clone,
			logger: { info() {}, warn() {}, error() {}, debug() {} } as never,
		});

		const first = await sync.sync();
		expect(first.error).toBeUndefined();
		expect(clone).not.toHaveBeenCalled();
		expect(read().repositories).toEqual([]);
		expect(first.repos?.[0]).toMatchObject({
			repo: "teamnovu/sayflowers",
			platforms: { github: {} },
		});

		expect(await sync.provideGitHub("TeamNovu/Sayflowers")).toBe(true);
		expect(clone).toHaveBeenCalledOnce();
		expect(read().repositories).toMatchObject([
			{
				id: "inbudget-sayflowers-github",
				linearWorkspaceId: "github",
				teamKeys: ["teamnovu/sayflowers"],
			},
		]);

		// Later syncs keep it; unknown repositories are refused.
		await sync.sync();
		expect(read().repositories).toHaveLength(1);
		expect(read().repositories[0]!.isActive).toBe(true);
		expect(await sync.provideGitHub("teamnovu/unknown")).toBe(false);
	});
});

describe("repository groups", () => {
	const zuriga = { "@id": "/api/clients/7", name: "Zuriga" };
	const projects = [
		{ id: 1, nr: "1", name: "Website", client: zuriga },
		{ id: 2, nr: "2", name: "CMS", client: zuriga },
		{
			id: 3,
			nr: "3",
			name: "Intern",
			client: { "@id": "/api/clients/9", name: "novu ag" },
		},
	];
	const infos = [
		info(1, 1, "https://github.com/teamnovu/zuriga-web"),
		info(2, 1, "https://novu.atlassian.net/browse/ZUR", "jira"),
		info(3, 2, "https://github.com/teamnovu/zuriga-cms"),
		info(4, 3, "https://github.com/teamnovu/skeleton"),
	];

	it("groups a customer's repositories, which share their tracker keys", async () => {
		const plan = await planRepositories(projects, infos, context);
		const { desired, repos, groups } = mergeManual(plan, {}, context);
		expect(
			desired.map((d) => [d.repo, d.platform, d.teamKeys, d.routingGroup]),
		).toEqual([
			["teamnovu/zuriga-cms", "jira", ["ZUR"], "client:7"],
			["teamnovu/zuriga-web", "jira", ["ZUR"], "client:7"],
		]);
		expect(repos.find((r) => r.repo === "teamnovu/zuriga-cms")!.group).toEqual({
			key: "client:7",
			name: "Zuriga",
			source: "inbudget",
			customer: "Zuriga",
		});
		expect(groups.map((g) => [g.key, g.name, g.repos])).toEqual([
			["client:9", "novu ag", ["teamnovu/skeleton"]],
			["client:7", "Zuriga", ["teamnovu/zuriga-cms", "teamnovu/zuriga-web"]],
		]);
	});

	it("gives a group's own Jira/ClickUp keys to all its repositories, together with their members' keys", async () => {
		const { dir } = home();
		writeManual(dir, "@group:client:7", "jira", {
			teamKeys: ["ZURG"],
			projectKeys: [],
		});
		writeManual(dir, "@group:client:7", "clickup", {
			teamKeys: ["9015"],
			projectKeys: [],
		});
		const plan = await planRepositories(projects, infos, {
			...context,
			clickup: { teamId: "14278081", workspaceKey: "clickup-14278081" },
		});
		const { desired, repos, groups } = mergeManual(plan, readManual(dir), {
			...context,
			clickup: { teamId: "14278081", workspaceKey: "clickup-14278081" },
		});
		expect(
			desired
				.filter((d) => d.repo.startsWith("teamnovu/zuriga"))
				.map((d) => [d.repo, d.platform, d.teamKeys]),
		).toEqual([
			["teamnovu/zuriga-cms", "clickup", ["9015"]],
			["teamnovu/zuriga-cms", "jira", ["ZURG", "ZUR"]],
			["teamnovu/zuriga-web", "clickup", ["9015"]],
			["teamnovu/zuriga-web", "jira", ["ZURG", "ZUR"]],
		]);
		expect(groups.find((g) => g.key === "client:7")!.platforms.jira).toEqual({
			own: { teamKeys: ["ZURG"], projectKeys: [] },
			effective: { teamKeys: ["ZURG", "ZUR"], projectKeys: [] },
		});
		const cms = repos.find((r) => r.repo === "teamnovu/zuriga-cms")!;
		expect(cms.platforms.jira).toMatchObject({
			effective: { teamKeys: [] },
			inherited: { teamKeys: ["ZURG", "ZUR"], projectKeys: [] },
		});
		// Cleared: only the members' keys remain.
		writeManual(dir, "@group:client:7", "jira", {
			teamKeys: [],
			projectKeys: [],
		});
		expect(
			mergeManual(plan, readManual(dir), context).groups.find(
				(g) => g.key === "client:7",
			)!.platforms.jira!.effective.teamKeys,
		).toEqual(["ZUR"]);
	});

	it("follows the groups set in the dashboard: a name, alone, or back to the customer", async () => {
		const { dir } = home();
		writeGroup(dir, "teamnovu/zuriga-cms", "");
		writeGroup(dir, "teamnovu/skeleton", "Zuriga Plattform");
		writeGroup(dir, "teamnovu/zuriga-web", "Zuriga Plattform");
		const plan = await planRepositories(projects, infos, context);
		const { desired, repos } = mergeManual(plan, readManual(dir), context);
		expect(desired.map((d) => [d.repo, d.teamKeys, d.routingGroup])).toEqual([
			["teamnovu/skeleton", ["ZUR"], "Zuriga Plattform"],
			["teamnovu/zuriga-web", ["ZUR"], "Zuriga Plattform"],
		]);
		expect(
			repos.find((r) => r.repo === "teamnovu/zuriga-cms")!.group,
		).toMatchObject({
			key: "repo:teamnovu/zuriga-cms",
			source: "manual",
		});
		writeGroup(dir, "teamnovu/zuriga-cms", null);
		expect(readManual(dir)["teamnovu/zuriga-cms"]).toBeUndefined();
	});
});

describe("syncing only changes", () => {
	function fakeClient() {
		const calls: string[] = [];
		const state = {
			projects: [
				{
					id: 1,
					nr: "1",
					name: "Website",
					client: { "@id": "/api/clients/7", name: "Zuriga" },
				},
			] as Array<{
				id: number;
				nr: string;
				name: string;
				client: { "@id": string; name: string };
			}>,
			resources: [
				{
					id: 10,
					environment: "production",
					client: "/api/clients/7",
					repositoryUrl: "https://github.com/teamnovu/zuriga-web",
				},
			] as Array<Record<string, unknown> & { id: number }>,
		};
		return {
			calls,
			state,
			client: {
				listProjects: vi.fn(async () => {
					calls.push("projects");
					return state.projects;
				}),
				listClientResources: vi.fn(async (since?: string) => {
					calls.push(since ? "resources-changed" : "resources");
					return (
						since ? state.resources.filter((r) => r.changed) : state.resources
					) as never;
				}),
				listProjectInfos: vi.fn(async (projects: Array<{ id: number }>) => {
					calls.push(`infos:${projects.map((p) => p.id).join(",")}`);
					return [];
				}),
			},
		};
	}
	const quiet = { info() {}, warn() {}, error() {}, debug() {} } as never;

	it("reads everything once, then only changes, and applies dashboard changes without asking inBudget", async () => {
		const { dir } = home();
		const { client, calls, state } = fakeClient();
		const sync = new InbudgetSync({
			client,
			cyrusHome: dir,
			context,
			clone: async (_r, name) => ({ path: `/repos/${name}` }),
			logger: quiet,
		});

		const first = await sync.sync("changes"); // no cache yet: full
		expect(calls).toEqual(["projects", "resources", "infos:1"]);
		expect(first.lastFetch).toMatchObject({ mode: "full" });

		calls.length = 0;
		state.projects.push({
			id: 2,
			nr: "2",
			name: "CMS",
			client: { "@id": "/api/clients/7", name: "Zuriga" },
		});
		state.resources.push({
			id: 11,
			changed: true,
			environment: "production",
			client: "/api/clients/7",
			repositoryUrl: "https://github.com/teamnovu/zuriga-cms",
		});
		const second = await sync.sync("changes");
		expect(calls).toEqual(["projects", "resources-changed", "infos:2"]);
		expect(second.lastFetch).toMatchObject({ mode: "changes" });
		expect(second.groups?.find((g) => g.key === "client:7")?.repos).toEqual([
			"teamnovu/zuriga-cms",
			"teamnovu/zuriga-web",
		]);

		calls.length = 0;
		await sync.setManual("teamnovu/zuriga-web", "jira", {
			teamKeys: ["ZUR"],
			projectKeys: [],
		});
		const grouped = await sync.setGroup(
			["teamnovu/zuriga-web", "teamnovu/zuriga-cms"],
			"Zuriga Plattform",
		);
		expect(calls).toEqual([]);
		expect(grouped.lastFetch).toEqual({ mode: "none", requests: 0 });
		expect(
			grouped.repositories?.map((r) => [r.repo, r.teamKeys, r.routingGroup]),
		).toEqual([
			["teamnovu/zuriga-cms", ["ZUR"], "Zuriga Plattform"],
			["teamnovu/zuriga-web", ["ZUR"], "Zuriga Plattform"],
		]);

		// "Jetzt abgleichen": everything again.
		calls.length = 0;
		await sync.sync("full");
		expect(calls).toEqual(["projects", "resources", "infos:1,2"]);
	});

	it("reads everything again when the last full read is older than fullSyncHours", async () => {
		const { dir } = home();
		const { client, calls } = fakeClient();
		const sync = new InbudgetSync({
			client,
			cyrusHome: dir,
			context,
			clone: async (_r, name) => ({ path: `/repos/${name}` }),
			logger: quiet,
			fullSyncHours: 0,
		});
		await sync.sync("changes");
		calls.length = 0;
		await new Promise((r) => setTimeout(r, 5));
		await sync.sync("changes");
		expect(calls).toEqual(["projects", "resources", "infos:1"]);
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
	it("shares the clone between a repository's entries", async () => {
		const { dir, read } = home();
		const clone = vi.fn(async (_repo: DesiredRepository, name: string) => ({
			path: `/repos/${name}`,
			defaultBranch: "staging",
		}));
		const result = await applyPlan(
			[
				desired(),
				desired({
					platform: "github",
					workspaceKey: "github",
					teamKeys: ["teamnovu/sayflowers"],
				}),
			],
			{ cyrusHome: dir, clone },
		);
		expect(result.added).toEqual([
			"inbudget-sayflowers-jira",
			"inbudget-sayflowers-github",
		]);
		expect(clone).toHaveBeenCalledTimes(1);
		expect(read().repositories[1]).toMatchObject({
			repositoryPath: "/repos/sayflowers",
			baseBranch: "staging",
			linearWorkspaceId: "github",
			teamKeys: ["teamnovu/sayflowers"],
		});
	});

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
		const { dir } = home();
		const integration = createInbudgetIntegrationFactory({
			fetch: (async () => Response.json([])) as unknown as typeof fetch,
		})({
			env: {
				INBUDGET_URL: "https://inbudget.test",
				INBUDGET_TOKEN: "jwt",
				CYRUS_API_KEY: "key",
				INBUDGET_SYNC_INTERVAL_MINUTES: "0",
			},
			cyrusHome: dir,
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
				repos: [],
				trackers: { jira: false, clickup: false, github: false },
			});
			expect(
				(
					await fastify.inject({
						method: "POST",
						url: "/api/dashboard/inbudget/manual",
						headers: { authorization: "Bearer key" },
						payload: { repo: "nope", platform: "jira" },
					})
				).statusCode,
			).toBe(400);
			const manual = await fastify.inject({
				method: "POST",
				url: "/api/dashboard/inbudget/manual",
				headers: { authorization: "Bearer key" },
				payload: {
					repo: "teamnovu/sayflowers",
					platform: "jira",
					teamKeys: ["SAY"],
				},
			});
			expect(manual.statusCode).toBe(200);
			const bulk = await fastify.inject({
				method: "POST",
				url: "/api/dashboard/inbudget/manual",
				headers: { authorization: "Bearer key" },
				payload: {
					repos: ["teamnovu/zuriga-web", "teamnovu/zuriga-cms"],
					group: "Zuriga",
				},
			});
			expect(bulk.statusCode).toBe(200);
			const groupKeys = await fastify.inject({
				method: "POST",
				url: "/api/dashboard/inbudget/manual",
				headers: { authorization: "Bearer key" },
				payload: { groupKey: "client:7", platform: "jira", teamKeys: ["ZUR"] },
			});
			expect(groupKeys.statusCode).toBe(200);
			expect(readManual(dir)["@group:client:7"]).toEqual({
				jira: { teamKeys: ["ZUR"], projectKeys: [] },
			});
			expect(
				(
					await fastify.inject({
						method: "POST",
						url: "/api/dashboard/inbudget/manual",
						headers: { authorization: "Bearer key" },
						payload: { groupKey: "nope", platform: "jira" },
					})
				).statusCode,
			).toBe(400);
			expect(readManual(dir)["teamnovu/zuriga-cms"]).toEqual({
				group: "Zuriga",
			});
			expect(
				(
					await fastify.inject({
						method: "POST",
						url: "/api/dashboard/inbudget/manual",
						headers: { authorization: "Bearer key" },
						payload: { repos: ["teamnovu/a"], platform: "jira" },
					})
				).statusCode,
			).toBe(400);
			expect(readManual(dir)).toMatchObject({
				"teamnovu/sayflowers": { jira: { teamKeys: ["SAY"], projectKeys: [] } },
			});
		} finally {
			integration.dispose?.();
		}
	});
});
