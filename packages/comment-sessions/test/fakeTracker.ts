import { vi } from "vitest";
import type { CommentTracker } from "../src/types.js";

/**
 * An in-memory comment tracker with one ticket, TCK-1 (id "t-1"). Set
 * `state.handedOver` to hand the ticket to the agent.
 */
export function fakeTracker() {
	let nextId = 1;
	const comments = new Map<string, string>();
	const state = { handedOver: false };
	const tracker = {
		platform: "fake",
		workspaceKey: "fake-ws",
		comments,
		state,
		fetchIssueState: vi.fn(async (_issueId: string) => ({
			issue: {
				id: "t-1",
				identifier: "TCK-1",
				title: "Login broken",
				url: "https://tracker.example/t/TCK-1",
				team: Promise.resolve({ id: "space-1", key: "WEB", name: "Web" }),
			} as never,
			handedOver: state.handedOver,
		})),
		fetchUser: vi.fn(async (id: string) => ({
			id,
			name: "Ada",
			email: "ada@example.com",
		})) as unknown as CommentTracker["fetchUser"],
		postComment: vi.fn(async (_issueId: string, markdown: string) => {
			const id = `c-${nextId++}`;
			comments.set(id, markdown);
			return { id };
		}),
		updateComment: vi.fn(
			async (_issueId: string, commentId: string, markdown: string) => {
				comments.set(commentId, markdown);
			},
		),
		deleteComment: vi.fn(async (_issueId: string, commentId: string) => {
			comments.delete(commentId);
		}),
	};
	return tracker;
}
