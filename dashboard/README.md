# nyrus Dashboard

Laravel app to watch and configure nyrus: status and sessions, repositories and routing, `.env` variables, logs and an audit log. Sign-in with novu SSO (auth.novu.ch, like the AI-Usage-Collector), limited to one email domain (default `novu.ch`).

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

In Forge → nyrus site → Environment set a strong shared secret (the daemon runs nyrus with `--env-file` on this file, see `deploy/forge/README.md`):

```bash
CYRUS_API_KEY=<openssl rand -hex 32>
# only if Slack is used: keep verifying Slack signatures with the key set
SLACK_DIRECT_WEBHOOKS=true
```

Then deploy nyrus so it has the `/api/dashboard/*` endpoints and picks up the key.

The nyrus Nginx config must block `/api/` and `/mcp/` from outside (see `deploy/forge/README.md`); the dashboard reaches them on `127.0.0.1`.

### 2. novu SSO

Sign-in works like in the AI-Usage-Collector: OAuth 2 (authorization code) against **auth.novu.ch**, which itself signs in with Google. On auth.novu.ch create an **OAuth Client** with redirect URI `https://<dashboard-site>/sso/check` (locally e.g. `http://127.0.0.1:8000/sso/check`) and note its client id and secret. The dashboard reads the person's email from `GET /api/me` and lets in emails of `DASHBOARD_ALLOWED_DOMAIN` (empty = everyone novu SSO vouches for).

Visitors without a session go straight to novu SSO; `/login` is shown after logout, after a failed login, or while the OAuth client is not configured.

### 3. Database (PostgreSQL)

Forge → server → **Database**: create a database `nyrus_dashboard` and a user with access to it (Forge generates the password). The dashboard stores users, sessions, cache and the audit log there; nyrus itself needs no database. PHP needs the `pgsql` extension, which Forge installs on Postgres servers.

### 4. Site

Forge → same server → new site, e.g. `nyrus-dashboard.on-forge.com`:

- Repository `teamnovu/nyrus`, branch `main`; turn off "Install Composer dependencies" (the repo root has no `composer.json`, the deploy script installs in `dashboard/`)
- Web directory: `/dashboard/public`; or, if your Forge has a separate **Root directory**, Root `/dashboard` and Web directory `/public`
- PHP 8.3 or newer, Let's Encrypt

Deploy script:

```bash
cd /home/forge/nyrus-dashboard.on-forge.com
git pull origin $FORGE_SITE_BRANCH

cd dashboard
# Laravel reads dashboard/.env. If Forge keeps the Environment in the site
# root instead (no "Root directory" set), link it; never replace a real file.
[ -e .env ] || ln -s ../.env .env
$FORGE_COMPOSER install --no-dev --no-interaction --prefer-dist --optimize-autoloader
npm ci && npm run build
$FORGE_PHP artisan migrate --force
$FORGE_PHP artisan optimize

# With OPcache's timestamp checks off (Forge's OPcache optimization), PHP-FPM
# keeps serving the old compiled views/routes/config while Nginx already serves
# the new CSS. Clear FPM's OPcache through the app with a one-time token (no
# sudo needed); fall back to a reload that never prompts for a password.
token=$($FORGE_PHP -r 'echo bin2hex(random_bytes(24));')
printf '%s' "$token" > storage/framework/opcache-reset-token
url=$(grep -E '^APP_URL=' .env | cut -d= -f2- | tr -d '"')
if curl -fsS -X POST -H "X-Deploy-Token: $token" "$url/_deploy/opcache-reset"; then
    echo " OPcache cleared"
else
    rm -f storage/framework/opcache-reset-token
    sudo -n service "${FORGE_PHP_FPM:-php8.5-fpm}" reload 2>/dev/null \
        || echo "Could not clear OPcache: restart PHP in Forge, or turn off Forge's OPcache optimization."
fi
```

If pages look half-updated after a deploy (new CSS, old HTML), PHP is serving old compiled views from OPcache and the reset step above did not run (check the deploy log; the very first deploy that adds it still needs one manual PHP restart, because the old cached routes do not know the endpoint yet). Either turn off the OPcache optimization for PHP in Forge (Server → PHP → OPcache; then changed files are picked up on their own) or restart PHP in Forge after each deploy.

Environment (Forge → site → Environment), starting from `dashboard/.env.example`. Forge stores it in the site's root directory: with Root `/dashboard` that is `dashboard/.env` directly; otherwise `/home/forge/<site>/.env`, which the deploy script links to `dashboard/.env`:

```bash
APP_ENV=production
APP_DEBUG=false
APP_URL=https://nyrus-dashboard.on-forge.com
APP_KEY=            # see below
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=nyrus_dashboard
DB_USERNAME=        # the database user from step 3
DB_PASSWORD=
NYRUS_API_KEY=      # same value as CYRUS_API_KEY in nyrus
NYRUS_LOG_PATH=     # log file of the nyrus daemon, shown in Forge
NOVU_AUTH_CLIENT_ID=     # OAuth Client on auth.novu.ch (step 2)
NOVU_AUTH_CLIENT_SECRET=
DASHBOARD_ALLOWED_DOMAIN=novu.ch
```

Set the environment **before the first deploy**, and **deploy again after every change**: the deploy script runs `php artisan optimize`, which caches the configuration. With a cached config that lacks `APP_KEY`, every page fails with `No application encryption key has been specified`. To apply changes without a full deploy: `php artisan optimize:clear && php artisan optimize` in `dashboard/`.

Generate `APP_KEY` before the first deploy (vendor is not installed yet, so not via artisan):

```bash
php -r 'echo "base64:".base64_encode(random_bytes(32)), PHP_EOL;'
```

## Local development

```bash
cd dashboard
composer install && npm install && npm run build
cp .env.example .env && php artisan key:generate
touch database/database.sqlite && php artisan migrate   # SQLite locally; PostgreSQL works too (DB_* in .env)
```

Point `NYRUS_URL` / `NYRUS_API_KEY` at a local nyrus (started with `CYRUS_API_KEY`), set `DASHBOARD_DEV_LOGIN=true` to sign in without SSO (only with `APP_ENV=local`), then `php artisan serve`.

Tests (nyrus is faked with `Http::fake()`):

```bash
php artisan test
```
