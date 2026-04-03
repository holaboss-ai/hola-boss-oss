# CRM App Outputs Phase 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the post-Phase-2 work from the original contact-centric CRM app outputs plan by adding Gmail thread outputs, surfacing CRM links in the desktop, and making the Sheets-to-Gmail follow-up workflow explicit and reopenable.

**Architecture:** Phases 1 and 2 completed the app-output protocol, Gmail draft outputs, Sheets contact-row outputs, and desktop `metadata.presentation` routing. Phase 3 should now implement the remaining workflow layer from the original plan: durable Gmail thread resources, visible CRM linkage between outputs that share a contact, and workflow affordances that move the operator from a contact row to the relevant Gmail conversation and back again. Keep `outputs` as the source of truth; do not introduce direct Gmail-to-Sheets mutation on send. The agent or operator should still update the Sheets row explicitly so the workflow remains observable and reversible.

**Tech Stack:** Gmail module (TanStack Start + MCP), Sheets module (TanStack Start), Electron desktop renderer, runtime `outputs` metadata, node:test / existing repo test runners

**Prerequisite:** Phase 2 is complete as described in `docs/plans/2026-04-02-crm-app-outputs-phase-2.md`.

---

### Task 1: Add Gmail thread resources and thread outputs

**Files:**
- Modify: `../../hola-boss-apps/gmail/src/server/actions.ts`
- Modify: `../../hola-boss-apps/gmail/src/server/app-outputs.ts`
- Modify: `../../hola-boss-apps/gmail/src/server/mcp.ts`
- Create: `../../hola-boss-apps/gmail/src/routes/threads.$threadId.tsx`
- Modify: `../../hola-boss-apps/gmail/test/app-outputs.test.ts`

**Step 1: Write the failing tests**

Add focused tests that prove:
- a Gmail thread output uses `output_type: "thread"`
- thread outputs publish `metadata.presentation.path` as `/threads/<threadId>`
- thread outputs can carry `metadata.crm.contact_key` and `metadata.crm.contact_row_ref`

Run:

```bash
cd ../../hola-boss-apps/gmail
npx tsx --test test/app-outputs.test.ts
```

Expected: FAIL because no thread-output helpers exist yet.

**Step 2: Add thread fetch server support**

In `../../hola-boss-apps/gmail/src/server/actions.ts`, add a `fetchThreadById` server function that:
- accepts `threadId`
- calls `getThread(threadId)`
- maps `thread.messages` through `parseMessage`
- returns a route-safe payload for the new thread detail page

Keep it read-only. Do not persist anything here.

**Step 3: Add a stable Gmail thread route**

Create `../../hola-boss-apps/gmail/src/routes/threads.$threadId.tsx` with:
- loader based on `fetchThreadById`
- read-only message list
- clear subject / participants / timestamps
- explicit relationship to the CRM follow-up workflow

The route should be reopen-safe from the desktop via `metadata.presentation.path`.

**Step 4: Add thread output helpers**

In `../../hola-boss-apps/gmail/src/server/app-outputs.ts`, add:
- `threadRoutePath(threadId)`
- `buildThreadOutputTitle(...)`
- `buildThreadOutputMetadata(...)`
- `syncThreadOutput(...)`

The metadata shape must match the protocol already used by draft outputs:

```ts
{
  source_kind: "application",
  presentation: {
    kind: "app_resource",
    view: "threads",
    path: `/threads/${encodeURIComponent(threadId)}`,
  },
  resource: {
    entity_type: "thread",
    entity_id: threadId,
    label: subjectOrFallback,
  },
  crm: {
    contact_key: normalizedEmail,
    contact_row_ref: contactRowRef ?? undefined,
  },
}
```

**Step 5: Publish thread outputs from Gmail MCP**

In `../../hola-boss-apps/gmail/src/server/mcp.ts`, extend the thread-reading flow so a durable thread output can be created.

Preferred shape:
- keep `gmail_get_thread` for pure reads if needed
- add a separate tool such as `gmail_open_thread` or extend `gmail_get_thread` with optional CRM context
- when CRM context is present, persist a `thread` output through `syncThreadOutput(...)`

