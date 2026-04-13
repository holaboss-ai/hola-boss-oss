# CRM App Outputs Phase 2 — Sheets + Desktop Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the contact-centric CRM output protocol by wiring up the Sheets module as the CRM contact surface, making the desktop read `metadata.presentation` for app output routing, and mirroring the Bridge SDK to all modules.

**Architecture:** Phase 1 delivered Gmail draft outputs with `metadata.presentation` and CRM cross-references. Phase 2 completes the loop: Sheets publishes `contact_row` outputs that reopen into a dedicated contact detail route, the desktop reads `metadata.presentation` to route app outputs correctly (no more hardcoded `/posts/`), and the Bridge SDK is mirrored to all remaining modules. The iframe migration (separate plan: `2026-04-01-app-surface-iframe-migration.md`) is independent — this plan works with the current BrowserView architecture.

**Tech Stack:** TanStack Start (Sheets module), Electron desktop renderer (React 19), module-local Holaboss Bridge SDK, node:test

**Repos touched:**
- `holaOS/` — desktop output routing
- `hola-boss-apps/` — sheets module + bridge SDK mirror

---

### Task 1: Upgrade Sheets Bridge SDK with app output functions

**Files:**
- Modify: `../../hola-boss-apps/sheets/src/server/holaboss-bridge.ts`

Phase 1 added `createAppOutput`, `updateAppOutput`, and `buildAppResourcePresentation` to Gmail's bridge. Sheets still has the old proxy-only bridge. Copy the output functions over.

- [ ] **Step 1: Add output types and WORKSPACE_ID to Sheets bridge**

Replace the entire `../../hola-boss-apps/sheets/src/server/holaboss-bridge.ts` with the Gmail version. The file is module-local (no shared packages — copy-paste is the convention), so this is a direct copy of `../../hola-boss-apps/gmail/src/server/holaboss-bridge.ts`.

Verify the only differences from Gmail's version are:
- No changes needed — the bridge is provider-agnostic

- [ ] **Step 2: Run Sheets build to verify no breakage**

Run: `cd ../../hola-boss-apps/sheets && npm run build`
Expected: BUILD SUCCESS — existing `createIntegrationClient` callers are unchanged.

- [ ] **Step 3: Commit**

```bash
cd ../../hola-boss-apps/sheets
git add src/server/holaboss-bridge.ts
git commit -m "feat(sheets): upgrade bridge SDK with app output functions"
```

---

### Task 2: Create Sheets contact detail route

**Files:**
- Create: `../../hola-boss-apps/sheets/src/routes/contacts.$contactRef.tsx`
- Modify: `../../hola-boss-apps/sheets/src/server/actions.ts`

The `contactRef` is a URL-encoded composite key: `<spreadsheet_id>:<sheet_name>:<row_number>`. This route loads one CRM contact row and renders its details.

- [ ] **Step 1: Add server function to fetch a single contact row**

In `../../hola-boss-apps/sheets/src/server/actions.ts`, add a `fetchContactRow` server function:

```ts
import { createServerFn } from "@tanstack/react-start"
import { getSheetInfo, readRows } from "./google-api"

export const fetchStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { ready: true, message: "Google Sheets module is ready. Use the agent to query rows, update cells, and append data." }
})

export interface ContactRowData {
  spreadsheetId: string
  sheetName: string
  rowNumber: number
  sheetTitle: string
  values: Record<string, string>
}

export const fetchContactRow = createServerFn({ method: "GET" })
  .inputValidator((data: { contactRef: string }) => data)
  .handler(async ({ data }): Promise<ContactRowData> => {
    const parts = data.contactRef.split(":")
    if (parts.length < 3) {
      throw new Error(`Invalid contact reference: ${data.contactRef}`)
    }
    const spreadsheetId = parts[0]
    const sheetName = parts[1]
    const rowNumber = parseInt(parts[2], 10)
    if (Number.isNaN(rowNumber) || rowNumber < 1) {
      throw new Error(`Invalid row number in contact reference: ${data.contactRef}`)
    }

    const info = await getSheetInfo(spreadsheetId)
    const rows = await readRows(spreadsheetId, sheetName)
    const row = rows.find(r => r.rowNumber === rowNumber)
    if (!row) {
      throw new Error(`Row ${rowNumber} not found in ${sheetName}`)
    }

    return {
      spreadsheetId,
      sheetName,
      rowNumber,
      sheetTitle: info.title,
      values: row.values,
    }
  })
```

