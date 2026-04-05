# Inbox UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the OperationsDrawer Inbox and Running panels for density, scannability, and consistent shadcn component usage.

**Architecture:** Single-file refactor of `OperationsDrawer.tsx`. Replace custom styled elements with shadcn `Badge`, `Button`, `Card`, `Tooltip`. Add a `relativeTime` helper. Restructure the Inbox header to collapse toolbar + status banner into the tab bar row, and redesign proposal cards for inline actions.

**Tech Stack:** React, TypeScript, shadcn/ui (Badge, Button, Card, Tooltip), Tailwind CSS, lucide-react icons

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `desktop/src/components/layout/OperationsDrawer.tsx` | Modify | All UI changes |

No new files. No test files (pure presentational component with no testable logic beyond `relativeTime`, which is trivial).

---

### Task 1: Add relativeTime helper and update imports

**Files:**
- Modify: `desktop/src/components/layout/OperationsDrawer.tsx`

- [ ] **Step 1: Add new imports and relativeTime helper**

At the top of the file, update imports to include all shadcn components and new icons:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Clock,
  FolderOpen,
  Inbox as InboxIcon,
  Loader2,
  LogIn,
  RefreshCcw,
  Sparkles,
  X,
  Bell,
  Clock3,
} from "lucide-react";
import { useDesktopAuthSession } from "@/lib/auth/authClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
```

Then replace the existing `formatTimestamp` function (at the bottom of the file) with:

```tsx
function relativeTime(value: string): string {
  const ms = Date.now() - Date.parse(value);
  if (Number.isNaN(ms)) {
    return value;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run desktop:typecheck`
Expected: No errors (unused import warnings are acceptable at this stage since we haven't used Badge/Card yet).

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/layout/OperationsDrawer.tsx
git commit -m "refactor: add relativeTime helper and update imports for inbox redesign"
```

---

### Task 2: Redesign Inbox header

**Files:**
- Modify: `desktop/src/components/layout/OperationsDrawer.tsx`

- [ ] **Step 1: Replace the OperationsDrawer header and InboxPanel toolbar**

Replace the `<header>` element inside the `OperationsDrawer` component (the one containing `DrawerTabButton` components) with:

```tsx
<header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
  <div className="flex items-center gap-1.5">
    <DrawerTabButton
      active={activeTab === "inbox"}
      icon={<Bell size={14} />}
      label="Inbox"
      onClick={() => onTabChange("inbox")}
    />
    <DrawerTabButton
      active={activeTab === "running"}
      icon={<Clock3 size={14} />}
      label="Running"
      onClick={() => onTabChange("running")}
    />
  </div>
  {activeTab === "inbox" ? (
    <InboxHeaderActions
      isSignedIn={isSignedIn}
      isAuthPending={isAuthPending}
      hasWorkspace={hasWorkspace}
      proactiveTaskProposalsEnabled={proactiveTaskProposalsEnabled}
      isUpdatingProactiveTaskProposalsEnabled={isUpdatingProactiveTaskProposalsEnabled}
      isTriggeringProposal={isTriggeringProposal}
      isLoadingProposals={isLoadingProposals}
      onRequestSignIn={onRequestSignIn}
      onTriggerProposal={onTriggerProposal}
      onProactiveTaskProposalsEnabledChange={onProactiveTaskProposalsEnabledChange}
      onRefreshProposals={onRefreshProposals}
    />
  ) : null}
</header>
```

This requires lifting auth state out of InboxPanel into OperationsDrawer. Add these lines inside the `OperationsDrawer` component body, before the `return`:

```tsx
const { data: authSession, isPending: isAuthPending, requestAuth } =
  useDesktopAuthSession();
const isSignedIn = Boolean(authSession?.user?.id);
const onRequestSignIn = () => {
  void requestAuth();
};
```

Pass `isSignedIn`, `isAuthPending`, and `onRequestSignIn` down to `InboxPanel` as props (they're still needed for the content area sign-in prompt).

- [ ] **Step 2: Create InboxHeaderActions component**

Add this new component below `DrawerTabButton`:

```tsx
function InboxHeaderActions({
  isSignedIn,
  isAuthPending,
  hasWorkspace,
  proactiveTaskProposalsEnabled,
  isUpdatingProactiveTaskProposalsEnabled,
  isTriggeringProposal,
  isLoadingProposals,
  onRequestSignIn,
  onTriggerProposal,
  onProactiveTaskProposalsEnabledChange,
  onRefreshProposals,
}: {
  isSignedIn: boolean;
  isAuthPending: boolean;
  hasWorkspace: boolean;
  proactiveTaskProposalsEnabled: boolean;
  isUpdatingProactiveTaskProposalsEnabled: boolean;
  isTriggeringProposal: boolean;
  isLoadingProposals: boolean;
  onRequestSignIn: () => void;
  onTriggerProposal: () => void;
  onProactiveTaskProposalsEnabledChange: (enabled: boolean) => void;
  onRefreshProposals: () => void;
}) {
  if (!isSignedIn) {
    return (
      <Button
        type="button"
        size="sm"
        onClick={onRequestSignIn}
        disabled={isAuthPending}
      >
        {isAuthPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <LogIn size={12} />
        )}
        <span>Sign in</span>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant="outline"
        className={`cursor-pointer select-none gap-1.5 transition-colors ${
          isUpdatingProactiveTaskProposalsEnabled
            ? "cursor-wait opacity-75"
            : "hover:bg-muted"
        }`}
        onClick={() =>
          !isUpdatingProactiveTaskProposalsEnabled &&
          onProactiveTaskProposalsEnabledChange(!proactiveTaskProposalsEnabled)
        }
      >
        {isUpdatingProactiveTaskProposalsEnabled ? (
          <Loader2 size={8} className="animate-spin" />
        ) : (
          <span
            className={`inline-block size-1.5 rounded-full ${
              proactiveTaskProposalsEnabled ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
        )}
        <span>{proactiveTaskProposalsEnabled ? "Enabled" : "Paused"}</span>
      </Badge>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Trigger proposal"
              onClick={onTriggerProposal}
              disabled={!hasWorkspace || isTriggeringProposal}
            />
          }
        >
          {isTriggeringProposal ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">Trigger proposal</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Refresh proposals"
              onClick={onRefreshProposals}
              disabled={!hasWorkspace || isLoadingProposals}
            />
          }
        >
          {isLoadingProposals ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCcw size={12} />
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">Refresh</TooltipContent>
      </Tooltip>
    </div>
  );
}
```

- [ ] **Step 3: Remove the toolbar section from InboxPanel**

In the `InboxPanel` component, remove the entire `<div className="shrink-0 border-b ...">` block (the toolbar area with Trigger, Enabled/Paused, Refresh buttons and the status banners). Keep only the error display — move it to a simple line right above the scrollable content area:

```tsx
return (
  <div className="flex h-full min-h-0 flex-col">
    {proactiveTaskProposalsError ? (
      <div className="shrink-0 border-b border-destructive/20 px-3 py-2 text-xs text-destructive">
        {proactiveTaskProposalsError}
      </div>
    ) : null}

    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {/* existing content area stays here */}
    </div>
  </div>
);
```

Remove the `useDesktopAuthSession` hook call and related state from `InboxPanel` (it's now in `OperationsDrawer`). Add `isSignedIn` and `onRequestSignIn` to `InboxPanel`'s props interface instead.

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run desktop:typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/layout/OperationsDrawer.tsx
git commit -m "refactor: collapse inbox header into compact tab bar with badge and icon buttons"
```

