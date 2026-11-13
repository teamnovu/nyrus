# cyrus-comment-sessions

Agent sessions over plain ticket comments, for trackers that have no built-in agent sessions (ClickUp, Jira).

Linear and Plane start an *agent session* when the agent is assigned or mentioned, and show its thoughts, questions and answers in that session. ClickUp and Jira only have tickets and comments, so this package plays the session part, and the rest of Cyrus (EdgeWorker, runners, prompts) runs unchanged:

```
tracker webhook ──► your transport ──► CommentTrackerEvent ──► CommentSessionCoordinator ──► Linear-shaped webhook ──► EdgeWorker
                                                                                                                          │
ticket comments ◄── your CommentTracker ◄── CommentActivityPublisher ◄── createAgentActivity() ◄──────────────────────────┘
```

## Behavior

| On the ticket | Cyrus does |
|---|---|
| Bot assigned | Starts a delegation session that works the whole ticket (unless one is already working) |
| Bot unassigned | Stops the ticket's sessions and says so |
| Comment mentioning the bot | Resumes the ticket's latest session; starts a conversational session on that comment if there is none |
| Any comment while a session works or waits for an answer | Passed to the session as a follow-up (`followUpsWithoutMention`, default on) |
| `stop` / `@bot stop` | Stops the working session |
| Reply `2` to a question with options | Resolved to the second option |
| The bot's own comments and changes, retried webhooks | Ignored |

While a session works it keeps one **"⏳ Working on it."** comment updated with its latest step (at most every 15 s, for API rate limits). The comment is deleted when the session answers, asks or fails, so only those stay on the ticket. Sessions are saved to `<cyrusHome>/comment-sessions/<workspaceKey>.json`, so follow-ups after a restart still reach the right session.

## Adding a tracker

A tracker package (e.g. `packages/jira-event-transport`) provides:

1. **A `CommentTracker`**: `fetchIssue`, `fetchUser`, `postComment`, `updateComment`, `deleteComment`, plus `platform`, `workspaceKey` and `botUserId`. Bodies are Markdown; convert them to the tracker's format (ClickUp rich text, Jira ADF).
2. **An `IIssueTrackerService`** (from `cyrus-core`) that maps the tracker's tickets, projects, statuses and users onto Cyrus's Linear-shaped types, like `PlaneIssueTrackerService` does. It keeps a `CommentAgentSessions` and delegates the agent-session methods to it:

   ```ts
   this.sessions = new CommentAgentSessions(this, {
   	sessionsFile: sessionsFilePath(cyrusHome, this.workspaceKey),
   });

   createAgentSessionOnIssue(input) { return this.sessions.createAgentSessionOnIssue(input); }
   createAgentSessionOnComment(input) { return this.sessions.createAgentSessionOnComment(input); }
   fetchAgentSession(id) { return this.sessions.fetchAgentSession(id); }
   emitStopSignalEvent(id) { return this.sessions.emitStopSignalEvent(id); }
   createAgentActivity(input) { return this.sessions.createAgentActivity(input); }
   ```

3. **A transport** that registers a webhook route on the host's Fastify server, verifies the signature, answers at once, and turns each delivery into `CommentTrackerEvent`s:
   - `eventId`: unique per change, the same on a retry (used to drop duplicates).
   - `issueId`: the id `fetchIssue` returns as `issue.id`.
   - `actorId`: who did it (the bot's own events are dropped).
   - For comments: `body` with the bot's mention removed, and `mentionsBot`.
4. **A `TrackerIntegrationFactory`** that reads the tracker's environment variables and returns a `TrackerIntegration` (or `null` when not configured):

   ```ts
   export const createJiraIntegration: TrackerIntegrationFactory = ({ env, cyrusHome }) => {
   	if (!env.JIRA_BASE_URL) return null;
   	const tracker = new JiraIssueTrackerService(/* ... */, cyrusHome);
   	return {
   		workspaceKey: tracker.workspaceKey,
   		tracker,
   		mcpServers: () => ({ jira: jiraToolsMcpServerConfig(/* ... */) }),
   		register(host) {
   			const coordinator = tracker.sessions.createCoordinator(host);
   			new JiraEventTransport(host.fastify, /* ... */).on("event", (e) => void coordinator.handle(e));
   		},
   		dispose: () => tracker.sessions.dispose(),
   	};
   };
   ```

   Then append it to `trackerIntegrationFactories` in `packages/edge-worker/src/TrackerIntegrations.ts`. That is the only EdgeWorker change a tracker needs.

Repositories take the tracker's work by using its `workspaceKey` as their `linearWorkspaceId`, and are routed by the team (`issue.team.key`) and project your `IIssueTrackerService` reports, like Plane.
