import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createClickUpToolsServer } from "../src/mcp/ClickUpToolsServer.js";
import { clickUpTask, fakeClickUp, LIST } from "./fakeClickUp.js";

const TASK = "1amxjbadtjm";

async function connect(routes: Record<string, unknown>) {
	const fake = fakeClickUp(routes);
	const server = createClickUpToolsServer(fake.api);
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "test", version: "1.0.0" });
	await client.connect(clientTransport);
	const call = async (name: string, args: Record<string, unknown>) => {
		const result = (await client.callTool({ name, arguments: args })) as {
			content: Array<{ text: string }>;
			isError?: boolean;
		};
		return { text: result.content[0]!.text, isError: result.isError };
	};
	return { call, calls: fake.calls };
}

describe("ClickUp tools", () => {
	it("add_comment signs the comment and puts mentions first", async () => {
		const { call, calls } = await connect({
			[`POST /task/${TASK}/comment`]: { id: 5 },
		});
		const result = await call("add_comment", {
			task: `CU-${TASK}`,
			body: "Please review **PR #20**.",
			mention: [42],
		});

		expect(JSON.parse(result.text)).toEqual({
			id: "5",
			url: `https://app.clickup.com/t/${TASK}`,
		});
		expect(calls[0]?.body).toEqual({
			notify_all: false,
			comment: [
				{ text: "🤖 nyrus:", attributes: { bold: true } },
				{ text: "\n" },
				{ type: "tag", user: { id: 42 } },
				{ text: " " },
				{ text: "\n" },
				{ text: "Please review " },
				{ text: "PR #20", attributes: { bold: true } },
				{ text: "." },
				{ text: "\n" },
			],
		});
	});

	it("set_status takes a status of the task's List, or says which there are", async () => {
		const { call, calls } = await connect({
			[`GET /task/${TASK}`]: clickUpTask(),
			[`GET /list/${LIST.id}`]: LIST,
			[`PUT /task/${TASK}`]: {},
		});

		expect(
			JSON.parse(
				(await call("set_status", { task: TASK, status: "In Review" })).text,
			),
		).toEqual({ task: TASK, status: "in review" });
		expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
			status: "in review",
		});

		const missing = await call("set_status", { task: TASK, status: "shipped" });
		expect(missing.isError).toBe(true);
		expect(missing.text).toContain("to do, in progress, in review, complete");
	});

	it("get_task leaves out nyrus's own comments", async () => {
		const { call } = await connect({
			[`GET /task/${TASK}`]: clickUpTask(),
			[`GET /task/${TASK}/comment`]: {
				comments: [
					{ id: 2, comment_text: "🤖 nyrus:\nWorking on it." },
					{ id: 1, comment: [{ text: "please fix" }], date: "1794574316000" },
				],
			},
		});
		const task = JSON.parse((await call("get_task", { task: TASK })).text);
		expect(task.comments).toEqual([
			{
				id: "1",
				author: null,
				createdAt: "2026-11-13T12:51:56.000Z",
				text: "please fix",
			},
		]);
		expect(task.description).toBe(
			"## Steps\n\n- open the **shop**\n- tap `menu`",
		);
	});

	it("download_attachments never overwrites a file in the directory", async () => {
		const dir = await mkdtemp(join(tmpdir(), "clickup-attachments-"));
		await writeFile(join(dir, "package.json"), "keep");
		const { call } = await connect({
			[`GET /task/${TASK}`]: clickUpTask({
				attachments: [
					{
						id: "a1",
						title: "package.json",
						url: "https://files.localhost/a1",
					},
				],
			}),
			"GET https://files.localhost/a1": new Response("from clickup"),
		});

		const { files } = JSON.parse(
			(await call("download_attachments", { task: TASK, directory: dir })).text,
		) as { files: Array<{ name: string }> };
		expect(files.map((f) => f.name)).toEqual(["package (2).json"]);
		expect(await readFile(join(dir, "package.json"), "utf8")).toBe("keep");
		expect(await readFile(join(dir, "package (2).json"), "utf8")).toBe(
			"from clickup",
		);
	});
});
