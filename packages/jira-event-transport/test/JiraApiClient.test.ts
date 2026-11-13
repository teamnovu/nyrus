import { describe, expect, it, vi } from "vitest";
import { JiraApiClient } from "../src/JiraApiClient.js";
import { fakeJira } from "./fakeJira.js";

const comment = (id: string) => ({ id, created: "", updated: "" });

describe("JiraApiClient", () => {
	it("reads every page of an issue's comments", async () => {
		const { api, fetchImpl } = fakeJira({});
		fetchImpl
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({
							comments: Array.from({ length: 100 }, (_, i) => comment(`c${i}`)),
							total: 101,
						}),
					),
			)
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({ comments: [comment("c100")], total: 101 }),
					),
			);

		const comments = await api.listComments("SAY-12");

		expect(comments.map((c) => c.id).slice(-2)).toEqual(["c99", "c100"]);
		expect(String(fetchImpl.mock.calls[1]![0])).toContain("startAt=100");
	});

	it("reads every page of projects", async () => {
		const project = (key: string) => ({ id: key, key, name: key });
		const { api, fetchImpl } = fakeJira({});
		fetchImpl
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({ values: [project("SAY")], isLast: false }),
					),
			)
			.mockImplementationOnce(
				async () =>
					new Response(
						JSON.stringify({ values: [project("ZOO")], isLast: true }),
					),
			);

		expect((await api.listProjects()).map((p) => p.key)).toEqual([
			"SAY",
			"ZOO",
		]);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	describe("service accounts", () => {
		const SITE = "https://acme.atlassian.net";
		const GATEWAY = "https://api.atlassian.com/ex/jira/cloud-123";

		function serviceAccountClient() {
			const fetchImpl = vi.fn(async (url: string) =>
				url === `${SITE}/_edge/tenant_info`
					? new Response(JSON.stringify({ cloudId: "cloud-123" }))
					: new Response(JSON.stringify({ accountId: "sa-1" })),
			);
			const api = new JiraApiClient(
				{
					baseUrl: SITE,
					email: "nyrus-abc@serviceaccount.atlassian.com",
					apiToken: "token",
				},
				{ fetch: fetchImpl as never },
			);
			return { api, fetchImpl };
		}

		it("call the API gateway with the site's cloud id, looked up once", async () => {
			const { api, fetchImpl } = serviceAccountClient();

			await api.myself();
			await api.getUser("u-1");

			const urls = fetchImpl.mock.calls.map(([url]) => String(url));
			expect(urls).toEqual([
				`${SITE}/_edge/tenant_info`,
				`${GATEWAY}/rest/api/2/myself`,
				`${GATEWAY}/rest/api/2/user?accountId=u-1`,
			]);
		});

		it("download attachments through the gateway, but link issues on the site", async () => {
			const { api, fetchImpl } = serviceAccountClient();

			await api.download(`${SITE}/rest/api/2/attachment/content/7`);

			expect(String(fetchImpl.mock.calls.at(-1)![0])).toBe(
				`${GATEWAY}/rest/api/2/attachment/content/7`,
			);
			expect(api.issueUrl("SAY-1")).toBe(`${SITE}/browse/SAY-1`);
		});

		it("keep the site URL for normal accounts", async () => {
			const { api, fetchImpl } = fakeJira({});
			fetchImpl.mockImplementationOnce(
				async () => new Response(JSON.stringify({ accountId: "a" })),
			);

			await api.myself();

			expect(String(fetchImpl.mock.calls[0]![0])).not.toContain(
				"api.atlassian.com",
			);
		});
	});
});
