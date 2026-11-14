# cyrus-inbudget-sync

Repositories and their routing from inBudget projects. Setup and behavior: [docs/INBUDGET.md](../../docs/INBUDGET.md).

- `InbudgetClient`: inBudget's REST API (`/api/projects`, `/api/project_infos`) with an access token, read-only.
- `parseProjectLink`: a project info's URL as a GitHub repository, Jira project or ClickUp Space/List/Folder.
- `planRepositories`: projects and infos → the repositories nyrus should have, per tracker workspace, with warnings. Pure.
- `applyPlan`: brings `config.json` in line (managed `inbudget-*` entries, clone on add, turn off instead of delete).
- `InbudgetSync` and `createInbudgetIntegration`: one sync at a time, on a timer, plus `GET/POST /api/dashboard/inbudget` (Bearer `CYRUS_API_KEY`) for the dashboard.

It plugs into the edge worker as a `TrackerIntegrationFactory` (see `packages/edge-worker/src/TrackerIntegrations.ts`) without a tracker of its own.