---

### Task 3: Redesign proposal cards

**Files:**
- Modify: `desktop/src/components/layout/OperationsDrawer.tsx`

- [ ] **Step 1: Replace proposal card markup**

In the `InboxPanel` component, replace the `proposals.map(...)` block with:

```tsx
<div className="grid gap-2">
  {proposals.map((proposal) => {
    const isActing =
      proposalAction?.proposalId === proposal.proposal_id;
    return (
      <Card
        key={proposal.proposal_id}
        size="sm"
        className="gap-2 py-3 ring-border/40"
      >
        <div className="flex items-start justify-between gap-2 px-3">
          <div className="min-w-0 flex-1 text-sm font-medium text-foreground">
            {proposal.task_name}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Accept proposal"
                    onClick={() => onAcceptProposal(proposal)}
                    disabled={isActing}
                    className="text-muted-foreground hover:text-primary"
                  />
                }
              >
                {isActing && proposalAction?.action === "accept" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} />
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">Accept</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Dismiss proposal"
                    onClick={() => onDismissProposal(proposal)}
                    disabled={isActing}
                    className="text-muted-foreground hover:text-foreground"
                  />
                }
              >
                {isActing && proposalAction?.action === "dismiss" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <X size={12} />
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">Dismiss</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="line-clamp-2 px-3 text-sm leading-relaxed text-muted-foreground">
          {proposal.task_prompt}
        </div>
        <div className="px-3 text-xs text-muted-foreground/70">
          {relativeTime(proposal.created_at)}
        </div>
      </Card>
    );
  })}
</div>
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run desktop:typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/components/layout/OperationsDrawer.tsx
git commit -m "refactor: redesign proposal cards with inline actions and line-clamped prompt"
```

---

### Task 4: Redesign empty states

**Files:**
- Modify: `desktop/src/components/layout/OperationsDrawer.tsx`

- [ ] **Step 1: Replace EmptyNotice and update Inbox content area empty states**

Replace the `EmptyNotice` component with:

```tsx
function EmptyNotice({
  icon,
  message,
}: {
  icon: ReactNode;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
      {icon}
      <span className="text-sm">{message}</span>
    </div>
  );
}
```

