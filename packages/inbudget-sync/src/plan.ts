import {
	type InbudgetProject,
	type InbudgetProjectInfo,
	projectKeysOf,
	projectRefOf,
} from "./InbudgetClient.js";
import { type ProjectLink, parseProjectLink } from "./links.js";

/** The trackers nyrus takes work from, as configured in its environment. */
export interface PlanContext {
	/** The Jira site nyrus works on (JIRA_BASE_URL) and its workspace key. */
	jira?: { host: string; workspaceKey: string };
	/** The ClickUp workspace nyrus works on (CLICKUP_TEAM_ID) and its workspace key. */
	clickup?: { teamId?: string; workspaceKey: string };
	/** A ClickUp List's name (repositories route Lists by name). */
	listName?: (listId: string) => Promise<string | undefined>;
}

/** A repository nyrus should have for one tracker workspace. */
export interface DesiredRepository {
	/** `owner/name` on GitHub */
	repo: string;
	/** Base branch, if a link names one (`…/tree/<branch>`). */
	branch?: string;
	platform: "jira" | "clickup";
	workspaceKey: string;
	/** Jira project keys / ClickUp Space ids */
	teamKeys: string[];
	/** ClickUp List names */
	projectKeys: string[];
	/** The inBudget projects it comes from, e.g. "2041 Webshop (Sayflowers)". */
	projects: string[];
}

export interface SyncPlan {
	repositories: DesiredRepository[];
	/** Projects whose links nyrus can't use, and why. */
	warnings: Array<{ project: string; message: string }>;
	/** Projects with a GitHub repository but no Jira or ClickUp link. */
	unrouted: string[];
	projectCount: number;
	/** Project infos read from inBudget (of all projects, archived ones too). */
	infoCount: number;
	/** Infos that belong to an active project. */
	matchedInfoCount: number;
	/** Infos of active projects nyrus recognised as a GitHub, Jira or ClickUp link. */
	linkCount: number;
}

/**
 * Which repositories nyrus needs: for every active project with a GitHub
 * link and a Jira or ClickUp link, its repository routed from that Jira
 * project / ClickUp Space or List. A repository linked from several
 * projects gets all their keys; one per tracker workspace.
 */
