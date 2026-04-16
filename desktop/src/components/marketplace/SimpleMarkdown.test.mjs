import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "SimpleMarkdown.tsx");
const normalizationPath = path.join(__dirname, "markdownFenceNormalization.mjs");

test("simple markdown uses react-markdown with gfm and safe defaults", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /import ReactMarkdown, \{ defaultUrlTransform, type Components \} from "react-markdown";/);
  assert.match(source, /import remarkGfm from "remark-gfm";/);
  assert.match(source, /import \{ normalizeWrappedMarkdownFence \} from "\.\/markdownFenceNormalization\.mjs";/);
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
    /const normalizedChildren = useMemo\(\s*\(\) => normalizeWrappedMarkdownFence\(children\),\s*\[children\],\s*\);/,
  );
  assert.match(
    source,
    /const components = useMemo\(\s*\(\) => createMarkdownComponents\(onLinkClick\),\s*\[onLinkClick\],\s*\);/,
  );
  assert.match(source, /<ReactMarkdown[\s\S]*>\s*\{normalizedChildren\}\s*<\/ReactMarkdown>/);
  assert.match(source, /export const SimpleMarkdown = memo\(SimpleMarkdownComponent\);/);
});

test("markdown fence normalization repairs wrapped markdown that contains nested code fences", async () => {
  const { normalizeWrappedMarkdownFence } = await import(pathToFileURL(normalizationPath).href);

  const broken = [
    "Draft preview:",
    "",
    "```md",
    "# AGENTS.md",
    "",
    "```csv",
    "name,value",
    "```",
    "",
    "```",
    "",
    "Confirm before writing it to disk.",
  ].join("\n");

  const normalized = normalizeWrappedMarkdownFence(broken);

  assert.match(normalized, /````md/);
  assert.match(normalized, /name,value/);
  assert.match(normalized, /\n````\n\nConfirm before writing it to disk\.$/);
});

test("markdown fence normalization leaves separate markdown and csv blocks unchanged", async () => {
  const { normalizeWrappedMarkdownFence } = await import(pathToFileURL(normalizationPath).href);

  const separateBlocks = [
    "```md",
    "# AGENTS.md",
    "```",
    "",
    "```csv",
    "name,value",
    "```",
  ].join("\n");

  assert.equal(normalizeWrappedMarkdownFence(separateBlocks), separateBlocks);
});
