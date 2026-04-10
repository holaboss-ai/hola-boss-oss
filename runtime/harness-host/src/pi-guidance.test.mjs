import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = path.resolve(
  "/Users/jeffrey/Desktop/holaboss/hola-boss-oss-feat-more-tools/runtime/harness-host/src/pi.ts",
);

test("pi todo guidance requires continuing todo execution until blocked or complete", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(
    source,
    /After reading an existing todo, continue executing it until the recorded work is complete or genuinely blocked\./,
  );
  assert.match(
    source,
    /When you choose to use a todo, keep executing it until the recorded work is complete or genuinely blocked\./,
  );
  assert.match(
    source,
    /Do not stop only to give progress updates or ask whether to continue while executable todo items remain\./,
  );
  assert.match(
    source,
    /After restoring the plan, continue executing it until the recorded work is complete or genuinely blocked\./,
  );
  assert.match(
    source,
    /If the user's newest message clearly redirects to unrelated work, handle that new request first after restoring the todo, keep the restored todo marked unfinished, and then propose continuing it once the unrelated request is complete\./,
  );
  assert.match(
    source,
    /If the user's newest message is clearly unrelated to the unfinished todo, preserve that todo as unfinished, handle the new request first, and then propose continuing the unfinished work\./,
  );
  assert.match(
    source,
    /If a new user message clearly redirects to unrelated work, do that work first without marking the existing unfinished todo complete, then propose resuming the unfinished work afterward\./,
  );
});