- [ ] **Step 2: Create the contact detail route**

Create `../../hola-boss-apps/sheets/src/routes/contacts.$contactRef.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router"
import { fetchContactRow } from "../server/actions"

export const Route = createFileRoute("/contacts/$contactRef")({
  head: () => ({
    meta: [{ title: "Holaboss — Contact Detail" }],
  }),
  loader: ({ params }) => fetchContactRow({ data: { contactRef: params.contactRef } }),
  component: ContactDetailPage,
})

function ContactDetailPage() {
  const contact = Route.useLoaderData()
  const name = contact.values.name || contact.values.fullname || contact.values.contact || "Unknown"
  const email = contact.values.email || contact.values.mail || ""
  const company = contact.values.company || contact.values.organization || ""

  const otherFields = Object.entries(contact.values).filter(
    ([key]) => !["name", "fullname", "contact", "email", "mail", "company", "organization"].includes(key.toLowerCase()),
  )

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-4">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-lg font-semibold uppercase">
            {name.charAt(0)}
          </div>
          <div>
            <h1 className="text-lg font-semibold">{name}</h1>
            {email && <p className="text-sm text-muted-foreground">{email}</p>}
            {company && <p className="text-sm text-muted-foreground">{company}</p>}
          </div>
        </div>

        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">Sheet</span>
            <span className="text-xs font-medium">{contact.sheetTitle}</span>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">Row</span>
            <span className="text-xs font-medium">{contact.rowNumber}</span>
          </div>
          {otherFields.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground capitalize">{key}</span>
              <span className="text-xs font-medium">{value}</span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          This contact is managed via Google Sheets. Use the agent to update CRM fields, draft follow-up emails, or track engagement.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run build to verify route is picked up**

Run: `cd ../../hola-boss-apps/sheets && npm run build`
Expected: BUILD SUCCESS with the new route in `routeTree.gen.ts`.

- [ ] **Step 4: Commit**

```bash
cd ../../hola-boss-apps/sheets
git add src/server/actions.ts src/routes/contacts.\$contactRef.tsx
git commit -m "feat(sheets): add contact detail route for CRM reopen"
```

---

### Task 3: Create Sheets app-outputs module

**Files:**
- Create: `../../hola-boss-apps/sheets/src/server/app-outputs.ts`

Follow the same pattern as Gmail's `app-outputs.ts`. This module builds output metadata for `contact_row` resources and syncs them through the Bridge SDK.

- [ ] **Step 1: Create the app-outputs module**

Create `../../hola-boss-apps/sheets/src/server/app-outputs.ts`:

```ts
import {
  buildAppResourcePresentation,
  createAppOutput,
  updateAppOutput,
} from "./holaboss-bridge"

export function contactRef(spreadsheetId: string, sheetName: string, rowNumber: number): string {
  return `${spreadsheetId}:${sheetName}:${rowNumber}`
}

export function contactRoutePath(ref: string): string {
  return `/contacts/${encodeURIComponent(ref)}`
}

export function buildContactRowOutputTitle(name: string, action: string): string {
  const trimmed = name.trim()
  return trimmed ? `${action}: ${trimmed}` : `${action}: contact row`
}

export function buildContactRowOutputMetadata(params: {
  ref: string
  name: string
  email?: string | null
  spreadsheetId: string
  sheetName: string
  rowNumber: number
}): Record<string, unknown> {
  return {
    source_kind: "application",
    presentation: buildAppResourcePresentation({
      view: "contacts",
      path: contactRoutePath(params.ref),
    }),
    resource: {
      entity_type: "contact_row",
      entity_id: params.ref,
      label: params.name.trim() || "Contact row",
    },
    crm: {
      contact_key: params.email ? params.email.trim().toLowerCase() : null,
      contact_row_ref: {
        spreadsheet_id: params.spreadsheetId,
        sheet_name: params.sheetName,
        row_number: params.rowNumber,
      },
    },
  }
}

