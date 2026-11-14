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

- **Repositories of client resources:** a project without a git link takes the repository of its client's resources in inBudget (`repositoryUrl`, base branch from the production resource). Jira and ClickUp links among a resource's other URLs route all of the client's projects. Other GitHub URLs of a resource (e.g. a deploy repository) are ignored. A project's own git link wins over its client's resources.
- **GitHub issues:** with [GitHub issues](GITHUB-ISSUES.md) on (`GITHUB_ISSUES_WEBHOOK_SECRET`), every repository inBudget knows also takes the issues in it that are assigned to the nyrus GitHub account. A project then needs no Jira or ClickUp link: its repository alone is enough. Repositories are cloned on demand: the first issue assigned to nyrus in a repository clones it and adds its entry `inbudget-<repository>-github` (workspace `github`, team key `owner/name`), which stays from then on (kept in `<cyrus-home>/inbudget-github.json`). A repository that is cloned anyway (e.g. for Jira) gets it right away. The entries of one repository share its clone.
- A repository linked from several projects gets all their Jira projects, Spaces and Lists.
- A project with several repositories (e.g. frontend and backend) routes its tickets to all of them; nyrus then asks on the ticket which one, unless the ticket says `[repo=…]`.
- Links to another Jira site or ClickUp workspace than nyrus works on, ClickUp folders, and projects with a tracker link but no GitHub link are listed as warnings in the dashboard.

In nyrus, each such repository is an entry `inbudget-<repository>-jira` (or `-clickup`) in `config.json`, shown with an "inBudget" chip in the dashboard:

- **inBudget is the source of the routing:** GitHub URL, Jira project keys, ClickUp Spaces and Lists.
- **Groups:** a customer's repositories form a group (`routingGroup` in their entries) and share their Jira/ClickUp keys, so a ticket for one gets all of them in its session. On a repository's page it can be moved to another or a new group, worked alone, or put back with its customer; manual groups win over the customer grouping and are kept in `inbudget-manual.json`. A group can have its own Jira project or ClickUp Space/List (on its page in the dashboard): every repository of the group inherits it, together with the keys its members have from inBudget or set themselves.
- **Unlinking:** a value that comes from inBudget can only be overridden after unlinking it from inBudget on the repository's page; then the manual value applies even when inBudget has one, until it is linked again.
- **The dashboard can supplement it:** on a repository's page, add the Jira project or ClickUp Space/List inBudget doesn't have (yet). A repository inBudget knows but routes nowhere becomes a Jira/ClickUp repository that way. As soon as inBudget has a value for that field, inBudget's value wins; the manual one only applies while inBudget's is empty. Manual values are kept in `<cyrus-home>/inbudget-manual.json`.
- **The dashboard owns the rest:** base branch, active or not, instructions, tools. They are set once when the repository is added and then left alone.
- **A repository you configure by hand** in the dashboard for the same tracker wins: nyrus doesn't add its own entry for it.
- **When a project is archived or its link removed**, the entry is turned off, not deleted, and turned on again if the link comes back. An entry you turn off yourself stays off.

nyrus keeps what it read from inBudget in `<cyrus-home>/inbudget-cache.json` and asks inBudget as little as possible:

- **At startup and every 30 minutes** it reads only changes: the project list (to see archived and new projects), the client resources changed since the last read (`updatedAt[after]`), and the infos of new projects.
- **Once a day** (`INBUDGET_FULL_SYNC_HOURS`, default 24) and when you click **Jetzt abgleichen**, it reads everything again; only that notices deleted resources and changed project infos.
- **Changes in the dashboard** (Jira/ClickUp, groups, unlinking) and repositories set up on demand are applied from the cache, without asking inBudget.

**Several nyrus:** with `REDIS_URL` (e.g. `redis://127.0.0.1:6379`) the cache, the manual routing and groups, and the repositories set up on demand live in Redis (keys `nyrus:inbudget:*`, `INBUDGET_REDIS_PREFIX` to change), shared by every nyrus using the same Redis. Only one of them reads inBudget at a time (a lock), and changes another one read in the last interval are not read again. Each nyrus applies the result to its own `config.json` and clones. Without `REDIS_URL` it all stays in files next to `config.json`. Redis should persist its data (RDB or AOF, as Forge's Redis does by default); if it loses it, the next sync reads everything again and manual routing has to be set again. The page also shows the last sync, what changed, repositories that couldn't be cloned, and the warnings.

## Setup

### 1. An access token in inBudget

nyrus reads projects and their infos with an inBudget **access token** (user → Access Tokens → new). The token acts as the user who created it, so it sees the projects that user sees: use a user who sees all projects (e.g. a technical "nyrus" user with the project manager role). Without "valid until" the token is valid for 50 years.

> Deleting a token in inBudget doesn't revoke it: inBudget checks only its signature and expiry. To cut nyrus off, set "valid until" when you create it, or disable the user.

### 2. nyrus

In `<cyrus-home>/.env` (Forge: site → Environment):

```bash
INBUDGET_URL=https://api.inbudget.ch        # the API, not the web app; without /api
INBUDGET_TOKEN=...                          # the access token
# INBUDGET_SYNC_INTERVAL_MINUTES=30         # changes only; 0: only at startup and on demand
# INBUDGET_FULL_SYNC_HOURS=24               # read everything again after this long
# REDIS_URL=redis://127.0.0.1:6379          # share cache, manual routing and groups between several nyrus
```

Jira and ClickUp have to be set up in nyrus (see [JIRA.md](JIRA.md), [CLICKUP.md](CLICKUP.md)); their links are matched against `JIRA_BASE_URL` and `CLICKUP_TEAM_ID`. ClickUp List links need `CLICKUP_API_TOKEN` to read the List's name.

Restart. The log shows `✅ inBudget registered` and, a few seconds later, `inBudget sync: N repositories from M projects (I infos, L links)`. nyrus reads the infos per project (`project[]=…`, 50 projects per request): inBudget answers `/api/project_infos` without a project filter with an empty list. If the dashboard shows `0 Infos`, the token's user can't see the projects' infos.

Repositories are cloned like the dashboard does it (`gh repo clone`), into `~/.cyrus/repos/<name>`, so the server's GitHub login needs access to them.

## Notes

- inBudget's credentials are never handed to agent sessions.
- The sync writes `config.json`; nyrus picks it up without a restart. It keeps its own state (which entries it turned off) in `<cyrus-home>/inbudget-sync.json`.
- New entries get an `appendInstruction` that names their inBudget projects and points the agent to the tracker's tools (without commenting and status changes when [GitHub issues](GITHUB-ISSUES.md) are on).
