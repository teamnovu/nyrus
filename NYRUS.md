# nyrus

**nyrus** is novu's fork of [Cyrus](https://github.com/cyrusagents/cyrus) (Apache 2.0), at [teamnovu/nyrus](https://github.com/teamnovu/nyrus). It adds the trackers we use, **ClickUp** and **Jira**, so tickets there are worked like Linear issues: assign the bot (or mention it in a comment), it works the ticket in its own branch, reports progress and questions as comments, and opens a pull request that a person reviews and merges.

This file is the starting point for everything nyrus-specific. The rest of the repository is upstream Cyrus; see [README.md](README.md) and [CLAUDE.md](CLAUDE.md) for how Cyrus itself works.

Project brief (German): [ClickUp doc "novu cyrus"](https://app.clickup.com/14278081/v/dc/dkqe1-508992/dkqe1-311892).

## Where things are

| What | Where |
|---|---|
| Deploying on Laravel Forge (AP1) | [deploy/forge/README.md](deploy/forge/README.md) |
| Shared base for trackers without agent sessions (AP2): design and how to add a tracker | [packages/comment-sessions/README.md](packages/comment-sessions/README.md) |
| Where trackers plug into the edge worker | [packages/edge-worker/src/TrackerIntegrations.ts](packages/edge-worker/src/TrackerIntegrations.ts) |
| ClickUp integration (AP3): spike and findings | [docs/nyrus/clickup-spike.md](docs/nyrus/clickup-spike.md), tools in [scripts/clickup/](scripts/clickup) |
| ClickUp setup guide | [docs/CLICKUP.md](docs/CLICKUP.md) |
| Jira integration (AP4) setup guide (once released) | `docs/JIRA.md` |
| Repositories and routing from inBudget projects | [docs/INBUDGET.md](docs/INBUDGET.md), code in [packages/inbudget-sync](packages/inbudget-sync) |
| Service desk triage: customer, project and assignee for new tickets | [docs/SERVICEDESK-TRIAGE.md](docs/SERVICEDESK-TRIAGE.md), code in [packages/servicedesk-triage](packages/servicedesk-triage) |
| Working Jira/ClickUp tickets in GitHub issues | [docs/GITHUB-ISSUES.md](docs/GITHUB-ISSUES.md), code in [packages/comment-sessions/src/github/](packages/comment-sessions/src/github) |
| Plane, the integration ClickUp and Jira are modeled on | [docs/PLANE.md](docs/PLANE.md), [packages/plane-event-transport](packages/plane-event-transport) |

Setup guides for users go in `docs/<TRACKER>.md`, like upstream's. Notes for developers (spikes, decisions, open questions) go in `docs/nyrus/`. Package contracts go in the package's README.

## Work packages

| # | Package | Status | Branch |
|---|---|---|---|
| AP1 | Hosting & operations (Forge) | Deploy script and dashboard on `main`, prod at https://nyrus.novu.ch. Agent sessions run in the sandbox ([deploy/forge/README.md](deploy/forge/README.md#sandbox-recommended)); GitHub webhooks via an org webhook to `/github-webhook` | `main` |
| AP2 | Shared base for trackers without agent sessions | Merged: [#5](https://github.com/teamnovu/nyrus/pull/5), fixes in [#9](https://github.com/teamnovu/nyrus/pull/9) | `main` |
| AP3 | ClickUp integration | Sessions on `main`: tag `nyrus` and `/nyrus` comments, acting with one person's token ([docs/CLICKUP.md](docs/CLICKUP.md)). Next: test on prod in the sandbox Space, confirm webhook payloads, admins' OK for the token | `main` |
| AP4 | Jira integration | Live on jkwebch.atlassian.net (space "sayflowers 2.0", `SAY`) since 2026-11-13: label `nyrus` → session → PR. Service account ([#10](https://github.com/teamnovu/nyrus/pull/10)), worklogs per run and dashboard usage ([#13](https://github.com/teamnovu/nyrus/pull/13)), start status `JIRA_STARTED_STATUS` ([#16](https://github.com/teamnovu/nyrus/pull/16)) | `main` |
| AP5 | Tracker-neutral prompts, status mapping, PR links | Partly: Jira start status ([#16](https://github.com/teamnovu/nyrus/pull/16)), review/done on PR open/merge and PR links (GitHub issues). Open: tracker-neutral prompts | — |
| AP6 | Tests & pilot | Pilot started on sayflowers (SAY-686 analysis, SAY-687 README PR, SAY-688 sandbox check); PR comments to `@novu-nyrus` answered | — |
| AP7 | Fork maintenance (merging upstream) | Ongoing | — |

Keep this table current when a package changes state.

## Decisions

| Date | Decision |
|---|---|
| 2026-11-13 | ClickUp and Jira are built in parallel, on the shared AP2 package `cyrus-comment-sessions`. Jira's own coordinator (#3) was merged into it: one session per ticket, hand-over read from the ticket, own comments by id and signature. Merged in that order (#5, #3, #6). |
| 2026-11-13 | User access control also applies to answers to the agent's questions and repository picks (#9): in ClickUp and Jira anyone who can comment, guests included, sends them. |
| 2026-11-13 | No contributions back to upstream Cyrus. We still merge upstream regularly (AP7). |
| 2026-11-13 | Assigning the bot means "work the whole ticket"; mentioning it in a comment means a question or instruction. |
| 2026-11-13 | ClickUp: no bot user. novu allows no non-personal ClickUp accounts, so nyrus has to act through the API in a person's name. Whose, and how it is started instead of assign/@mention, is open: see [docs/nyrus/clickup-spike.md](docs/nyrus/clickup-spike.md#identity-no-bot-account). |
| 2026-11-13 | ClickUp routing: a Space (one per customer) is the team, a List is the project. |
| 2026-11-13 | ClickUp sessions start on the tag `nyrus` (hand-over) and on comments starting with `/nyrus` (questions); assignment only with `CLICKUP_TRIGGER_ON_ASSIGN=true`. nyrus reads tasks and comments from the API instead of trusting webhook payloads, and only acts in `CLICKUP_SPACE_IDS`. Tasks are `CU-<id>` (branch `CU-<id>-<title>`) and a Space's id is its team key. No time entries, since they would land on the token person's timesheet. Whose token in production is still open. |

| 2026-11-14 | Tickets from Jira and ClickUp are worked in a GitHub issue in their repository (on with `GITHUB_ISSUES_WEBHOOK_SECRET`): the issue gets all the ticket's details, questions and progress go there, and the agent clears up open questions before it starts. The pull request closes the issue. The ticket only gets the link, the PR, review/done status and the result; its comments are still passed on and copied to GitHub. Only repository members and collaborators steer nyrus on GitHub. |
| 2026-11-14 | Repositories come from inBudget (on with `INBUDGET_URL`): an active project with a GitHub link and a Jira or ClickUp link becomes a managed repository `inbudget-<repo>-<tracker>`. inBudget owns its routing; base branch, active flag and instructions stay editable in the dashboard. Repositories configured by hand win. Links are read by URL, so no new info kinds are needed in inBudget. |
| 2026-11-14 | Agent sessions run in Claude Code's sandbox (bubblewrap, egress allowlist preset `trusted`): their shell commands read only their worktree and repository, can't reach `~/.ssh`, `.env` files or the other sites on the server, and only reach allowed domains. nyrus's own integration secrets (Slack, Jira, ClickUp tokens, webhook secrets, `CYRUS_API_KEY`) never reach sessions ([#14](https://github.com/teamnovu/nyrus/pull/14)). |
| 2026-11-14 | GitHub: nyrus acts as the user account `novu-nyrus` (fine-grained token on teamnovu) instead of a GitHub App; commits are "Nyrus <nyrus@novu.ch>". Git talks to GitHub over HTTPS with that token for every repository, so repositories added later (dashboard, inBudget) need no setup. `@novu-nyrus` in a PR comment and failed CI checks reach nyrus through an org webhook to `/github-webhook` ([#16](https://github.com/teamnovu/nyrus/pull/16)). |
| 2026-11-14 | Jira: the agent account is an Atlassian service account (`…@serviceaccount.atlassian.com`, API calls through api.atlassian.com); each agent run logs its time on the issue. |

Answered: Jira Cloud (jkwebch.atlassian.net); production on Forge (https://nyrus.novu.ch); pilot on sayflowers. Open: which further projects and repositories (from inBudget).

## Working on the fork

**Keep upstream merges cheap.** Upstream releases about weekly, and `EdgeWorker.ts` alone is over 8,000 lines that change often. So:

- Put nyrus code in new packages (`packages/comment-sessions`, `packages/clickup-event-transport`, `packages/jira-event-transport`) and new files.
- Keep edits to upstream files small and in one place. A new tracker only adds its factory to `packages/edge-worker/src/TrackerIntegrations.ts`.
- Package names stay `cyrus-*` and the CLI stays `cyrus`. Renaming them would touch every upstream file on each merge.

**Merging upstream** (AP7):

```bash
git remote add upstream https://github.com/cyrusagents/cyrus.git   # once
git fetch upstream
git checkout -b chore/merge-upstream origin/main
git merge upstream/main          # resolve conflicts, usually CHANGELOG*.md
pnpm install && pnpm build && pnpm test:packages:run
```

Then open a pull request to `main` on teamnovu/nyrus.

**Commits and pull requests** follow [CLAUDE.md](CLAUDE.md): changelog entries under `## [Unreleased]` (`CHANGELOG.md` for what users notice, `CHANGELOG.internal.md` for the rest), and proportionate tests. Pull requests go to `main` on teamnovu/nyrus, never to upstream.
