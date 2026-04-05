# Inbox UI Redesign

## Context

The OperationsDrawer is a narrow (360-420px), collapsible side panel with two tabs: **Inbox** (primary) and **Running** (secondary). Inbox is where users review and act on proactive task proposals. The current UI is vertically wasteful, visually noisy, and underuses available shadcn components.

## Goals

- Maximize visible proposals by reducing header/chrome overhead
- Make proposal cards scannable with inline actions
- Use shadcn `Badge`, `Button`, `Card` consistently
- Clean up Running tab as a compact list

## File

All changes in `desktop/src/components/layout/OperationsDrawer.tsx`.

## Design

### Inbox Header

Collapse the current 3-row header (tab bar + toolbar + status banner) into a single compact header.

**Tab bar row (unchanged):** Inbox and Running pill buttons, left-aligned.

**Action buttons:** Trigger (Sparkles icon) and Refresh (RefreshCcw icon) as `size="icon-sm"` `variant="ghost"` Buttons, right-aligned in the same header row as the tabs.

**Status indicator:** A small clickable `Badge` between tabs and action buttons:
- Enabled state: `variant="outline"` with a green dot and "Enabled" text
- Paused state: `variant="outline"` with an amber dot and "Paused" text
- Clicking toggles the preference (same as current toggle)

**Status banner removed.** The badge communicates the state. Errors display as a small destructive-colored line below the header only when present.

**Signed-out state:** Trigger and Refresh buttons hidden. The content area shows the sign-in prompt.

Saves ~60-80px vertical space.

### Proposal Cards

Each proposal renders as a `Card` with minimal border, no heavy shadow.

**Layout per card:**
- **Row 1:** Task name (bold, `text-sm`, left) + Accept/Dismiss icon buttons (right, same row)
  - Accept: `Button size="icon-sm" variant="ghost"` with Check icon, primary color on hover
  - Dismiss: `Button size="icon-sm" variant="ghost"` with X icon, muted color
- **Row 2:** Prompt text, `text-sm text-muted-foreground`, capped at 2 lines via `line-clamp-2`, no expand
- **Row 3:** Relative timestamp ("2 min ago"), `text-xs text-muted-foreground`

**Removed:** State badge (redundant since only unreviewed proposals are shown), separate action button row.

**Relative timestamps:** Replace `toLocaleString()` with relative time ("just now", "2m ago", "1h ago", "yesterday"). Implement as a simple `relativeTime(dateString)` helper in the same file.

### Running Tab

**Sub-header removed.** The tab label already says "Running".

**Sessions as compact rows** separated by subtle borders, not individual cards:
- **Row 1:** Session title (truncated, left) + status Badge (right)
  - Badge variants by status: BUSY/QUEUED = primary, WAITING_USER = secondary, ERROR = destructive, IDLE = outline
- **Row 2:** Relative timestamp, `text-xs text-muted-foreground`
- **Error line:** If present, single truncated line in destructive color below timestamp. No nested bordered box.
- **Active session:** Left border accent (`border-l-2 border-primary`) instead of full border highlight.

### Empty States

Both tabs use centered icon + message, no border or background:
- Inbox: `Inbox` icon (24px, muted) + "No proposals yet."
- Inbox loading: `Loader2` icon (animated) + "Loading proposals..."
- Running empty: `Clock` icon + "No background sessions."
- No workspace: `FolderOpen` icon + contextual message

### Components Used

| Component | Usage |
|-----------|-------|
| `Button` | Tab buttons, Trigger, Refresh, Accept, Dismiss, Sign-in |
| `Badge` | Enabled/Paused toggle, session status |
| `Card` | Proposal cards |
| `Tooltip` | Icon-only buttons (Trigger, Refresh, Accept, Dismiss) |

### Not Changing

- Tab switching logic and state management in AppShell.tsx
- IPC calls and data flow (proposals, sessions)
- Sign-in flow
- Drawer container dimensions and open/close behavior
