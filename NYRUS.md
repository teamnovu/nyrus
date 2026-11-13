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
| ClickUp integration (AP3): spike and findings | `docs/nyrus/clickup-spike.md` (on `feat/clickup-integration` until merged) |
| ClickUp setup guide (once released) | `docs/CLICKUP.md` |
| Jira integration (AP4) setup guide (once released) | `docs/JIRA.md` |
| Plane, the integration ClickUp and Jira are modeled on | [docs/PLANE.md](docs/PLANE.md), [packages/plane-event-transport](packages/plane-event-transport) |

Setup guides for users go in `docs/<TRACKER>.md`, like upstream's. Notes for developers (spikes, decisions, open questions) go in `docs/nyrus/`. Package contracts go in the package's README.

## Work packages

| # | Package | Status | Branch |
|---|---|---|---|
| AP1 | Hosting & operations (Forge) | Deploy script on `main` | `main` |
| AP2 | Shared base for trackers without agent sessions | Built, in review | `feat/ap2-comment-sessions` |
| AP3 | ClickUp integration | Spike | `feat/clickup-integration` (on top of AP2) |
| AP4 | Jira integration | In progress (other developer) | — |
| AP5 | Tracker-neutral prompts, status mapping, PR links | Open | — |
| AP6 | Tests & pilot | Open | — |
| AP7 | Fork maintenance (merging upstream) | Ongoing | — |

Keep this table current when a package changes state.

## Decisions

| Date | Decision |
|---|---|
| 2026-11-13 | ClickUp and Jira are built in parallel, on the shared AP2 package `cyrus-comment-sessions`. |
| 2026-11-13 | No contributions back to upstream Cyrus. We still merge upstream regularly (AP7). |
| 2026-11-13 | Assigning the bot means "work the whole ticket"; mentioning it in a comment means a question or instruction. |
| 2026-11-13 | One bot user with an API token per tracker; an OAuth app only once several customer workspaces need it. |
| 2026-11-13 | ClickUp routing: a Space (one per customer) is the team, a List is the project. |

Open: Jira Cloud or Data Center, where nyrus runs in production, and which projects and repositories the pilot uses.

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
