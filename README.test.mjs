import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const README_PATH = new URL("./README.md", import.meta.url);

test("README routes GitHub visitors to tracked website destinations", async () => {
  const source = await readFile(README_PATH, "utf8");

  assert.match(
    source,
    /https:\/\/holaboss\.ai\/\?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_nav_website/
  );
  assert.match(
    source,
    /https:\/\/docs\.holaboss\.ai\/\?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_nav_docs/
  );
  assert.match(
    source,
    /https:\/\/app\.holaboss\.ai\/signin\?utm_source=github&utm_medium=oss&utm_campaign=hola_boss_oss&utm_content=readme_nav_signin/
  );
});
