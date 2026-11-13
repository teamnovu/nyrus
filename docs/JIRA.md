# Jira

Nyrus (novu's Cyrus) can take work from Jira Cloud issues. In Jira the agent is called **Nyrus**; commands, settings and environment variables keep Cyrus's names (`cyrus`, `<cyrus-home>`, `CYRUS_*`).

Jira has no agent API like Linear's or Plane's, so Nyrus works as a normal Jira account (the "agent account") with an API token:

- **Hand an issue to Nyrus** by adding the trigger label (`nyrus` by default) or assigning it to the agent account. Nyrus works the whole issue, like a Linear delegation.
- **Mention the agent account** (or write `@Nyrus`) in a comment to ask or instruct it, like a Linear @mention.
- **While an issue is handed to Nyrus, every comment on it steers the session.** Afterwards, only comments that mention Nyrus do.
- **Stop it** by removing the label, unassigning the agent account, or commenting just `stop`.

## 1. Agent account and API token

Use a dedicated Jira user (e.g. "Nyrus") if you can: its comments and changes then show as Nyrus's. A personal account works too; Nyrus signs its comments (`🤖 Nyrus`) to tell them apart from yours.

Create an API token for that account at <https://id.atlassian.com/manage-profile/security/api-tokens>. The account needs to browse, comment on and transition issues in the projects Nyrus works in.

> With a personal account, keep `JIRA_TRIGGER_ON_ASSIGN=false`: otherwise every issue assigned to you in the webhook's projects starts Nyrus.

## 2. Configure Nyrus

In `<cyrus-home>/.env`:

```bash
JIRA_BASE_URL=https://your-site.atlassian.net   # no trailing slash
JIRA_EMAIL=nyrus@example.com                    # the agent account
JIRA_API_TOKEN=...
JIRA_WEBHOOK_SECRET=...                         # same secret as in the Jira webhook
# JIRA_TRIGGER_LABEL=nyrus                      # empty to disable label hand-over
# JIRA_TRIGGER_ON_ASSIGN=true                   # false: assignment doesn't start Nyrus
# JIRA_WORKSPACE_KEY=jira-your-site             # defaults to jira-<site>
```

Restart after changing these. The log shows `✅ Jira event transport registered` and the agent account it found.

Each repository that should take Jira work uses the workspace key (`jira-<site>`, e.g. `jira-novu` for `novu.atlassian.net`) as its `linearWorkspaceId`. A Jira project counts as both the team (its key, e.g. `SAY`) and the project (its name). `appendInstruction` tells the agent its name and where its Jira tools are:

```json
{
  "id": "sayflowers",
  "name": "sayflowers",
  "repositoryPath": "~/code/sayflowers",
  "baseBranch": "main",
  "workspaceBaseDir": "~/.cyrus/worktrees/sayflowers",
  "githubUrl": "https://github.com/acme/sayflowers",
  "linearWorkspaceId": "jira-novu",
  "teamKeys": ["SAY"],
  "appendInstruction": "Your name is Nyrus, novu's coding agent. Your work comes from Jira: use the mcp__jira__* tools (not Linear's) to read the issue, comment on it, attach your pull request and change its status."
}
```

## 3. Send webhooks to Nyrus

Nyrus receives Jira webhooks at `https://<host>/jira-webhook`. Use either of these:

**A. Admin webhook (recommended)** — Jira settings → System → WebHooks → Create a WebHook (needs Jira admin):

| Field | Value |
|---|---|
| URL | `https://<host>/jira-webhook` |
| Secret | the value of `JIRA_WEBHOOK_SECRET` (Jira then signs requests with `X-Hub-Signature`) |
| Events | Issue: **created**, **updated**; Comment: **created** |
| JQL filter | the projects Nyrus works in, e.g. `project = SAY` |

**B. Jira Automation** — for a project admin without global admin rights. Create a rule per trigger, with the action **Send web request**:

- URL: `https://<host>/jira-webhook?secret=<JIRA_WEBHOOK_SECRET>` (or send the secret in an `X-Cyrus-Webhook-Secret` header)
- Method `POST`, body **Custom data**:
  - for "Issue assigned" / "Field value changed: Labels": `{"issueKey": "{{issue.key}}"}`
  - for "Comment added": `{"webhookEvent": "comment_created", "issueKey": "{{issue.key}}", "comment": {"id": "{{comment.id}}", "body": "{{comment.body.jsonEncode}}", "author": {"accountId": "{{comment.author.accountId}}"}}}`

A request without `webhookEvent` counts as "this issue may have been handed to Nyrus": Nyrus reads the issue and starts if it carries the label or is assigned to the agent account.

## What works

- Hand-over by label or assignment starts a delegation (the whole issue); a mention starts a conversation on the mention comment. Handing an issue back later continues its session.
- The issue moves to the first "In Progress"-category status when work begins, through the workflow transition that leads there.
- While Nyrus works, one comment shows what it is doing now and its last few steps. It is edited at most every 20 seconds, without notifying watchers, and deleted when Nyrus answers, asks a question or fails, so only the answer stays.
- Answers, questions (including repository selection) and errors are posted as comments, converted from Markdown to Jira wiki markup.
- Sessions get a `jira` MCP server (`mcp__jira__*`) running as the agent account: `get_issue`, `add_comment` (Markdown, with mentions), `download_attachments`, `add_link` (attaches a pull request; the same URL again retitles it), `list_transitions` and `transition_issue`. Its tools are allowed by default.
- The description reaches the agent as Markdown, with the names of attached files; the agent downloads them with `download_attachments`.

## Not yet

- Images pasted inline into a description (only attachments are listed).
- Sub-tasks and issue links of Jira issues.
- Stopping sessions when an issue is resolved in Jira.
- Some built-in prompts still call the tracker "Linear"; the `appendInstruction` above points the agent to the Jira tools.
