/**
 * What an inBudget project link points to. Links are read by their URL, so
 * it doesn't matter which kind ("git", "jira", "documentation", ...) a
 * project info was saved as; the kind only helps with a bare value (e.g. a
 * Jira project key without a URL).
 */
export type ProjectLink =
	| { type: "github"; repo: string; branch?: string }
	| { type: "jira"; host?: string; projectKey: string }
	| {
			type: "clickup";
			teamId: string;
			target: "space" | "list" | "folder";
			id: string;
	  };

const JIRA_KEY = /^[A-Z][A-Z0-9_]{0,19}$/;

/** The link of a project info, or undefined if nyrus can't use it. */
export function parseProjectLink(info: {
	kind?: string | null;
	url?: string | null;
	value?: string | null;
}): ProjectLink | undefined {
	for (const candidate of [info.url, info.value]) {
		const text = candidate?.trim();
		if (!text) continue;
		const link =
			parseGitHubLink(text) ?? parseJiraLink(text) ?? parseClickUpLink(text);
		if (link) return link;
	}
	// A bare Jira project key ("SAY") saved as a Jira info.
	const value = info.value?.trim().toUpperCase();
	if (info.kind === "jira" && value && JIRA_KEY.test(value)) {
		return { type: "jira", projectKey: value };
	}
	return undefined;
}

/**
 * `https://github.com/owner/repo(.git)`, `…/tree/<branch>`, or
 * `git@github.com:owner/repo.git`. A `/tree/<branch>` URL names the base
 * branch.
 */
export function parseGitHubLink(
	text: string,
): Extract<ProjectLink, { type: "github" }> | undefined {
	const ssh =
		/^(?:ssh:\/\/)?git@github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
			text,
		);
	if (ssh) return { type: "github", repo: `${ssh[1]}/${ssh[2]}` };
	const url = toUrl(text);
	if (!url || !/^(www\.)?github\.com$/i.test(url.hostname)) return undefined;
	const [owner, rawRepo, section, ...rest] = url.pathname
		.split("/")
		.filter(Boolean);
	if (!owner || !rawRepo) return undefined;
	const repo = rawRepo.replace(/\.git$/i, "");
	if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return undefined;
	const branch =
		section === "tree" && rest.length > 0
			? decodeURIComponent(rest.join("/"))
			: undefined;
	return {
		type: "github",
		repo: `${owner}/${repo}`,
		...(branch && { branch }),
	};
}

/**
 * A Jira Cloud project, board or issue URL: `/browse/SAY(-12)`,
 * `/jira/software/(c/)projects/SAY/…`, `/projects/SAY`, or `?projectKey=SAY`.
 */
export function parseJiraLink(
	text: string,
): Extract<ProjectLink, { type: "jira" }> | undefined {
	const url = toUrl(text);
	if (!url || !/\.atlassian\.net$/i.test(url.hostname)) return undefined;
	const key =
		/\/browse\/([A-Z][A-Z0-9_]*)(?:-\d+)?(?:\/|$)/i.exec(url.pathname)?.[1] ??
		/\/projects\/([A-Z][A-Z0-9_]*)(?:\/|$)/i.exec(url.pathname)?.[1] ??
		url.searchParams.get("projectKey") ??
		undefined;
	const projectKey = key?.toUpperCase();
	if (!projectKey || !JIRA_KEY.test(projectKey)) return undefined;
	return { type: "jira", host: url.hostname.toLowerCase(), projectKey };
}

/**
 * A ClickUp Space, Folder or List URL:
 * `https://app.clickup.com/<team>/v/(o/)s/<id>`, `…/v/f/<id>(/<space>)`,
 * `…/v/li/<id>` or `…/v/l/li/<id>`.
 */
export function parseClickUpLink(
	text: string,
): Extract<ProjectLink, { type: "clickup" }> | undefined {
	const url = toUrl(text);
	if (!url || !/^(app\.)?clickup\.com$/i.test(url.hostname)) return undefined;
	const parts = url.pathname.split("/").filter(Boolean);
	const teamId = parts[0];
	if (!teamId || !/^\d+$/.test(teamId) || parts[1] !== "v") return undefined;
	const view = parts.slice(2).filter((p) => p !== "o" && p !== "l");
	const [marker, id] = view;
	if (!id || !/^[\w-]+$/.test(id)) return undefined;
	const target =
		marker === "s"
			? "space"
			: marker === "f"
				? "folder"
				: marker === "li"
					? "list"
					: undefined;
	return target ? { type: "clickup", teamId, target, id } : undefined;
}

function toUrl(text: string): URL | undefined {
	try {
		const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
		return url.protocol === "https:" || url.protocol === "http:"
			? url
			: undefined;
	} catch {
		return undefined;
	}
}
