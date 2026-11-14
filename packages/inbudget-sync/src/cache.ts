import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	InbudgetClientResource,
	InbudgetProject,
	InbudgetProjectInfo,
} from "./InbudgetClient.js";

/**
 * What nyrus last read from inBudget, so changes in the dashboard are
 * applied without asking inBudget again, and a sync only fetches changes.
 */
export interface InbudgetCache {
	projects: InbudgetProject[];
	infos: InbudgetProjectInfo[];
	resources: InbudgetClientResource[];
	fetchedAt: {
		/** Last full sync (everything read again). */
		full?: string;
		/** Last time client resources were read (full or changes since). */
		resources?: string;
		/** Last time the project list was read. */
		projects?: string;
	};
}

export function cachePath(cyrusHome: string): string {
	return join(cyrusHome, "inbudget-cache.json");
}

export function readCache(cyrusHome: string): InbudgetCache | undefined {
	try {
		const data = JSON.parse(
			readFileSync(cachePath(cyrusHome), "utf8"),
		) as Partial<InbudgetCache>;
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

export function writeCache(cyrusHome: string, cache: InbudgetCache): void {
	writeFileSync(cachePath(cyrusHome), JSON.stringify(cache));
}

/** Replace items by id with newer ones, keep the rest. */
export function mergeById<T extends { id: number }>(
	current: T[],
	changed: T[],
): T[] {
	const byId = new Map(current.map((item) => [item.id, item]));
	for (const item of changed) byId.set(item.id, item);
	return [...byId.values()];
}
