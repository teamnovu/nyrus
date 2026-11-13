#!/usr/bin/env node
/**
 * Stdio entry point for the Jira tools MCP server (see JiraToolsServer).
 * Configured by the JIRA_* variables that jiraToolsMcpServerConfig sets.
 */

// Stdout carries the MCP protocol; send every log line to stderr.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

const { StdioServerTransport } = await import(
	"@modelcontextprotocol/sdk/server/stdio.js"
);
const { JiraApiClient } = await import("../JiraApiClient.js");
const { createJiraToolsServer } = await import("./JiraToolsServer.js");

function required(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		console.error(`Jira tools MCP server: ${name} is not set`);
		process.exit(1);
	}
	return value;
}

const api = new JiraApiClient({
	baseUrl: required("JIRA_BASE_URL").replace(/\/+$/, ""),
	email: required("JIRA_EMAIL"),
	apiToken: required("JIRA_API_TOKEN"),
});

await createJiraToolsServer(api).connect(new StdioServerTransport());
