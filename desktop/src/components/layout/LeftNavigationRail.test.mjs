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
    /pointer-events-none w-full select-none overflow-hidden px-0\.5 text-center text-\[8px\] leading-none font-medium tabular-nums tracking-\[0\.02em\] text-muted-foreground\/36/,
  );
  assert.match(source, /v\{appVersionLabel\}/);
});