Important constraint:
- do not make every thread read noisy by default if the tool is used for ad hoc search
- only persist when the caller is explicitly opening/syncing a CRM conversation

**Step 6: Run verification**

Run:

```bash
cd ../../hola-boss-apps/gmail
npx tsx --test test/app-outputs.test.ts
npm run build
```

Expected: PASS and BUILD SUCCESS.

**Step 7: Commit**

```bash
cd ../../hola-boss-apps/gmail
git add src/server/actions.ts src/server/app-outputs.ts src/server/mcp.ts src/routes/threads.\$threadId.tsx test/app-outputs.test.ts
git commit -m "feat(gmail): add durable thread outputs for crm reopen"
```

---

### Task 2: Surface CRM-linked outputs in the desktop drawer

**Files:**
- Modify: `desktop/src/components/layout/AppShell.tsx`
- Modify: `desktop/src/components/layout/OperationsDrawer.tsx`
- Modify: `desktop/src/types/electron.d.ts`
- Modify: `desktop/src/components/layout/OperationsDrawer.test.mjs`

**Step 1: Write the failing desktop tests**

Add tests that assert:
- outputs with the same `metadata.crm.contact_key` are grouped or visibly linked
- a Gmail output with `contact_row_ref` exposes a clear path back to the related CRM record
- internal outputs remain unchanged

Run:

```bash
cd desktop
node --test src/components/layout/OperationsDrawer.test.mjs
```

Expected: FAIL because CRM-linked rendering does not exist yet.

**Step 2: Enrich mapped output entries**

In `desktop/src/components/layout/AppShell.tsx`, extend `runtimeOutputToEntry(...)` so app outputs carry CRM metadata forward into the drawer model.

Add fields on `OperationsOutputEntry` for:
- `contactKey?: string | null`
- `contactRowRef?: string | null`
- `primaryEmail?: string | null`

Read them from `output.metadata.crm`.

**Step 3: Render CRM linkage in `OperationsDrawer`**

In `desktop/src/components/layout/OperationsDrawer.tsx`, update the outputs list so CRM-linked entries show:
- a small CRM badge/chip when `contactKey` exists
- a secondary label for related app surfaces, for example `Gmail`, `Sheets`
- a visible affordance like `Open related CRM record` when a matching Sheets output is present

Implementation rule:
- compute related outputs inside the drawer from the existing `outputs` prop
- match on normalized `contactKey`
- prefer linking to the most recent Sheets `contact_row` output when multiple matches exist

Do not add new runtime APIs for this. The point of this phase is to prove the metadata is already enough.

**Step 4: Keep the open behavior simple**

When the user clicks a related CRM affordance:
- call the existing `onOpenOutput(...)`
- open the selected related output rather than inventing a second navigation mechanism

**Step 5: Run verification**

Run:

```bash
cd desktop
node --test src/components/layout/OperationsDrawer.test.mjs
npm run typecheck
```

Expected: PASS and no new type errors.

**Step 6: Commit**

```bash
cd desktop
git add src/components/layout/AppShell.tsx src/components/layout/OperationsDrawer.tsx src/components/layout/OperationsDrawer.test.mjs src/types/electron.d.ts
git commit -m "feat(desktop): surface crm-linked related outputs"
```

---

### Task 3: Make the CRM follow-up workflow explicit in Gmail and Sheets surfaces

**Files:**
- Modify: `../../hola-boss-apps/gmail/src/routes/drafts.$draftId.tsx`
- Modify: `../../hola-boss-apps/gmail/src/routes/threads.$threadId.tsx`
- Modify: `../../hola-boss-apps/sheets/src/routes/contacts.$contactRef.tsx`
- Modify: `../../hola-boss-apps/sheets/src/server/demo-actions.ts`

**Step 1: Expand demo CRM fields**

Update `../../hola-boss-apps/sheets/src/server/demo-actions.ts` so the sample sheet is closer to the workflow described in the original plan.

Use headers like:

```ts
["Name", "Email", "Company", "Stage", "Owner", "Last Contacted At", "Next Action"]
```

Populate sample rows with meaningful follow-up state.

**Step 2: Promote CRM fields in the Sheets contact route**

