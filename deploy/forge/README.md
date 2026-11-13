# Deploying nyrus on Laravel Forge

nyrus runs as a long-lived Node process on a server managed by [Laravel Forge](https://forge.laravel.com). Forge provides the server, Nginx with Let's Encrypt, deploys from Git and keeps the process alive as a daemon (Supervisor).

> **Use a dedicated server.** The agent runs code from the repositories it works on (builds, tests, scripts). Don't put nyrus on a server that hosts customer sites. Plan for at least 4 GB RAM (8 GB is better) and 80 GB disk or more for the repositories and one worktree per ticket.

## 1. Server

Install on the server (as `forge`, unless noted):

- Node.js 18 or newer (Forge: server → PHP/Node settings, or NodeSource). pnpm comes through `corepack` using the version in `package.json`; the deploy script pins that version for all calls, so a globally installed pnpm of another version doesn't get in the way.
- `git`, `curl`, `jq` and `gh` (GitHub CLI); with sudo: `apt install -y jq gh`
- Claude Code CLI, signed in (subscription login or `ANTHROPIC_API_KEY`)
- `gh auth login` as the GitHub bot account that opens the pull requests
- Whatever the target repositories need for their tests (PHP, Composer, …)

## 2. Site

1. Create a site, e.g. `nyrus.on-forge.com` (project type: static/HTML; the web directory doesn't matter).
2. Enable Let's Encrypt.
3. Link the repository `teamnovu/nyrus`, branch `main`. Turn off "Install Composer dependencies".
4. Edit the site's Nginx config and replace the `location /` block with:

   ```nginx
   # nyrus listens on CYRUS_SERVER_PORT (default 3456)
   location / {
       proxy_pass http://127.0.0.1:3456;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_read_timeout 300s;
   }

   # Internal only: the deploy script reads these on 127.0.0.1 directly
   location ~ ^/(status|version)$ {
       deny all;
   }

   # Internal only: config API (used by the dashboard on 127.0.0.1) and the
   # cyrus-tools MCP endpoint (used by agent sessions on 127.0.0.1)
   location ^~ /api/ {
       deny all;
   }
   location ^~ /mcp/ {
       deny all;
   }
   ```

   Only the webhook paths need to be reachable from outside. The `/mcp/` endpoint skips its authorization check when `CYRUS_API_KEY` is not set, so keep these blocks in any case.

Webhooks from ClickUp and Jira then go to `https://nyrus.on-forge.com/…`. No Cloudflare Tunnel is needed.

## 3. Configuration

nyrus keeps its data (repositories, worktrees, state, `config.json`) in `~/.cyrus/` of the `forge` user. Its **variables live in the site's `.env`**, which you edit in **Forge → site → Environment** (the file `/home/forge/nyrus.on-forge.com/.env`). The daemon starts nyrus with `--env-file` pointing at that file (section 5), and nyrus's config API (used by the dashboard) writes to the same file.

- **Forge → site → Environment:** replace the content with [`env.example`](env.example), which lists every variable we need and the ones not to set, and fill in the values:

  | Variable | Needed | What for |
  |---|---|---|
  | `CYRUS_BASE_URL` | yes | Public URL for webhooks: `https://nyrus.on-forge.com` |
  | `CYRUS_SERVER_PORT` | yes | Local port, `3456` (matches the Nginx proxy) |
  | `CYRUS_API_KEY` | yes | Shared secret for nyrus's own APIs (`openssl rand -hex 32`); the dashboard uses it as `NYRUS_API_KEY`, and `/mcp/cyrus-tools` only checks auth when it is set. With Slack also set `SLACK_DIRECT_WEBHOOKS=true` |
  | `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` | for agent sessions | Claude access; the token comes from `claude setup-token` (subscription) |
  | `GITHUB_TOKEN` | for pull requests | Token of the GitHub bot account; also `gh auth login` as that account |
  | ClickUp / Jira tokens and webhook secrets | once AP3 / AP4 land | Names are defined by the integrations; placeholders in `env.example` |

  Don't set `CYRUS_HOST_EXTERNAL` (binds to `0.0.0.0` and enables webhook IP allowlists, not needed behind Nginx), `CYRUS_TEAM_ID` / `CYRUS_APP_URL` (hosted Cyrus cloud only; together with `CYRUS_API_KEY` they mirror session transcripts there), `LINEAR_*` or `CLOUDFLARE_TOKEN`.

  nyrus starts without Linear and without repositories: with only `CYRUS_BASE_URL` and `CYRUS_SERVER_PORT` it runs, listens on `127.0.0.1` and `::1`, and answers `/status` and `/version` (checked locally with v0.2.78). It watches the env file and reloads it when Forge saves it (also when the file is replaced instead of rewritten). Values read only at startup, such as the port, need a restart: `NYRUS_SKIP_BUILD=1 bash deploy/forge/deploy.sh`.

- `~/.cyrus/config.json`: repositories and routing (which project goes to which repository), see `docs/CONFIG_FILE.md`. Without it nyrus starts with no repositories and does nothing until some are added.

Secrets live only on the server, never in the repository.

## Dashboard

The Laravel dashboard in [`dashboard/`](../../dashboard) runs as a second Forge site on the same server and talks to nyrus on `127.0.0.1`. Setup: [`dashboard/README.md`](../../dashboard/README.md).

## 4. Deploy script

Set the site's deploy script in Forge to (keep Forge's default `git pull`, add the last line):

```bash
cd /home/forge/nyrus.on-forge.com
git pull origin $FORGE_SITE_BRANCH
bash deploy/forge/deploy.sh
```

Forge pulls the code; `deploy.sh` does not. That way a changed `deploy.sh` is already on disk before it runs (bash reads a script while running it, so pulling a new version of it mid-run could break the deploy). `deploy/forge/deploy.sh` must be on the deploy branch for this to work.

Run the first deploy before creating the daemon, so the build exists. It ends with a warning that nyrus is not running (no daemon yet) but counts as successful.

[`deploy.sh`](deploy.sh) installs dependencies, builds and smoke-tests the CLI. It then **waits until nyrus is idle** (`GET /status`) so running agent sessions are not cut off, restarts the process and checks that the new one answers. Optional settings (environment variables in Forge):

| Variable | Default | Meaning |
|---|---|---|
| `NYRUS_PORT` | `CYRUS_SERVER_PORT` or `3456` | Port nyrus listens on |
| `NYRUS_IDLE_TIMEOUT` | `1800` | Seconds to wait for idle; after that the deploy fails without restarting |
| `NYRUS_IDLE_POLL` | `15` | Seconds between `/status` checks |
| `NYRUS_FORCE_RESTART` | `0` | `1` restarts even while sessions are running |
| `NYRUS_START_TIMEOUT` | `90` | Seconds to wait for the new process |
| `NYRUS_SKIP_BUILD` | `0` | `1` only restarts (skips install and build), e.g. after changing `.env` |
| `NYRUS_DAEMON_GRACE` | `15` | If nyrus wasn't running, seconds to wait for a process to appear; if none does, the deploy succeeds with a warning (no daemon yet) |

## 5. Daemon

Forge → server → Daemons:

| Field | Value |
|---|---|
| Command | `node /home/forge/nyrus.on-forge.com/apps/cli/dist/src/app.js --env-file /home/forge/nyrus.on-forge.com/.env` |
| User | `forge` |
| Directory | `/home/forge/nyrus.on-forge.com` |
| Processes | `1` |
| Stop seconds | `30` |

Use the **absolute path** of the entry file: the deploy script finds the process by it. `--env-file` makes nyrus use the variables from Forge's Environment page instead of `~/.cyrus/.env`. The script stops the process with `SIGTERM` (nyrus shuts down gracefully), and Supervisor starts it again with the new build.

## Checks

```bash
curl -s http://127.0.0.1:3456/status    # {"status":"idle"} or {"status":"busy"}
curl -s http://127.0.0.1:3456/version
```

Logs: Forge → Daemons → log of the nyrus daemon.

## Notes

- The build is replaced while the old process is still running and waiting for idle. If the wait times out, the new build is on disk but not running yet: deploy again later.
- Worktrees of finished tickets pile up; clean them up regularly.
