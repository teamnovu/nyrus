import { describe, expect, it } from "vitest";
import { McpConfigService } from "../src/McpConfigService.js";

const jira = { type: "stdio" as const, command: "node", args: ["jira-mcp.js"] };
const clickup = {
	type: "stdio" as const,
	command: "node",
	args: ["clickup-mcp.js"],
};

function service(
	trackers: Record<string, unknown> = { jira, clickup },
	planeForGithub = false,
) {
	return new McpConfigService({
		getLinearTokenForWorkspace: () => undefined,
		getIssueTracker: () => undefined,
		getCyrusToolsMcpUrl: () => "http://localhost/mcp/cyrus-tools",
		createCyrusToolsOptions: () => ({}) as never,
		getTrackerMcpServers: (workspaceId) =>
			planeForGithub && workspaceId === "github"
				? ({ plane: jira } as never)
				: undefined,
		getAllTrackerMcpServers: () => trackers as never,
	});
}

describe("McpConfigService - chat sessions", () => {
	it("gives a chat session every tracker's tools, whatever its workspace", () => {
		const config = service().buildChatMcpConfig("web", "github", "chat-1");
		expect(Object.keys(config ?? {}).sort()).toEqual([
			"clickup",
			"cyrus-docs",
			"jira",
		]);
	});

	it("gives a chat session without a repository the trackers' tools too", () => {
		expect(
			Object.keys(service().buildChatMcpConfig(undefined, undefined) ?? {}),
		).toEqual(["jira", "clickup"]);
	});

	it("has no MCP config without a workspace or trackers", () => {
		expect(
			service({}).buildChatMcpConfig(undefined, undefined),
		).toBeUndefined();
	});
});
