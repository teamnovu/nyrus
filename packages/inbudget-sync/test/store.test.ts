import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";
import { InbudgetSync } from "../src/InbudgetSync.js";
import type { DesiredRepository } from "../src/plan.js";
import { RedisInbudgetStore, type RedisLike } from "../src/store.js";

const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:6379";

async function redisAvailable(): Promise<boolean> {
	const probe = new Redis(REDIS_URL, {
		lazyConnect: true,
		maxRetriesPerRequest: 0,
		retryStrategy: () => null,
	});
	try {
		await probe.connect();
		await probe.ping();
		return true;
	} catch {
		return false;
	} finally {
		probe.disconnect();
	}
}
const available = await redisAvailable();

const clients: Redis[] = [];
const prefixes = new Set<string>();
afterAll(async () => {
	const cleanup = clients[0];
	for (const prefix of prefixes) {
		const keys = await cleanup?.keys(`${prefix}*`).catch(() => []);
		if (keys?.length) await cleanup?.del(...keys);
	}
	for (const client of clients) await client.quit().catch(() => {});
});

function store(prefix: string) {
	prefixes.add(prefix);
	const redis = new Redis(REDIS_URL);
	clients.push(redis);
	return new RedisInbudgetStore(redis as unknown as RedisLike, prefix);
}

function home() {
	const dir = mkdtempSync(join(tmpdir(), "inbudget-redis-"));
	writeFileSync(join(dir, "config.json"), JSON.stringify({ repositories: [] }));
	return dir;
}

const context = {
	jira: { host: "novu.atlassian.net", workspaceKey: "jira-novu" },
};

function client() {
	const calls: string[] = [];
	return {
		calls,
		client: {
			listProjects: vi.fn(async () => {
				calls.push("projects");
				return [
					{
						id: 1,
						nr: "1",
						name: "Website",
						client: { "@id": "/api/clients/7", name: "Zuriga" },
					},
				];
			}),
			listClientResources: vi.fn(async (since?: string) => {
				calls.push(since ? "resources-changed" : "resources");
				return since
					? []
					: [
							{
								id: 10,
								environment: "production",
								client: "/api/clients/7",
								repositoryUrl: "https://github.com/teamnovu/zuriga-web",
							},
						];
			}),
			listProjectInfos: vi.fn(async () => {
				calls.push("infos");
				return [];
			}),
		},
	};
}

const quiet = { info() {}, warn() {}, error() {}, debug() {} } as never;

describe.skipIf(!available)("Redis store shared by several nyrus", () => {
	it("lets one nyrus read inBudget and the others use the shared cache and manual routing", async () => {
		const prefix = `test:${Date.now()}:${Math.random()}:`;
		const a = client();
		const b = client();
		const clone = async (_r: DesiredRepository, name: string) => ({
			path: `/repos/${name}`,
		});
		const first = new InbudgetSync({
			client: a.client,
			cyrusHome: home(),
			context,
			clone,
			logger: quiet,
			store: store(prefix),
			minChangesIntervalMs: 60_000,
		});
		const second = new InbudgetSync({
			client: b.client,
			cyrusHome: home(),
			context,
			clone,
			logger: quiet,
			store: store(prefix),
			minChangesIntervalMs: 60_000,
		});

		await first.sync("changes");
		expect(a.calls).toEqual(["projects", "resources", "infos"]);
		// The second one finds fresh changes in the shared cache: no request.
		const status = await second.sync("changes");
		expect(b.calls).toEqual([]);
		expect(status.repos?.map((r) => r.repo)).toEqual(["teamnovu/zuriga-web"]);

		// A manual change on one nyrus applies on the other.
		await first.setManual("teamnovu/zuriga-web", "jira", {
			teamKeys: ["ZUR"],
			projectKeys: [],
		});
		const applied = await second.sync("local");
		expect(applied.repositories?.map((r) => [r.repo, r.teamKeys])).toEqual([
			["teamnovu/zuriga-web", ["ZUR"]],
		]);
		expect(b.calls).toEqual([]);
	});

	it("holds the fetch lock for one nyrus at a time", async () => {
		const prefix = `test:${Date.now()}:${Math.random()}:`;
		const one = store(prefix);
		const two = store(prefix);
		let release!: () => void;
		const held = one.withLock(
			"fetch",
			5_000,
			() => new Promise<string>((resolve) => (release = () => resolve("one"))),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(
			await two.withLock("fetch", 5_000, async () => "two"),
		).toBeUndefined();
		release();
		expect(await held).toBe("one");
		expect(await two.withLock("fetch", 5_000, async () => "two")).toBe("two");
	});
});