Update the content area in `InboxPanel` to use icons:

```tsx
{!isSignedIn ? (
  <SignedOutInboxNotice onRequestSignIn={onRequestSignIn} />
) : !hasWorkspace ? (
  <EmptyNotice
    icon={<FolderOpen size={24} strokeWidth={1.5} />}
    message="Select a workspace to review proposals."
  />
) : proposals.length === 0 ? (
  <EmptyNotice
    icon={
      isLoadingProposals ? (
        <Loader2 size={24} strokeWidth={1.5} className="animate-spin" />
      ) : (
        <InboxIcon size={24} strokeWidth={1.5} />
      )
    }
    message={
      isLoadingProposals ? "Loading proposals..." : "No proposals yet."
    }
  />
) : (
  /* proposal cards */
)}
```

- [ ] **Step 2: Update CenteredNotice for Running tab**

Replace the `CenteredNotice` component with:

```tsx
function CenteredNotice({
  icon,
  message,
}: {
  icon: ReactNode;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
      {icon}
      <span className="text-sm">{message}</span>
    </div>
  );
}
```

Since this is identical to `EmptyNotice`, merge them into one component. Remove `CenteredNotice` and use `EmptyNotice` everywhere. Update the Running panel calls:

```tsx
{!hasWorkspace ? (
  <EmptyNotice
    icon={<FolderOpen size={24} strokeWidth={1.5} />}
    message="Choose a workspace to inspect sessions."
  />
) : errorMessage ? (
  <EmptyNotice
    icon={<X size={24} strokeWidth={1.5} className="text-destructive" />}
    message={errorMessage}
  />
) : isLoading && sessions.length === 0 ? (
  <EmptyNotice
    icon={<Loader2 size={24} strokeWidth={1.5} className="animate-spin" />}
    message="Loading sessions..."
  />
) : sessions.length === 0 ? (
  <EmptyNotice
    icon={<Clock size={24} strokeWidth={1.5} />}
    message="No background sessions."
  />
) : (
  /* session list */
)}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run desktop:typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/layout/OperationsDrawer.tsx
git commit -m "refactor: redesign empty states with centered icon and message"
```

---

### Task 5: Redesign Running tab

**Files:**
- Modify: `desktop/src/components/layout/OperationsDrawer.tsx`

- [ ] **Step 1: Remove Running tab sub-header and redesign session rows**

In the `RunningPanel` component, remove the sub-header `<div className="shrink-0 border-b ...">` block entirely.

Replace the sessions list markup with compact rows:

```tsx
<div className="flex h-full min-h-0 flex-col">
  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
    {/* empty states from Task 4 */}

    {sessions.length > 0 ? (
      <div className="divide-y divide-border/30">
        {sessions.map((session) => (
          <button
            key={session.sessionId}
            type="button"
            onClick={() => onOpenSession(session.sessionId)}
            aria-label={`Open session ${session.title}`}
            className={`w-full px-3 py-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/50 ${
              activeSessionId === session.sessionId
                ? "border-l-2 border-l-primary bg-muted/30"
                : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {session.title}
              </div>
              <Badge
                variant={runningStatusBadgeVariant(session.status)}
                className="shrink-0 text-[10px] uppercase"
              >
                {session.status}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground/70">
              {relativeTime(session.updatedAt)}
            </div>
            {session.lastError ? (
              <div className="mt-1.5 truncate text-xs text-destructive">
                {session.lastError}
              </div>
            ) : null}
          </button>
        ))}
      </div>
    ) : null}
  </div>
</div>
```

- [ ] **Step 2: Add runningStatusBadgeVariant helper**

Replace the existing `runningStatusClasses` function with:

```tsx
function runningStatusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "BUSY":
    case "QUEUED":
      return "default";
    case "WAITING_USER":
      return "secondary";
    case "ERROR":
      return "destructive";
    default:
      return "outline";
  }
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run desktop:typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/layout/OperationsDrawer.tsx
git commit -m "refactor: redesign running tab as compact list with badge status"
```

---

### Task 6: Clean up dead code

**Files:**
- Modify: `desktop/src/components/layout/OperationsDrawer.tsx`

- [ ] **Step 1: Remove unused functions and old components**

Delete the following if still present:
- `formatTimestamp` function (replaced by `relativeTime`)
- `runningStatusClasses` function (replaced by `runningStatusBadgeVariant`)
- `CenteredNotice` component (merged into `EmptyNotice`)
- Old `EmptyNotice` component (replaced in Task 4)
- Any unused imports

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run desktop:typecheck`
Expected: No errors.

- [ ] **Step 3: Verify no unused imports**

Search the file for any imported names that are no longer referenced in the component code.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/layout/OperationsDrawer.tsx
git commit -m "chore: remove dead code from inbox redesign"
```
