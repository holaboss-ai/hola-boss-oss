import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import ExcelJS from "exceljs";
import JSZip from "jszip";

import type { HarnessInputAttachmentPayload } from "./types.js";

const require = createRequire(import.meta.url);

export interface HarnessInlineImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface HarnessAttachmentTextExtractionParams {
  attachment: HarnessInputAttachmentPayload;
  absolutePath: string;
  maxInlineTextBytes?: number;
}

export interface HarnessDocumentAttachmentSectionParams extends HarnessAttachmentTextExtractionParams {
  promptPath?: string;
  maxExtractedTextChars?: number;
}

export interface HarnessInlineImageAttachmentParams {
  attachment: HarnessInputAttachmentPayload;
  absolutePath: string;
  maxInlineImageBytes?: number;
}

export const DEFAULT_HARNESS_MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_HARNESS_MAX_INLINE_TEXT_BYTES = 128 * 1024;
export const DEFAULT_HARNESS_MAX_EXTRACTED_TEXT_CHARS = 120_000;

const TEXT_ATTACHMENT_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/x-sh",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "application/sql",
]);

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cfg",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".env",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".kt",
  ".log",
  ".lua",
  ".md",
  ".mdx",
  ".mjs",
  ".php",
  ".pl",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const PDF_ATTACHMENT_MIME_TYPES = new Set(["application/pdf"]);
const DOCX_ATTACHMENT_MIME_TYPES = new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const PPTX_ATTACHMENT_MIME_TYPES = new Set(["application/vnd.openxmlformats-officedocument.presentationml.presentation"]);
const EXCEL_ATTACHMENT_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

function normalizePdfjsFactoryPath(directory: string): string {
  return `${directory.replaceAll("\\", "/").replace(/\/+$/u, "")}/`;
}

function resolvePdfStandardFontDataPath(): string {
  const packageJsonPath = require.resolve("pdfjs-dist/package.json");
  return normalizePdfjsFactoryPath(path.join(path.dirname(packageJsonPath), "standard_fonts"));
}

const PDF_STANDARD_FONT_DATA_PATH = resolvePdfStandardFontDataPath();

function isTextLikeAttachment(attachment: HarnessInputAttachmentPayload): boolean {
  const mimeType = attachment.mime_type.trim().toLowerCase();
  if (mimeType.startsWith("text/") || TEXT_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return true;
  }
  return TEXT_ATTACHMENT_EXTENSIONS.has(path.extname(attachment.name).toLowerCase());
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(0);
}

function truncateExtractedText(text: string, maxExtractedTextChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxExtractedTextChars) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, maxExtractedTextChars),
    truncated: true,
  };
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isPdfAttachment(attachment: HarnessInputAttachmentPayload): boolean {
  const lowerName = attachment.name.toLowerCase();
  return PDF_ATTACHMENT_MIME_TYPES.has(attachment.mime_type.toLowerCase()) || lowerName.endsWith(".pdf");
}

function isDocxAttachment(attachment: HarnessInputAttachmentPayload): boolean {
  const lowerName = attachment.name.toLowerCase();
  return DOCX_ATTACHMENT_MIME_TYPES.has(attachment.mime_type.toLowerCase()) || lowerName.endsWith(".docx");
}

function isPptxAttachment(attachment: HarnessInputAttachmentPayload): boolean {
  const lowerName = attachment.name.toLowerCase();
  return PPTX_ATTACHMENT_MIME_TYPES.has(attachment.mime_type.toLowerCase()) || lowerName.endsWith(".pptx");
}

function isExcelAttachment(attachment: HarnessInputAttachmentPayload): boolean {
  const lowerName = attachment.name.toLowerCase();
  return (
    EXCEL_ATTACHMENT_MIME_TYPES.has(attachment.mime_type.toLowerCase()) ||
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls")
  );
}

function buildAttachmentXmlPromptPath(attachment: HarnessInputAttachmentPayload): string {
  return `./${attachment.workspace_path}`;
}

async function extractPdfAttachmentText(buffer: Buffer, fileName: string): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: PDF_STANDARD_FONT_DATA_PATH,
  }).promise;
  try {
    let extractedText = `<pdf filename="${escapeXmlAttribute(fileName)}">`;
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter((part) => part.trim().length > 0)
        .join(" ");
      extractedText += `\n<page number="${index}">\n${pageText}\n</page>`;
    }
    extractedText += "\n</pdf>";
    return normalizeExtractedText(extractedText);
  } finally {
    await pdf.destroy();
  }
}

async function extractDocxAttachmentText(buffer: Buffer, fileName: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) {
    throw new Error(`DOCX document XML not found for ${fileName}`);
  }
  const paragraphs = documentXml.match(/<w:p[\s\S]*?<\/w:p>/g) ?? [];
  const lines = paragraphs
    .map((paragraph) => {
      const matches = [...paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
      return decodeXmlEntities(matches.map((match) => match[1] ?? "").join("")).trim();
    })
    .filter((line) => line.length > 0);
  const extractedText = `<docx filename="${escapeXmlAttribute(fileName)}">\n<page number="1">\n${lines.join("\n")}\n</page>\n</docx>`;
  return normalizeExtractedText(extractedText);
}

