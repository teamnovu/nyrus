import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		// The release tests pack and publish every workspace package; with the
		// fork's extra packages they outgrow the 5 s default under parallel load.
		testTimeout: 30_000,
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			reportsDirectory: "./coverage",
		},
	},
});
