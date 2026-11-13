import { describe, expect, it } from "vitest";
import {
	issueIdFromSessionId,
	SessionStore,
	sessionIdFor,
} from "../src/SessionStore.js";

describe("session ids", () => {
	it("derive from the ticket and back", () => {
		expect(sessionIdFor("jira", "10001")).toBe("jira-10001");
		expect(issueIdFromSessionId("jira", "jira-10001")).toBe("10001");
		expect(issueIdFromSessionId("jira", "clickup-86c1")).toBeUndefined();
		expect(issueIdFromSessionId("jira", "jira-")).toBeUndefined();
	});
});

describe("SessionStore.resolveAnswer", () => {
	const options = [{ value: "web" }, { value: "api", label: "API" }];

	it("maps a number or a label to the option's value, once", () => {
		const store = new SessionStore();
		store.setQuestion("s", options);
		expect(store.resolveAnswer("s", " 2. ")).toBe("api");
		expect(store.resolveAnswer("s", "2")).toBe("2"); // question closed

		store.setQuestion("s", options);
		expect(store.resolveAnswer("s", "api")).toBe("api");
		store.setQuestion("s", options);
		expect(store.resolveAnswer("s", "Api")).toBe("api");
	});

	it("passes anything else on as written", () => {
		const store = new SessionStore();
		store.setQuestion("s", options);
		expect(store.resolveAnswer("s", "7")).toBe("7");
		expect(store.resolveAnswer("t", "1")).toBe("1");
	});
});