async function extractPptxAttachmentText(buffer: Buffer, fileName: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  let extractedText = `<pptx filename="${escapeXmlAttribute(fileName)}">`;
  for (let index = 0; index < slideFiles.length; index += 1) {
    const slideFile = zip.file(slideFiles[index]);
    if (!slideFile) {
      continue;
    }
    const slideXml = await slideFile.async("text");
    const matches = [...slideXml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)];
    const slideText = matches.map((match) => decodeXmlEntities(match[1] ?? "").trim()).filter(Boolean).join("\n");
    if (!slideText) {
      continue;
    }
    extractedText += `\n<slide number="${index + 1}">\n${slideText}\n</slide>`;
  }
  extractedText += "\n</pptx>";
  return normalizeExtractedText(extractedText);
}

async function extractExcelAttachmentText(buffer: Buffer, fileName: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
  );
  let extractedText = `<excel filename="${escapeXmlAttribute(fileName)}">`;
  workbook.eachSheet((worksheet, index) => {
    const csvRows: string[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        const raw = cell.text ?? "";
        cells[columnNumber - 1] = /[",\n\r]/.test(raw)
          ? `"${raw.replace(/"/g, "\"\"")}"`
          : raw;
      });

      let lastNonEmptyIndex = cells.length - 1;
      while (lastNonEmptyIndex >= 0 && cells[lastNonEmptyIndex] === "") {
        lastNonEmptyIndex -= 1;
      }
      const normalized = cells.slice(0, lastNonEmptyIndex + 1);
      if (normalized.length > 0) {
        csvRows.push(normalized.join(","));
      }
    });

    extractedText += `\n<sheet name="${escapeXmlAttribute(worksheet.name)}" index="${index}">\n${csvRows.join("\n").trim()}\n</sheet>`;
  });
  extractedText += "\n</excel>";
  return normalizeExtractedText(extractedText);
}

export function buildHarnessAttachmentPromptPath(attachment: HarnessInputAttachmentPayload): string {
  return buildAttachmentXmlPromptPath(attachment);
}

export function buildHarnessAttachmentFallbackPromptLine(
  attachment: HarnessInputAttachmentPayload,
  promptPath = buildHarnessAttachmentPromptPath(attachment),
): string {
  const label =
    attachment.kind === "image"
      ? "image"
      : attachment.kind === "folder"
        ? "folder"
        : "file";
  return `- ${attachment.name} (${label}, ${attachment.mime_type}) at ${promptPath}`;
}

export function isHarnessFolderAttachment(attachment: HarnessInputAttachmentPayload): boolean {
  return attachment.kind === "folder" || attachment.mime_type.trim().toLowerCase() === "inode/directory";
}

export async function extractHarnessAttachmentText(params: HarnessAttachmentTextExtractionParams): Promise<string | null> {
  const {
    attachment,
    absolutePath,
    maxInlineTextBytes = DEFAULT_HARNESS_MAX_INLINE_TEXT_BYTES,
  } = params;
  const buffer = fs.readFileSync(absolutePath);

  if (isPdfAttachment(attachment)) {
    return await extractPdfAttachmentText(buffer, attachment.name);
  }
  if (isDocxAttachment(attachment)) {
    return await extractDocxAttachmentText(buffer, attachment.name);
  }
  if (isPptxAttachment(attachment)) {
    return await extractPptxAttachmentText(buffer, attachment.name);
  }
  if (isExcelAttachment(attachment)) {
    try {
      return await extractExcelAttachmentText(buffer, attachment.name);
    } catch {
      return null;
    }
  }
  if (!isTextLikeAttachment(attachment) || isBinaryBuffer(buffer)) {
    return null;
  }

  const truncated = buffer.length > maxInlineTextBytes;
  const text = normalizeExtractedText(buffer.subarray(0, maxInlineTextBytes).toString("utf8"));
  if (!text) {
    return "[file is empty]";
  }
  return truncated ? `${text}\n\n[truncated to first ${maxInlineTextBytes} bytes]` : text;
}

export async function inlineHarnessDocumentAttachmentSection(
  params: HarnessDocumentAttachmentSectionParams,
): Promise<string | null> {
  const {
    attachment,
    absolutePath,
    promptPath = buildHarnessAttachmentPromptPath(attachment),
    maxExtractedTextChars = DEFAULT_HARNESS_MAX_EXTRACTED_TEXT_CHARS,
    maxInlineTextBytes,
  } = params;
  if (isHarnessFolderAttachment(attachment)) {
    return null;
  }
  const extractedText = await extractHarnessAttachmentText({
    attachment,
    absolutePath,
    maxInlineTextBytes,
  });
  if (!extractedText) {
    return null;
  }
  const truncatedText = truncateExtractedText(extractedText, maxExtractedTextChars);
  const notice = truncatedText.truncated ? "\n[document text truncated for prompt size]" : "";
  return [
    `[Document: ${attachment.name}]`,
    `Mime-Type: ${attachment.mime_type}`,
    `Workspace Path: ${promptPath}`,
    "",
    `${truncatedText.text}${notice}`.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

export function inlineHarnessImageAttachment(
  params: HarnessInlineImageAttachmentParams,
): HarnessInlineImageContent | null {
  const {
    attachment,
    absolutePath,
    maxInlineImageBytes = DEFAULT_HARNESS_MAX_INLINE_IMAGE_BYTES,
  } = params;
  if (attachment.kind !== "image" && !attachment.mime_type.startsWith("image/")) {
    return null;
  }
  const buffer = fs.readFileSync(absolutePath);
  if (buffer.length > maxInlineImageBytes) {
    return null;
  }
  return {
    type: "image",
    data: buffer.toString("base64"),
    mimeType: attachment.mime_type,
  };
}
