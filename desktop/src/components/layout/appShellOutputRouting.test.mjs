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
