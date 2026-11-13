# ClickUp

nyrus takes work from [ClickUp](https://clickup.com) tasks. **Status: first stage.** nyrus receives ClickUp's webhooks, checks their signature, logs them and can record them; it does not start sessions on ClickUp tasks yet. Design, findings and open questions: [docs/nyrus/clickup-spike.md](nyrus/clickup-spike.md).

## How it will work

novu allows no non-personal ClickUp accounts, so there is no `nyrus` user to assign or mention. nyrus acts through the API with one person's access and marks its comments "🤖 nyrus:". Proposed triggers (not final): the tag `nyrus` on a task to work the whole task, and comments starting with `/nyrus` for questions and instructions.

## 1. Configure nyrus

On Forge: **site → Environment** (see [deploy/forge/README.md](../deploy/forge/README.md)). Elsewhere: `<cyrus-home>/.env`.

```bash
CLICKUP_WEBHOOK_SECRET=...     # from step 2; ClickUp stays off without it
CLICKUP_TEAM_ID=14278081       # the ClickUp workspace (novu: 14278081)
# CLICKUP_WEBHOOK_RECORD=1     # save every delivery to <cyrus-home>/clickup-webhooks/
```

nyrus then answers `POST <CYRUS_BASE_URL>/clickup-webhook` and logs `Registered POST /clickup-webhook` at startup. Restart after setting the secret the first time: `NYRUS_SKIP_BUILD=1 bash deploy/forge/deploy.sh`.

## 2. Create the webhook

ClickUp has no settings page for API webhooks; create it with the API, from any machine, with the token of the person nyrus acts as (in `~/.cyrus/.env` as `CLICKUP_API_TOKEN` and `CLICKUP_TEAM_ID`):

```bash
node scripts/clickup/webhook.mjs create --endpoint https://nyrus.novu.ch/clickup-webhook --space <space id>
```

Narrow it to the Spaces nyrus should see (`--space`, `--folder`, `--list`); without one it covers the whole workspace. The command saves the webhook's secret to that machine's `~/.cyrus/.env` as `CLICKUP_WEBHOOK_SECRET`, since ClickUp shows it only once: copy it from there into nyrus's environment (step 1).

`webhook.mjs list` shows the webhooks and their health, `reactivate <id>` turns a suspended one back on, `delete <id>` removes one.

## Behavior

- A delivery with a wrong or missing `X-Signature` is answered with **400**. Never 401: ClickUp suspends a webhook that gets a 401.
- Valid deliveries are answered at once and logged as one line per delivery (event, task id, changed fields, user ids; no comment texts).
- With `CLICKUP_WEBHOOK_RECORD=1` each delivery is also saved as a JSON file in `<cyrus-home>/clickup-webhooks/` (on Forge: `/home/forge/.cyrus/clickup-webhooks/`). These contain real task data: turn recording off when you have what you need, and delete the files.
- ClickUp suspends a webhook after repeated failed deliveries (e.g. while nyrus is down). Check with `webhook.mjs list` and reactivate it.
