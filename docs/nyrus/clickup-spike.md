# ClickUp spike (AP3, step 0)

Before building `packages/clickup-event-transport`, we check ClickUp's real behavior through its API: webhook payloads, comment formatting, the plan's rate limit. The recorded payloads become the test fixtures. Findings go in the table at the end; anything that changes the design also goes in [NYRUS.md](../../NYRUS.md) under Decisions.

The tools are in [scripts/clickup/](../../scripts/clickup). They have no dependencies (Node 18+). Their output goes to `~/.cyrus/clickup-spike/`, outside the repository, because it contains real ticket data. Fixtures are copied into the package's `test/fixtures/` by hand, with names and texts anonymized.

## What we already know (from ClickUp's docs)

- **Auth:** a personal token (`pk_…`) of a user, sent as `Authorization: pk_…` (no `Bearer`). Rate limits are per token and depend on the workspace plan: 100 requests/min on Free, Unlimited and Business; 1,000 on Business Plus; 10,000 on Enterprise. ([rate limits](https://developer.clickup.com/docs/rate-limits))
- **Webhooks** are created through the API only (`POST /team/{team_id}/webhook`), optionally narrowed to a Space, Folder, List or task. Each has its own secret, returned once at creation. ClickUp signs the raw body: `X-Signature` = hex HMAC-SHA256. **Answer an invalid signature with 400, not 401: a 401 suspends the webhook.** Repeated failed deliveries also suspend it (`health.status`); `webhook.mjs list` shows the health and `reactivate` turns it back on. ([webhook signature](https://developer.clickup.com/docs/webhooksignature))
- **Payloads are thin**: `event`, `task_id`, `webhook_id` and `history_items[]`, whose `id` serves as the idempotency key for retried deliveries. The task itself has to be fetched.
- **Comments:** `POST /task/{id}/comment` takes plain `comment_text` (Markdown is **not** rendered) or a rich-text `comment` array. Threaded replies: `POST /comment/{id}/reply`. Edit `PUT /comment/{id}`, delete `DELETE /comment/{id}`.
- **Workspace 14278081** ("UNION") has 296 Spaces, one per customer, and is on the **Enterprise** plan: 10,000 requests/min per token (probe, 2026-11-13).

## Identity: no bot account

novu's ClickUp policy allows **no non-personal accounts** (admins, 2026-11-13). A `nyrus` bot user was invited as a guest and has to be removed again by an admin (`nyrus@novu.ch`, id `105741187`). ClickUp also has no way for a self-built integration to appear as its own participant: only partner agents (Cursor, Codegen) do, and OAuth apps act as the person who authorized them.

So nyrus works through the API **in the name of a real person**, and is started without assigning or mentioning a bot user. Built this way (see [docs/CLICKUP.md](../CLICKUP.md)); whose token is used in production still needs the admins' OK:

- **Writing** with one person's access (personal token for the spike, an OAuth app in production), every comment starting with "🤖 nyrus:". Needs the admins' OK.
- **Starting** with a tag `nyrus` on a task (works the whole task; removing it stops) and comments starting with `/nyrus` (questions and instructions).
- **Own comments** recognized by the comment ids nyrus posted and the 🤖 prefix, not by the user id, since that is a person who also writes real comments. This changes the shared base (AP2).
- **Scope** limited in code to the configured Spaces, since a person's token sees all of them.

## Prerequisites

1. **API token** of the person nyrus acts as: ClickUp → avatar → Settings → **Apps** → API Token → **Generate**. The token starts with `pk_`, never expires and can do everything that person can. Keep it in the password manager; never in the repository, chat or tickets. Regenerating it invalidates the old one at once.
2. **Sandbox**: the Space "nyrus Sandbox" below. Don't use customer Spaces or the Musterprojekte templates: test comments notify watchers.
3. **Public URL** to the capture server: `ngrok http 3457` or `cloudflared tunnel --url http://localhost:3457`.

The scripts read their settings from nyrus's env file `~/.cyrus/.env` (or the environment), so the token never has to be pasted into a shell or chat. Add with an editor:

```bash
CLICKUP_API_TOKEN=pk_...      # the token of the person nyrus acts as
CLICKUP_TEAM_ID=14278081
```

`webhook.mjs create` saves the webhook's signing secret there as `CLICKUP_WEBHOOK_SECRET` instead of printing it; `capture.mjs` reads it from there.

## Sandbox

| | Name | Id |
|---|---|---|
| Space | nyrus Sandbox | `1500750000001463` |
| List | Tests (statuses: to do → in progress → in review → complete; Multiple Assignees on) | `1500750000002693` |
| Task | [Probe: comment formats](https://app.clickup.com/t/1amxjbadtjm) | `1amxjbadtjm` |

## Steps

### 1. Account, plan, rate limit

```bash
node scripts/clickup/probe.mjs
```

Note the user id, the plan and the `x-ratelimit-limit` header.

### 2. Comments

```bash
node scripts/clickup/probe.mjs --task <test task id> --mention <your user id>
```

Then open the task in ClickUp and check which of the test comments render as intended: Markdown in `comment_text`, rich text (bold, italic, inline code, link, bullet and numbered list, code block), the mention, the threaded reply. The edit/delete test comment should be gone. `--cleanup` removes the test comments.

### 3. Webhook payloads

**On prod (preferred):** nyrus itself receives and records the deliveries, see [docs/CLICKUP.md](../CLICKUP.md): set `CLICKUP_WEBHOOK_RECORD=1`, create the webhook for the sandbox Space against `https://nyrus.novu.ch/clickup-webhook`, put its secret into Forge → Environment, then work through the list below and read `/home/forge/.cyrus/clickup-webhooks/` (or the daemon log).

**Locally:** with the capture script and a tunnel:

```bash
node scripts/clickup/capture.mjs                     # terminal 1
ngrok http 3457                                      # terminal 2
node scripts/clickup/webhook.mjs create --endpoint https://<ngrok host>/clickup-webhook --space <sandbox space id>
# create saved CLICKUP_WEBHOOK_SECRET to ~/.cyrus/.env; restart capture.mjs to pick it up
```

In the sandbox, do each of these and watch the capture output:

- [ ] add the tag `nyrus` to a task, then remove it
- [ ] assign a task to someone (to see `taskAssigneeUpdated`, in case we trigger by assignment after all)
- [ ] comment starting with `/nyrus`; normal comment; comment with an @mention of a person; reply in a thread
- [ ] edit a comment; delete a comment
- [ ] change the status; edit title and description
- [ ] let the script comment (via `probe.mjs --task`): does that comment arrive as a webhook too, with the token's person as `user`?
- [ ] stop `capture.mjs` for a few deliveries: how often and how fast does ClickUp retry, and when does it suspend?

Finally `node scripts/clickup/webhook.mjs delete <id>`.

## Questions to answer

| # | Question | Finding |
|---|---|---|
| 1 | Which plan, which rate limit? | Enterprise, `x-ratelimit-limit: 10000` per minute (2026-11-13). Rate limits are no constraint; progress edits stay throttled for readability, not for the limit. |
| 2 | Guest seat enough for the bot? | Moot: no bot accounts allowed (see Identity). |
| 3 | Which comment format renders best (rich text array, Markdown, HTML)? Code blocks and lists? | **Rich text `comment` array.** It renders bold, italic, inline code, links, bullet and numbered lists, code blocks (with highlighting) and mentions (`{type: "tag", user: {id}}` becomes a real mention). Markdown in `comment_text` mostly stays literal (`**`, `_`, `- `, broken code fences); only inline code and bare URLs render. So nyrus converts its Markdown to the rich text array (block formats such as lists and code blocks go on the `\n` that ends the line, Quill-style). Threaded replies, edit and delete work (2026-11-13). |
| 4 | How do a `/nyrus` comment and an @mention appear in `taskCommentPosted` (`text_content`, `comment` array with `type: "tag"`)? | |
| 5 | How does adding or removing a tag arrive (event, `history_items[].field`), and is the tag name in it? | |
| 6 | Do comments posted through the API trigger webhooks, and with which `user`? | Open. The create response marks API comments with `version.data.context.originating_service: "publicapi_comments"`; check whether webhooks carry it, so nyrus can tell its own comments from the same person's hand-written ones. |
| 7 | Do threaded replies arrive as `taskCommentPosted`, and how do we know the parent? | |
| 8 | Retry behavior and suspension after failed deliveries | |
| 9 | Task ids: are custom task ids (`DEV-123`) on in the Spaces we'd pilot? | Off: tasks have only ClickUp ids (`custom_id` is null on the sandbox task, 2026-11-13). Branch names use the plain id. |
| 10 | Does ClickUp's GitHub integration link PRs by `CU-<task id>` in the branch name for us? | |
