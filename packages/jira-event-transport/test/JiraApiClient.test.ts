import { describe, expect, it } from "vitest";
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
});
