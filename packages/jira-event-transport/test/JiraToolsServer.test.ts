import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { TrackerMcpSession } from "cyrus-comment-sessions";
import { describe, expect, it } from "vitest";
import { createJiraToolsServer } from "../src/mcp/JiraToolsServer.js";
import { BASE, fakeJira, jiraIssue } from "./fakeJira.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

async function connect(
	routes: Record<string, unknown>,
	session: Partial<TrackerMcpSession> = {},
) {
	const fake = fakeJira(routes);
	const server = createJiraToolsServer(fake.api, session);
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

describe("Jira tools", () => {
	describe("download_attachments", () => {
		const routes = {
			"GET /issue/SAY-12": {
				...jiraIssue({
					attachment: [
						{
							id: "a1",
							filename: "image-20261114.png",
							mimeType: "image/png",
							content: `${BASE}/files/a1`,
						},
					],
				}),
				key: "SAY-12",
			},
			[`GET ${BASE}/files/a1`]: new Response(new Uint8Array(PNG)),
		};

		it("saves into the session's attachments folder, whatever directory is asked for", async () => {
			const attachmentsDir = await mkdtemp(join(tmpdir(), "attachments-"));
			const elsewhere = await mkdtemp(join(tmpdir(), "elsewhere-"));
			const { call } = await connect(routes, { attachmentsDir });

			const first = await call("download_attachments", {
				key: "SAY-12",
				directory: elsewhere,
			});
			const again = await call("download_attachments", { key: "SAY-12" });

			const path = join(attachmentsDir, "SAY-12", "image-20261114.png");
			expect(JSON.parse(first.text)).toEqual({
				key: "SAY-12",
				files: [
					{
						name: "image-20261114.png",
						path,
						size: PNG.length,
						type: "image/png",
					},
				],
			});
			// Downloading again reuses the file instead of piling up copies.
			expect(JSON.parse(again.text).files[0].path).toBe(path);
			expect((await readFile(path)).equals(PNG)).toBe(true);
		});

		it("refuses without an attachments folder", async () => {
			const { call } = await connect(routes);

			const result = await call("download_attachments", { key: "SAY-12" });

			expect(result.isError).toBe(true);
			expect(result.text).toContain("can't be downloaded in this session");
		});
	});

	describe("upload_attachments", () => {
		async function setup() {
			const workspacePath = await mkdtemp(join(tmpdir(), "worktree-"));
			const outside = await mkdtemp(join(tmpdir(), "outside-"));
			await writeFile(join(workspacePath, "SAY-12-after.png"), PNG);
			await writeFile(join(outside, "id_rsa"), "-----BEGIN KEY-----");
			const { call, calls } = await connect(
				{
					"GET /issue/SAY-12": {
						...jiraIssue({
							attachment: [
								{
									id: "a1",
									filename: "SAY-12-after.png",
									content: `${BASE}/files/a1`,
								},
							],
						}),
						key: "SAY-12",
					},
					"POST /issue/SAY-12/attachments": [
						{ id: "a2", filename: "SAY-12-after-2.png", size: PNG.length },
					],
				},
				{ workspacePath },
			);
			return { call, calls, workspacePath, outside };
		}

		it("attaches images from the worktree, numbering names the issue has", async () => {
			const { call, calls, workspacePath } = await setup();

			const result = await call("upload_attachments", {
				key: "SAY-12",
				files: [join(workspacePath, "SAY-12-after.png")],
			});

			expect(JSON.parse(result.text)).toEqual({
				key: "SAY-12",
				attachments: [{ filename: "SAY-12-after-2.png", size: PNG.length }],
			});
			const upload = calls.find((c) => c.method === "POST");
			const files = (upload?.body as FormData).getAll("file") as File[];
			expect(files.map((f) => [f.name, f.type])).toEqual([
				["SAY-12-after-2.png", "image/png"],
			]);
		});

		it("refuses files outside the worktree, also through a symlink, and non-images", async () => {
			const { call, calls, workspacePath, outside } = await setup();
			await symlink(join(outside, "id_rsa"), join(workspacePath, "key.png"));
			await writeFile(join(workspacePath, ".env"), "SECRET=1");

			for (const file of [
				join(outside, "id_rsa"),
				join(workspacePath, "key.png"),
				join(workspacePath, ".env"),
			]) {
				const result = await call("upload_attachments", {
					key: "SAY-12",
					files: [file],
				});
				expect(result.isError).toBe(true);
			}
			expect(calls.some((c) => c.method === "POST")).toBe(false);
		});
	});
});