export async function publishContactRowOutput(params: {
  ref: string
  name: string
  email?: string | null
  spreadsheetId: string
  sheetName: string
  rowNumber: number
  action: string
  existingOutputId?: string | null
}): Promise<string | null> {
  const title = buildContactRowOutputTitle(params.name, params.action)
  const metadata = buildContactRowOutputMetadata(params)

  if (params.existingOutputId) {
    await updateAppOutput(params.existingOutputId, {
      title,
      status: "updated",
      moduleResourceId: params.ref,
      metadata,
    })
    return params.existingOutputId
  }

  const output = await createAppOutput({
    outputType: "contact_row",
    title,
    moduleId: "sheets",
    moduleResourceId: params.ref,
    platform: "google",
    metadata,
  })

  return output?.id ?? null
}
```

- [ ] **Step 2: Run build**

Run: `cd ../../hola-boss-apps/sheets && npm run build`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
cd ../../hola-boss-apps/sheets
git add src/server/app-outputs.ts
git commit -m "feat(sheets): add app-outputs module for contact_row outputs"
```

---

### Task 4: Wire Sheets MCP tools to publish contact outputs

**Files:**
- Modify: `../../hola-boss-apps/sheets/src/server/mcp.ts`

Publish a `contact_row` output when the agent appends or updates a row in a sheet that looks like a contacts table (has an "email" column).

- [ ] **Step 1: Add output publishing to `sheets_append_row` and `sheets_update_cell`**

