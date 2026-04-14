import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CREDITS_PILL_PATH = new URL("./CreditsPill.tsx", import.meta.url);

test("credits pill uses the shared compact top bar control height", async () => {
  const source = await readFile(CREDITS_PILL_PATH, "utf8");

  assert.match(source, /size="default"/);
  assert.match(source, /className=\{`inline-flex shrink-0 items-center rounded-lg border px-2\.5 text-xs transition \$\{/);
  assert.doesNotMatch(source, /h-9/);
});
