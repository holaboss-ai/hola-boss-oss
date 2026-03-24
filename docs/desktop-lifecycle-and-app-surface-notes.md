# Desktop Lifecycle And App Surface Notes

Date: 2026-03-24
Branch: `feat/application-lifecycle-ui`
Worktree: `/Users/jeffrey/Desktop/holaboss/hola-boss-oss-lifecycle`

## Purpose

This note captures the current product and implementation decisions for the desktop application lifecycle work so the context survives compaction.

## Hard Constraints

- Do not modify any code under `runtime/`.
- If runtime changes become necessary, stop and inform the user before proceeding.
- Work should stay in the lifecycle worktree unless explicitly directed otherwise.

## Current Desktop Shell Model

The current Electron desktop shell in `desktop/` now behaves like this:

- Left rail is top-level app navigation.
- Top-level modes:
  - `Agent`
  - `Automations`
  - `Skills`
- `Agent` owns the collapsible right drawer.
- Right drawer tabs:
  - `Inbox`
  - `Running`
  - `Outputs`
- `Automations` is intended for full cronjob management.
- `Skills` is a separate focus screen.
- Browser and Files are manual-open workbench tools.
- Agent-triggered browser open is allowed.
- Agent-triggered file explorer open is not wanted.

## Correct Layout Intent

Target layout:

- Left: persistent navigation rail
- Center: active focus surface
- Right: collapsible agent drawer, only visible in `Agent`

Important behavior:

- Clicking the left rail changes the whole focus screen.
- The right drawer does not represent app-wide navigation.
- The right drawer belongs only to `Agent`.

## Application Lifecycle Direction

The lifecycle should not be represented as a single vague badge like `Finishing setup`.

Lifecycle should be shown as explicit steps with state:

- signed in
- runtime provisioned
- sandbox assigned
- desktop browser ready
- workspace ready

Each step should support:

- `pending`
- `current`
- `done`
- `error`

The auth popup should stay minimal. Lifecycle should become a clearer visible surface in the desktop shell.

## Inspiration Pulled From `holaboss-app`

Useful references found locally:

- `/Users/jeffrey/Desktop/holaboss/holaboss-app/docs/superpowers/specs/2026-03-19-workspace-onboarding-design.md`
- `/Users/jeffrey/Desktop/holaboss/holaboss-app/docs/design/2026-03-11-workspace-activity-panel-design.md`
- `/Users/jeffrey/Desktop/holaboss/holaboss-app/apps/web/src/components/ui/timeline.tsx`
- `/Users/jeffrey/Desktop/holaboss/holaboss-app/apps/web/src/components/dashboard/sidebar/sidebar-apps.tsx`
- `/Users/jeffrey/Desktop/holaboss/holaboss-app/apps/web/src/features/outputs/components/output-detail.tsx`
- `/Users/jeffrey/Desktop/holaboss/holaboss-app/apps/web/src/features/outputs/components/document-editor.tsx`
- `/Users/jeffrey/Desktop/holaboss/holaboss-app/docs/plans/2026-03-10-chat-first-multi-workspace-design.md`

Main ideas borrowed:

- onboarding/lifecycle should be a first-class flow
- activity/output surfaces should be visible without leaving the main workspace
- installed apps should be real workspace destinations
- outputs should be able to open either app surfaces or internal surfaces
- a timeline-style component is a good fit for lifecycle rendering

## Output Rendering Model

Do not classify outputs by narrow domain types like social media drafts.

The only meaningful distinction the user wants is:

- rendered by a workspace app
- rendered internally by Holaboss

Use a renderer-based model, not a domain enum.

Suggested model:

```ts
type OutputRenderer =
  | { type: "app"; appId: string; resourceId?: string | null; view?: string | null }
  | { type: "internal"; surface: "document" | "preview" | "file" | "event"; resourceId?: string | null };

interface DesktopOutputEntry {
  id: string;
  title: string;
  detail: string;
  createdAt: string;
  sessionId?: string | null;
  renderer: OutputRenderer;
}
```

Behavior:

- app-rendered output -> switch center focus to the app surface
- internal output -> switch center focus to an internal surface

## App Surface Interaction Model

Installed apps in a workspace should be real destinations, not decorative list items.

Examples:

- clicking `LinkedIn` in the left rail opens the LinkedIn app surface
- clicking an output with `renderer.type === "app"` opens that app and resource
- left rail should visually reflect the active app when an app surface is open

The center area under `Agent` should support sub-focus:

- chat
- app surface
- internal document editor
- internal preview

Suggested `Agent` sub-view state:

```ts
type AgentView =
  | { type: "chat" }
  | { type: "app"; appId: string; resourceId?: string | null; view?: string | null }
  | { type: "internal"; surface: "document" | "preview" | "file" | "event"; resourceId?: string | null };
```

## Outputs Panel Direction

Current `Outputs` drawer behavior is too shallow because it behaves like a desktop event log.

Target behavior:

- outputs list should hold actionable artifacts/events
- selecting an output shows detail
- detail view should expose a primary action:
  - `Open in <App>`
  - `Open document`
  - `Preview`
  - `Reveal in files`
  - `View source session`

The outputs panel should dispatch the center view to the correct target.

## Left Rail Direction

Top-level left rail should remain:

- `Agent`
- `Automations`
- `Skills`

Below that, the workspace should show installed apps.

Important:

- installed apps are not top-level global modes
- they are sub-destinations inside `Agent`
- they should be workspace-scoped

## Automations

The user has stated:

- `Automations` should be full cronjob management

This should remain separate from the `Agent` right drawer.

## Right Drawer

The user has stated:

- right drawer is collapsible
- right drawer belongs only to `Agent`
- `Inbox` holds remote task proposals
- `Accept` immediately enqueues the proposal
- `Dismiss` persists dismissal back to backend
- `Running` can stay placeholder for now
- `Outputs` is the agent-side outputs surface

## Browser And Files

The user has stated:

- Browser: manual open + agent-triggered open
- Files: manual open only
- both live in an on-demand workbench
- no agent-triggered file explorer opening

## Previously Diagnosed Setup/Auth Issue

Relevant prior finding for lifecycle work:

- the desktop app previously restored a signed-in session on startup without automatically reprovisioning runtime binding
- this caused the UI to stay stuck at `Finishing setup`
- a startup sync path was added in desktop Electron code so persisted sessions trigger runtime binding provisioning on launch
- runtime-config change events were also added so the renderer updates when provisioning completes

This may matter for future lifecycle visualizations.

## Recommended Next Implementation Order

1. Add `Agent` sub-view state for chat vs app vs internal surface.
2. Make left-rail app items real selectable destinations.
3. Replace output log entries with renderer-aware outputs.
4. Let output selection route the center focus.
5. Add a generic app surface pane.
6. Add a lifecycle panel or timeline surface in desktop without touching `runtime/`.

## If Blocked

If any upcoming step requires:

- new runtime endpoints
- runtime schema changes
- runtime-side app metadata changes

stop and notify the user before editing anything under `runtime/`.
