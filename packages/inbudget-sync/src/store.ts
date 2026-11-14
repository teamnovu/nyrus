import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type InbudgetCache, readCache, writeCache } from "./cache.js";
import {
	type ManualRepository,
	type ManualRouting,
	readManual,
	updateManualFile,
} from "./manual.js";

/**
 * Where the inBudget sync keeps what it shares: the cache of what it read
 * from inBudget, the dashboard's manual routing and groups, and the
 * repositories set up for GitHub issues on demand. A file store for one
 * nyrus; a Redis store (REDIS_URL) when several nyrus share them, with a
 * lock so only one of them asks inBudget at a time.
 */
export interface InbudgetStore {
	readCache(): Promise<InbudgetCache | undefined>;
	writeCache(cache: InbudgetCache): Promise<void>;
	readManual(): Promise<ManualRouting>;
	/** Change one repository's manual entry (undefined removes it). */
	updateManual(
		repo: string,
		change: (
			entry: ManualRepository | undefined,
		) => ManualRepository | undefined,
	): Promise<void>;
	readRequested(): Promise<string[]>;
	addRequested(repos: string[]): Promise<void>;
	/**
	 * Run `fn` holding the lock `name` (for at most `ttlMs`); undefined if
	 * another nyrus holds it.
	 */
	withLock<T>(
		name: string,
		ttlMs: number,
		fn: () => Promise<T>,
	): Promise<T | undefined>;
	dispose?(): Promise<void>;
}

/** Files next to config.json (one nyrus). */
export class FileInbudgetStore implements InbudgetStore {
	constructor(private readonly cyrusHome: string) {}

	async readCache() {
		return readCache(this.cyrusHome);
	}

	async writeCache(cache: InbudgetCache) {
		writeCache(this.cyrusHome, cache);
	}

	async readManual() {
		return readManual(this.cyrusHome);
	}

	async updateManual(
		repo: string,
		change: (
			entry: ManualRepository | undefined,
		) => ManualRepository | undefined,
	) {
		updateManualFile(this.cyrusHome, repo, change);
	}

	async readRequested() {
		try {
			const list = JSON.parse(readFileSync(this.requestedPath(), "utf8"));
			return Array.isArray(list)
				? list.filter((r): r is string => typeof r === "string")
				: [];
		} catch {
			return [];
		}
	}

	async addRequested(repos: string[]) {
		const current = await this.readRequested();
		const next = [
			...new Set([...current, ...repos.map((r) => r.toLowerCase())]),
		].sort();
		if (next.length !== current.length) {
			writeFileSync(this.requestedPath(), `${JSON.stringify(next, null, 2)}\n`);
		}
	}

	async withLock<T>(_name: string, _ttlMs: number, fn: () => Promise<T>) {
		return fn(); // one nyrus: its syncs already run one at a time
	}

	private requestedPath() {
		return join(this.cyrusHome, "inbudget-github.json");
	}
}

/** The few Redis commands the store needs (ioredis provides them). */
export interface RedisLike {
	get(key: string): Promise<string | null>;
	set(
		key: string,
		value: string,
		...args: Array<string | number>
	): Promise<unknown>;
	hget(key: string, field: string): Promise<string | null>;
	hset(key: string, field: string, value: string): Promise<unknown>;
	hdel(key: string, field: string): Promise<unknown>;
	hgetall(key: string): Promise<Record<string, string>>;
	sadd(key: string, ...members: string[]): Promise<unknown>;
	smembers(key: string): Promise<string[]>;
	eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
	quit?(): Promise<unknown>;
}

const RELEASE_LOCK =
	'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

/**
 * Redis, shared by several nyrus: the cache as one JSON value, manual
 * entries as a hash (one field per repository, so two changes don't
 * overwrite each other), requested repositories as a set.
 */
export class RedisInbudgetStore implements InbudgetStore {
	constructor(
		private readonly redis: RedisLike,
		private readonly prefix = "nyrus:inbudget:",
	) {}

	async readCache() {
		const raw = await this.redis.get(this.key("cache"));
		if (!raw) return undefined;
		try {
			const data = JSON.parse(raw) as Partial<InbudgetCache>;
			if (!Array.isArray(data.projects)) return undefined;
			return {
				projects: data.projects,
				infos: Array.isArray(data.infos) ? data.infos : [],
				resources: Array.isArray(data.resources) ? data.resources : [],
				fetchedAt: data.fetchedAt ?? {},
			};
		} catch {
			return undefined;
		}
	}

	async writeCache(cache: InbudgetCache) {
		await this.redis.set(this.key("cache"), JSON.stringify(cache));
	}

	async readManual() {
		const all = await this.redis.hgetall(this.key("manual"));
		const manual: ManualRouting = {};
		for (const [repo, raw] of Object.entries(all)) {
			try {
				manual[repo] = JSON.parse(raw) as ManualRepository;
			} catch {
				// a broken entry is left out
			}
		}
		return manual;
	}

	async updateManual(
		repo: string,
		change: (
			entry: ManualRepository | undefined,
		) => ManualRepository | undefined,
	) {
		const field = repo.toLowerCase();
		const raw = await this.redis.hget(this.key("manual"), field);
		let current: ManualRepository | undefined;
		try {
			current = raw ? (JSON.parse(raw) as ManualRepository) : undefined;
		} catch {
			current = undefined;
		}
		const next = change(current);
		if (next)
			await this.redis.hset(this.key("manual"), field, JSON.stringify(next));
		else await this.redis.hdel(this.key("manual"), field);
	}

	async readRequested() {
		return (await this.redis.smembers(this.key("github-requested"))).sort();
	}

	async addRequested(repos: string[]) {
		if (repos.length === 0) return;
		await this.redis.sadd(
			this.key("github-requested"),
			...repos.map((r) => r.toLowerCase()),
		);
	}

	async withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>) {
		const key = this.key(`lock:${name}`);
		const token = randomUUID();
		const acquired = await this.redis.set(key, token, "PX", ttlMs, "NX");
		if (acquired !== "OK") return undefined;
		try {
			return await fn();
		} finally {
			await this.redis.eval(RELEASE_LOCK, 1, key, token).catch(() => {});
		}
	}

	async dispose() {
		await this.redis.quit?.().catch(() => {});
	}

	private key(name: string) {
		return `${this.prefix}${name}`;
	}
}

/**
 * The store for this nyrus: Redis with REDIS_URL (prefix
 * INBUDGET_REDIS_PREFIX, default `nyrus:inbudget:`), else files.
 */
export async function createInbudgetStore(
	env: NodeJS.ProcessEnv,
	cyrusHome: string,
): Promise<InbudgetStore> {
	const url = env.REDIS_URL?.trim();
	if (!url) return new FileInbudgetStore(cyrusHome);
	const { Redis } = await import("ioredis");
	const redis = new Redis(url, {
		maxRetriesPerRequest: 3,
		enableOfflineQueue: true,
		lazyConnect: false,
	});
	return new RedisInbudgetStore(
		redis as unknown as RedisLike,
		env.INBUDGET_REDIS_PREFIX?.trim() || "nyrus:inbudget:",
	);
}