Modify `../../hola-boss-apps/sheets/src/server/mcp.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { createServer } from "node:http"
import { z } from "zod"

import { MODULE_CONFIG } from "../lib/types"
import { getSheetInfo, readRows, readRange, updateCell, appendRow } from "./google-api"
import { contactRef, publishContactRowOutput } from "./app-outputs"

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true }
}

function findEmailColumnIndex(headers: string[]): number {
  return headers.findIndex(h => {
    const lower = h.trim().toLowerCase()
    return lower === "email" || lower === "mail" || lower === "e-mail"
  })
}

function findNameColumnIndex(headers: string[]): number {
  return headers.findIndex(h => {
    const lower = h.trim().toLowerCase()
    return lower === "name" || lower === "fullname" || lower === "full name" || lower === "contact"
  })
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: `${MODULE_CONFIG.name} Module`,
    version: "1.0.0",
  })

  server.tool("sheets_get_info", "Get sheet title, headers, and row count", {
    sheet_id: z.string().describe("Google Sheets spreadsheet ID"),
  }, async ({ sheet_id }) => {
    try {
      const info = await getSheetInfo(sheet_id)
      return text(info)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  server.tool("sheets_read_rows", "Read all rows as objects (header-keyed). Optionally filter by column value.", {
    sheet_id: z.string().describe("Google Sheets spreadsheet ID"),
    range: z.string().optional().describe("Sheet range (default: Sheet1)"),
    filter_column: z.string().optional().describe("Column name to filter by"),
    filter_value: z.string().optional().describe("Value to match in filter_column"),
  }, async ({ sheet_id, range, filter_column, filter_value }) => {
    try {
      let rows = await readRows(sheet_id, range ?? "Sheet1")
      if (filter_column && filter_value) {
        const col = filter_column.trim().toLowerCase()
        const val = filter_value.trim().toLowerCase()
        rows = rows.filter(r => r.values[col]?.toLowerCase() === val)
      }
      return text(rows)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  server.tool("sheets_read_range", "Read raw cell values from a specific range", {
    sheet_id: z.string().describe("Google Sheets spreadsheet ID"),
    range: z.string().describe("Range in A1 notation (e.g. Sheet1!A1:C10)"),
  }, async ({ sheet_id, range }) => {
    try {
      const data = await readRange(sheet_id, range)
      return text(data)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  server.tool("sheets_update_cell", "Update a single cell value", {
    sheet_id: z.string().describe("Google Sheets spreadsheet ID"),
    range: z.string().describe("Cell in A1 notation (e.g. Sheet1!D5)"),
    value: z.string().describe("New cell value"),
    contact_name: z.string().optional().describe("Contact name if this is a CRM contact row update"),
    contact_email: z.string().optional().describe("Contact email if this is a CRM contact row update"),
  }, async ({ sheet_id, range, value, contact_name, contact_email }) => {
    try {
      await updateCell(sheet_id, range, value)
      const result: Record<string, unknown> = { updated: true, range, value }

      if (contact_name && contact_email) {
        const match = range.match(/^(.+?)!([A-Z]+)(\d+)$/)
        if (match) {
          const sheetName = match[1]
          const rowNumber = parseInt(match[3], 10)
          const ref = contactRef(sheet_id, sheetName, rowNumber)
          try {
            const outputId = await publishContactRowOutput({
              ref,
              name: contact_name,
              email: contact_email,
              spreadsheetId: sheet_id,
              sheetName,
              rowNumber,
              action: "Updated CRM contact",
            })
            if (outputId) result.output_id = outputId
          } catch {
            // non-fatal: output publishing should not block the tool
          }
        }
      }

      return text(result)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  server.tool("sheets_append_row", "Append a new row to a sheet", {
    sheet_id: z.string().describe("Google Sheets spreadsheet ID"),
    values: z.array(z.string()).describe("Array of cell values for the new row"),
    range: z.string().optional().describe("Sheet range (default: Sheet1)"),
  }, async ({ sheet_id, values, range }) => {
    try {
      const sheetName = range ?? "Sheet1"
      await appendRow(sheet_id, sheetName, values)
      const result: Record<string, unknown> = { appended: true, values }

      // Try to publish a contact output if this looks like a contacts sheet
      try {
        const info = await getSheetInfo(sheet_id)
        const headers = (info.headers ?? []).map((h: string) => h.trim().toLowerCase())
        const emailIdx = findEmailColumnIndex(headers)
        const nameIdx = findNameColumnIndex(headers)

        if (emailIdx >= 0 && emailIdx < values.length) {
          const email = values[emailIdx]
          const name = nameIdx >= 0 && nameIdx < values.length ? values[nameIdx] : ""
          const rows = await readRows(sheet_id, sheetName)
          const lastRow = rows[rows.length - 1]
          if (lastRow) {
            const ref = contactRef(sheet_id, sheetName, lastRow.rowNumber)
            const outputId = await publishContactRowOutput({
              ref,
              name: name || email,
              email,
              spreadsheetId: sheet_id,
              sheetName,
              rowNumber: lastRow.rowNumber,
              action: "Added CRM contact",
            })
            if (outputId) result.output_id = outputId
          }
        }
      } catch {
        // non-fatal
      }

      return text(result)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  })

  return server
}

export function startMcpServer(port: number) {
  const transports = new Map<string, SSEServerTransport>()

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`)

    if (url.pathname === "/mcp/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok" }))
      return
    }

    if (url.pathname === "/mcp/sse" && req.method === "GET") {
      const transport = new SSEServerTransport("/mcp/messages", res)
      transports.set(transport.sessionId, transport)
      const server = createMcpServer()
      await server.connect(transport)
      return
    }

    if (url.pathname === "/mcp/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId")
      const transport = sessionId ? transports.get(sessionId) : undefined
      if (!transport) {
        res.writeHead(400)
        res.end("Unknown session")
        return
      }
      await transport.handlePostMessage(req, res)
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  httpServer.listen(port, () => {
    console.log(`[mcp] server listening on port ${port}`)
  })

  return httpServer
}
```

- [ ] **Step 2: Run build**

Run: `cd ../../hola-boss-apps/sheets && npm run build`
Expected: BUILD SUCCESS

- [ ] **Step 3: Commit**

```bash
cd ../../hola-boss-apps/sheets
git add src/server/mcp.ts
git commit -m "feat(sheets): publish contact_row outputs from MCP tools"
```

---

### Task 5: Desktop reads `metadata.presentation` for app output routing

**Files:**
- Modify: `desktop/src/components/layout/AppShell.tsx`

The `runtimeOutputToEntry` function (line 296) currently uses `output.output_type` as the view and `output.module_resource_id` as the resourceId. It should prefer `metadata.presentation.path` and `metadata.presentation.view` when present.

- [ ] **Step 1: Write a failing test**

Create `desktop/src/components/layout/appShellOutputRouting.test.mjs`:

```js
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const APP_SHELL_PATH = new URL("./AppShell.tsx", import.meta.url)

