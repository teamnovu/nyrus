# ClickUp spike (AP3, step 0)

Before building `packages/clickup-event-transport`, we check ClickUp's real behavior with the bot's own token: webhook payloads, comment formatting, the plan's rate limit. The recorded payloads become the test fixtures. Findings go in the table at the end; anything that changes the design also goes in [NYRUS.md](../../NYRUS.md) under Decisions.

The tools are in [scripts/clickup/](../../scripts/clickup). They have no dependencies (Node 18+). Their output goes to `~/.cyrus/clickup-spike/`, outside the repository, because it contains real ticket data. Fixtures are copied into the package's `test/fixtures/` by hand, with names and texts anonymized.

## What we already know (from ClickUp's docs)

- **Auth:** a personal token (`pk_…`) of a bot user, sent as `Authorization: pk_…` (no `Bearer`). Rate limits are per token and depend on the workspace plan: 100 requests/min on Free, Unlimited and Business; 1,000 on Business Plus; 10,000 on Enterprise. ([rate limits](https://developer.clickup.com/docs/rate-limits))
- **Webhooks** are created through the API only (`POST /team/{team_id}/webhook`), optionally narrowed to a Space, Folder, List or task. Each has its own secret, returned once at creation. ClickUp signs the raw body: `X-Signature` = hex HMAC-SHA256. **Answer an invalid signature with 400, not 401: a 401 suspends the webhook.** Repeated failed deliveries also suspend it (`health.status`); `webhook.mjs list` shows the health and `reactivate` turns it back on. ([webhook signature](https://developer.clickup.com/docs/webhooksignature))
- **Payloads are thin**: `event`, `task_id`, `webhook_id` and `history_items[]`, whose `id` serves as the idempotency key for retried deliveries. The task itself has to be fetched.
- **Comments:** `POST /task/{id}/comment` takes plain `comment_text` (Markdown is **not** rendered) or a rich-text `comment` array. Threaded replies: `POST /comment/{id}/reply`. Edit `PUT /comment/{id}`, delete `DELETE /comment/{id}`.
- **Workspace 14278081** has 296 Spaces, one per customer, so it is on Unlimited or higher. The ClickUp MCP can't tell which plan.

## Prerequisites

1. **Bot user** in the workspace, e.g. `nyrus@novu.ch`, display name `nyrus`. To check: whether a guest seat is enough (assignable, can comment, can create an API token) or a member seat is needed.
2. **API token** of the bot: ClickUp → bot's avatar → Settings → Apps → API Token.
3. **Sandbox**: a Space "nyrus Sandbox" with one List and a test task, the bot invited. Don't use customer Spaces or the Musterprojekte templates: test comments notify watchers.
4. **Public URL** to the capture server: `ngrok http 3457` or `cloudflared tunnel --url http://localhost:3457`.

```bash
export CLICKUP_API_TOKEN=pk_...      # the bot's token
export CLICKUP_TEAM_ID=14278081
```

## Sandbox

| | Name | Id |
|---|---|---|
| Space | nyrus Sandbox | `1500750000001463` |
| List | Tests (statuses: to do → in progress → in review → complete; Multiple Assignees on) | `1500750000002693` |
| Task | [Probe: comment formats](https://app.clickup.com/t/1amxjbadtjm) | `1amxjbadtjm` |
| Bot user | `nyrus@novu.ch`, Guest (invited 2026-11-13) | `105741187` (`CLICKUP_BOT_USER_ID`) |

## Creating the bot user

The bot is an ordinary ClickUp user. Its display name is what people type to mention it (`@nyrus`), and its API token is what nyrus acts with.

1. **Mailbox.** Create `nyrus@novu.ch` as a shared mailbox or group that the team can read. ClickUp sends the invitation, login codes and password resets there. Store the bot's password (and 2FA secret, if the workspace enforces 2FA) in the team password manager, not with one person.
2. **Invite.** As a workspace owner or admin: Settings → **People** → Invite → `nyrus@novu.ch`.
   - **Guest** (start here): only sees what is shared with it, which keeps the 295 customer Spaces out of reach. Share the sandbox with it with **Edit** permission, so it can be assigned, comment and change status. Whether a guest is enough (assignable, mentionable, webhooks for its tasks) is spike question 2.
   - **Member**: if a guest falls short. Costs a paid seat and sees every Space it is added to.
3. **Accept.** Open the invitation in the bot's mailbox in a private window or separate browser profile (so you don't mix it up with your own session), set the name to `nyrus` and a password. An avatar helps people recognize its comments.
4. **Quiet its notifications.** As the bot: Settings → Notifications → turn off email (and mobile) notifications. Otherwise every assignment and comment lands in the shared mailbox. Set its timezone to Europe/Zurich.
5. **API token.** As the bot: Settings → **Apps** → API Token → **Generate**. The token starts with `pk_`, never expires and acts with the bot's permissions. Put it straight into the password manager; never into the repository, chat or tickets. Regenerating it invalidates the old one at once.

Then run step 1 below to confirm the token works.

## Steps

### 1. Account, plan, rate limit

```bash
node scripts/clickup/probe.mjs
```

Note the bot user id (`CLICKUP_BOT_USER_ID`), the plan and the `x-ratelimit-limit` header.

### 2. Comments

```bash
node scripts/clickup/probe.mjs --task <test task id> --mention <your user id>
```

Then open the task in ClickUp and check which of the test comments render as intended: Markdown in `comment_text`, rich text (bold, italic, inline code, link, bullet and numbered list, code block), the mention, the threaded reply. The edit/delete test comment should be gone. `--cleanup` removes the test comments.

### 3. Webhook payloads

```bash
node scripts/clickup/capture.mjs                     # terminal 1
ngrok http 3457                                      # terminal 2
node scripts/clickup/webhook.mjs create --endpoint https://<ngrok host>/clickup-webhook --space <sandbox space id>
export CLICKUP_WEBHOOK_SECRET=...                    # from the create output; restart capture.mjs
```

In the sandbox, do each of these and watch the capture output:

- [ ] assign the bot to a task, then unassign it
- [ ] assign the bot together with another person
- [ ] comment mentioning the bot; comment without a mention; reply in a thread
- [ ] edit a comment; delete a comment
- [ ] change the status; edit title and description
- [ ] let the bot comment (via `probe.mjs --task`): does its own comment arrive as a webhook, with the bot as `user`?
- [ ] stop `capture.mjs` for a few deliveries: how often and how fast does ClickUp retry, and when does it suspend?

Finally `node scripts/clickup/webhook.mjs delete <id>`.

## Questions to answer

| # | Question | Finding |
|---|---|---|
| 1 | Which plan, which rate limit? | |
| 2 | Guest seat enough for the bot? | |
| 3 | Which comment format renders best (rich text array, Markdown, HTML)? Code blocks and lists? | |
| 4 | How does a mention of the bot appear in `taskCommentPosted` (item `comment` array, `type: "tag"`)? | |
| 5 | Does assignment arrive as `taskAssigneeUpdated` with `field: "assignee_add"` and the bot in `after`? With several assignees? | |
| 6 | Do the bot's own comments trigger webhooks, and with which `user`? | |
| 7 | Do threaded replies arrive as `taskCommentPosted`, and how do we know the parent? | |
| 8 | Retry behavior and suspension after failed deliveries | |
| 9 | Task ids: are custom task ids (`DEV-123`) on in the Spaces we'd pilot? | Off: tasks have only ClickUp ids (`custom_id` is null on the sandbox task, 2026-11-13). Branch names use the plain id. |
| 10 | Does ClickUp's GitHub integration link PRs by `CU-<task id>` in the branch name for us? | |
