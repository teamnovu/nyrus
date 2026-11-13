import { describe, expect, it } from "vitest";
import { addRunToTotals } from "../src/AgentSessionManager.js";

describe("addRunToTotals", () => {
	const result = {
		duration_ms: 90_000,
		total_cost_usd: 0.5,
		usage: {
			input_tokens: 10,
			output_tokens: 20,
			cache_read_input_tokens: 300,
			cache_creation_input_tokens: 4_000,
		},
	} as Parameters<typeof addRunToTotals>[1];

	it("starts the totals with the first run", () => {
		expect(addRunToTotals(undefined, result)).toEqual({
			runs: 1,
			durationMs: 90_000,
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 300,
			cacheCreationTokens: 4_000,
			costUsd: 0.5,
		});
	});

	it("adds later runs (a resumed session) and tolerates missing usage", () => {
		const first = addRunToTotals(undefined, result);
		const second = addRunToTotals(first, {
			duration_ms: 30_000,
			total_cost_usd: 0.25,
		} as Parameters<typeof addRunToTotals>[1]);

		expect(second).toMatchObject({
			runs: 2,
			durationMs: 120_000,
			inputTokens: 10,
			costUsd: 0.75,
		});
	});
});
