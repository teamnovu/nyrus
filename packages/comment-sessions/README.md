# cyrus-comment-sessions

Agent sessions over plain ticket comments, for trackers that have no built-in agent sessions (ClickUp, Jira).

Linear and Plane start an *agent session* when the agent is assigned or mentioned, and show its thoughts, questions and answers in that session. ClickUp and Jira only have tickets and comments, so this package plays the session part, and the rest of Cyrus (EdgeWorker, runners, prompts) runs unchanged:

```
tracker webhook ──► your transport ──► CommentTrackerEvent ──► CommentSessionCoordinator ──► Linear-shaped webhook ──► EdgeWorker
                                                                                                                          │
ticket comments ◄── your CommentTracker ◄── CommentActivityPublisher ◄── createAgentActivity() ◄──────────────────────────┘
```

It started as two parallel designs, this package and the Jira integration's own coordinator (teamnovu/nyrus#3); it now combines both.

## Behavior

Every ticket has at most one session, `<platform>-<issue id>`, so comments continue it, also after a restart. Whether a ticket is **handed to the agent** is read fresh from the tracker on every event (e.g. it has the trigger label or tag, or is assigned to the agent's account); the tracker decides what counts.

| On the ticket | Cyrus does |
|---|---|
| Ticket handed over, no session yet (any change reports it) | Starts a delegation: the agent works the whole ticket |
| Ticket handed back after its session ended | Continues that session ("handed to you again") |
| Ticket taken away (label removed, unassigned) | Stops the session |
| Comment mentioning the agent, no session yet | Starts a conversation on that comment |
| Comment while the ticket is handed over | Passed to the session as a follow-up |
| Comment after that | Only if it mentions the agent or answers its question |
| `stop` | Stops the session |
| Reply `2` (or an option's name) to a question with options | Resolved to that option |
| The agent's own comments (posted ids, or `own` from the tracker's signature check), retried deliveries | Ignored |

The agent may write as a person's account (novu allows no bot accounts in ClickUp), so its own comments are recognized by the ids it posted and by the tracker's signature, never by the author.

While a session works it keeps one **"⏳ Working on it."** comment with its latest thought and last few steps, edited at most every 20 s and posted with `progress: true` so trackers can skip notifications. It is deleted when the session answers, asks or fails, so only those stay on the ticket.

Events for one ticket are handled in order, but the next one only waits until the edge worker has taken the previous one over (not until the agent run ends), so a stop or an answer reaches the running session.

## Adding a tracker

A tracker package (e.g. `packages/jira-event-transport`) provides:

1. **A `CommentTracker`**: `fetchIssueState` (the Linear-shaped issue and whether it is handed over, read fresh), `fetchUser`, `postComment`, `updateComment`, `deleteComment`, plus `platform` and `workspaceKey`. Bodies are Markdown: convert them to the tracker's format (ClickUp rich text, Jira wiki markup) and sign the agent's comments.
2. **An `IIssueTrackerService`** (from `cyrus-core`) that maps the tracker's tickets, projects, statuses and users onto Cyrus's Linear-shaped types, like `PlaneIssueTrackerService` does. It keeps a `CommentAgentSessions` and delegates the agent-session methods to it:

   ```ts
   this.sessions = new CommentAgentSessions(this);

   createAgentSessionOnIssue(input) { return this.sessions.createAgentSessionOnIssue(input); }
   createAgentSessionOnComment(input) { return this.sessions.createAgentSessionOnComment(input); }
   fetchAgentSession(id) { return this.sessions.fetchAgentSession(id); }
   emitStopSignalEvent(id) { return this.sessions.emitStopSignalEvent(id); }
   createAgentActivity(input) { return this.sessions.createAgentActivity(input); }
   ```

3. **A transport** that registers a webhook route on the host's Fastify server, verifies the request, answers at once, and turns each delivery into `CommentTrackerEvent`s:
   - `issue` for a change of the ticket, with `handOver: "added" | "removed"` if the webhook shows that the hand-over changed.
   - `comment` with `body` (Markdown, the agent's mention removed), `mentionsAgent`, and `own` if the tracker's signature check recognizes it.
   - `eventId` if the tracker has a per-change id (used to drop retried deliveries), `actor` if known.
4. **A `TrackerIntegrationFactory`** that reads the tracker's environment variables and returns a `TrackerIntegration` (or `null` when not configured):

   ```ts
   export const createJiraIntegration: TrackerIntegrationFactory = ({ env, logger }) => {
   	if (!env.JIRA_BASE_URL) return null;
   	const tracker = new JiraIssueTrackerService(/* ... */);
   	return {
   		workspaceKey: tracker.workspaceKey,
   		tracker,
   		mcpServers: () => ({ jira: tracker.toolsMcpServerConfig() }),
   		register(host) {
   			const coordinator = tracker.sessions.createCoordinator(host);
   			const transport = new JiraEventTransport({ fastifyServer: host.fastify, /* ... */ });
   			transport.on("event", (e) => void coordinator.handle(toCommentTrackerEvent(e)));
   			transport.register();
   		},
   		dispose: () => tracker.dispose(),
   	};
   };
   ```

   Then append it to `trackerIntegrationFactories` in `packages/edge-worker/src/TrackerIntegrations.ts`. That is the only EdgeWorker change a tracker needs.

Repositories take the tracker's work by using its `workspaceKey` as their `linearWorkspaceId`, and are routed by the team (`issue.team.key`) and project your `IIssueTrackerService` reports, like Plane.
