#!/usr/bin/env node
/**
 * Stdio entry point for the ClickUp tools MCP server (see ClickUpToolsServer).
 * Configured by the CLICKUP_* variables that clickUpToolsMcpServerConfig sets.
 */

// Stdout carries the MCP protocol; send every log line to stderr.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

const { StdioServerTransport } = await import(
	"@modelcontextprotocol/sdk/server/stdio.js"
);
const { ClickUpApiClient } = await import("../ClickUpApiClient.js");
const { createClickUpToolsServer } = await import("./ClickUpToolsServer.js");

const apiToken = process.env.CLICKUP_API_TOKEN?.trim();
if (!apiToken) {
	console.error("ClickUp tools MCP server: CLICKUP_API_TOKEN is not set");
	process.exit(1);
}

const api = new ClickUpApiClient({
	apiToken,
	teamId: process.env.CLICKUP_TEAM_ID?.trim() || undefined,
});

await createClickUpToolsServer(api).connect(new StdioServerTransport());
