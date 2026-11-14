# inBudget

nyrus can take its repositories and their routing from **inBudget**. A project in inBudget that has a GitHub link and a Jira or ClickUp link becomes a repository in nyrus: tickets from that Jira project or ClickUp Space/List go to that repository. Nobody has to enter repositories in the nyrus dashboard by hand.

## How a project becomes a repository

nyrus reads every active (not archived) project and its project infos. It looks at each link's URL, whatever kind the info was saved as:

| Link in inBudget | What nyrus does with it |
|---|---|
| `https://github.com/teamnovu/shop` (also `.git`, `git@github.com:…`) | The repository; it is cloned on the server |
| `https://github.com/teamnovu/shop/tree/develop` | The repository, with `develop` as base branch |
| `https://novu.atlassian.net/browse/SAY`, a board URL `…/projects/SAY/…`, or a Jira info with just `SAY` | Jira tickets of project `SAY` go to the repository |
| `https://app.clickup.com/<workspace>/v/s/<space>` | ClickUp tasks of that Space go to the repository |
| `https://app.clickup.com/<workspace>/v/li/<list>` | ClickUp tasks of that List go to the repository |

- A repository linked from several projects gets all their Jira projects, Spaces and Lists.
- A project with several repositories (e.g. frontend and backend) routes its tickets to all of them; nyrus then asks on the ticket which one, unless the ticket says `[repo=…]`.
- Links to another Jira site or ClickUp workspace than nyrus works on, ClickUp folders, and projects with a tracker link but no GitHub link are listed as warnings in the dashboard.

In nyrus, each such repository is an entry `inbudget-<repository>-jira` (or `-clickup`) in `config.json`, shown with an "inBudget" chip in the dashboard:

- **inBudget owns the routing:** GitHub URL, Jira project keys, ClickUp Spaces and Lists. Change them in inBudget.
- **The dashboard owns the rest:** base branch, active or not, instructions, tools. They are set once when the repository is added and then left alone.
- **A repository you configure by hand** in the dashboard for the same tracker wins: nyrus doesn't add its own entry for it.
- **When a project is archived or its link removed**, the entry is turned off, not deleted, and turned on again if the link comes back. An entry you turn off yourself stays off.

nyrus syncs at startup, every 30 minutes, and when you click **Jetzt abgleichen** on the dashboard's repositories page. The page also shows the last sync, what changed, repositories that couldn't be cloned, and the warnings.

## Setup

### 1. An access token in inBudget

nyrus reads projects and their infos with an inBudget **access token** (user → Access Tokens → new). The token acts as the user who created it, so it sees the projects that user sees: use a user who sees all projects (e.g. a technical "nyrus" user with the project manager role). Without "valid until" the token is valid for 50 years.

> Deleting a token in inBudget doesn't revoke it: inBudget checks only its signature and expiry. To cut nyrus off, set "valid until" when you create it, or disable the user.

### 2. nyrus

In `<cyrus-home>/.env` (Forge: site → Environment):

```bash
INBUDGET_URL=https://inbudget.novu.ch       # without /api
INBUDGET_TOKEN=...                          # the access token
# INBUDGET_SYNC_INTERVAL_MINUTES=30         # 0: only at startup and on demand
```

Jira and ClickUp have to be set up in nyrus (see [JIRA.md](JIRA.md), [CLICKUP.md](CLICKUP.md)); their links are matched against `JIRA_BASE_URL` and `CLICKUP_TEAM_ID`. ClickUp List links need `CLICKUP_API_TOKEN` to read the List's name.

Restart. The log shows `✅ inBudget registered` and, a few seconds later, `inBudget sync: N repositories from M projects`.

Repositories are cloned like the dashboard does it (`gh repo clone`), into `~/.cyrus/repos/<name>`, so the server's GitHub login needs access to them.

## Notes

- inBudget's credentials are never handed to agent sessions.
- The sync writes `config.json`; nyrus picks it up without a restart. It keeps its own state (which entries it turned off) in `<cyrus-home>/inbudget-sync.json`.
- New entries get an `appendInstruction` that names their inBudget projects and points the agent to the tracker's tools (without commenting and status changes when [GitHub issues](GITHUB-ISSUES.md) are on).
