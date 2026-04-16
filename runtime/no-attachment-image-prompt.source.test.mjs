import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptSourcePath = path.join(__dirname, "harness-host", "src", "pi.ts");
const promptTestPath = path.join(__dirname, "harness-host", "src", "pi.test.ts");

test("Pi prompt builder explicitly states when attachments and image inputs are absent", async () => {
  const source = await readFile(promptSourcePath, "utf8");

  assert.match(source, /const attachments = request\.attachments \?\? \[\];/);
  assert.match(
    source,
    /if \(attachments\.length === 0\) \{\s*sections\.push\(\["Attachments: none\.", "Image inputs: none\."\]\.join\("\\n"\)\);\s*\} else if \(imageLines\.length > 0\) \{/,
  );
  assert.match(source, /else \{\s*sections\.push\("Image inputs: none\."\);\s*\}/);
});

test("Pi prompt tests cover the explicit no-attachment and no-image-input prompt text", async () => {
  const source = await readFile(promptTestPath, "utf8");

  assert.match(
    source,
    /test\("buildPiPromptPayload explicitly marks when attachments and image inputs are absent", async \(\) => \{/,
  );
  assert.match(source, /assert\.match\(prompt\.text, \/\^List the files\\s\+Attachments: none\\\.\\s\+Image inputs: none\\\.\$\/\);/);
});
