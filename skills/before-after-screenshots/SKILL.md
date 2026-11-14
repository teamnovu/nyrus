---
name: before-after-screenshots
description: Use after you changed something visible in the browser (templates, CSS, JS, page content, images) and pushed it. Takes a "before" screenshot (base branch) and an "after" screenshot (your branch) of the affected page, posts both in the Jira ticket as one comment and links the ticket from the PR. Skip it for backend-only changes or when the site can't be rendered, and say why in one sentence.
---

# Before/after screenshots

Show the reviewer what your change looks like: one "before" and one "after" image of the same page, posted in the **Jira ticket** (never in the GitHub PR: there is no API for images there).

## 1. Decide

- **Skip** if nothing visible changed (backend, config, tests, tooling only). Say so in one sentence in your summary, e.g. "No screenshots: backend-only change."
- **Skip** if the helper is missing: `test -f /opt/nyrus-screenshots/nyrus-screenshot.mjs || echo missing` → "No screenshots: the screenshot tool is not installed on this server."
- Otherwise find the page that shows the change (URL path) and how to render the site **without a database or secrets**:
  - static files or a built site → `--serve <dir> --path /page.html`
  - a server that runs without DB/secrets → `--server "<command>" --url http://127.0.0.1:<port>/<path>`, e.g. `php -S 127.0.0.1:8123 -t public`, `npx vite preview --port 8123 --strictPort`, `python3 -m http.server 8123 --bind 127.0.0.1`
  - If the site needs a database, Docker, private registries or credentials to render, you can't render it here. See "Fallback" below, or skip with one sentence that names what is missing.

## 2. Render the base branch next to your branch

The sandbox lets you write only inside the worktree. Put everything under `.nyrus/`, which git ignores:

```bash
mkdir -p .nyrus/screenshots && echo '*' > .nyrus/.gitignore
rm -rf .nyrus/base && mkdir -p .nyrus/base
git archive origin/<base_branch> | tar -x -C .nyrus/base
```

If the site needs a build or dependencies, do the same steps in both copies (reuse dependencies with a symlink, e.g. `ln -s "$PWD/node_modules" .nyrus/base/node_modules`).

## 3. Take both screenshots

Every Bash call runs in its own sandbox: a server you start in one call is gone in the next. The helper therefore starts the server (`--serve` or `--server`), takes the screenshot and stops the server in **one** command. Use the **same page, viewport and options** for both shots:

```bash
SHOT="node /opt/nyrus-screenshots/nyrus-screenshot.mjs"
# before (base branch)
$SHOT --serve .nyrus/base/public --path /index.html --out .nyrus/screenshots/<KEY>-before.png
# after (your branch)
$SHOT --serve public --path /index.html --out .nyrus/screenshots/<KEY>-after.png
```

Options: `--width 1440 --height 900` (default; use `--width 390 --height 844` for a mobile change), `--full-page`, `--selector "<css>"` (only that element, good for a change far down the page), `--wait <ms>`, `--timeout <s>`. With `--server`, `cd` into the copy first, e.g. `(cd .nyrus/base && $SHOT --server "php -S 127.0.0.1:8123 -t public" --url http://127.0.0.1:8123/ --out ../screenshots/<KEY>-before.png)`.

The helper prints `{"out", "url", "status", "title", "viewport"}`. Check that `status` is 200 and **look at both images** with the Read tool: they must show the page (not an error page) and the change must be visible. If not, fix the page/selector or skip.

## 4. Post in Jira

1. Upload both files (absolute paths): `mcp__jira__upload_attachments` with `{ "key": "<KEY>", "files": ["<worktree>/.nyrus/screenshots/<KEY>-before.png", "<worktree>/.nyrus/screenshots/<KEY>-after.png"] }`.
2. Post **one** comment with `mcp__jira__add_comment`, in the ticket's language, using the file names the upload returned (a name that already exists on the ticket gets a numeric suffix; names must not contain spaces):

   ```markdown
   Vorher / Nachher: `/path/of/the/page` (1440×900)

   ![Vorher](<KEY>-before.png)
   ![Nachher](<KEY>-after.png)
   ```

## 5. Link it from the PR

Add one line to the PR description, no images:

```bash
body="$(gh pr view --json body -q .body)"
gh pr edit --body "$body

Screenshots (before/after): <Jira ticket URL>"
```

Then remove the base copy: `rm -rf .nyrus/base`.

## Fallback: no local render

Only if the site can't be rendered here **and** the repository documents a public URL that runs the base branch (a staging site, not a production site that runs other code), and that domain is reachable through the egress proxy: take the "before" shot from that URL (`$SHOT --url https://staging.example.com/page --out …-before.png`). There is no "after" until your branch is deployed, so say that plainly in the comment (e.g. "Nachher: erst nach dem Deploy sichtbar, die Seite lässt sich hier nicht rendern (braucht Datenbank)"). If the domain is blocked (`ERR_TUNNEL_CONNECTION_FAILED`), skip with one sentence.
