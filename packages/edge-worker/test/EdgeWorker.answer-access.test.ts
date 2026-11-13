import { LinearClient } from "@linear/sdk";
import { ClaudeRunner } from "cyrus-claude-runner";
import { LinearEventTransport } from "cyrus-linear-event-transport";
import { createCyrusToolsServer } from "cyrus-mcp-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";
import { TEST_CYRUS_HOME } from "./test-dirs.js";

vi.mock("fs/promises");
vi.mock("cyrus-claude-runner");
vi.mock("cyrus-mcp-tools");
vi.mock("cyrus-codex-runner");
vi.mock("cyrus-linear-event-transport");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		PersistenceManager: vi.fn().mockImplementation(function () {
			return {
				loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
				saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
			};
		}),
	};
});

/**
 * Answers to a pending repository selection or an agent question steer a
 * session, so they must pass user access control like any other prompt. In
 * ClickUp and Jira anyone who can comment on a ticket (also guests) sends
 * them. A blocked user's answer is ignored and the session keeps waiting.
 */
describe("EdgeWorker - access control for answers", () => {
	let edgeWorker: EdgeWorker;

	const repository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/test/repo",
		workspaceBaseDir: "/test/workspaces",
		baseBranch: "main",
		linearWorkspaceId: "test-workspace",
		isActive: true,
		allowedTools: ["Read"],
		labelPrompts: {},
		teamKeys: ["TEST"],
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.mocked(createCyrusToolsServer).mockImplementation(
			() => ({ server: {} }) as any,
		);
		vi.mocked(ClaudeRunner).mockImplementation(function () {
			return { isRunning: vi.fn().mockReturnValue(false) };
		} as any);
		vi.mocked(AgentSessionManager).mockImplementation(function () {
			return {
				getSession: vi.fn().mockReturnValue(null),
				setActivitySink: vi.fn(),
				on: vi.fn(),
			};
		} as any);
		vi.mocked(SharedApplicationServer).mockImplementation(function () {
			return {
				start: vi.fn(),
				stop: vi.fn(),
				getFastifyInstance: vi.fn().mockReturnValue({ post: vi.fn() }),
				getWebhookUrl: vi.fn().mockReturnValue("http://localhost:3456"),
				registerOAuthCallbackHandler: vi.fn(),
			};
		} as any);
		vi.mocked(LinearEventTransport).mockImplementation(function () {
			return { register: vi.fn(), on: vi.fn(), removeAllListeners: vi.fn() };
		} as any);
		vi.mocked(LinearClient).mockImplementation(function () {
			return { users: { me: vi.fn() } };
		} as any);

		const config: EdgeWorkerConfig = {
			proxyUrl: "http://localhost:3000",
			cyrusHome: TEST_CYRUS_HOME,
			repositories: [repository],
			linearWorkspaces: { "test-workspace": { linearToken: "test-token" } },
			userAccessControl: { blockedUsers: ["guest-1"] },
		};
		edgeWorker = new EdgeWorker(config);
		(edgeWorker as any).repositories.set(repository.id, repository);
	});

	function answer(from: string, body = "Test Repo") {
		return (edgeWorker as any).handleUserPromptedAgentActivity({
			type: "AgentSessionEvent",
			action: "prompted",
			organizationId: "test-workspace",
			agentSession: {
				id: "session-1",
				issue: { id: "issue-1", identifier: "TEST-1" },
				creator: { id: from, name: from, email: "" },
			},
			agentActivity: { content: { type: "prompt", body } },
		});
	}

	it("ignores a blocked user's repository pick and keeps the selection open", async () => {
		const router = (edgeWorker as any).repositoryRouter;
		router.pendingSelections.set("session-1", {
			issueId: "issue-1",
			workspaceRepos: [repository],
		});
		const select = vi
			.spyOn(edgeWorker as any, "handleRepositorySelectionResponse")
			.mockResolvedValue(undefined);

		await answer("guest-1");
		expect(select).not.toHaveBeenCalled();
		expect(router.hasPendingSelection("session-1")).toBe(true);

		await answer("member-1");
		expect(select).toHaveBeenCalledTimes(1);
	});

	it("ignores a blocked user's answer to the agent's question", async () => {
		vi.spyOn(
			(edgeWorker as any).askUserQuestionHandler,
			"hasPendingQuestion",
		).mockReturnValue(true);
		const respond = vi
			.spyOn(edgeWorker as any, "handleAskUserQuestionResponse")
			.mockResolvedValue(undefined);
		(edgeWorker as any).sessionRepositories.set("session-1", repository.id);

		await answer("guest-1", "Yes, delete it");
		expect(respond).not.toHaveBeenCalled();

		await answer("member-1", "Yes, delete it");
		expect(respond).toHaveBeenCalledTimes(1);
	});
});
