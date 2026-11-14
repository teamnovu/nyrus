# Service desk triage

nyrus can look at every new ticket in a Jira service desk (for novu: the `NOV` queue), find out which inBudget customer and project it is about, and suggest who should handle it: the people who booked the most hours on that project. It writes the suggestion as an **internal comment** on the ticket, so the customer doesn't see it, and it can assign the ticket to the first person too.

```
🤖 Nyrus
Triage-Vorschlag
Kunde: Zoo Zürich (erkannt über Absender-Domain zoo.ch)
Projekt: P-10 Website (von 2 aktiven Projekten, gewählt nach Ticket-Text)
Vorschlag Bearbeitung: Anna Muster (142 h)
Weitere: Marco Rossi (60 h), Lea Meier (12 h)
Gebuchte Stunden auf dem Projekt in den letzten 12 Monaten, aus inBudget.
```

No agent session runs and no code is touched. Triage only reads Jira and inBudget, plus one short Claude question when the customer or project isn't clear.

## How it decides

1. **The ticket:** a new, unassigned ticket in one of `TRIAGE_JIRA_PROJECTS`. Tickets that already got a triage comment are skipped, and so are senders like `noreply@…`.
2. **The customer**, the first that works:
   - the sender's email is a **contact (person)** of a customer in inBudget;
   - the sender's **domain** is a domain of one of a customer's **resources** (websites, including aliases and subdomains). Free-mail domains (gmail.com, bluewin.ch, …) and `TRIAGE_OWN_DOMAINS` (novu.ch) never count;
   - otherwise **Claude reads the ticket** and picks the customer from the list of customers with active projects, or says it can't tell.
3. **The project:** if the customer has one active, non-internal project, that one. If it has several, Claude picks one from the ticket text. If Claude can't tell, the comment lists them, and the hours count over all of them.
4. **The people:** hours per person on the project from inBudget's work-hour insights, over the last `TRIAGE_HOURS_MONTHS` months (all time if nobody booked in that window). People disabled in inBudget are left out. The top three are listed.
5. **Assigning** (only with `TRIAGE_ASSIGN=true`): the first person is found in Jira by their inBudget email and assigned. If that fails, the comment says why.

The ticket text goes to Claude as untrusted data. Claude has no tools and can only answer with one of the listed ids, so a ticket can at worst make it pick the wrong customer.

## Setup

Triage needs Jira (see [JIRA.md](JIRA.md)) and inBudget (see [INBUDGET.md](INBUDGET.md)) set up in nyrus.

### 1. Accounts

- **Jira:** the account in `JIRA_EMAIL` posts the comment. In a service project, internal comments need an **agent**, so add that account (or service account) to the service project as an agent. It must be allowed to browse the project and, with `TRIAGE_ASSIGN`, to assign issues.
- **inBudget:** the `INBUDGET_TOKEN` user must see the customers' contacts and resources, all projects, all users, and **work hours of other people** (project insights). A user with the project manager role usually does. If it only sees its own hours, the suggestions are wrong.

### 2. nyrus

In `<cyrus-home>/.env` (Forge: site → Environment):

```bash
TRIAGE_JIRA_PROJECTS=NOV          # turns triage on; comma-separated Jira project keys
# TRIAGE_ASSIGN=false             # true: also assign the ticket to the first person
# TRIAGE_HOURS_MONTHS=12          # hours of the last N months; 0 for all time
# TRIAGE_OWN_DOMAINS=novu.ch      # domains that never identify a customer
# TRIAGE_IGNORE_SENDERS=          # more senders to skip (parts of the email), comma-separated
# TRIAGE_CLAUDE=true              # false: no Claude, only email and domain matching
# TRIAGE_MODEL=haiku              # model for picking customer and project
# TRIAGE_WEBHOOK_SECRET=          # defaults to JIRA_WEBHOOK_SECRET
```

Claude uses the same `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` as agent sessions. Restart; the log shows `✅ Service desk triage registered for NOV`.

### 3. Send new tickets to nyrus

Either of these, with the URL `https://<host>/jira-triage-webhook`:

**A. Admin webhook:** Jira settings → System → WebHooks → Create, with the secret, the event **Issue: created** and the JQL filter `project = NOV`.

**B. Jira Automation** (project admin is enough): in the NOV project, a rule **Issue created** → **Send web request**:

- URL `https://<host>/jira-triage-webhook?secret=<secret>` (or the header `X-Cyrus-Webhook-Secret`)
- Method `POST`, body **Custom data**: `{"issueKey": "{{issue.key}}"}`

### 4. Try it without commenting

On the server, try a ticket by hand. This is a dry run unless you add `"dryRun": false`; `"force": true` also triages assigned tickets:

```bash
curl -s -X POST http://127.0.0.1:3456/api/dashboard/triage \
  -H "Authorization: Bearer $CYRUS_API_KEY" -H 'Content-Type: application/json' \
  -d '{"issueKey": "NOV-9019"}'
```

The answer shows the customer, project, people and the comment it would post.

## Notes

- Tickets that came in before triage was on aren't touched; use the endpoint above with `"dryRun": false` for them.
- Jira shows a customer's email only when its profile allows it. Customers created from an email are named by their address, which works too; for anyone else Claude decides from the text.
- Triaged tickets are remembered in `<cyrus-home>/servicedesk-triage.json`, and a ticket with a triage comment is never triaged again.
- inBudget projects and users are cached for 15 minutes.
