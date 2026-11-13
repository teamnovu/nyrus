# ClickUp

nyrus takes work from [ClickUp](https://clickup.com) tasks. Design, findings and open questions: [docs/nyrus/clickup-spike.md](nyrus/clickup-spike.md).

novu allows no non-personal ClickUp accounts, so there is no `nyrus` user to assign or mention. nyrus works through ClickUp's API with **one person's token** and starts every comment it writes with "🤖 nyrus:":

- **Hand a task to nyrus** by adding the tag `nyrus`. nyrus works the whole task, like a Linear delegation.
- **Ask or instruct it** with a comment that starts with `/nyrus`, e.g. `/nyrus why does the menu break on iOS?`, like a Linear @mention.
- **While a task has the tag, every comment on it steers the session.** Afterwards, only `/nyrus` comments and answers to a question it asked do.
- **Stop it** by removing the tag, or commenting `/nyrus stop`.

## 1. Token

nyrus acts as the person whose personal API token it has: ClickUp → avatar → Settings → **Apps** → API Token → **Generate** (starts with `pk_`, never expires). Everything nyrus does shows as that person's: comments (signed "🤖 nyrus:"), status changes, tags. Their own comments still reach nyrus like anyone else's; nyrus recognizes its own by the ids it posted and the signature.

The token can do everything its person can, in every Space. nyrus only acts on the Spaces in `CLICKUP_SPACE_IDS`; set it.

## 2. Configure nyrus

On Forge: **site → Environment** (see [deploy/forge/README.md](../deploy/forge/README.md)). Elsewhere: `<cyrus-home>/.env`.

```bash
CLICKUP_WEBHOOK_SECRET=...       # from step 3; ClickUp stays off without it
CLICKUP_API_TOKEN=pk_...         # the person nyrus acts as; without it deliveries are only logged
CLICKUP_TEAM_ID=14278081         # the workspace (novu: 14278081); the workspace key is clickup-<id>
CLICKUP_SPACE_IDS=1500750000001463   # comma-separated Spaces nyrus works in
# CLICKUP_TRIGGER_TAG=nyrus      # the hand-over tag; empty to disable
# CLICKUP_TRIGGER_ON_ASSIGN=true # assigning the token's person also hands a task over (off: that person gets real assignments too)
# CLICKUP_WEBHOOK_RECORD=1       # save every delivery to <cyrus-home>/clickup-webhooks/
```

Restart after changing these: `NYRUS_SKIP_BUILD=1 bash deploy/forge/deploy.sh`. The log shows `✅ ClickUp registered (key clickup-14278081, starts on tag "nyrus" or "/nyrus" comments, Spaces …)` and `ClickUp acts as: <person>`.

Each repository that takes ClickUp work uses the workspace key as its `linearWorkspaceId`. A ClickUp **Space** (one per customer) is the team, with its id as the key; a **List** is the project, by name. Route by Space with `teamKeys`, by List with `projectKeys`. `appendInstruction` tells the agent where its ClickUp tools are:

```json
{
  "id": "sayflowers",
  "name": "sayflowers",
  "repositoryPath": "~/code/sayflowers",
  "baseBranch": "main",
  "workspaceBaseDir": "~/.cyrus/worktrees/sayflowers",
  "githubUrl": "https://github.com/acme/sayflowers",
  "linearWorkspaceId": "clickup-14278081",
  "teamKeys": ["1500750000001463"],
  "appendInstruction": "Your name is nyrus, novu's coding agent. Your work comes from ClickUp: use the mcp__clickup__* tools (not Linear's) to read the task, comment on it and change its status."
}
```

`node scripts/clickup/probe.mjs --task <task id>` prints the Space id of a task.

## 3. Create the webhook

ClickUp has no settings page for API webhooks; create it with the API, from any machine, with the token of the person nyrus acts as (in `~/.cyrus/.env` as `CLICKUP_API_TOKEN` and `CLICKUP_TEAM_ID`):

```bash
node scripts/clickup/webhook.mjs create --endpoint https://nyrus.novu.ch/clickup-webhook --space <space id>
```

Narrow it to the Spaces nyrus should see (`--space`, `--folder`, `--list`); without one it covers the whole workspace. The command saves the webhook's secret to that machine's `~/.cyrus/.env` as `CLICKUP_WEBHOOK_SECRET`, since ClickUp shows it only once: copy it from there into nyrus's environment (step 2).

`webhook.mjs list` shows the webhooks and their health, `reactivate <id>` turns a suspended one back on, `delete <id>` removes one.

## What works

- Adding the tag starts a delegation (the whole task); a `/nyrus` comment on a task without a session starts a conversation on that comment. Adding the tag again later continues the task's session.
- The task moves to the first status of type "custom" ("in progress") when work begins. Each List may have its own statuses; nyrus takes the List's status of the same type if the name differs.
- While nyrus works, one comment shows what it is doing now and its last few steps. It is edited at most every 20 seconds and deleted when nyrus answers, asks a question or fails, so only the answer stays. ClickUp has no silent comments: watchers are notified of new comments.
- Answers, questions (including repository selection) and errors are posted as comments, converted from Markdown to ClickUp rich text (bold, italic, code, links, lists, code blocks; headings become bold lines). Reply `2` (or an option's name) to pick an option.
- Sessions get a `clickup` MCP server (`mcp__clickup__*`) with the same token: `get_task`, `add_comment` (Markdown, with mentions), `list_statuses`, `set_status` and `download_attachments`. Its tools are allowed by default.
- The description reaches the agent as Markdown, with the names of attached files; the agent downloads them with `download_attachments`.
- Branches are named `CU-<task id>-<title>`, the form ClickUp's GitHub integration links to the task.

## Behavior of the webhook

- A delivery with a wrong or missing `X-Signature` is answered with **400**. Never 401: ClickUp suspends a webhook that gets a 401.
- Valid deliveries are answered at once and logged as one line per delivery (event, task id, changed fields, user ids; no comment texts).
- nyrus reads the task (and the comment, if the delivery lacks it) from the API rather than trusting the delivery's shape. Comment edits, time tracking and other changes that can't hand a task over are ignored; so are tasks outside `CLICKUP_SPACE_IDS`.
- With `CLICKUP_WEBHOOK_RECORD=1` each delivery is also saved as a JSON file in `<cyrus-home>/clickup-webhooks/` (on Forge: `/home/forge/.cyrus/clickup-webhooks/`). These contain real task data: turn recording off when you have what you need, and delete the files.
- ClickUp suspends a webhook after repeated failed deliveries (e.g. while nyrus is down). Check with `webhook.mjs list` and reactivate it.

## Not yet

- Time worked is not logged on the task: time entries would land on the timesheet of the token's person.
- Images pasted inline into a description (only attachments are listed), subtasks and task links.
- Stopping sessions when a task is closed in ClickUp.
- Custom task ids (`DEV-123`); nyrus uses ClickUp's own ids.
- Some built-in prompts still call the tracker "Linear"; the `appendInstruction` above points the agent to the ClickUp tools.
