import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const LEFT_RAIL_PATH = new URL("./LeftNavigationRail.tsx", import.meta.url);

test("left navigation rail renders a centered version label at the bottom", async () => {
  const source = await readFile(LEFT_RAIL_PATH, "utf8");

  assert.match(source, /appVersionLabel\?: string;/);
  assert.match(source, /appVersionLabel = ""/);
  assert.match(source, /<div className="mt-2 flex w-full justify-center pt-1">/);
  assert.match(
    source,
    /pointer-events-none select-none text-center text-\[10px\] font-medium tracking-\[0\.16em\] text-muted-foreground\/28/,
  );
  assert.match(source, /v\{appVersionLabel\}/);
});