In `../../hola-boss-apps/sheets/src/routes/contacts.$contactRef.tsx`, stop treating all non-name/email/company fields as undifferentiated leftovers.

Render first-class CRM fields near the top:
- `stage`
- `owner`
- `last_contacted_at`
- `next_action`

Keep the remaining fields below as secondary metadata.

**Step 3: Show CRM context inside Gmail routes**

In the Gmail draft and thread routes, add small workflow context blocks that make the CRM link obvious:
- recipient / contact email
- related thread id or draft id
- copy that tells the user this artifact belongs to a contact follow-up workflow

Do not fetch Sheets directly from the Gmail route in this phase. The CRM connection is conveyed through output metadata and desktop linkage, not cross-app HTTP coupling.

**Step 4: Run verification**

Run:

```bash
cd ../../hola-boss-apps/gmail
npm run build
cd ../sheets
npm run build
```

Expected: both module builds succeed.

**Step 5: Commit**

```bash
cd ../../hola-boss-apps
git add gmail/src/routes/drafts.\$draftId.tsx gmail/src/routes/threads.\$threadId.tsx sheets/src/routes/contacts.\$contactRef.tsx sheets/src/server/demo-actions.ts
git commit -m "feat: clarify crm follow-up workflow across gmail and sheets surfaces"
```

---

### Task 4: Verify the end-to-end contact-centric workflow

**Files:**
- Modify: `../../hola-boss-apps/gmail/test/e2e.test.ts`
- Modify: `../../hola-boss-apps/sheets/test/app-outputs.test.ts`
- Modify: `desktop/src/components/layout/OperationsDrawer.test.mjs`

**Step 1: Add Gmail thread-output tests**

Cover:
- thread output metadata shape
- CRM-linked thread output creation
- thread route path generation

**Step 2: Add desktop CRM-link tests**

Cover:
- draft output and contact-row output sharing the same `contact_key`
- the drawer choosing the related Sheets output
- opening the related output through existing handlers

**Step 3: Add a manual verification checklist**

Document the manual flow in the PR or plan notes:
1. Open a Sheets contact row.
2. Read or open the related Gmail thread.
3. Create a draft reply linked to the same contact.
4. Open both outputs from the desktop drawer.
5. Confirm the drawer shows the relationship and both reopen correctly.

**Step 4: Run verification**

Run:

```bash
cd ../../hola-boss-apps/gmail
npx tsx --test test/app-outputs.test.ts test/e2e.test.ts
cd ../sheets
npx tsx --test test/app-outputs.test.ts
cd ../../hola-boss-oss/desktop
node --test src/components/layout/OperationsDrawer.test.mjs
```

Expected: PASS for all targeted tests.

**Step 5: Commit**

```bash
git add ../../hola-boss-apps/gmail/test/e2e.test.ts ../../hola-boss-apps/sheets/test/app-outputs.test.ts desktop/src/components/layout/OperationsDrawer.test.mjs
git commit -m "test: cover crm thread outputs and related desktop navigation"
```

---

## Phase 3 Completion Checklist

- [ ] Gmail has a durable `thread` app-output type with `/threads/$threadId` reopen support
- [ ] Gmail thread outputs can carry `contact_key` and `contact_row_ref`
- [ ] Desktop output entries expose CRM metadata from `metadata.crm`
- [ ] The operations drawer shows related outputs for the same CRM contact
- [ ] Sheets contact detail emphasizes workflow fields like `stage` and `next_action`
- [ ] Gmail draft/thread surfaces clearly indicate CRM follow-up context
- [ ] The full contact-centric workflow can be reopened from outputs without relying on hidden cross-app mutations
- [ ] Targeted Gmail, Sheets, and desktop tests pass

## Notes

- This phase is the natural continuation of the original plan's remaining scope in [`2026-04-01-contact-centric-crm-app-outputs-plan.md`](./2026-04-01-contact-centric-crm-app-outputs-plan.md), especially Task 5 (`contact-centric CRM workflow`) and rollout item 5 (`Optional Gmail thread resource and richer CRM chrome`).
- Inference from the original plan: the CRM workflow should stay explicit. Gmail should not silently mutate Sheets on send; the agent or user should perform the CRM update as a visible step that produces its own `contact_row` output.
