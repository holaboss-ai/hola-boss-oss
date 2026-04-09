import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "SimpleMarkdown.tsx");

test("simple markdown uses react-markdown with gfm and safe defaults", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /import ReactMarkdown, \{ defaultUrlTransform, type Components \} from "react-markdown";/);
  assert.match(source, /import remarkGfm from "remark-gfm";/);
  assert.match(source, /remarkPlugins=\{\[remarkGfm\]\}/);
  assert.match(source, /skipHtml/);
  assert.match(source, /urlTransform=\{defaultUrlTransform\}/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(source, /export function renderMarkdown/);
});

test("simple markdown preserves the md-* styling hooks used by chat and marketplace", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /onLinkClick\?: \(url: string\) => void;/);
  assert.match(source, /const normalizedHref = normalizeHttpUrl/);
  assert.match(source, /event\.preventDefault\(\);\s*onLinkClick\(normalizedHref\);/);
  assert.match(source, /className=\{appendClassName\(className, "md-link"\)\}/);
  assert.match(source, /className=\{appendClassName\(className, "md-blockquote"\)\}/);
  assert.match(source, /className=\{appendClassName\(className, "md-code-block"\)\}/);
  assert.match(source, /className=\{appendClassName\(className, "md-inline-code"\)\}/);
  assert.match(source, /className=\{appendClassName\(className, "md-table"\)\}/);
  assert.match(source, /className=\{appendClassName\(className, "md-ul"\)\}/);
  assert.match(source, /className=\{appendClassName\(className, "md-ol"\)\}/);
  assert.match(source, /className=\{appendClassName\(className, "md-li md-oli"\)\}/);
  assert.match(source, /className=\{`simple-markdown \$\{className\}`\.trim\(\)\}/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
});

test("simple markdown memoizes renderer components to keep chat content stable during parent rerenders", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /import \{ memo, useMemo \} from "react";/);
  assert.match(
    source,
    /const components = useMemo\(\s*\(\) => createMarkdownComponents\(onLinkClick\),\s*\[onLinkClick\],\s*\);/,
  );
  assert.match(source, /export const SimpleMarkdown = memo\(SimpleMarkdownComponent\);/);
});
