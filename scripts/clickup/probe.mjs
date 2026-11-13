#!/usr/bin/env node
// Check what the bot's token can do, and how comments behave.
//
//   node scripts/clickup/probe.mjs                         # account, workspace plan, rate limit
//   node scripts/clickup/probe.mjs --task <id> [--mention <user id>] [--cleanup]
//
// With --task it reads the task and its list's statuses, then posts test
// comments on it: Markdown as plain text, ClickUp rich text, a mention, a
// threaded reply, and one comment that is edited and deleted. Look at the
// task in ClickUp to see which formats render. --cleanup deletes the test
// comments afterwards. Use a test task: the comments notify its watchers.
//
// Env: CLICKUP_API_TOKEN, CLICKUP_TEAM_ID. Results go to ~/.cyrus/clickup-spike/probe.
import {
	clickup,
	lastRateLimit,
	OUT_DIR,
	parseArgs,
	requireEnv,
	save,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const teamId = requireEnv("CLICKUP_TEAM_ID");
const results = {};

async function step(name, method, path, body) {
	const result = await clickup(method, path, body);
	results[name] = { request: { method, path, body }, ...result };
	save("probe", name, results[name]);
	const ok = result.status >= 200 && result.status < 300;
	console.log(`${ok ? "✓" : "✗"} ${name}: HTTP ${result.status}`);
	if (!ok) console.log(`    ${JSON.stringify(result.body).slice(0, 300)}`);
	return ok ? result.body : undefined;
}

// --- Account and workspace -------------------------------------------------

const user = await step("user", "GET", "/user");
if (user) {
	console.log(`    user: ${user.user.username} (id ${user.user.id})`);
}
const teams = await step("teams", "GET", "/team");
const team = teams?.teams?.find((t) => String(t.id) === teamId);
console.log(
	team
		? `    workspace ${team.name} (${team.id}), ${team.members?.length ?? "?"} members visible`
		: `    the token has no access to workspace ${teamId}`,
);
const plan =
	(await step("plan", "GET", `/team/${teamId}/plan`)) ??
	(await step("plan-workspace-path", "GET", `/workspace/${teamId}/plan`));
if (plan) console.log(`    plan: ${plan.plan_name ?? JSON.stringify(plan)}`);
console.log(`    rate limit: ${JSON.stringify(lastRateLimit)}`);

// --- Task and comments --------------------------------------------------------

const taskId = typeof args.task === "string" ? args.task : undefined;
if (taskId) {
	const task = await step(
		"task",
		"GET",
		`/task/${taskId}?include_markdown_description=true&include_subtasks=true`,
	);
	if (task) {
		console.log(
			`    "${task.name}" in list ${task.list?.name} (${task.list?.id}), space ${task.space?.id}, status "${task.status?.status}" (${task.status?.type}), custom id ${task.custom_id ?? "none"}, ${task.attachments?.length ?? 0} attachments`,
		);
		const list = await step("list", "GET", `/list/${task.list.id}`);
		if (list) {
			console.log(
				`    statuses: ${list.statuses.map((s) => `${s.status} (${s.type})`).join(", ")}`,
			);
		}
	}
	await step("comments", "GET", `/task/${taskId}/comment`);

	const created = [];
	const post = async (name, body) => {
		const comment = await step(name, "POST", `/task/${taskId}/comment`, {
			notify_all: false,
			...body,
		});
		if (comment?.id) created.push(String(comment.id));
		return comment;
	};

	await post("comment-markdown-as-text", {
		comment_text:
			"[probe] Markdown as comment_text: **bold**, _italic_, `code`, [link](https://github.com/teamnovu/nyrus)\n\n- first\n- second\n\n```js\nconst x = 1;\n```",
	});

	// ClickUp's editor stores Quill-style rich text: inline attributes on
	// text, block formats (lists, code blocks) on the newline ending the line.
	const mentionId = typeof args.mention === "string" ? args.mention : undefined;
	await post("comment-rich-text", {
		comment: [
			{ text: "[probe] Rich text: " },
			{ text: "bold", attributes: { bold: true } },
			{ text: ", " },
			{ text: "italic", attributes: { italic: true } },
			{ text: ", " },
			{ text: "code", attributes: { code: true } },
			{ text: ", " },
			{
				text: "link",
				attributes: { link: "https://github.com/teamnovu/nyrus" },
			},
			{ text: "\n" },
			{ text: "first" },
			{ text: "\n", attributes: { list: { list: "bullet" } } },
			{ text: "second" },
			{ text: "\n", attributes: { list: { list: "bullet" } } },
			{ text: "step one" },
			{ text: "\n", attributes: { list: { list: "ordered" } } },
			{ text: "const x = 1;" },
			{
				text: "\n",
				attributes: { "code-block": { "code-block": "javascript" } },
			},
			...(mentionId
				? [
						{ text: "Mention: " },
						{ type: "tag", user: { id: Number(mentionId) } },
						{ text: "\n" },
					]
				: []),
		],
	});

	const parent = await post("comment-thread-parent", {
		comment_text: "[probe] Thread parent",
	});
	if (parent?.id) {
		await step("comment-reply", "POST", `/comment/${parent.id}/reply`, {
			comment_text: "[probe] Threaded reply",
			notify_all: false,
		});
		await step("comment-replies", "GET", `/comment/${parent.id}/reply`);
	}

	const editable = await post("comment-to-edit", {
		comment_text: "[probe] Working on it…",
	});
	if (editable?.id) {
		await step("comment-edit", "PUT", `/comment/${editable.id}`, {
			comment_text: "[probe] Edited: now running tests",
		});
		await step("comment-delete", "DELETE", `/comment/${editable.id}`);
		created.splice(created.indexOf(String(editable.id)), 1);
	}

	if (args.cleanup) {
		for (const id of created)
			await step(`cleanup-${id}`, "DELETE", `/comment/${id}`);
	} else if (created.length) {
		console.log(
			`    Left ${created.length} test comments on the task to look at; run again with --cleanup to remove the next batch, or delete them in ClickUp.`,
		);
	}
	console.log(`    rate limit after: ${JSON.stringify(lastRateLimit)}`);
}

console.log(`\nResults in ${OUT_DIR}/probe`);