test("runtimeOutputToEntry reads metadata.presentation for app output routing", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8")

  assert.match(
    source,
    /metadata.*presentation/s,
    "expected runtimeOutputToEntry to read metadata.presentation for app output view/path routing",
  )
})

test("runtimeOutputToEntry does not hardcode output_type as the sole view source for app outputs", async () => {
  const source = await readFile(APP_SHELL_PATH, "utf8")

  // The function should still reference output_type as a fallback, but must also
  // reference metadata/presentation so it is not the only view source
  assert.match(
    source,
    /presentation.*view|view.*presentation/s,
    "expected presentation.view to be consulted for app output renderer view",
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test desktop/src/components/layout/appShellOutputRouting.test.mjs`
Expected: FAIL — `metadata` is not referenced in `runtimeOutputToEntry`.

- [ ] **Step 3: Modify `runtimeOutputToEntry` to read `metadata.presentation`**

In `desktop/src/components/layout/AppShell.tsx`, replace the `runtimeOutputToEntry` function (lines 296–333):

```ts
function runtimeOutputToEntry(
  output: WorkspaceOutputRecordPayload,
  installedAppIds: Set<string>,
): OperationsOutputEntry {
  const moduleId = (output.module_id || "").trim().toLowerCase();
  const title =
    output.title.trim() || output.output_type.trim() || "Workspace output";
  const detailParts = [
    output.status ? `Status: ${output.status}` : "",
    output.file_path ? `File: ${output.file_path}` : "",
    output.platform ? `Platform: ${output.platform}` : "",
  ].filter(Boolean);

  // Read presentation protocol from metadata when available
  const metadata = (output.metadata ?? {}) as Record<string, unknown>;
  const presentation = metadata.presentation as
    | { kind?: string; view?: string; path?: string }
    | undefined;
  const hasAppPresentation =
    presentation?.kind === "app_resource" && presentation.view;

  const presentationView = hasAppPresentation
    ? presentation!.view!
    : output.output_type || "home";
  const presentationResourceId = hasAppPresentation && presentation!.path
    ? presentation!.path
    : output.module_resource_id || output.artifact_id || output.id;

  return {
    id: `runtime-output:${output.id}`,
    title,
    detail:
      detailParts.join(" | ") || "Runtime output generated for this workspace.",
    createdAt: output.created_at,
    tone: runtimeOutputTone(output.status),
    sessionId: output.session_id,
    renderer:
      moduleId && installedAppIds.has(moduleId)
        ? {
            type: "app",
            appId: moduleId,
            resourceId: presentationResourceId,
            view: presentationView,
          }
        : {
            type: "internal",
            surface: inferInternalSurfaceFromOutputType(output.output_type),
            resourceId: output.file_path || output.artifact_id || output.id,
            htmlContent: output.html_content,
          },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test desktop/src/components/layout/appShellOutputRouting.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd desktop
git add src/components/layout/AppShell.tsx src/components/layout/appShellOutputRouting.test.mjs
git commit -m "feat(desktop): read metadata.presentation for app output routing"
```

---

### Task 6: Desktop `AppSurfacePane` uses `resolveAppSurfacePath`

**Files:**
- Modify: `desktop/src/components/panes/AppSurfacePane.tsx`

The `useEffect` at line 61 hardcodes `const urlPath = resourceId ? \`/posts/${resourceId}\` : "/"`. Replace this with `resolveAppSurfacePath` which already handles view-based routing correctly.

- [ ] **Step 1: Import and use `resolveAppSurfacePath`**

In `desktop/src/components/panes/AppSurfacePane.tsx`, add the import and replace the URL construction:

Add at top:
```ts
import { resolveAppSurfacePath } from "./appSurfaceRoute";
```

Replace the `useEffect` (lines 61–68):
```ts
  useEffect(() => {
    if (!ready || !selectedWorkspaceId) return;
    const urlPath = resolveAppSurfacePath({ view, resourceId });
    void window.electronAPI.appSurface.navigate(selectedWorkspaceId, appId, urlPath);
    return () => {
      void window.electronAPI.appSurface.destroy(appId);
    };
  }, [appId, ready, selectedWorkspaceId, resourceId, view]);
```

Note: `view` is added to the dependency array since it now affects the URL.

- [ ] **Step 2: Run existing route tests**

Run: `node --test desktop/src/components/panes/appSurfaceRoute.test.mjs`
Expected: PASS — the helper is already tested and working.

- [ ] **Step 3: Run desktop typecheck**

Run: `npm --prefix desktop run typecheck`
Expected: no new errors from the import.

- [ ] **Step 4: Commit**

```bash
cd desktop
git add src/components/panes/AppSurfacePane.tsx
git commit -m "feat(desktop): use resolveAppSurfacePath for app surface navigation"
```

---

### Task 7: Sheets tests

**Files:**
- Modify: `../../hola-boss-apps/sheets/test/e2e.test.ts`

Add tests for the new app-outputs module and contact route server function.

- [ ] **Step 1: Add app-outputs unit tests**

Append to `../../hola-boss-apps/sheets/test/e2e.test.ts` (or create a new `test/app-outputs.test.ts`):

```ts
import test from "node:test"
import assert from "node:assert/strict"
import {
  contactRef,
  contactRoutePath,
  buildContactRowOutputTitle,
  buildContactRowOutputMetadata,
} from "../src/server/app-outputs"

test("contactRef builds composite key", () => {
  assert.equal(contactRef("sheet-1", "Sheet1", 7), "sheet-1:Sheet1:7")
})

test("contactRoutePath encodes the ref", () => {
  assert.equal(contactRoutePath("sheet-1:Sheet1:7"), "/contacts/sheet-1%3ASheet1%3A7")
})

test("buildContactRowOutputTitle includes name and action", () => {
  assert.equal(buildContactRowOutputTitle("Alice Chen", "Updated CRM contact"), "Updated CRM contact: Alice Chen")
})

test("buildContactRowOutputTitle falls back when name is empty", () => {
  assert.equal(buildContactRowOutputTitle("", "Added CRM contact"), "Added CRM contact: contact row")
})

test("buildContactRowOutputMetadata produces the full protocol shape", () => {
  const meta = buildContactRowOutputMetadata({
    ref: "sheet-1:Sheet1:7",
    name: "Alice Chen",
    email: "alice@example.com",
    spreadsheetId: "sheet-1",
    sheetName: "Sheet1",
    rowNumber: 7,
  })

  assert.equal(meta.source_kind, "application")
  const pres = meta.presentation as { kind: string; view: string; path: string }
  assert.equal(pres.kind, "app_resource")
  assert.equal(pres.view, "contacts")
  assert.equal(pres.path, "/contacts/sheet-1%3ASheet1%3A7")

  const resource = meta.resource as { entity_type: string; entity_id: string; label: string }
  assert.equal(resource.entity_type, "contact_row")
  assert.equal(resource.entity_id, "sheet-1:Sheet1:7")
  assert.equal(resource.label, "Alice Chen")

  const crm = meta.crm as { contact_key: string; contact_row_ref: { spreadsheet_id: string; sheet_name: string; row_number: number } }
  assert.equal(crm.contact_key, "alice@example.com")
  assert.equal(crm.contact_row_ref.spreadsheet_id, "sheet-1")
  assert.equal(crm.contact_row_ref.sheet_name, "Sheet1")
  assert.equal(crm.contact_row_ref.row_number, 7)
})

test("buildContactRowOutputMetadata handles null email", () => {
  const meta = buildContactRowOutputMetadata({
    ref: "sheet-1:Sheet1:3",
    name: "Bob",
    email: null,
    spreadsheetId: "sheet-1",
    sheetName: "Sheet1",
    rowNumber: 3,
  })
  const crm = meta.crm as { contact_key: null }
  assert.equal(crm.contact_key, null)
})
```

- [ ] **Step 2: Run the tests**

Run: `cd ../../hola-boss-apps/sheets && npx tsx --test test/app-outputs.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 3: Commit**

```bash
cd ../../hola-boss-apps/sheets
git add test/app-outputs.test.ts
git commit -m "test(sheets): add app-outputs unit tests for contact_row protocol"
```

---

### Task 8: Mirror Bridge SDK to remaining modules

**Files:**
- Modify: `../../hola-boss-apps/twitter/src/server/holaboss-bridge.ts`
- Modify: `../../hola-boss-apps/linkedin/src/server/holaboss-bridge.ts`
- Modify: `../../hola-boss-apps/reddit/src/server/holaboss-bridge.ts`
- Modify: `../../hola-boss-apps/_template/src/server/holaboss-bridge.ts`

Each module has the old proxy-only bridge. Replace each with the full version (identical to `gmail/src/server/holaboss-bridge.ts`). These modules don't need to call `createAppOutput` yet — the SDK is just available for future use.

- [ ] **Step 1: Copy Gmail's bridge to all four modules**

For each of `twitter`, `linkedin`, `reddit`, `_template`:
```bash
cp ../../hola-boss-apps/gmail/src/server/holaboss-bridge.ts ../../hola-boss-apps/twitter/src/server/holaboss-bridge.ts
cp ../../hola-boss-apps/gmail/src/server/holaboss-bridge.ts ../../hola-boss-apps/linkedin/src/server/holaboss-bridge.ts
cp ../../hola-boss-apps/gmail/src/server/holaboss-bridge.ts ../../hola-boss-apps/reddit/src/server/holaboss-bridge.ts
cp ../../hola-boss-apps/gmail/src/server/holaboss-bridge.ts ../../hola-boss-apps/_template/src/server/holaboss-bridge.ts
```

- [ ] **Step 2: Build each module to verify no breakage**

```bash
cd ../../hola-boss-apps/twitter && npm run build
cd ../../hola-boss-apps/linkedin && npm run build
cd ../../hola-boss-apps/reddit && npm run build
```

Expected: BUILD SUCCESS for each — existing `createIntegrationClient` callers are unchanged.

- [ ] **Step 3: Commit**

```bash
cd ../../hola-boss-apps
git add twitter/src/server/holaboss-bridge.ts linkedin/src/server/holaboss-bridge.ts reddit/src/server/holaboss-bridge.ts _template/src/server/holaboss-bridge.ts
git commit -m "feat: mirror bridge SDK with app output functions to all modules"
```

---

## Phase 2 Completion Checklist

After all tasks:

- [ ] Sheets bridge has `createAppOutput`, `updateAppOutput`, `buildAppResourcePresentation`
- [ ] `/contacts/$contactRef` route loads and renders a single CRM row
- [ ] `sheets_append_row` publishes a `contact_row` output when the sheet has an email column
- [ ] `sheets_update_cell` publishes a `contact_row` output when contact metadata is provided
- [ ] Desktop `runtimeOutputToEntry` reads `metadata.presentation.view` and `metadata.presentation.path`
- [ ] Desktop `AppSurfacePane` uses `resolveAppSurfacePath` instead of hardcoded `/posts/`
- [ ] Gmail draft outputs route to `/drafts/<id>` (not `/posts/<id>`) in the desktop
- [ ] Sheets contact outputs route to `/contacts/<ref>` in the desktop
- [ ] All module bridges upgraded (twitter, linkedin, reddit, _template)
- [ ] Sheets app-output unit tests pass
- [ ] Desktop output routing test passes
