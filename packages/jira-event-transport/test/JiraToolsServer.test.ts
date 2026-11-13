import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createJiraToolsServer } from "../src/mcp/JiraToolsServer.js";
import { BASE, fakeJira, jiraIssue } from "./fakeJira.js";

async function connect(routes: Record<string, unknown>) {
	const { api } = fakeJira(routes);
	const server = createJiraToolsServer(api);
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	const client = new Client({ name: "test", version: "1.0.0" });
	await client.connect(clientTransport);
	return client;
}

describe("Jira tools", () => {
	it("download_attachments never overwrites a file in the directory", async () => {
		const dir = await mkdtemp(join(tmpdir(), "jira-attachments-"));
		await writeFile(join(dir, "package.json"), "keep");
		const client = await connect({
			"GET /issue/SAY-12": jiraIssue({
				attachment: [
					{ id: "a1", filename: "package.json", content: `${BASE}/files/a1` },
				],
			}),
			[`GET ${BASE}/files/a1`]: new Response("from jira"),
		});

		const result = (await client.callTool({
			name: "download_attachments",
			arguments: { key: "SAY-12", directory: dir },
		})) as { content: Array<{ text: string }> };

		const { files } = JSON.parse(result.content[0]!.text) as {
			files: Array<{ name: string }>;
		};
		expect(files.map((f) => f.name)).toEqual(["package (2).json"]);
		expect(await readFile(join(dir, "package.json"), "utf8")).toBe("keep");
		expect(await readFile(join(dir, "package (2).json"), "utf8")).toBe(
			"from jira",
		);
	});
});
