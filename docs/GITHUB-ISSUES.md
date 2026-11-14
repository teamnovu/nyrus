# Working tickets in GitHub issues

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

Restart. The log shows `✅ Tickets are worked in GitHub issues (webhook POST /github-issues-webhook)`.

Repositories need `githubUrl` in `config.json` (e.g. `https://github.com/acme/web`); that's where the issue is opened. Their `appendInstruction` should no longer tell the agent to comment on or move the ticket: see the examples in [JIRA.md](JIRA.md) and [CLICKUP.md](CLICKUP.md).

Which ticket belongs to which GitHub issue is kept in `<cyrus-home>/github-issue-threads.json`.

## Notes

- Access control (`userAccessControl`) matches people by tracker account or email. GitHub commenters have neither (their id is `github:<login>`), so with an allow list they are blocked; use `GITHUB_ISSUES_ALLOWED_ASSOCIATIONS` to limit who can steer nyrus on GitHub.
- A pull request also counts as the ticket's if its branch is named after the ticket (`say-12-…`), even without `Closes`.
- Tickets nyrus worked on before this was turned on keep working on the ticket until they get a new event.