export async function planRepositories(
	projects: InbudgetProject[],
	infos: InbudgetProjectInfo[],
	context: PlanContext,
): Promise<SyncPlan> {
	const infosByProject = new Map<string, InbudgetProjectInfo[]>();
	for (const info of infos) {
		const ref = projectRefOf(info);
		if (ref === undefined) continue;
		const list = infosByProject.get(ref) ?? [];
		list.push(info);
		infosByProject.set(ref, list);
	}
	let matchedInfoCount = 0;
	let linkCount = 0;

	const desired = new Map<string, DesiredRepository>();
	const warnings: SyncPlan["warnings"] = [];
	const unrouted: string[] = [];

	for (const project of projects) {
		const label = projectLabel(project);
		const projectInfos = uniqueBy(
			projectKeysOf(project).flatMap((key) => infosByProject.get(key) ?? []),
			(info) => String(info.id),
		);
		matchedInfoCount += projectInfos.length;
		const links: ProjectLink[] = [];
		for (const info of projectInfos) {
			const link = parseProjectLink(info);
			if (link) {
				links.push(link);
				linkCount++;
			} else if (isUnusableGitLink(info)) {
				warnings.push({
					project: label,
					message: `git link ${(info.url ?? info.value ?? "").trim()} is not a GitHub repository (nyrus clones from GitHub only)`,
				});
			}
		}
		const repos = uniqueBy(
			links.filter((l) => l.type === "github"),
			(l) => l.repo.toLowerCase(),
		);
		const targets: Array<{
			platform: "jira" | "clickup";
			workspaceKey: string;
			teamKey?: string;
			projectKey?: string;
		}> = [];

		for (const link of links) {
			if (link.type === "jira") {
				if (!context.jira) {
					warnings.push({
						project: label,
						message: `Jira project ${link.projectKey}: Jira is not set up in nyrus (JIRA_BASE_URL)`,
					});
				} else if (link.host && link.host !== context.jira.host) {
					warnings.push({
						project: label,
						message: `Jira project ${link.projectKey} is on ${link.host}, nyrus works on ${context.jira.host}`,
					});
				} else {
					targets.push({
						platform: "jira",
						workspaceKey: context.jira.workspaceKey,
						teamKey: link.projectKey,
					});
				}
			} else if (link.type === "clickup") {
				const target = await clickUpTarget(link, context);
				if ("warning" in target) {
					warnings.push({ project: label, message: target.warning });
				} else {
					targets.push({ platform: "clickup", ...target });
				}
			}
		}

		if (repos.length === 0) {
			if (targets.length > 0) {
				warnings.push({
					project: label,
					message: "has a Jira/ClickUp link but no GitHub repository link",
				});
			}
			continue;
		}
		if (targets.length === 0) {
			if (!links.some((l) => l.type !== "github")) unrouted.push(label);
			continue;
		}

		for (const link of repos) {
			for (const target of targets) {
				const key = `${link.repo.toLowerCase()}|${target.workspaceKey}`;
				const entry =
					desired.get(key) ??
					({
						repo: link.repo,
						platform: target.platform,
						workspaceKey: target.workspaceKey,
						teamKeys: [],
						projectKeys: [],
						projects: [],
					} satisfies DesiredRepository);
				if (link.branch) {
					if (entry.branch && entry.branch !== link.branch) {
						warnings.push({
							project: label,
							message: `${link.repo}: branch ${link.branch} differs from ${entry.branch} of another project; using ${entry.branch}`,
						});
					} else {
						entry.branch = link.branch;
					}
				}
				addUnique(entry.teamKeys, target.teamKey);
				addUnique(entry.projectKeys, target.projectKey);
				addUnique(entry.projects, label);
				desired.set(key, entry);
			}
		}
	}

	return {
		repositories: [...desired.values()].sort((a, b) =>
			`${a.repo}|${a.workspaceKey}`.localeCompare(
				`${b.repo}|${b.workspaceKey}`,
			),
		),
		warnings,
		unrouted,
		projectCount: projects.length,
		infoCount: infos.length,
		matchedInfoCount,
		linkCount,
	};
}

/** A git info with a value nyrus can't read as a GitHub repository. */
function isUnusableGitLink(info: InbudgetProjectInfo): boolean {
	const text = (info.url ?? info.value ?? "").trim();
	if (!text) return false;
	return (
		info.kind === "git" || /(^|[@/.])(gitlab|bitbucket)\.|\.git\/?$/i.test(text)
	);
}

async function clickUpTarget(
	link: Extract<ProjectLink, { type: "clickup" }>,
	context: PlanContext,
): Promise<
	| { workspaceKey: string; teamKey?: string; projectKey?: string }
	| { warning: string }
> {
	if (!context.clickup) {
		return {
			warning: `ClickUp ${link.target} ${link.id}: ClickUp is not set up in nyrus`,
		};
	}
	if (context.clickup.teamId && link.teamId !== context.clickup.teamId) {
		return {
			warning: `ClickUp ${link.target} ${link.id} is in workspace ${link.teamId}, nyrus works in ${context.clickup.teamId}`,
		};
	}
	const { workspaceKey } = context.clickup;
	if (link.target === "space") return { workspaceKey, teamKey: link.id };
	if (link.target === "folder") {
		return {
			warning: `ClickUp folder ${link.id}: link the Space or a List instead (nyrus routes by Space or List)`,
		};
	}
	const name = await context.listName?.(link.id).catch(() => undefined);
	return name
		? { workspaceKey, projectKey: name }
		: {
				warning: `ClickUp List ${link.id}: could not read its name (CLICKUP_API_TOKEN)`,
			};
}

export function projectLabel(project: InbudgetProject): string {
	const client =
		typeof project.client === "string" ? undefined : project.client?.name;
	return (
		[project.nr, project.name].filter(Boolean).join(" ") +
		(client ? ` (${client})` : "")
	);
}

function addUnique(list: string[], value: string | undefined): void {
	if (value && !list.includes(value)) list.push(value);
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const k = key(item);
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}
