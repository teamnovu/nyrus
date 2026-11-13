# nyrus Dashboard

Laravel app to watch and configure nyrus: status and sessions, repositories and routing, `.env` variables, logs and an audit log. Sign-in with Google, limited to one domain (default `novu.ch`).

It runs as a second Forge site on the nyrus server and talks to nyrus on `127.0.0.1` with the shared `CYRUS_API_KEY`:

| Page | nyrus endpoint |
|---|---|
| Übersicht (status, sessions) | `GET /status`, `GET /version`, `GET /api/dashboard/sessions` |
| Session detail | `GET /api/dashboard/session?id=…` |
| Repositories | `GET /api/dashboard/config`, `POST`/`DELETE /api/dashboard/repository`, `POST /api/dashboard/repository/routing` |
| Einstellungen | `GET /api/dashboard/env` (names only), `POST /api/update/cyrus-env`, `POST /api/check-gh` |
| Logs | reads the nyrus daemon log file directly (`NYRUS_LOG_PATH`) |
| Audit-Log | own table: who changed what (never secret values) |

The `/api/dashboard/*` endpoints live in `packages/config-updater` of this repo. nyrus picks up repository changes in `config.json` without a restart.

## Forge setup

### 1. nyrus

In nyrus's `~/.cyrus/.env` set a strong shared secret and restart nyrus:

```bash
CYRUS_API_KEY=<openssl rand -hex 32>
# only if Slack is used: keep verifying Slack signatures with the key set
SLACK_DIRECT_WEBHOOKS=true
```

```bash
cd /home/forge/nyrus.on-forge.com && NYRUS_SKIP_BUILD=1 bash deploy/forge/deploy.sh
```

The nyrus Nginx config must block `/api/` and `/mcp/` from outside (see `deploy/forge/README.md`); the dashboard reaches them on `127.0.0.1`.

### 2. Google sign-in

Google Cloud console → APIs & Services:

1. OAuth consent screen: user type **Internal** (only accounts of the Google Workspace).
2. Credentials → OAuth client ID → **Web application**, authorized redirect URI `https://<dashboard-site>/auth/google/callback`.

### 3. Site

Forge → same server → new site, e.g. `nyrus-dashboard.on-forge.com`:

- Repository `teamnovu/nyrus`, branch `main`
- Web directory: `/dashboard/public`
- PHP 8.3 or newer, Let's Encrypt

Deploy script:

```bash
cd /home/forge/nyrus-dashboard.on-forge.com
git pull origin $FORGE_SITE_BRANCH

cd dashboard
$FORGE_COMPOSER install --no-dev --no-interaction --prefer-dist --optimize-autoloader
npm ci && npm run build
touch database/database.sqlite
$FORGE_PHP artisan migrate --force
$FORGE_PHP artisan optimize
```

Environment (Forge → site → Environment; the file is `dashboard/.env`), starting from `.env.example`:

```bash
APP_ENV=production
APP_DEBUG=false
APP_URL=https://nyrus-dashboard.on-forge.com
APP_KEY=            # php artisan key:generate --show
NYRUS_API_KEY=      # same value as CYRUS_API_KEY in nyrus
NYRUS_LOG_PATH=     # log file of the nyrus daemon, shown in Forge
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
DASHBOARD_ALLOWED_DOMAIN=novu.ch
```

## Local development

```bash
cd dashboard
composer install && npm install && npm run build
cp .env.example .env && php artisan key:generate
touch database/database.sqlite && php artisan migrate
```

Point `NYRUS_URL` / `NYRUS_API_KEY` at a local nyrus (started with `CYRUS_API_KEY`), set `DASHBOARD_DEV_LOGIN=true` to sign in without Google (only with `APP_ENV=local`), then `php artisan serve`.

Tests (nyrus is faked with `Http::fake()`):

```bash
php artisan test
```
