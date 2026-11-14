# Working tickets in GitHub issues

There are two ways nyrus works with GitHub issues; both use the same GitHub App, webhook and secret ([Setup](#setup)):

- **Tickets from Jira/ClickUp, discussed in a GitHub issue** (this page's first part): nyrus opens a GitHub issue for the ticket and talks there.
- **GitHub issues as the tickets** ([Working GitHub issues directly](#working-github-issues-directly)): a project without Jira or ClickUp. Someone opens an issue in the repository and assigns it to nyrus.

With this turned on, nyrus works Jira issues and ClickUp tasks in a **GitHub issue** in the ticket's repository. The ticket stays where work is planned; the GitHub issue is where nyrus and the team talk about it, next to the code.

## How a ticket goes

1. **Hand-over.** A ticket is handed to nyrus as before (Jira label/assignment, ClickUp tag, or a mention). Once nyrus knows the repository (from routing, or after asking which one, on the ticket), it opens a GitHub issue `[KEY-12] <title>` with everything the ticket says: description, attached file names, status, assignee, labels and the ticket's comments so far. The ticket gets one comment with the link.
2. **Clear things up first.** Before it changes any code, the agent reads the GitHub issue, the attachments and the code, and works out what has to change and how to verify it. If anything is missing or unclear, it asks all its questions at once **on the GitHub issue** and waits. Answer there with a comment. It checks again after each answer and only starts when it knows what to build and that it can.
3. **Plan, then work.** It posts its plan on the GitHub issue and implements it. Its progress ("⏳ Working on it") is shown on the GitHub issue too.
4. **Pull request.** The pull request says `Closes owner/repo#12`. When it is opened, the ticket gets the PR as a link (Jira: a remote link; ClickUp: a comment) and moves to **review**.
5. **Result.** The agent's final answer is posted on the GitHub issue and, with a link to it, on the ticket. When the GitHub issue is closed (by merging the PR), the ticket moves to **done**.

While a ticket is worked this way:

- **Every comment on the GitHub issue** from a member or collaborator of the repository goes to nyrus (answers, instructions, `stop`). Comments from others and from bots are ignored.
- **Comments on the ticket** still reach nyrus as before, and nyrus copies them to the GitHub issue so the whole conversation is there. It answers on GitHub.
- The agent doesn't comment on, link or move the ticket itself; nyrus does that.

Tickets whose repository isn't on GitHub (e.g. GitLab) are worked on the ticket as before.

## Setup

### 1. GitHub App: permissions and webhook

nyrus uses the GitHub App it already opens pull requests with ([deploy/forge/README.md](../deploy/forge/README.md#github-app-for-pull-requests)); a `GITHUB_TOKEN` works too.

Organization → Settings → Developer settings → GitHub Apps → your App:

1. **Permissions → Repository permissions:** add **Issues: Read and write** (keep Contents and Pull requests). The organization has to accept the new permission (Settings → GitHub Apps → the installation → review request).
2. **General → Webhook:** tick **Active**.
   - Webhook URL: `https://<host>/github-issues-webhook`
   - Webhook secret: a new random value (`openssl rand -hex 32`)
3. **Permissions → Subscribe to events:** **Issues**, **Issue comment**, **Pull request**.

Without the App, add a webhook with the same URL, secret and events on each repository (Settings → Webhooks, content type `application/json`).

### 2. nyrus

In `<cyrus-home>/.env` (Forge: site → Environment):

```bash
GITHUB_ISSUES_WEBHOOK_SECRET=...           # the webhook secret from step 1; turns this on
# GITHUB_ISSUES_ALLOWED_ASSOCIATIONS=OWNER,MEMBER,COLLABORATOR   # who can steer nyrus on GitHub
# GITHUB_BOT_USERNAME=nyrus-bot            # with GITHUB_TOKEN: the bot account, whose comments are ignored

# Where tickets move (by status name). Defaults: the first status with "review" in its name,
# and the first done status. Empty turns the move off.
# JIRA_REVIEW_STATUS=In Review
# JIRA_DONE_STATUS=Done
# CLICKUP_REVIEW_STATUS=review
# CLICKUP_DONE_STATUS=complete
```

Restart. The log shows `✅ GitHub issues webhook registered (POST /github-issues-webhook)`.

Repositories need `githubUrl` in `config.json` (e.g. `https://github.com/acme/web`); that's where the issue is opened. Their `appendInstruction` should no longer tell the agent to comment on or move the ticket: see the examples in [JIRA.md](JIRA.md) and [CLICKUP.md](CLICKUP.md).

Which ticket belongs to which GitHub issue is kept in `<cyrus-home>/github-issue-threads.json`.

## Notes

- Access control (`userAccessControl`) matches people by tracker account or email. GitHub commenters have neither (their id is `github:<login>`), so with an allow list they are blocked; use `GITHUB_ISSUES_ALLOWED_ASSOCIATIONS` to limit who can steer nyrus on GitHub.
- A pull request also counts as the ticket's if its branch is named after the ticket (`say-12-…`), even without `Closes`.
- Tickets nyrus worked on before this was turned on keep working on the ticket until they get a new event.

## Working GitHub issues directly

A project doesn't need Jira or ClickUp: nyrus can work the issues of its GitHub repository directly. The GitHub issue is the ticket.

### How an issue goes

1. **Hand-over.** Assign the issue to nyrus's GitHub account (`GITHUB_BOT_USERNAME`, default `nyrus`), or open it with nyrus already assigned. nyrus works the whole issue, like a Jira issue handed to it.
2. **Questions, progress, answer.** Like with tickets: the agent reads the issue and its comments first and asks on the issue if something is unclear; its progress ("⏳ Working on it") and its final answer are comments on the issue. nyrus's comments carry a hidden `<!-- nyrus -->` marker, so they never count as replies.
3. **Pull request.** The agent's pull request says `Closes #<number>`, so merging it closes the issue. nyrus tells the agent so; no repository instructions needed.

| On the issue | nyrus does |
|---|---|
| nyrus assigned (or issue opened with nyrus assigned) | Starts working the issue |
| nyrus assigned again after its session ended, or the issue reopened while assigned | Continues that session ("handed to you again") |
| nyrus unassigned | Stops the session |
| Issue closed while nyrus is still working or waiting for an answer | Stops the session |
| Comment mentioning `@nyrus`, issue not assigned to nyrus | Starts a conversation on that comment |
| Comment while the issue is assigned to nyrus | Passed to the session |
| Comment after that | Only if it mentions `@nyrus` or answers its question |
| `stop` (or `@nyrus stop`) | Stops the session |

Who can steer nyrus: comments count only from authors whose association with the repository is in `GITHUB_ISSUES_ALLOWED_ASSOCIATIONS` (default `OWNER,MEMBER,COLLABORATOR`); others, bots and nyrus's own comments are ignored. Assignments aren't checked again: GitHub only lets people with triage or write access to the repository assign issues.

Comments on pull requests stay with nyrus's pull request integration ([GitHub setup](../deploy/forge/README.md)); issues nyrus opened for Jira/ClickUp tickets stay with those tickets.

### Setup

1. **Webhook.** Either is enough:
   - **The webhook nyrus already has on `/github-webhook`** (PR comments, CI; `GITHUB_WEBHOOK_SECRET`): add the events **Issues** and **Issue comments** to it. nyrus passes issue events on to this tracker. Nothing else to set.
   - Or a webhook to `/github-issues-webhook` with `GITHUB_ISSUES_WEBHOOK_SECRET` (the [setup](#setup) above), which also mirrors Jira/ClickUp tickets into GitHub issues.

   On with `GITHUB_WEBHOOK_SECRET` or `GITHUB_ISSUES_WEBHOOK_SECRET`; `GITHUB_ISSUES_ENABLED=false` turns it off.
2. **A GitHub account for nyrus that can be assigned.** Only users can be assigned to issues, not a GitHub App's bot, and only users with access to the repository: the account (e.g. `novu-nyrus`) must be a **collaborator** of the repository or a member of the organization. nyrus finds its login from its GitHub token (`GET /user`); set it when the token is an App token or belongs to another account:

   ```bash
   GITHUB_BOT_USERNAME=novu-nyrus   # assigning it hands issues over, @novu-nyrus mentions it, its comments are nyrus's own
   ```

   The log says which login it uses: `GitHub issues: nyrus is @novu-nyrus (from its GitHub token)`.
3. **The repository in `config.json`**, taking work from the workspace `github`, with the repository's full name, **in lowercase**, as team key:

   ```json
   {
     "id": "sayflowers",
     "name": "sayflowers",
     "repositoryPath": "/home/nyrus/repos/sayflowers",
     "baseBranch": "main",
     "githubUrl": "https://github.com/teamnovu/sayflowers",
     "linearWorkspaceId": "github",
     "teamKeys": ["teamnovu/sayflowers"]
   }
   ```

   Issues of repositories without such an entry are ignored. inBudget projects with a GitHub repository get these entries from the inBudget sync.

Restart. The log shows `✅ GitHub issues worked directly (assign or mention @…)`. Every issue event is logged with what nyrus did with it (`… → session`, `nothing for nyrus`, or why it was ignored).

### Notes

- An issue `teamnovu/sayflowers#12` is `sayflowers-12` in nyrus: its worktree directory, and the start of its branch (`sayflowers-12-<title>`). Its session is kept per issue, so comments continue it, also after a restart.
- `userAccessControl` matches GitHub people as `github:<login>`; with an allow list, add them that way or rely on `GITHUB_ISSUES_ALLOWED_ASSOCIATIONS`.
- Labels of the issue are labels in nyrus (e.g. for label-based prompts). A `[repo=...]` tag in the issue body can still route it to another repository of the `github` workspace.
