import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import JSZip from "jszip";
import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  createFindTool,
  createGrepTool,
  createLsTool,
  DefaultResourceLoader,
  loadSkillsFromDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type LoadSkillsResult,
  type Skill,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { Api, ImageContent, Model, TextContent } from "@mariozechner/pi-ai";
import type { ResourceDiagnostic } from "@mariozechner/pi-coding-agent";
import { APIError as OpenAIApiError } from "openai";
import ExcelJS from "exceljs";
import { createCallResult, createRuntime, type Runtime as McporterRuntime, type ServerDefinition, type ServerToolInfo } from "mcporter";

import type {
  HarnessHostInputAttachmentPayload,
  HarnessHostPiMcpToolRef,
  HarnessHostPiRequest,
  JsonObject,
  JsonValue,
  RunnerEventType,
  RunnerOutputEventPayload,
} from "./contracts.js";
import { resolvePiDesktopBrowserToolDefinitions } from "./pi-browser-tools.js";
import { resolvePiRuntimeToolDefinitions } from "./pi-runtime-tools.js";
import { resolvePiWebSearchToolDefinitions } from "./pi-web-search.js";

export type PiMappedEvent = {
  event_type: RunnerEventType;
  payload: JsonObject;
};

export type PiEventMapperState = {
  toolArgsByCallId: Map<string, JsonValue>;
  mcpToolMetadata: ReadonlyMap<string, PiMcpToolMetadata>;
  skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>;
  terminalState: "completed" | "failed" | null;
  waitingForUser: boolean;
};

export interface PiSessionHandle {
  session: AgentSession;
  sessionFile: string;
  mcpToolMetadata: Map<string, PiMcpToolMetadata>;
  skillMetadataByAlias: Map<string, PiSkillMetadata>;
  dispose: () => Promise<void>;
}

export interface PiDeps {
  createSession: (request: HarnessHostPiRequest) => Promise<PiSessionHandle>;
}

type PiThinkingLevel =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
type PiRequestedThinkingLevel = PiThinkingLevel | "off";
type PiThinkingBudgetLevel = Exclude<PiThinkingLevel, "xhigh">;

interface PiThinkingSelection {
  rawValue: string | null;
  level: PiRequestedThinkingLevel | null;
  thinkingBudgets?: Partial<Record<PiThinkingBudgetLevel, number>>;
}

const PI_AGENT_STATE_DIR = ".holaboss/pi-agent";
const PI_SESSION_DIR = ".holaboss/pi-sessions";
const PI_HARNESS_CLIENT_NAME = "holaboss-pi-harness";
const PI_HARNESS_CLIENT_VERSION = "0.1.0";
const PI_MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
const PI_MAX_INLINE_TEXT_BYTES = 128 * 1024;
const PI_MAX_EXTRACTED_TEXT_CHARS = 120_000;
const PI_MCP_DISCOVERY_RETRY_INTERVAL_MS = 250;
const PI_MCP_DISCOVERY_MAX_WAIT_MS = 10000;
const PI_TODO_STATE_DIR = "todos";
const PI_TODO_STATE_VERSION = 2;
const PI_TODO_STATUSES = [
  "pending",
  "in_progress",
  "blocked",
  "completed",
  "abandoned",
] as const;
const PI_TODO_WRITE_OPS = ["replace", "add_phase", "add_task", "update", "remove_task"] as const;
const PI_TODO_WRITE_OPS_TEXT =
  "`replace`, `add_phase`, `add_task`, `update`, and `remove_task`";
const PI_TODO_WRITE_ALIAS_WARNING =
  "Do not invent alias op names such as `replace_all`, `update_task`, or `set_status`.";
const require = createRequire(import.meta.url);

type PiTodoStatus = (typeof PI_TODO_STATUSES)[number];

interface PiTodoItem {
  id: string;
  content: string;
  status: PiTodoStatus;
  notes?: string;
  details?: string;
}

interface PiTodoPhase {
  id: string;
  name: string;
  tasks: PiTodoItem[];
}

interface PiTodoState {
  version: number;
  session_id: string;
  updated_at: string | null;
  phases: PiTodoPhase[];
  next_task_id: number;
  next_phase_id: number;
}

const PI_TEXT_ATTACHMENT_MIME_TYPES = new Set([
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

const PI_TEXT_ATTACHMENT_EXTENSIONS = new Set([
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

const PI_PDF_ATTACHMENT_MIME_TYPES = new Set(["application/pdf"]);
const PI_DOCX_ATTACHMENT_MIME_TYPES = new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
const PI_PPTX_ATTACHMENT_MIME_TYPES = new Set(["application/vnd.openxmlformats-officedocument.presentationml.presentation"]);
const PI_EXCEL_ATTACHMENT_MIME_TYPES = new Set([
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

const PI_PDF_STANDARD_FONT_DATA_PATH = resolvePdfStandardFontDataPath();

export interface PiMcpToolMetadata {
  piToolName: string;
  serverId: string;
  toolId: string;
  toolName: string;
}

export interface PiSkillMetadata {
  skillId: string;
  skillName: string;
  filePath: string;
  baseDir: string;
  grantedTools: string[];
  grantedCommands: string[];
}

export interface PiSkillWideningState {
  scope: "run";
  managedToolNames: Set<string>;
  grantedToolNames: Set<string>;
  skillIdsByManagedTool: ReadonlyMap<string, ReadonlySet<string>>;
  managedCommandIds: Set<string>;
  grantedCommandIds: Set<string>;
  skillIdsByManagedCommand: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface PiWorkspaceBoundaryPolicy {
  workspaceDir: string;
  workspaceRealDir: string;
  overrideRequested: boolean;
}

export type PiMcpServerBinding = {
  serverId: string;
  timeoutMs: number;
  definition: ServerDefinition;
};

export type PiMcpToolset = {
  runtime: McporterRuntime | null;
  customTools: ToolDefinition[];
  mcpToolMetadata: Map<string, PiMcpToolMetadata>;
};

export interface PiPromptPayload {
  text: string;
  images: ImageContent[];
}

type PiAttachment = HarnessHostInputAttachmentPayload;

const WORKSPACE_PATH_KEY_PATTERN =
  /(?:^|_)(?:path|file|filepath|filename|target|source|destination|cwd|dir|directory|root)$/i;
const TOOL_COMMAND_KEY_PATTERN = /^(?:command|cmd|script)$/i;
const WORKSPACE_LOCAL_TOOL_NAMES = new Set([
  "read",
  "edit",
  "write",
  "bash",
  "glob",
  "grep",
  "find",
  "ls",
  "list",
  "mkdir",
  "rm",
  "mv",
  "cp",
  "todoread",
  "todowrite",
  "skill",
]);

function shouldEnforceWorkspaceBoundaryForTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("mcp__") || normalized.startsWith("holaboss_")) {
    return false;
  }
  return WORKSPACE_LOCAL_TOOL_NAMES.has(normalized);
}

function attachmentPromptPath(attachment: PiAttachment): string {
  return `./${attachment.workspace_path}`;
}

function resolveAttachmentAbsolutePath(request: HarnessHostPiRequest, attachment: PiAttachment): string {
  const policy = createWorkspaceBoundaryPolicy(request.workspace_dir, false);
  const resolved = resolvePathWithinWorkspace(policy, attachment.workspace_path);
  if (!resolved) {
    throw new Error(
      `Attachment '${attachment.name}' resolves outside workspace boundary: ${attachment.workspace_path}`
    );
  }
  return resolved;
}

function isTextLikeAttachment(attachment: PiAttachment): boolean {
  const mimeType = attachment.mime_type.trim().toLowerCase();
  if (mimeType.startsWith("text/") || PI_TEXT_ATTACHMENT_MIME_TYPES.has(mimeType)) {
    return true;
  }
  return PI_TEXT_ATTACHMENT_EXTENSIONS.has(path.extname(attachment.name).toLowerCase());
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(0);
}

function truncateExtractedText(text: string): { text: string; truncated: boolean } {
  if (text.length <= PI_MAX_EXTRACTED_TEXT_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, PI_MAX_EXTRACTED_TEXT_CHARS),
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

function isPdfAttachment(attachment: PiAttachment): boolean {
  const lowerName = attachment.name.toLowerCase();
  return PI_PDF_ATTACHMENT_MIME_TYPES.has(attachment.mime_type.toLowerCase()) || lowerName.endsWith(".pdf");
}

function isDocxAttachment(attachment: PiAttachment): boolean {
  const lowerName = attachment.name.toLowerCase();
  return PI_DOCX_ATTACHMENT_MIME_TYPES.has(attachment.mime_type.toLowerCase()) || lowerName.endsWith(".docx");
}

function isPptxAttachment(attachment: PiAttachment): boolean {
  const lowerName = attachment.name.toLowerCase();
  return PI_PPTX_ATTACHMENT_MIME_TYPES.has(attachment.mime_type.toLowerCase()) || lowerName.endsWith(".pptx");
}

function isExcelAttachment(attachment: PiAttachment): boolean {
  const lowerName = attachment.name.toLowerCase();
  return (
    PI_EXCEL_ATTACHMENT_MIME_TYPES.has(attachment.mime_type.toLowerCase()) ||
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls")
  );
}

function fallbackPromptLine(attachment: PiAttachment): string {
  const label =
    attachment.kind === "image"
      ? "image"
      : attachment.kind === "folder"
        ? "folder"
        : "file";
  return `- ${attachment.name} (${label}, ${attachment.mime_type}) at ${attachmentPromptPath(attachment)}`;
}

function isFolderAttachment(attachment: PiAttachment): boolean {
  return attachment.kind === "folder" || attachment.mime_type.trim().toLowerCase() === "inode/directory";
}

async function extractPdfAttachmentText(buffer: Buffer, fileName: string): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: PI_PDF_STANDARD_FONT_DATA_PATH,
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

async function extractAttachmentText(request: HarnessHostPiRequest, attachment: PiAttachment): Promise<string | null> {
  const attachmentPath = resolveAttachmentAbsolutePath(request, attachment);
  const buffer = fs.readFileSync(attachmentPath);

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

  const truncated = buffer.length > PI_MAX_INLINE_TEXT_BYTES;
  const text = normalizeExtractedText(buffer.subarray(0, PI_MAX_INLINE_TEXT_BYTES).toString("utf8"));
  if (!text) {
    return "[file is empty]";
  }
  return truncated ? `${text}\n\n[truncated to first ${PI_MAX_INLINE_TEXT_BYTES} bytes]` : text;
}

async function inlineDocumentAttachmentSection(request: HarnessHostPiRequest, attachment: PiAttachment): Promise<string | null> {
  if (isFolderAttachment(attachment)) {
    return null;
  }
  const extractedText = await extractAttachmentText(request, attachment);
  if (!extractedText) {
    return null;
  }
  const truncatedText = truncateExtractedText(extractedText);
  const notice = truncatedText.truncated ? "\n[document text truncated for prompt size]" : "";
  return [
    `[Document: ${attachment.name}]`,
    `Mime-Type: ${attachment.mime_type}`,
    `Workspace Path: ${attachmentPromptPath(attachment)}`,
    "",
    `${truncatedText.text}${notice}`.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

function inlineImageAttachment(request: HarnessHostPiRequest, attachment: PiAttachment): ImageContent | null {
  if (attachment.kind !== "image" && !attachment.mime_type.startsWith("image/")) {
    return null;
  }
  const attachmentPath = resolveAttachmentAbsolutePath(request, attachment);
  const buffer = fs.readFileSync(attachmentPath);
  if (buffer.length > PI_MAX_INLINE_IMAGE_BYTES) {
    return null;
  }
  return {
    type: "image",
    data: buffer.toString("base64"),
    mimeType: attachment.mime_type,
  };
}

export async function buildPiPromptPayload(request: HarnessHostPiRequest): Promise<PiPromptPayload> {
  const sections: string[] = [];
  const imageLines: string[] = [];
  const folderLines: string[] = [];
  const fallbackLines: string[] = [];
  const images: ImageContent[] = [];
  const attachments = request.attachments ?? [];

  const todoResumeInstruction = resumeTodoReadInstruction(request);
  if (todoResumeInstruction) {
    sections.push(todoResumeInstruction);
  }

  const quotedSkills = resolveQuotedSkillSections(request.instruction, request.workspace_skill_dirs);
  if (quotedSkills.blocks.length > 0) {
    sections.push(["Quoted workspace skills:", ...quotedSkills.blocks].join("\n\n"));
  }
  if (quotedSkills.missing.length > 0) {
    sections.push(
      `Quoted workspace skills not found in this workspace: ${quotedSkills.missing.join(", ")}`
    );
  }

  const instruction = quotedSkills.body.trim();
  if (instruction) {
    sections.push(instruction);
  }

  for (const attachment of attachments) {
    if (isFolderAttachment(attachment)) {
      folderLines.push(fallbackPromptLine(attachment));
      continue;
    }
    if (attachment.kind === "image" || attachment.mime_type.startsWith("image/")) {
      const image = inlineImageAttachment(request, attachment);
      if (image) {
        images.push(image);
        imageLines.push(`- ${attachment.name} (${attachment.mime_type}) at ${attachmentPromptPath(attachment)}`);
        continue;
      }
    }

    const textSection = await inlineDocumentAttachmentSection(request, attachment);
    if (textSection) {
      sections.push(textSection);
      continue;
    }

    fallbackLines.push(fallbackPromptLine(attachment));
  }

  if (attachments.length === 0) {
    sections.push(["Attachments: none.", "Image inputs: none."].join("\n"));
  } else if (imageLines.length > 0) {
    sections.push(["Attached images:", ...imageLines].join("\n"));
  } else {
    sections.push("Image inputs: none.");
  }
  if (folderLines.length > 0) {
    sections.push(
      [
        "Attached folders:",
        ...folderLines,
        "Treat attached folders as scoped workspace context. Inspect relevant files inside them when needed; their contents are not inlined automatically.",
      ].join("\n")
    );
  }
  if (fallbackLines.length > 0) {
    sections.push(
      [
        "Other attachments are staged in the workspace and should be inspected from these paths:",
        ...fallbackLines,
      ].join("\n")
    );
  }

  const text = sections.join("\n\n").trim() || "Review the attached files.";
  return { text, images };
}

export async function promptTextForRequest(request: HarnessHostPiRequest): Promise<string> {
  return (await buildPiPromptPayload(request)).text;
}

export async function promptImagesForRequest(request: HarnessHostPiRequest): Promise<ImageContent[]> {
  return (await buildPiPromptPayload(request)).images;
}

export async function promptContentForRequest(request: HarnessHostPiRequest): Promise<Array<TextContent | ImageContent>> {
  const prompt = await buildPiPromptPayload(request);
  return [{ type: "text", text: prompt.text }, ...prompt.images];
}

function emitRunnerEvent(
  request: HarnessHostPiRequest,
  sequence: number,
  eventType: RunnerEventType,
  payload: JsonObject
): void {
  const event: RunnerOutputEventPayload = {
    session_id: request.session_id,
    input_id: request.input_id,
    sequence,
    event_type: eventType,
    payload,
  };
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOpenAiCompatErrorResponse(errorResponse: unknown): Object | undefined {
  if (isRecord(errorResponse)) {
    return errorResponse;
  }
  if (!Array.isArray(errorResponse)) {
    return undefined;
  }
  for (const item of errorResponse) {
    if (isRecord(item) && isRecord(item.error)) {
      return item;
    }
  }
  return undefined;
}

let openAiApiErrorGeneratePatched = false;

function patchOpenAiApiErrorGenerate(): void {
  if (openAiApiErrorGeneratePatched) {
    return;
  }
  const originalGenerate = OpenAIApiError.generate.bind(OpenAIApiError);
  OpenAIApiError.generate = ((status, errorResponse, message, headers) =>
    originalGenerate(status, normalizeOpenAiCompatErrorResponse(errorResponse), message, headers)) as typeof OpenAIApiError.generate;
  openAiApiErrorGeneratePatched = true;
}

patchOpenAiApiErrorGenerate();

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonValue(item));
  }
  if (value && typeof value === "object") {
    try {
      return JSON.parse(JSON.stringify(value)) as JsonValue;
    } catch {
      return String(value);
    }
  }
  return value === undefined ? null : String(value);
}

function jsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function sdkErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function resolvePiStateDir(workspaceDir: string): string {
  return path.join(workspaceDir, PI_AGENT_STATE_DIR);
}

function resolvePiSessionDir(workspaceDir: string): string {
  return path.join(workspaceDir, PI_SESSION_DIR);
}

function directoryExists(target: string): boolean {
  return fs.statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

export function resolvePiSkillDirs(request: HarnessHostPiRequest): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const rawDir of request.workspace_skill_dirs) {
    const resolvedDir = path.resolve(rawDir);
    if (seen.has(resolvedDir) || !directoryExists(resolvedDir)) {
      continue;
    }
    seen.add(resolvedDir);
    ordered.push(resolvedDir);
  }
  return ordered;
}

function loadPiSkills(skillDirs: string[]): LoadSkillsResult {
  const skills: Skill[] = [];
  const diagnostics: ResourceDiagnostic[] = [];
  const seenFilePaths = new Set<string>();

  for (const skillDir of skillDirs) {
    const result = loadSkillsFromDir({
      dir: skillDir,
      source: "holaboss",
    });
    diagnostics.push(...result.diagnostics);
    for (const skill of result.skills) {
      if (seenFilePaths.has(skill.filePath)) {
        continue;
      }
      seenFilePaths.add(skill.filePath);
      skills.push(skill);
    }
  }

  return { skills, diagnostics };
}

function stripMarkdownFrontmatter(value: string): string {
  const normalized = value.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) {
    return normalized;
  }
  return normalized.slice(match[0].length);
}

function parseQuotedSkillInstruction(value: string): { skillIds: string[]; body: string } {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const skillIds: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      break;
    }
    const match = /^\/([A-Za-z0-9_-]+)$/.exec(line);
    if (!match) {
      return { skillIds: [], body: normalized.trim() };
    }
    skillIds.push(match[1] ?? "");
    index += 1;
  }

  if (skillIds.length === 0) {
    return { skillIds: [], body: normalized.trim() };
  }

  if (index < lines.length && (lines[index]?.trim() ?? "") !== "") {
    return { skillIds: [], body: normalized.trim() };
  }

  while (index < lines.length && (lines[index]?.trim() ?? "") === "") {
    index += 1;
  }

  return {
    skillIds: [...new Set(skillIds)],
    body: lines.slice(index).join("\n").trim(),
  };
}

function quotedSkillBlock(metadata: PiSkillMetadata): string {
  const body = stripMarkdownFrontmatter(fs.readFileSync(metadata.filePath, "utf8")).trim();
  return `<skill name="${metadata.skillName}" location="${metadata.filePath}">\nReferences are relative to ${metadata.baseDir}.\n\n${body}\n</skill>`;
}

function resolveQuotedSkillSections(
  instruction: string,
  workspaceSkillDirs: string[]
): { blocks: string[]; missing: string[]; body: string } {
  const parsed = parseQuotedSkillInstruction(instruction);
  if (parsed.skillIds.length === 0) {
    return {
      blocks: [],
      missing: [],
      body: parsed.body,
    };
  }

  const resolvedSkillDirs = Array.from(
    new Set(
      workspaceSkillDirs
        .map((dir) => path.resolve(dir))
        .filter((dir) => directoryExists(dir))
    )
  );
  const loadedSkills = loadPiSkills(resolvedSkillDirs);
  const skillMetadataByAlias = buildPiSkillMetadataByAlias(loadedSkills.skills);
  const blocks: string[] = [];
  const missing: string[] = [];

  for (const skillId of parsed.skillIds) {
    const metadata = resolveSkillMetadata(skillMetadataByAlias, skillId);
    if (!metadata) {
      missing.push(skillId);
      continue;
    }
    try {
      blocks.push(quotedSkillBlock(metadata));
    } catch {
      missing.push(skillId);
    }
  }

  return {
    blocks,
    missing,
    body: parsed.body,
  };
}

function normalizeSkillLookupToken(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sanitizePiStateSegment(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "default";
}

function resolvePiTodoStatePath(stateDir: string, sessionId: string): string {
  return path.join(stateDir, PI_TODO_STATE_DIR, `${sanitizePiStateSegment(sessionId)}.json`);
}

function emptyPiTodoState(sessionId: string): PiTodoState {
  return {
    version: PI_TODO_STATE_VERSION,
    session_id: sessionId,
    updated_at: null,
    phases: [],
    next_task_id: 1,
    next_phase_id: 1,
  };
}

function hasPersistedPiTodoState(stateDir: string, sessionId: string): boolean {
  return countPiTodoTasks(readPiTodoState(stateDir, sessionId).phases) > 0;
}

function hasBlockedPersistedPiTodoState(stateDir: string, sessionId: string): boolean {
  return readPiTodoState(stateDir, sessionId).phases
    .flatMap((phase) => phase.tasks)
    .some((task) => task.status === "blocked");
}

function shouldRequireTodoReadBeforePrompt(request: HarnessHostPiRequest): boolean {
  return Boolean(
    resolveRequestedSessionFile(request) &&
      hasPersistedPiTodoState(resolvePiStateDir(request.workspace_dir), request.session_id)
  );
}

function resumeTodoReadInstruction(request: HarnessHostPiRequest): string {
  if (!shouldRequireTodoReadBeforePrompt(request)) {
    return "";
  }
  return [
    "Resumed session note:",
    "A persisted phased todo plan already exists for this session.",
    "Treat the user's newest message as the primary instruction for this turn.",
    "Use `todoread` when you need the current phase/task ids before continuing or updating the persisted plan.",
    "Only restore and continue the persisted todo immediately when the user's newest message clearly asks to continue it or clearly advances the same work.",
    "If the user's newest message is conversational, brief, acknowledges prior progress, or is otherwise ambiguous about continuation, respond to that message directly first and ask whether they want to continue the unfinished work.",
    `When you use \`todowrite\`, valid \`op\` values are exactly ${PI_TODO_WRITE_OPS_TEXT}.`,
    PI_TODO_WRITE_ALIAS_WARNING,
    "When you do resume the plan, continue executing it until the recorded work is complete or genuinely blocked.",
    "Once the user has clearly asked you to continue an unfinished plan and executable todo items remain, do not stop only to give progress updates or ask whether to continue.",
    "If the user's newest message clearly redirects to unrelated work, handle that new request first, keep the restored todo marked unfinished, and then propose continuing it once the unrelated request is complete.",
  ].join("\n");
}

function effectiveSystemPromptForRequest(request: HarnessHostPiRequest): string {
  const basePrompt = request.system_prompt.trim();
  const todoResumeInstruction = resumeTodoReadInstruction(request);
  return [basePrompt, todoResumeInstruction].filter(Boolean).join("\n\n");
}

function normalizePiTodoStatus(value: unknown): PiTodoStatus | null {
  const normalized = optionalTrimmedString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  switch (normalized) {
    case "pending":
    case "in_progress":
    case "blocked":
    case "completed":
    case "abandoned":
      return normalized;
    default:
      return null;
  }
}

function clonePiTodoPhases(phases: PiTodoPhase[]): PiTodoPhase[] {
  return phases.map((phase) => ({
    id: phase.id,
    name: phase.name,
    tasks: phase.tasks.map((task) => ({ ...task })),
  }));
}

function countPiTodoTasks(phases: PiTodoPhase[]): number {
  return phases.reduce((total, phase) => total + phase.tasks.length, 0);
}

function flattenPiTodoSummaries(phases: PiTodoPhase[]): Array<{ content: string; status: PiTodoStatus }> {
  return phases.flatMap((phase) =>
    phase.tasks.map((task) => ({
      content: task.content,
      status: task.status,
    }))
  );
}

function nextPiTodoIds(phases: PiTodoPhase[]): { nextTaskId: number; nextPhaseId: number } {
  let maxTaskId = 0;
  let maxPhaseId = 0;

  for (const phase of phases) {
    const phaseMatch = /^phase-(\d+)$/u.exec(phase.id);
    if (phaseMatch) {
      maxPhaseId = Math.max(maxPhaseId, Number.parseInt(phaseMatch[1] ?? "0", 10));
    }
    for (const task of phase.tasks) {
      const taskMatch = /^task-(\d+)$/u.exec(task.id);
      if (taskMatch) {
        maxTaskId = Math.max(maxTaskId, Number.parseInt(taskMatch[1] ?? "0", 10));
      }
    }
  }

  return { nextTaskId: maxTaskId + 1, nextPhaseId: maxPhaseId + 1 };
}

function normalizePersistedPiTodoItem(value: unknown, fallbackId: string): PiTodoItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const content = firstNonEmptyString(value.content, value.text, value.task, value.title);
  if (!content) {
    return null;
  }
  const status = normalizePiTodoStatus(value.status) ?? "pending";
  const notes = optionalTrimmedString(value.notes) ?? undefined;
  const details = optionalTrimmedString(value.details) ?? undefined;
  const id = firstNonEmptyString(value.id, fallbackId) ?? fallbackId;
  return {
    id,
    content,
    status,
    ...(notes ? { notes } : {}),
    ...(details ? { details } : {}),
  };
}

function normalizePersistedPiTodoPhase(
  value: unknown,
  fallbackId: string,
  nextTaskId: number
): { phase: PiTodoPhase | null; nextTaskId: number } {
  if (!isRecord(value)) {
    return { phase: null, nextTaskId };
  }
  const name = firstNonEmptyString(value.name, value.title);
  if (!name) {
    return { phase: null, nextTaskId };
  }
  const tasks: PiTodoItem[] = [];
  let localNextTaskId = nextTaskId;
  if (Array.isArray(value.tasks)) {
    for (const rawTask of value.tasks) {
      const task = normalizePersistedPiTodoItem(rawTask, `task-${localNextTaskId}`);
      localNextTaskId += 1;
      if (task) {
        tasks.push(task);
      }
    }
  }
  return {
    phase: {
      id: firstNonEmptyString(value.id, fallbackId) ?? fallbackId,
      name,
      tasks,
    },
    nextTaskId: localNextTaskId,
  };
}

function normalizeLegacyPiTodoPhases(todos: unknown[]): PiTodoPhase[] {
  const tasks: PiTodoItem[] = [];
  let nextTaskId = 1;
  for (const rawTask of todos) {
    const task = normalizePersistedPiTodoItem(rawTask, `task-${nextTaskId}`);
    nextTaskId += 1;
    if (task) {
      tasks.push(task);
    }
  }
  return tasks.length > 0
    ? [
        {
          id: "phase-1",
          name: "Tasks",
          tasks,
        },
      ]
    : [];
}

function normalizeInProgressPiTodoTask(phases: PiTodoPhase[]): void {
  const orderedTasks = phases.flatMap((phase) => phase.tasks);
  if (orderedTasks.length === 0) {
    return;
  }

  const inProgressTasks = orderedTasks.filter((task) => task.status === "in_progress");
  if (inProgressTasks.length > 1) {
    for (const task of inProgressTasks.slice(1)) {
      task.status = "pending";
    }
  }
  if (inProgressTasks.length > 0) {
    return;
  }

  const hasBlockedTask = orderedTasks.some((task) => task.status === "blocked");
  if (hasBlockedTask) {
    return;
  }

  const firstPendingTask = orderedTasks.find((task) => task.status === "pending");
  if (firstPendingTask) {
    firstPendingTask.status = "in_progress";
  }
}

function summarizeQuestionPrompt(args: JsonValue | null, result: unknown): string | null {
  const candidates: unknown[] = [];
  if (isRecord(args)) {
    candidates.push(args.question, args.prompt, args.message, args.text, args.content);
  }
  if (isRecord(result)) {
    candidates.push(result.question, result.prompt, result.message, result.text, result.content);
    if (isRecord(result.details)) {
      candidates.push(
        result.details.question,
        result.details.prompt,
        result.details.message,
        result.details.text,
        result.details.content
      );
    }
  }
  for (const candidate of candidates) {
    const normalized = optionalTrimmedString(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function blockActivePiTodoTask(params: {
  stateDir: string;
  sessionId: string;
  detail: string;
}): PiTodoState | null {
  const currentState = readPiTodoState(params.stateDir, params.sessionId);
  if (countPiTodoTasks(currentState.phases) === 0) {
    return null;
  }
  const nextPhases = clonePiTodoPhases(currentState.phases);
  const activeTask =
    nextPhases.flatMap((phase) => phase.tasks).find((task) => task.status === "in_progress") ??
    nextPhases.flatMap((phase) => phase.tasks).find((task) => task.status === "pending");
  if (!activeTask) {
    return null;
  }
  activeTask.status = "blocked";
  const existingDetails = optionalTrimmedString(activeTask.details);
  activeTask.details =
    existingDetails && existingDetails !== params.detail
      ? `${existingDetails}\n${params.detail}`
      : params.detail;
  return writePiTodoState({
    stateDir: params.stateDir,
    sessionId: params.sessionId,
    phases: nextPhases,
  });
}

function readPiTodoState(stateDir: string, sessionId: string): PiTodoState {
  const statePath = resolvePiTodoStatePath(stateDir, sessionId);
  let raw: string;
  try {
    raw = fs.readFileSync(statePath, "utf8");
  } catch {
    return emptyPiTodoState(sessionId);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyPiTodoState(sessionId);
  }
  if (!isRecord(parsed)) {
    return emptyPiTodoState(sessionId);
  }

  const normalizedSessionId = firstNonEmptyString(parsed.session_id, sessionId) ?? sessionId;
  let phases: PiTodoPhase[] = [];
  let nextTaskId = 1;

  if (Array.isArray(parsed.phases)) {
    for (const rawPhase of parsed.phases) {
      const normalized = normalizePersistedPiTodoPhase(rawPhase, `phase-${phases.length + 1}`, nextTaskId);
      nextTaskId = normalized.nextTaskId;
      if (normalized.phase) {
        phases.push(normalized.phase);
      }
    }
  } else if (Array.isArray(parsed.todos)) {
    phases = normalizeLegacyPiTodoPhases(parsed.todos);
  }

  normalizeInProgressPiTodoTask(phases);
  const computedIds = nextPiTodoIds(phases);
  return {
    version:
      typeof parsed.version === "number" && Number.isFinite(parsed.version)
        ? parsed.version
        : PI_TODO_STATE_VERSION,
    session_id: normalizedSessionId,
    updated_at: optionalTrimmedString(parsed.updated_at) ?? null,
    phases,
    next_task_id:
      typeof parsed.next_task_id === "number" && Number.isFinite(parsed.next_task_id)
        ? Math.max(parsed.next_task_id, computedIds.nextTaskId)
        : computedIds.nextTaskId,
    next_phase_id:
      typeof parsed.next_phase_id === "number" && Number.isFinite(parsed.next_phase_id)
        ? Math.max(parsed.next_phase_id, computedIds.nextPhaseId)
        : computedIds.nextPhaseId,
  };
}

function writePiTodoState(params: { stateDir: string; sessionId: string; phases: PiTodoPhase[] }): PiTodoState {
  const statePath = resolvePiTodoStatePath(params.stateDir, params.sessionId);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const phases = clonePiTodoPhases(params.phases);
  normalizeInProgressPiTodoTask(phases);
  const ids = nextPiTodoIds(phases);
  const nextState: PiTodoState = {
    version: PI_TODO_STATE_VERSION,
    session_id: params.sessionId,
    updated_at: new Date().toISOString(),
    phases,
    next_task_id: ids.nextTaskId,
    next_phase_id: ids.nextPhaseId,
  };
  const tempPath = `${statePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, statePath);
  return nextState;
}

function parsePiTodoInputTask(value: unknown, fallbackId: string): PiTodoItem {
  if (!isRecord(value)) {
    throw new Error("Todo task entries must be objects.");
  }
  const content = optionalTrimmedString(value.content);
  if (!content) {
    if (optionalTrimmedString(value.title)) {
      throw new Error("Todo tasks require `content`; use `content` instead of `title`.");
    }
    throw new Error("Todo tasks require a non-empty `content`.");
  }
  const status = value.status === undefined ? "pending" : normalizePiTodoStatus(value.status);
  if (!status) {
    throw new Error(`Unsupported todo status: ${String(value.status)}`);
  }
  const notes = optionalTrimmedString(value.notes) ?? undefined;
  const details = optionalTrimmedString(value.details) ?? undefined;
  const id = firstNonEmptyString(value.id, fallbackId) ?? fallbackId;
  return {
    id,
    content,
    status,
    ...(notes ? { notes } : {}),
    ...(details ? { details } : {}),
  };
}

function buildPiTodoPhaseFromInput(
  value: unknown,
  phaseId: string,
  nextTaskId: number
): { phase: PiTodoPhase; nextTaskId: number } {
  if (!isRecord(value)) {
    throw new Error("Todo phases must be objects.");
  }
  const name = optionalTrimmedString(value.name);
  if (!name) {
    if (optionalTrimmedString(value.title)) {
      throw new Error("Todo phases require `name`; use `name` instead of `title`.");
    }
    throw new Error("Todo phases require a non-empty `name`.");
  }
  const tasks: PiTodoItem[] = [];
  let localNextTaskId = nextTaskId;
  const rawTasks = Array.isArray(value.tasks) ? value.tasks : [];
  for (const rawTask of rawTasks) {
    tasks.push(parsePiTodoInputTask(rawTask, `task-${localNextTaskId}`));
    localNextTaskId += 1;
  }
  return {
    phase: {
      id: firstNonEmptyString(value.id, phaseId) ?? phaseId,
      name,
      tasks,
    },
    nextTaskId: localNextTaskId,
  };
}

function parsePiTodoWriteOps(toolParams: unknown): Array<Record<string, unknown>> {
  if (!isRecord(toolParams) || !Array.isArray(toolParams.ops)) {
    throw new Error("Todo Write requires an `ops` array.");
  }
  if (toolParams.ops.length === 0) {
    throw new Error("Todo Write requires at least one op.");
  }
  return toolParams.ops.map((op) => {
    if (!isRecord(op)) {
      throw new Error("Todo ops must be objects.");
    }
    return op;
  });
}

function piTodoWriteRepairError(op: Record<string, unknown>): Error {
  const opName = firstNonEmptyString(op.op);
  const baseLines = [
    `Unsupported todo op ${opName ? `"${opName}"` : '"<missing>"'}.`,
    `Valid \`op\` values are exactly ${PI_TODO_WRITE_OPS_TEXT}.`,
    PI_TODO_WRITE_ALIAS_WARNING,
  ];

  if (opName === "set_status" || opName === "update_task") {
    return new Error(
      [
        ...baseLines,
        "Use `update` to change an existing task's status by task id.",
        "Example:",
        '{"ops":[{"op":"update","id":"task-1","status":"completed"}]}',
        "Call `todoread` first if you need the current task ids.",
      ].join("\n")
    );
  }

  if (opName === "replace_all") {
    return new Error(
      [
        ...baseLines,
        "Use `replace` to replace the entire phased plan.",
        "Example:",
        '{"ops":[{"op":"replace","phases":[{"name":"Phase name","tasks":[{"content":"Task text"}]}]}]}',
      ].join("\n")
    );
  }

  return new Error(
    [
      ...baseLines,
      "Use `replace` for a full plan rewrite, `add_phase` to append a phase, `add_task` to append a task, `update` to modify an existing task by id, or `remove_task` to delete a task by id.",
    ].join("\n")
  );
}

function findPiTodoTask(phases: PiTodoPhase[], id: string): PiTodoItem | undefined {
  for (const phase of phases) {
    const task = phase.tasks.find((entry) => entry.id === id);
    if (task) {
      return task;
    }
  }
  return undefined;
}

function applyPiTodoOps(
  currentState: PiTodoState,
  ops: Array<Record<string, unknown>>
): { phases: PiTodoPhase[]; nextTaskId: number; nextPhaseId: number } {
  const nextState = {
    phases: clonePiTodoPhases(currentState.phases),
    nextTaskId: currentState.next_task_id,
    nextPhaseId: currentState.next_phase_id,
  };

  for (const op of ops) {
    const opName = firstNonEmptyString(op.op);
    switch (opName) {
      case "replace": {
        if (!Array.isArray(op.phases)) {
          throw new Error("Todo replace requires a `phases` array.");
        }
        nextState.phases = [];
        nextState.nextTaskId = 1;
        nextState.nextPhaseId = 1;
        for (const rawPhase of op.phases) {
          const built = buildPiTodoPhaseFromInput(rawPhase, `phase-${nextState.nextPhaseId}`, nextState.nextTaskId);
          nextState.nextPhaseId += 1;
          nextState.nextTaskId = built.nextTaskId;
          nextState.phases.push(built.phase);
        }
        break;
      }
      case "add_phase": {
        const built = buildPiTodoPhaseFromInput(op, `phase-${nextState.nextPhaseId}`, nextState.nextTaskId);
        nextState.nextPhaseId += 1;
        nextState.nextTaskId = built.nextTaskId;
        nextState.phases.push(built.phase);
        break;
      }
      case "add_task": {
        const phaseId = firstNonEmptyString(op.phase);
        if (!phaseId) {
          throw new Error("Todo add_task requires a `phase` id.");
        }
        const phase = nextState.phases.find((entry) => entry.id === phaseId);
        if (!phase) {
          throw new Error(`Todo phase "${phaseId}" was not found.`);
        }
        phase.tasks.push(parsePiTodoInputTask(op, `task-${nextState.nextTaskId}`));
        nextState.nextTaskId += 1;
        break;
      }
      case "update": {
        const taskId = firstNonEmptyString(op.id);
        if (!taskId) {
          throw new Error("Todo update requires an `id`.");
        }
        const task = findPiTodoTask(nextState.phases, taskId);
        if (!task) {
          throw new Error(`Todo task "${taskId}" was not found.`);
        }
        if (op.status !== undefined) {
          const status = normalizePiTodoStatus(op.status);
          if (!status) {
            throw new Error(`Unsupported todo status: ${String(op.status)}`);
          }
          task.status = status;
        }
        if (Object.prototype.hasOwnProperty.call(op, "content")) {
          const content = optionalTrimmedString(op.content);
          if (!content) {
            throw new Error("Todo update requires a non-empty `content` when provided.");
          }
          task.content = content;
        }
        if (Object.prototype.hasOwnProperty.call(op, "notes")) {
          const notes = optionalTrimmedString(op.notes);
          if (notes) {
            task.notes = notes;
          } else {
            delete task.notes;
          }
        }
        if (Object.prototype.hasOwnProperty.call(op, "details")) {
          const details = optionalTrimmedString(op.details);
          if (details) {
            task.details = details;
          } else {
            delete task.details;
          }
        }
        break;
      }
      case "remove_task": {
        const taskId = firstNonEmptyString(op.id);
        if (!taskId) {
          throw new Error("Todo remove_task requires an `id`.");
        }
        let removed = false;
        for (const phase of nextState.phases) {
          const taskIndex = phase.tasks.findIndex((task) => task.id === taskId);
          if (taskIndex === -1) {
            continue;
          }
          phase.tasks.splice(taskIndex, 1);
          removed = true;
          break;
        }
        if (!removed) {
          throw new Error(`Todo task "${taskId}" was not found.`);
        }
        break;
      }
      default:
        throw piTodoWriteRepairError(op);
    }
    normalizeInProgressPiTodoTask(nextState.phases);
  }

  return nextState;
}

function currentPiTodoPhaseIndex(phases: PiTodoPhase[]): number {
  const currentIndex = phases.findIndex((phase) =>
    phase.tasks.some(
      (task) =>
        task.status === "pending" ||
        task.status === "in_progress" ||
        task.status === "blocked"
    )
  );
  if (currentIndex !== -1) {
    return currentIndex;
  }
  return phases.length === 0 ? -1 : phases.length - 1;
}

function formatPiTodoMarker(status: PiTodoStatus): string {
  switch (status) {
    case "completed":
      return "[x]";
    case "in_progress":
      return "[>]";
    case "blocked":
      return "[!]";
    case "abandoned":
      return "[-]";
    default:
      return "[ ]";
  }
}

function formatPiTodoListText(phases: PiTodoPhase[]): string {
  const taskCount = countPiTodoTasks(phases);
  if (taskCount === 0) {
    return "No todo items are currently recorded for this session.";
  }

  const lines = [
    `Current session todo plan (${taskCount} task${taskCount === 1 ? "" : "s"} across ${phases.length} phase${phases.length === 1 ? "" : "s"}):`,
  ];
  for (const [index, phase] of phases.entries()) {
    const completedTasks = phase.tasks.filter(
      (task) => task.status === "completed" || task.status === "abandoned"
    ).length;
    lines.push(`Phase ${index + 1}/${phases.length} "${phase.name}" - ${completedTasks}/${phase.tasks.length} complete`);
    for (const task of phase.tasks) {
      lines.push(`  ${formatPiTodoMarker(task.status)} ${task.id} ${task.content}`);
      if ((task.status === "in_progress" || task.status === "blocked") && task.details) {
        for (const detailLine of task.details.split("\n")) {
          lines.push(`      ${detailLine}`);
        }
      }
    }
  }
  return lines.join("\n");
}

function formatPiTodoWriteText(nextState: PiTodoState): string {
  const taskCount = countPiTodoTasks(nextState.phases);
  if (taskCount === 0) {
    return "Todo plan cleared.";
  }

  const incomplete = nextState.phases.flatMap((phase) =>
    phase.tasks
      .filter(
        (task) =>
          task.status === "pending" ||
          task.status === "in_progress" ||
          task.status === "blocked"
      )
      .map((task) => ({ ...task, phaseName: phase.name }))
  );
  const currentPhaseIndex = currentPiTodoPhaseIndex(nextState.phases);
  const lines = [
    `Updated todo plan with ${taskCount} task${taskCount === 1 ? "" : "s"} across ${nextState.phases.length} phase${nextState.phases.length === 1 ? "" : "s"}.`,
  ];

  if (incomplete.length === 0) {
    lines.push("Remaining items: none.");
  } else {
    lines.push(`Remaining items (${incomplete.length}):`);
    for (const task of incomplete) {
      lines.push(`  - ${task.id} ${task.content} [${task.status}] (${task.phaseName})`);
      if ((task.status === "in_progress" || task.status === "blocked") && task.details) {
        for (const detailLine of task.details.split("\n")) {
          lines.push(`      ${detailLine}`);
        }
      }
    }
  }

  if (currentPhaseIndex !== -1) {
    const currentPhase = nextState.phases[currentPhaseIndex];
    const completedTasks = currentPhase.tasks.filter(
      (task) => task.status === "completed" || task.status === "abandoned"
    ).length;
    lines.push(`Current phase: ${currentPhase.name} (${completedTasks}/${currentPhase.tasks.length} complete).`);
  }

  lines.push("");
  lines.push(formatPiTodoListText(nextState.phases));
  return lines.join("\n");
}

function todoReadParametersSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
}

function todoWriteParametersSchema(): Record<string, unknown> {
  return {
    type: "object",
    description:
      `Update the session todo plan with explicit mutations. Valid \`op\` values are exactly ${PI_TODO_WRITE_OPS_TEXT}. ${PI_TODO_WRITE_ALIAS_WARNING}`,
    properties: {
      ops: {
        type: "array",
        description:
          `Incremental phased todo operations over the current session plan. Valid \`op\` values are exactly ${PI_TODO_WRITE_OPS_TEXT}. Use \`name\` for phase titles and \`content\` for task text.`,
        items: {
          anyOf: [
            {
              type: "object",
              description:
                "Replace the entire phased plan. Use this to create the initial plan or rewrite the whole plan, not for a single task status change.",
              properties: {
                op: {
                  const: "replace",
                  description: "Replace the entire phased plan.",
                },
                phases: {
                  type: "array",
                  description: "Full replacement list of phases. Each phase requires `name`; each task requires `content`.",
                  items: {
                    type: "object",
                    description: "Phase object for a full-plan replacement. Use `name`, not `title`.",
                    properties: {
                      name: {
                        type: "string",
                        description: "Human-readable phase title.",
                      },
                      tasks: {
                        type: "array",
                        description: "Task objects for this phase. Use `content`, not `title`.",
                        items: {
                          type: "object",
                          description: "Task object. Use `content` as the task text.",
                          properties: {
                            content: {
                              type: "string",
                              description: "Required task text.",
                            },
                            status: {
                              type: "string",
                              enum: [...PI_TODO_STATUSES],
                              description: "Optional task status.",
                            },
                            notes: {
                              type: "string",
                              description: "Short note for the task.",
                            },
                            details: {
                              type: "string",
                              description: "Longer supporting detail for the task.",
                            },
                          },
                          required: ["content"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["name"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["op", "phases"],
              additionalProperties: false,
            },
            {
              type: "object",
              description: "Append a new phase to the current plan.",
              properties: {
                op: {
                  const: "add_phase",
                  description: "Append a new phase to the current plan.",
                },
                name: {
                  type: "string",
                  description: "Human-readable phase title.",
                },
                tasks: {
                  type: "array",
                  description: "Optional initial tasks for the new phase.",
                  items: {
                    type: "object",
                    description: "Task object. Use `content` as the task text.",
                    properties: {
                      content: {
                        type: "string",
                        description: "Required task text.",
                      },
                      status: {
                        type: "string",
                        enum: [...PI_TODO_STATUSES],
                        description: "Optional task status.",
                      },
                      notes: {
                        type: "string",
                        description: "Short note for the task.",
                      },
                      details: {
                        type: "string",
                        description: "Longer supporting detail for the task.",
                      },
                    },
                    required: ["content"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["op", "name"],
              additionalProperties: false,
            },
            {
              type: "object",
              description: "Append a new task to an existing phase by phase id.",
              properties: {
                op: {
                  const: "add_task",
                  description: "Append a new task to an existing phase by phase id.",
                },
                phase: {
                  type: "string",
                  description: "Existing phase id from `todoread` or a prior `todowrite` result, for example `phase-2`.",
                },
                content: {
                  type: "string",
                  description: "Required task text.",
                },
                status: {
                  type: "string",
                  enum: [...PI_TODO_STATUSES],
                  description: "Optional task status.",
                },
                notes: {
                  type: "string",
                  description: "Short note for the task.",
                },
                details: {
                  type: "string",
                  description: "Longer supporting detail for the task.",
                },
              },
              required: ["op", "phase", "content"],
              additionalProperties: false,
            },
            {
              type: "object",
              description:
                "Update an existing task by task id. Use this for status changes, content edits, notes, or details.",
              properties: {
                op: {
                  const: "update",
                  description: "Update an existing task by task id. Use this for status changes.",
                },
                id: {
                  type: "string",
                  description: "Existing task id from `todoread` or a prior `todowrite` result, for example `task-3`.",
                },
                status: {
                  type: "string",
                  enum: [...PI_TODO_STATUSES],
                  description: "New task status when changing status.",
                },
                content: {
                  type: "string",
                  description: "Replacement task text.",
                },
                notes: {
                  type: "string",
                  description: "Replacement short note for the task.",
                },
                details: {
                  type: "string",
                  description: "Replacement longer supporting detail for the task.",
                },
              },
              required: ["op", "id"],
              additionalProperties: false,
            },
            {
              type: "object",
              description: "Remove a single task by task id.",
              properties: {
                op: {
                  const: "remove_task",
                  description: "Remove a single task by task id.",
                },
                id: {
                  type: "string",
                  description: "Existing task id from `todoread` or a prior `todowrite` result.",
                },
              },
              required: ["op", "id"],
              additionalProperties: false,
            },
            {
              type: "object",
              description:
                "Fallback validation branch for malformed todo ops so the tool can return a repair hint. Do not rely on this shape.",
              properties: {
                op: { type: "string" },
                id: { type: "string" },
                phase: { type: "string" },
                name: { type: "string" },
                title: { type: "string" },
                content: { type: "string" },
                status: { type: "string" },
                notes: { type: "string" },
                details: { type: "string" },
                phases: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      title: { type: "string" },
                      tasks: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            content: { type: "string" },
                            title: { type: "string" },
                            status: { type: "string" },
                            notes: { type: "string" },
                            details: { type: "string" },
                          },
                          additionalProperties: false,
                        },
                      },
                    },
                    additionalProperties: false,
                  },
                },
              },
              required: ["op"],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ["ops"],
    additionalProperties: false,
  };
}

export function createPiTodoToolDefinitions(params: { stateDir: string; sessionId: string }): ToolDefinition[] {
  const readDefinition: ToolDefinition = {
    name: "todoread",
    label: "Todo Read",
    description:
      "Read the current phased todo plan for this session, including the phase ids and task ids needed for later `todowrite` calls.",
    parameters: todoReadParametersSchema() as never,
    promptSnippet:
      "todoread: Read the current phased todo plan for this session and recover the phase/task ids needed for later `todowrite` mutations.",
    promptGuidelines: [
      "Use todoread before changing an existing phased plan when current todo state may matter.",
      "When resuming a session that already has todo state, call todoread before continuing that plan if you need the current phase/task ids.",
      "Use todoread to recover the exact phase ids and task ids before calling `update`, `add_task`, or `remove_task` on an existing plan.",
      "Treat the user's newest message as the primary instruction for the current turn.",
      "If the user's newest message clearly asks to continue the unfinished plan or clearly advances it, resume the plan after reading it.",
      "If the user's newest message is conversational, brief, acknowledges prior progress, or is otherwise ambiguous about continuation, respond first and ask whether they want to continue before resuming the unfinished plan.",
      "After reading an existing todo that the user has clearly asked you to continue, keep executing it until the recorded work is complete or genuinely blocked.",
      "Once the user has clearly asked you to continue an unfinished plan, do not stop only to give progress updates or ask whether to continue while executable todo items remain.",
      "If the user's newest message is clearly unrelated to the unfinished todo, preserve that todo as unfinished, handle the new request first, and then propose continuing the unfinished work.",
    ],
    execute: async (_toolCallId, _toolParams, signal) => {
      if (signal?.aborted) {
        throw new Error("Todo Read aborted before execution");
      }
      const state = readPiTodoState(params.stateDir, params.sessionId);
      const todoCount = countPiTodoTasks(state.phases);
      return {
        content: [{ type: "text", text: formatPiTodoListText(state.phases) }],
        details: {
          invocation_type: "todo_read",
          session_id: state.session_id,
          updated_at: state.updated_at,
          phase_count: state.phases.length,
          task_count: todoCount,
          todo_count: todoCount,
          phases: state.phases,
          todos: flattenPiTodoSummaries(state.phases),
        },
      };
    },
  };

  const writeDefinition: ToolDefinition = {
    name: "todowrite",
    label: "Todo Write",
    description:
      `Update the current phased todo plan for this session. Valid \`op\` values are exactly ${PI_TODO_WRITE_OPS_TEXT}.`,
    parameters: todoWriteParametersSchema() as never,
    promptSnippet:
      `todowrite: Update the current phased todo plan for this session using only these \`op\` values: ${PI_TODO_WRITE_OPS_TEXT}.`,
    promptGuidelines: [
      "Use todowrite for complex or long-running tasks that benefit from an explicit phased plan.",
      "The top-level phases are grouped tasks, and each phase's `tasks` entries are the actionable task items within that grouped task.",
      "Treat the user's newest message as the primary instruction for the current turn even when an unfinished todo already exists.",
      "When the user has clearly asked you to continue an unfinished todo, keep executing it until the recorded work is complete or genuinely blocked.",
      "If the user's newest message is conversational, brief, acknowledges prior progress, or is otherwise ambiguous about continuation, respond directly and ask whether they want to continue instead of auto-resuming the unfinished todo.",
      "Once the user has clearly asked you to continue an unfinished todo, do not stop only to give progress updates or ask whether to continue while executable todo items remain.",
      "If a new user message clearly redirects to unrelated work, do that work first without marking the existing unfinished todo complete, then propose resuming the unfinished work afterward.",
      `Valid \`op\` values are exactly ${PI_TODO_WRITE_OPS_TEXT}.`,
      PI_TODO_WRITE_ALIAS_WARNING,
      "Use `replace` only for the initial plan or a full rewrite of the entire plan, not for a single task status change.",
      "Use `update` to change an existing task's status, content, notes, or details by task id.",
      "Use `add_phase` to append a new phase, `add_task` to append a task to an existing phase by phase id, and `remove_task` to delete a task by task id.",
      "Use `name` for phase titles and `content` for task text; do not use `title` for either.",
      "On an existing plan, call `todoread` first so you have the current phase ids and task ids before writing mutations.",
      "Keep exactly one task `in_progress` whenever unfinished tasks remain unless the current task is blocked on user input or another external dependency.",
    ],
    execute: async (_toolCallId, toolParams, signal) => {
      if (signal?.aborted) {
        throw new Error("Todo Write aborted before execution");
      }
      const previousState = readPiTodoState(params.stateDir, params.sessionId);
      const ops = parsePiTodoWriteOps(toolParams);
      const nextPlan = applyPiTodoOps(previousState, ops);
      const nextState = writePiTodoState({
        stateDir: params.stateDir,
        sessionId: params.sessionId,
        phases: nextPlan.phases,
      });
      const previousTodoCount = countPiTodoTasks(previousState.phases);
      const nextTodoCount = countPiTodoTasks(nextState.phases);
      return {
        content: [{ type: "text", text: formatPiTodoWriteText(nextState) }],
        details: {
          invocation_type: "todo_write",
          session_id: nextState.session_id,
          updated_at: nextState.updated_at,
          previous_phase_count: previousState.phases.length,
          phase_count: nextState.phases.length,
          previous_task_count: previousTodoCount,
          task_count: nextTodoCount,
          previous_todo_count: previousTodoCount,
          todo_count: nextTodoCount,
          phases: nextState.phases,
          todos: flattenPiTodoSummaries(nextState.phases),
        },
      };
    },
  };

  return [readDefinition, writeDefinition];
}

function normalizedWorkspaceDir(workspaceDir: string): { resolved: string; real: string } {
  const resolved = path.resolve(workspaceDir);
  try {
    return { resolved, real: fs.realpathSync(resolved) };
  } catch {
    return { resolved, real: resolved };
  }
}

function isPathInsideWorkspaceRoot(workspaceRealDir: string, candidatePath: string): boolean {
  const normalizedRoot = path.resolve(workspaceRealDir);
  const normalizedCandidate = path.resolve(candidatePath);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolvePathWithinWorkspace(
  policy: Pick<PiWorkspaceBoundaryPolicy, "workspaceDir" | "workspaceRealDir">,
  candidate: string
): string | null {
  const raw = candidate.trim();
  if (!raw) {
    return null;
  }
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(policy.workspaceDir, raw);
  let canonical = resolved;
  try {
    canonical = fs.realpathSync(resolved);
  } catch {
    canonical = resolved;
  }
  return isPathInsideWorkspaceRoot(policy.workspaceRealDir, canonical) ? canonical : null;
}

export function workspaceBoundaryOverrideRequested(instruction: string): boolean {
  const normalized = instruction.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    /(?:workspace[_ -]?boundary[_ -]?override\s*[:=]\s*(?:1|true|yes|on))|(?:#allow-outside-workspace)/i.test(
      normalized
    )
  ) {
    return true;
  }
  const insist = /\b(i insist|insist|override|must)\b/i.test(normalized);
  const outsideScope =
    /\b(outside (?:the )?workspace|outside workspace|cross[- ]workspace|parent directory|external path|beyond (?:the )?workspace)\b/i.test(
      normalized
    ) || /(?:\.\.\/|~\/|\/users\/|\/etc\/|\/var\/)/i.test(normalized);
  return insist && outsideScope;
}

function createWorkspaceBoundaryPolicy(workspaceDir: string, overrideRequested: boolean): PiWorkspaceBoundaryPolicy {
  const normalized = normalizedWorkspaceDir(workspaceDir);
  return {
    workspaceDir: normalized.resolved,
    workspaceRealDir: normalized.real,
    overrideRequested,
  };
}

function commandTokens(command: string): string[] {
  const tokens: string[] = [];
  const tokenPattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`|(\S+)/g;
  let match: RegExpExecArray | null = tokenPattern.exec(command);
  while (match) {
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    const trimmed = value.trim();
    if (trimmed) {
      tokens.push(trimmed);
    }
    match = tokenPattern.exec(command);
  }
  return tokens;
}

function pathCandidatesFromCommandToken(token: string): string[] {
  const candidates = new Set<string>();
  const normalized = token.trim();
  if (!normalized) {
    return [];
  }
  candidates.add(normalized);

  const assignmentIndex = normalized.indexOf("=");
  if (assignmentIndex >= 0 && assignmentIndex < normalized.length - 1) {
    candidates.add(normalized.slice(assignmentIndex + 1));
  }

  if (normalized.startsWith("--")) {
    const pathMatch = normalized.match(/^--(?:cwd|directory|dir|path|file|root)=(.+)$/i);
    if (pathMatch?.[1]) {
      candidates.add(pathMatch[1]);
    }
  }
  return [...candidates];
}

function commandPathLooksExternal(pathValue: string): boolean {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return false;
  }
  if (trimmed === ".." || trimmed.startsWith("../") || trimmed.includes("/../") || trimmed.includes("\\..\\")) {
    return true;
  }
  if (trimmed.startsWith("~")) {
    return true;
  }
  return false;
}

function commandBoundaryViolation(command: string, policy: PiWorkspaceBoundaryPolicy): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }
  if (policy.overrideRequested) {
    return null;
  }

  const tokens = commandTokens(trimmed);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const normalized = token.toLowerCase();
    if (normalized === "cd") {
      const destination = tokens[index + 1] ?? "";
      if (commandPathLooksExternal(destination)) {
        return `command uses external directory '${destination}'`;
      }
      const resolved = resolvePathWithinWorkspace(policy, destination);
      if (destination.trim() && !resolved) {
        return `command changes directory outside workspace: '${destination}'`;
      }
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      continue;
    }
  }
  return null;
}

function workspaceBoundaryViolationForCommand(command: string, policy: PiWorkspaceBoundaryPolicy): string | null {
  const trimmed = command.trim();
  if (!trimmed || policy.overrideRequested) {
    return null;
  }

  const baselineViolation = commandBoundaryViolation(trimmed, policy);
  if (baselineViolation) {
    return baselineViolation;
  }

  const tokens = commandTokens(trimmed);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const normalized = token.toLowerCase();

    if (normalized === "cd") {
      const destination = tokens[index + 1] ?? "";
      if (commandPathLooksExternal(destination)) {
        return `command uses external directory '${destination}'`;
      }
      const resolved = resolvePathWithinWorkspace(policy, destination);
      if (destination.trim() && !resolved) {
        return `command changes directory outside workspace: '${destination}'`;
      }
      continue;
    }

    if (normalized === "git" && (tokens[index + 1] ?? "").toLowerCase() === "-c") {
      const repositoryRoot = tokens[index + 2] ?? "";
      if (!repositoryRoot.trim()) {
        continue;
      }
      if (commandPathLooksExternal(repositoryRoot)) {
        return `git command points outside workspace: '${repositoryRoot}'`;
      }
      if (!resolvePathWithinWorkspace(policy, repositoryRoot)) {
        return `git command points outside workspace: '${repositoryRoot}'`;
      }
      continue;
    }

    for (const candidate of pathCandidatesFromCommandToken(token)) {
      if (!candidate) {
        continue;
      }
      if (commandPathLooksExternal(candidate)) {
        return `command references outside-workspace path '${candidate}'`;
      }
      const hasPathSignal =
        path.isAbsolute(candidate) ||
        candidate.includes("/") ||
        candidate.includes("\\") ||
        candidate.startsWith(".");
      if (!hasPathSignal) {
        continue;
      }
      if (!resolvePathWithinWorkspace(policy, candidate)) {
        return `command references outside-workspace path '${candidate}'`;
      }
    }
  }
  return null;
}

function workspacePathViolationForValue(
  value: string,
  pathRef: string,
  policy: PiWorkspaceBoundaryPolicy
): string | null {
  const trimmed = value.trim();
  if (!trimmed || policy.overrideRequested) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return null;
  }
  if (commandPathLooksExternal(trimmed)) {
    return `${pathRef} points outside workspace: '${trimmed}'`;
  }
  if (!resolvePathWithinWorkspace(policy, trimmed)) {
    return `${pathRef} points outside workspace: '${trimmed}'`;
  }
  return null;
}

export function workspaceBoundaryViolationForToolCall(params: {
  toolName: string;
  toolParams: unknown;
  policy: PiWorkspaceBoundaryPolicy;
}): string | null {
  const normalizedToolName = params.toolName.trim().toLowerCase();
  if (!normalizedToolName) {
    return null;
  }
  if (!shouldEnforceWorkspaceBoundaryForTool(normalizedToolName)) {
    return null;
  }
  if (params.policy.overrideRequested) {
    return null;
  }
  if (!isRecord(params.toolParams)) {
    return null;
  }

  const queue: Array<{ value: unknown; ref: string }> = [{ value: params.toolParams, ref: "params" }];
  while (queue.length > 0) {
    const current = queue.shift() as { value: unknown; ref: string };
    if (Array.isArray(current.value)) {
      current.value.forEach((entry, index) => queue.push({ value: entry, ref: `${current.ref}[${index}]` }));
      continue;
    }
    if (!isRecord(current.value)) {
      continue;
    }

    for (const [key, value] of Object.entries(current.value)) {
      const childRef = `${current.ref}.${key}`;
      if (typeof value === "string") {
        if (TOOL_COMMAND_KEY_PATTERN.test(key)) {
          const violation = workspaceBoundaryViolationForCommand(value, params.policy);
          if (violation) {
            return violation;
          }
        }
        if (WORKSPACE_PATH_KEY_PATTERN.test(key)) {
          const violation = workspacePathViolationForValue(value, childRef, params.policy);
          if (violation) {
            return violation;
          }
        }
      } else if (value && typeof value === "object") {
        queue.push({ value, ref: childRef });
      }
    }
  }

  return null;
}

function skillIdFromFilePath(filePath: string): string {
  const parsed = path.parse(filePath);
  if (parsed.base.toLowerCase() === "skill.md") {
    return path.basename(path.dirname(filePath));
  }
  return parsed.name;
}

function markdownFrontmatterBlock(value: string): string | null {
  const normalized = value.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match?.[1] ?? null;
}

function normalizeGrantedToolName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseInlineStringList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const bracketMatch = trimmed.match(/^\[([\s\S]*?)\]$/);
  const body = bracketMatch ? bracketMatch[1] ?? "" : trimmed;
  return body
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .map((item) => normalizeGrantedToolName(item))
    .filter((item): item is string => Boolean(item));
}

function parseFrontmatterStringList(frontmatter: string, keyName: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  const escapedKey = keyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyPattern = new RegExp(`^\\s*${escapedKey}\\s*:\\s*(.*)$`, "i");
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index] ?? "";
    const match = current.match(keyPattern);
    if (!match) {
      continue;
    }
    const inlineValue = (match[1] ?? "").trim();
    if (inlineValue.length > 0) {
      return parseInlineStringList(inlineValue);
    }
    const collected: string[] = [];
    for (let lookahead = index + 1; lookahead < lines.length; lookahead += 1) {
      const candidate = lines[lookahead] ?? "";
      if (!candidate.trim()) {
        if (collected.length > 0) {
          break;
        }
        continue;
      }
      const itemMatch = candidate.match(/^\s*-\s*(.+?)\s*$/);
      if (!itemMatch) {
        break;
      }
      const normalized = normalizeGrantedToolName(itemMatch[1]?.replace(/^['"]|['"]$/g, ""));
      if (normalized) {
        collected.push(normalized);
      }
    }
    return collected;
  }
  return [];
}

function parseHolabossNestedStringList(frontmatter: string, nestedKeyNames: string[]): string[] {
  const lines = frontmatter.split(/\r?\n/);
  let holabossStart = -1;
  let holabossIndent = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(/^(\s*)holaboss\s*:\s*$/i);
    if (!match) {
      continue;
    }
    holabossStart = index + 1;
    holabossIndent = match[1]?.length ?? 0;
    break;
  }
  if (holabossStart < 0) {
    return [];
  }

  const nestedLines: string[] = [];
  for (let index = holabossStart; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      nestedLines.push(line);
      continue;
    }
    const indent = line.match(/^\s*/)?.[0]?.length ?? 0;
    if (indent <= holabossIndent) {
      break;
    }
    nestedLines.push(line.slice(holabossIndent + 2));
  }

  const nestedFrontmatter = nestedLines.join("\n");
  for (const nestedKey of nestedKeyNames) {
    const parsed = parseFrontmatterStringList(nestedFrontmatter, nestedKey);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [];
}

function parseGrantedToolsFromSkillFrontmatter(frontmatter: string | null): string[] {
  if (!frontmatter) {
    return [];
  }
  const directKeys = [
    "holaboss_granted_tools",
    "holaboss-granted-tools",
    "holaboss_tools",
    "holaboss-tools",
    "capability_grants",
    "capability-grants",
  ];
  for (const key of directKeys) {
    const parsed = parseFrontmatterStringList(frontmatter, key);
    if (parsed.length > 0) {
      return [...new Set(parsed)];
    }
  }
  const nested = parseHolabossNestedStringList(frontmatter, ["granted_tools", "granted-tools", "tools"]);
  if (nested.length > 0) {
    return [...new Set(nested)];
  }
  return [];
}

function normalizeWorkspaceCommandId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseGrantedCommandsFromSkillFrontmatter(frontmatter: string | null): string[] {
  if (!frontmatter) {
    return [];
  }
  const directKeys = [
    "holaboss_granted_commands",
    "holaboss-granted-commands",
    "holaboss_commands",
    "holaboss-commands",
    "command_grants",
    "command-grants",
  ];
  for (const key of directKeys) {
    const parsed = parseFrontmatterStringList(frontmatter, key)
      .map((commandId) => normalizeWorkspaceCommandId(commandId))
      .filter((commandId): commandId is string => Boolean(commandId));
    if (parsed.length > 0) {
      return [...new Set(parsed)];
    }
  }
  const nested = parseHolabossNestedStringList(frontmatter, ["granted_commands", "granted-commands", "commands"])
    .map((commandId) => normalizeWorkspaceCommandId(commandId))
    .filter((commandId): commandId is string => Boolean(commandId));
  if (nested.length > 0) {
    return [...new Set(nested)];
  }
  return [];
}

function workspaceCommandIdsFromRunStartedPayload(payload: JsonObject): string[] {
  const raw = Array.isArray(payload.workspace_command_ids) ? payload.workspace_command_ids : [];
  return [...new Set(raw.map((commandId) => normalizeWorkspaceCommandId(commandId)).filter((commandId): commandId is string => Boolean(commandId)))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function uniqueSkillMetadata(skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>): PiSkillMetadata[] {
  const bySkillId = new Map<string, PiSkillMetadata>();
  for (const metadata of skillMetadataByAlias.values()) {
    if (!bySkillId.has(metadata.skillId)) {
      bySkillId.set(metadata.skillId, metadata);
    }
  }
  return [...bySkillId.values()].sort((left, right) => left.skillId.localeCompare(right.skillId));
}

function createPiSkillWideningState(
  skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>,
  availableToolNames: string[],
  availableCommandIds: string[]
): PiSkillWideningState {
  const available = new Set(availableToolNames.map((toolName) => toolName.trim().toLowerCase()).filter(Boolean));
  const availableCommands = new Set(availableCommandIds.map((commandId) => commandId.trim().toLowerCase()).filter(Boolean));
  const skillIdsByManagedToolMutable = new Map<string, Set<string>>();
  const skillIdsByManagedCommandMutable = new Map<string, Set<string>>();
  for (const metadata of uniqueSkillMetadata(skillMetadataByAlias)) {
    for (const toolName of metadata.grantedTools) {
      if (!available.has(toolName) || toolName === "skill") {
        continue;
      }
      const skillIds = skillIdsByManagedToolMutable.get(toolName) ?? new Set<string>();
      skillIds.add(metadata.skillId);
      skillIdsByManagedToolMutable.set(toolName, skillIds);
    }
    for (const commandId of metadata.grantedCommands) {
      if (!availableCommands.has(commandId)) {
        continue;
      }
      const skillIds = skillIdsByManagedCommandMutable.get(commandId) ?? new Set<string>();
      skillIds.add(metadata.skillId);
      skillIdsByManagedCommandMutable.set(commandId, skillIds);
    }
  }
  const skillIdsByManagedTool = new Map<string, ReadonlySet<string>>(
    [...skillIdsByManagedToolMutable.entries()].map(([toolName, skillIds]) => [toolName, new Set(skillIds)])
  );
  const skillIdsByManagedCommand = new Map<string, ReadonlySet<string>>(
    [...skillIdsByManagedCommandMutable.entries()].map(([commandId, skillIds]) => [commandId, new Set(skillIds)])
  );
  return {
    scope: "run",
    managedToolNames: new Set(skillIdsByManagedTool.keys()),
    grantedToolNames: new Set(),
    skillIdsByManagedTool,
    managedCommandIds: new Set(skillIdsByManagedCommand.keys()),
    grantedCommandIds: new Set(),
    skillIdsByManagedCommand,
  };
}

function requiredSkillIdsForTool(state: PiSkillWideningState, toolName: string): string[] {
  return [...(state.skillIdsByManagedTool.get(toolName) ?? new Set<string>())].sort((left, right) =>
    left.localeCompare(right)
  );
}

function applySkillWideningGrants(
  state: PiSkillWideningState,
  skillMetadata: PiSkillMetadata
): { grantedTools: string[]; grantedCommands: string[] } {
  const newlyGrantedTools: string[] = [];
  const newlyGrantedCommands: string[] = [];
  for (const toolName of skillMetadata.grantedTools) {
    if (!state.managedToolNames.has(toolName)) {
      continue;
    }
    if (!state.grantedToolNames.has(toolName)) {
      newlyGrantedTools.push(toolName);
    }
    state.grantedToolNames.add(toolName);
  }
  for (const commandId of skillMetadata.grantedCommands) {
    if (!state.managedCommandIds.has(commandId)) {
      continue;
    }
    if (!state.grantedCommandIds.has(commandId)) {
      newlyGrantedCommands.push(commandId);
    }
    state.grantedCommandIds.add(commandId);
  }
  return {
    grantedTools: newlyGrantedTools.sort((left, right) => left.localeCompare(right)),
    grantedCommands: newlyGrantedCommands.sort((left, right) => left.localeCompare(right)),
  };
}

function activeGrantedTools(state: PiSkillWideningState): string[] {
  return [...state.grantedToolNames].sort((left, right) => left.localeCompare(right));
}

function activeGrantedCommands(state: PiSkillWideningState): string[] {
  return [...state.grantedCommandIds].sort((left, right) => left.localeCompare(right));
}

function addSkillAlias(aliasMap: Map<string, PiSkillMetadata>, alias: unknown, metadata: PiSkillMetadata): void {
  const normalized = normalizeSkillLookupToken(alias);
  if (!normalized || aliasMap.has(normalized)) {
    return;
  }
  aliasMap.set(normalized, metadata);
}

function buildPiSkillMetadataByAlias(skills: Skill[]): Map<string, PiSkillMetadata> {
  const aliasMap = new Map<string, PiSkillMetadata>();
  for (const skill of skills) {
    const skillId = skillIdFromFilePath(skill.filePath);
    const rawSkillFile = fs.readFileSync(skill.filePath, "utf8");
    const frontmatter = markdownFrontmatterBlock(rawSkillFile);
    const grantedTools = parseGrantedToolsFromSkillFrontmatter(frontmatter);
    const grantedCommands = parseGrantedCommandsFromSkillFrontmatter(frontmatter);
    const metadata: PiSkillMetadata = {
      skillId,
      skillName: skill.name,
      filePath: skill.filePath,
      baseDir: skill.baseDir,
      grantedTools,
      grantedCommands,
    };
    addSkillAlias(aliasMap, skillId, metadata);
    addSkillAlias(aliasMap, skill.name, metadata);
  }
  return aliasMap;
}

function resolveSkillMetadata(
  skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>,
  requestedName: unknown
): PiSkillMetadata | null {
  const normalizedName = normalizeSkillLookupToken(requestedName);
  if (!normalizedName) {
    return null;
  }
  return skillMetadataByAlias.get(normalizedName) ?? null;
}

function uniqueSkillIds(skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>): string[] {
  return [...new Set([...skillMetadataByAlias.values()].map((metadata) => metadata.skillId))]
    .filter((value) => value.trim().length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function skillToolParametersSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Skill id or skill name to invoke.",
      },
      args: {
        type: "string",
        description: "Optional follow-up instructions appended after the invoked skill content.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  };
}

function createPiSkillToolDefinition(
  skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata>,
  skillWideningState: PiSkillWideningState,
  workspaceBoundaryPolicy: PiWorkspaceBoundaryPolicy
): ToolDefinition {
  return {
    name: "skill",
    label: "Skill",
    description: "Load a workspace skill by id or name and return its canonical skill block.",
    parameters: skillToolParametersSchema() as never,
    execute: async (_toolCallId, toolParams, signal) => {
      if (signal?.aborted) {
        throw new Error("Skill invocation aborted before execution");
      }
      const params = isRecord(toolParams) ? toolParams : {};
      const requestedName = optionalTrimmedString(params.name);
      if (!requestedName) {
        throw new Error("Skill invocation requires a non-empty `name` argument");
      }
      const resolvedSkill = resolveSkillMetadata(skillMetadataByAlias, requestedName);
      if (!resolvedSkill) {
        const availableSkills = uniqueSkillIds(skillMetadataByAlias);
        throw new Error(
          availableSkills.length > 0
            ? `Skill "${requestedName}" was not found. Available skills: ${availableSkills.join(", ")}`
            : `Skill "${requestedName}" was not found. No skills are currently available.`
        );
      }
      let body: string;
      try {
        body = stripMarkdownFrontmatter(fs.readFileSync(resolvedSkill.filePath, "utf8")).trim();
      } catch (error) {
        throw new Error(
          `Failed to load skill "${resolvedSkill.skillId}" from ${resolvedSkill.filePath}: ${sdkErrorMessage(
            error,
            "file read failed"
          )}`
        );
      }

      const skillBlock = `<skill name="${resolvedSkill.skillName}" location="${resolvedSkill.filePath}">\nReferences are relative to ${resolvedSkill.baseDir}.\n\n${body}\n</skill>`;
      const args = optionalTrimmedString(params.args);
      const wideningGrant = applySkillWideningGrants(skillWideningState, resolvedSkill);
      return {
        content: [{ type: "text", text: args ? `${skillBlock}\n\n${args}` : skillBlock }],
        details: {
          invocation_type: "skill",
          requested_name: requestedName,
          skill_id: resolvedSkill.skillId,
          skill_name: resolvedSkill.skillName,
          skill_file_path: resolvedSkill.filePath,
          skill_base_dir: resolvedSkill.baseDir,
          args: args ?? null,
          policy_widening: {
            scope: skillWideningState.scope,
            managed_tools: [...skillWideningState.managedToolNames].sort((left, right) => left.localeCompare(right)),
            granted_tools: wideningGrant.grantedTools,
            active_granted_tools: activeGrantedTools(skillWideningState),
            managed_commands: [...skillWideningState.managedCommandIds].sort((left, right) => left.localeCompare(right)),
            granted_commands: wideningGrant.grantedCommands,
            active_granted_commands: activeGrantedCommands(skillWideningState),
            workspace_boundary_override: workspaceBoundaryPolicy.overrideRequested,
          },
        },
      };
    },
  };
}

function wrapToolWithSkillWidening<TTool extends { name: string; execute: (...args: any[]) => Promise<any> }>(
  tool: TTool,
  state: PiSkillWideningState
): TTool {
  const normalizedName = tool.name.trim().toLowerCase();
  if (!state.managedToolNames.has(normalizedName)) {
    return tool;
  }

  const originalExecute = tool.execute.bind(tool);
  const wrapped: TTool = {
    ...tool,
    execute: (async (...args: any[]) => {
      if (!state.grantedToolNames.has(normalizedName)) {
        const requiredSkills = requiredSkillIdsForTool(state, normalizedName);
        const requiredSegment =
          requiredSkills.length > 0 ? ` by invoking one of: ${requiredSkills.join(", ")}` : "";
        throw new Error(
          `permission denied by skill policy: tool "${tool.name}" is gated and must be widened${requiredSegment}`
        );
      }
      return await originalExecute(...args);
    }) as TTool["execute"],
  };
  return wrapped;
}

function wrapToolWithWorkspaceBoundary<TTool extends { name: string; execute: (...args: any[]) => Promise<any> }>(
  tool: TTool,
  policy: PiWorkspaceBoundaryPolicy
): TTool {
  const originalExecute = tool.execute.bind(tool);
  const wrapped: TTool = {
    ...tool,
    execute: (async (...args: any[]) => {
      const toolParams = args[1];
      const violation = workspaceBoundaryViolationForToolCall({
        toolName: tool.name,
        toolParams,
        policy,
      });
      if (violation) {
        throw new Error(
          `permission denied by workspace boundary policy: ${violation}. Ask the user to explicitly insist if outside-workspace access is required.`
        );
      }
      return await originalExecute(...args);
    }) as TTool["execute"],
  };
  return wrapped;
}

function resolveRequestedSessionFile(request: HarnessHostPiRequest): string | null {
  const candidate = firstNonEmptyString(request.harness_session_id, request.persisted_harness_session_id);
  if (!candidate) {
    return null;
  }
  const resolved = path.resolve(candidate);
  return fs.existsSync(resolved) ? resolved : null;
}

function sanitizePiToolNameSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "tool";
}

export function buildPiMcpToolName(serverId: string, toolName: string): string {
  return `mcp__${sanitizePiToolNameSegment(serverId)}__${sanitizePiToolNameSegment(toolName)}`;
}

function uniquePiMcpToolName(serverId: string, toolName: string, usedNames: ReadonlySet<string>): string {
  const baseName = buildPiMcpToolName(serverId, toolName);
  if (!usedNames.has(baseName)) {
    return baseName;
  }
  let suffix = 2;
  while (usedNames.has(`${baseName}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}_${suffix}`;
}

function fallbackMcpToolParametersSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMcpToolParametersSchema(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) {
    return fallbackMcpToolParametersSchema();
  }
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

function resolveMcpToolTextResult(raw: unknown): string {
  const callResult = createCallResult(raw);
  return (
    callResult.markdown() ??
    callResult.text() ??
    JSON.stringify(jsonValue(callResult.structuredContent() ?? raw), null, 2)
  );
}

function toPiMcpServerBinding(payload: JsonObject, workspaceDir: string): PiMcpServerBinding | null {
  const name = firstNonEmptyString(payload.name);
  const config = isRecord(payload.config) ? payload.config : null;
  if (!name || !config) {
    return null;
  }

  const enabled = typeof config.enabled === "boolean" ? config.enabled : true;
  if (!enabled) {
    return null;
  }

  const timeoutMs = typeof config.timeout === "number" && Number.isFinite(config.timeout) ? config.timeout : 30000;
  const description = `Holaboss MCP server ${name}`;
  if (config.type === "local") {
    const command = Array.isArray(config.command) ? config.command.filter((item): item is string => typeof item === "string") : [];
    const [executable, ...args] = command;
    if (!executable) {
      throw new Error(`Pi MCP server ${name} is missing a local command`);
    }
    return {
      serverId: name,
      timeoutMs,
      definition: {
        name,
        description,
        command: {
          kind: "stdio",
          command: executable,
          args,
          cwd: workspaceDir,
        },
        env: stringRecord(config.environment),
      },
    };
  }

  const url = firstNonEmptyString(config.url);
  if (!url) {
    throw new Error(`Pi MCP server ${name} is missing a remote url`);
  }
  return {
    serverId: name,
    timeoutMs,
    definition: {
      name,
      description,
      command: {
        kind: "http",
        url: new URL(url),
        headers: stringRecord(config.headers),
      },
    },
  };
}

export function buildPiMcpServerBindings(request: HarnessHostPiRequest): PiMcpServerBinding[] {
  return request.mcp_servers
    .map((server) => toPiMcpServerBinding(server, request.workspace_dir))
    .filter((binding): binding is PiMcpServerBinding => Boolean(binding));
}

function mcpToolAllowlist(request: HarnessHostPiRequest): Map<string, Map<string, HarnessHostPiMcpToolRef>> {
  const allowlist = new Map<string, Map<string, HarnessHostPiMcpToolRef>>();
  for (const toolRef of request.mcp_tool_refs) {
    const serverTools = allowlist.get(toolRef.server_id) ?? new Map<string, HarnessHostPiMcpToolRef>();
    serverTools.set(toolRef.tool_name, toolRef);
    allowlist.set(toolRef.server_id, serverTools);
  }
  return allowlist;
}

function createPiMcpToolDefinition(params: {
  runtime: McporterRuntime;
  binding: PiMcpServerBinding;
  tool: ServerToolInfo;
  metadata: PiMcpToolMetadata;
}): ToolDefinition {
  const description = [params.tool.description?.trim(), `MCP server: ${params.binding.serverId}`, `MCP tool: ${params.tool.name}`]
    .filter(Boolean)
    .join("\n");

  return {
    name: params.metadata.piToolName,
    label: `${params.binding.serverId}:${params.tool.name}`,
    description,
    parameters: normalizeMcpToolParametersSchema(params.tool.inputSchema) as never,
    execute: async (_toolCallId, toolParams, signal) => {
      if (signal?.aborted) {
        throw new Error(`MCP tool call aborted before execution: ${params.binding.serverId}.${params.tool.name}`);
      }
      const raw = await params.runtime.callTool(params.binding.serverId, params.tool.name, {
        args: isRecord(toolParams) ? toolParams : {},
        timeoutMs: params.binding.timeoutMs,
      });
      const text = resolveMcpToolTextResult(raw);
      return {
        content: [{ type: "text", text }],
        details: {
          server_id: params.binding.serverId,
          tool_id: params.metadata.toolId,
          tool_name: params.tool.name,
          raw: jsonValue(raw),
        },
      };
    },
  };
}

export async function createPiMcpToolset(request: HarnessHostPiRequest): Promise<PiMcpToolset> {
  const bindings = buildPiMcpServerBindings(request);
  if (bindings.length === 0) {
    return {
      runtime: null,
      customTools: [],
      mcpToolMetadata: new Map(),
    };
  }

  const runtime = await createRuntime({
    servers: bindings.map((binding) => binding.definition),
    rootDir: request.workspace_dir,
    clientInfo: {
      name: PI_HARNESS_CLIENT_NAME,
      version: PI_HARNESS_CLIENT_VERSION,
    },
  });
  try {
    const customTools = await createPiMcpCustomTools(request, runtime, bindings);
    return {
      runtime,
      customTools: customTools.customTools,
      mcpToolMetadata: customTools.mcpToolMetadata,
    };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

export async function createPiMcpCustomTools(
  request: HarnessHostPiRequest,
  runtime: McporterRuntime,
  bindings: PiMcpServerBinding[] = buildPiMcpServerBindings(request)
): Promise<Omit<PiMcpToolset, "runtime">> {
  const allowlist = mcpToolAllowlist(request);
  const customTools: ToolDefinition[] = [];
  const mcpToolMetadata = new Map<string, PiMcpToolMetadata>();

  for (const binding of bindings) {
    const allowedTools = allowlist.get(binding.serverId);
    const discoveryDeadline = Date.now() + Math.max(
      PI_MCP_DISCOVERY_RETRY_INTERVAL_MS,
      Math.min(binding.timeoutMs, PI_MCP_DISCOVERY_MAX_WAIT_MS)
    );
    let discoveredTools: ServerToolInfo[] = [];
    let lastDiscoveryError: unknown = null;
    while (true) {
      try {
        discoveredTools = await runtime.listTools(binding.serverId, { includeSchema: true });
        lastDiscoveryError = null;
      } catch (error) {
        lastDiscoveryError = error;
        discoveredTools = [];
      }

      const missingAllowedTools = allowedTools
        ? [...allowedTools.keys()].filter((toolName) => !discoveredTools.some((tool) => tool.name === toolName))
        : [];
      if (missingAllowedTools.length === 0) {
        break;
      }
      if (Date.now() >= discoveryDeadline) {
        if (lastDiscoveryError) {
          throw lastDiscoveryError;
        }
        throw new Error(
          `Pi MCP tool ${binding.serverId}.${missingAllowedTools[0]} for tool_id=${allowedTools?.get(missingAllowedTools[0])?.tool_id ?? `${binding.serverId}.${missingAllowedTools[0]}`} was not discovered`
        );
      }
      await sleep(PI_MCP_DISCOVERY_RETRY_INTERVAL_MS);
    }
    const filteredTools = allowedTools
      ? discoveredTools.filter((tool) => allowedTools.has(tool.name))
      : discoveredTools;

    if (allowedTools) {
      for (const [toolName, toolRef] of allowedTools.entries()) {
        if (!discoveredTools.some((tool) => tool.name === toolName)) {
          throw new Error(`Pi MCP tool ${binding.serverId}.${toolName} for tool_id=${toolRef.tool_id} was not discovered`);
        }
      }
    }

    for (const tool of filteredTools) {
      const toolRef = allowedTools?.get(tool.name);
      const metadata: PiMcpToolMetadata = {
        piToolName: uniquePiMcpToolName(binding.serverId, tool.name, new Set(mcpToolMetadata.keys())),
        serverId: binding.serverId,
        toolId: toolRef?.tool_id ?? `${binding.serverId}.${tool.name}`,
        toolName: tool.name,
      };
      customTools.push(
        createPiMcpToolDefinition({
          runtime,
          binding,
          tool,
          metadata,
        })
      );
      mcpToolMetadata.set(metadata.piToolName, metadata);
    }
  }

  return {
    customTools,
    mcpToolMetadata,
  };
}

function resolvePiModel(request: HarnessHostPiRequest, modelRegistry: ModelRegistry) {
  const direct = modelRegistry.find(request.provider_id, request.model_id);
  if (direct) {
    return direct;
  }

  const prefixed = modelRegistry.find(request.provider_id, `${request.provider_id}/${request.model_id}`);
  if (prefixed) {
    return prefixed;
  }

  const fallback = modelRegistry
    .getAll()
    .find(
      (model) =>
        (model.provider === request.provider_id && model.id === request.model_id) ||
        (model.provider === request.provider_id && model.id === `${request.provider_id}/${request.model_id}`) ||
        `${model.provider}/${model.id}` === request.model_id
    );
  if (fallback) {
    return fallback;
  }

  throw new Error(`Pi model not found for provider=${request.provider_id} model=${request.model_id}`);
}

function piApiForRequest(request: HarnessHostPiRequest): Api {
  const normalizedProvider = request.model_client.model_proxy_provider.trim().toLowerCase();
  if (normalizedProvider === "anthropic_native") {
    return "anthropic-messages";
  }
  if (shouldUseNativeGoogleProvider(request)) {
    return "google-generative-ai";
  }
  if (shouldUseOpenAiResponsesProvider(request)) {
    return "openai-responses";
  }
  return "openai-completions";
}

function shouldUseNativeGoogleProvider(request: HarnessHostPiRequest): boolean {
  const normalizedProvider = request.model_client.model_proxy_provider.trim().toLowerCase();
  const providerId = request.provider_id.trim().toLowerCase();
  return normalizedProvider === "google_compatible" && providerId === "gemini_direct";
}

function normalizedPiModelId(request: Pick<HarnessHostPiRequest, "model_id">): string {
  const normalizedModelId = request.model_id.trim().toLowerCase();
  if (!normalizedModelId) {
    return "";
  }
  if (normalizedModelId.startsWith("openai/")) {
    return normalizedModelId.slice("openai/".length);
  }
  if (normalizedModelId.startsWith("holaboss_model_proxy/")) {
    return normalizedModelId.slice("holaboss_model_proxy/".length);
  }
  return normalizedModelId;
}

function isOpenAiGpt5Model(modelId: string): boolean {
  return /^gpt-5(?:[.-]|$)/.test(modelId);
}

function shouldUseOpenAiResponsesProvider(request: HarnessHostPiRequest): boolean {
  const normalizedProvider = request.model_client.model_proxy_provider.trim().toLowerCase();
  const providerId = request.provider_id.trim().toLowerCase();
  if (normalizedProvider !== "openai_compatible") {
    return false;
  }
  if (
    providerId !== "openai_direct" &&
    providerId !== "openai" &&
    providerId !== "holaboss_model_proxy" &&
    providerId !== "holaboss"
  ) {
    return false;
  }
  return isOpenAiGpt5Model(normalizedPiModelId(request));
}

function piGoogleGenerativeAiBaseUrlForRequest(request: HarnessHostPiRequest): string {
  const baseUrl = firstNonEmptyString(request.model_client.base_url);
  const normalized = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
  if (!normalized) {
    return "https://generativelanguage.googleapis.com/v1beta";
  }
  return normalized.replace(/\/openai$/i, "") || "https://generativelanguage.googleapis.com/v1beta";
}

function piAnthropicBaseUrlForRequest(request: HarnessHostPiRequest): string {
  const baseUrl = firstNonEmptyString(request.model_client.base_url);
  const normalized = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\/v1$/i, "");
}

function piOpenAiCompatForRequest(request: HarnessHostPiRequest): Model<"openai-completions">["compat"] | undefined {
  const modelProxyProvider = request.model_client.model_proxy_provider.trim().toLowerCase();
  const providerId = request.provider_id.trim().toLowerCase();
  const baseUrl = firstNonEmptyString(request.model_client.base_url)?.toLowerCase() ?? "";
  if (providerId.includes("ollama") || baseUrl.includes("localhost:11434") || baseUrl.includes("ollama")) {
    return {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    };
  }
  if (
    modelProxyProvider === "google_compatible" ||
    providerId.includes("gemini") ||
    providerId.includes("google") ||
    baseUrl.includes("generativelanguage.googleapis.com")
  ) {
    return {
      supportsStore: false,
    };
  }
  return undefined;
}

function mergePiOpenAiCompat(
  base: Model<"openai-completions">["compat"] | undefined,
  extra: Model<"openai-completions">["compat"] | undefined,
): Model<"openai-completions">["compat"] | undefined {
  if (!base) {
    return extra;
  }
  if (!extra) {
    return base;
  }
  return {
    ...base,
    ...extra,
    ...(base.reasoningEffortMap || extra.reasoningEffortMap
      ? {
          reasoningEffortMap: {
            ...(base.reasoningEffortMap ?? {}),
            ...(extra.reasoningEffortMap ?? {}),
          },
        }
      : {}),
  };
}

function piInputModalitiesForRequest(
  request: HarnessHostPiRequest,
): Array<"text" | "image"> {
  const providerId = request.provider_id.trim().toLowerCase();
  const modelId = request.model_id.trim().toLowerCase();
  if (
    providerId.includes("ollama") ||
    providerId.includes("minimax") ||
    modelId.startsWith("llama") ||
    modelId.startsWith("qwen3:") ||
    modelId.startsWith("gpt-oss:")
  ) {
    return ["text"];
  }
  return ["text", "image"];
}

export function requestedPiThinkingLevel(
  request: Pick<HarnessHostPiRequest, "thinking_value">,
): PiRequestedThinkingLevel | null {
  return piThinkingSelectionForRequest(request).level;
}

function piNumericThinkingLevel(value: number): PiThinkingBudgetLevel | "off" {
  if (value === 0) {
    return "off";
  }
  if (value < 0) {
    return "high";
  }
  if (value <= 1024) {
    return "minimal";
  }
  if (value <= 4096) {
    return "low";
  }
  if (value <= 12288) {
    return "medium";
  }
  return "high";
}

function piThinkingSelectionForRequest(
  request: Pick<HarnessHostPiRequest, "thinking_value">,
): PiThinkingSelection {
  const rawValue = request.thinking_value?.trim() ?? "";
  const normalizedValue = rawValue.toLowerCase();
  if (!normalizedValue) {
    return {
      rawValue: null,
      level: null,
    };
  }
  if (
    normalizedValue === "off" ||
    normalizedValue === "none" ||
    normalizedValue === "false"
  ) {
    return {
      rawValue,
      level: "off",
    };
  }
  if (
    normalizedValue === "minimal" ||
    normalizedValue === "low" ||
    normalizedValue === "medium" ||
    normalizedValue === "high" ||
    normalizedValue === "xhigh"
  ) {
    return {
      rawValue,
      level: normalizedValue,
    };
  }
  if (normalizedValue === "max") {
    return {
      rawValue,
      level: "xhigh",
    };
  }
  if (normalizedValue === "default") {
    return {
      rawValue,
      level: "low",
    };
  }
  if (normalizedValue === "true" || normalizedValue === "enabled") {
    return {
      rawValue,
      level: "medium",
    };
  }
  const numericValue = Number(normalizedValue);
  if (!Number.isFinite(numericValue)) {
    return {
      rawValue,
      level: null,
    };
  }
  const level = piNumericThinkingLevel(numericValue);
  if (level === "off") {
    return {
      rawValue,
      level,
    };
  }
  return {
    rawValue,
    level,
    thinkingBudgets: {
      [level]: numericValue,
    },
  };
}

function piOpenAiCompatForThinkingSelection(
  selection: PiThinkingSelection,
): Model<"openai-completions">["compat"] | undefined {
  if (!selection.rawValue || !selection.level || selection.level === "off") {
    return undefined;
  }
  const normalizedLevel = selection.level.toLowerCase();
  const normalizedRawValue = selection.rawValue.trim().toLowerCase();
  if (
    normalizedRawValue === normalizedLevel ||
    Number.isFinite(Number(normalizedRawValue))
  ) {
    return undefined;
  }
  return {
    reasoningEffortMap: {
      [selection.level]: selection.rawValue,
    },
  };
}

export function requestedPiThinkingBudgets(
  request: Pick<HarnessHostPiRequest, "thinking_value">,
): Partial<Record<PiThinkingBudgetLevel, number>> | undefined {
  const selection = piThinkingSelectionForRequest(request);
  return selection.thinkingBudgets
    ? { ...selection.thinkingBudgets }
    : undefined;
}

function requestedPiOpenAiCompat(
  request: Pick<HarnessHostPiRequest, "thinking_value">,
): Model<"openai-completions">["compat"] | undefined {
  return piOpenAiCompatForThinkingSelection(
    piThinkingSelectionForRequest(request),
  );
}

export function requestedPiThinkingConfig(
  request: Pick<HarnessHostPiRequest, "thinking_value">,
): PiThinkingSelection {
  const selection = piThinkingSelectionForRequest(request);
  return {
    rawValue: selection.rawValue,
    level: selection.level,
    ...(selection.thinkingBudgets
      ? { thinkingBudgets: { ...selection.thinkingBudgets } }
      : {}),
  };
}

export function buildPiProviderConfig(request: HarnessHostPiRequest) {
  const providerHeaders = isRecord(request.model_client.default_headers)
    ? Object.fromEntries(
        Object.entries(request.model_client.default_headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    : undefined;
  const hasExplicitAuthHeader = Object.keys(providerHeaders ?? {}).some((headerName) => {
    const normalizedHeaderName = headerName.trim().toLowerCase();
    return normalizedHeaderName === "x-api-key" || normalizedHeaderName === "authorization";
  });
  const api = piApiForRequest(request);
  const baseUrl =
    api === "google-generative-ai"
      ? piGoogleGenerativeAiBaseUrlForRequest(request)
      : api === "anthropic-messages"
        ? piAnthropicBaseUrlForRequest(request)
      : firstNonEmptyString(request.model_client.base_url);
  if (!baseUrl) {
    throw new Error(`Pi provider ${request.provider_id} is missing a model client base URL`);
  }

  const compat =
    api === "openai-completions" ? piOpenAiCompatForRequest(request) : undefined;
  const requestedThinking = requestedPiThinkingLevel(request);
  const requestedCompat =
    api === "openai-completions" ? requestedPiOpenAiCompat(request) : undefined;
  const mergedCompat = mergePiOpenAiCompat(compat, requestedCompat);

  return {
    baseUrl,
    apiKey: request.model_client.api_key,
    api,
    headers: providerHeaders,
    // Prefer runtime-managed auth headers when provided by the server, otherwise let Pi attach auth from api_key.
    authHeader: api !== "google-generative-ai" && !hasExplicitAuthHeader,
    models: [
      {
        id: request.model_id,
        name: request.model_id,
        api,
        reasoning: requestedThinking !== null,
        input: piInputModalitiesForRequest(request),
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 65536,
        maxTokens: 8192,
        ...(mergedCompat ? { compat: mergedCompat } : {}),
      },
    ],
  };
}

async function defaultCreateSession(request: HarnessHostPiRequest): Promise<PiSessionHandle> {
  const stateDir = resolvePiStateDir(request.workspace_dir);
  const sessionDir = resolvePiSessionDir(request.workspace_dir);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  const authStorage = AuthStorage.create(path.join(stateDir, "auth.json"));
  authStorage.setRuntimeApiKey(request.provider_id, request.model_client.api_key);

  const modelRegistry = ModelRegistry.create(
    authStorage,
    path.join(stateDir, "models.json"),
  );
  modelRegistry.registerProvider(request.provider_id, buildPiProviderConfig(request));

  const model = resolvePiModel(request, modelRegistry);
  const requestedThinking = requestedPiThinkingLevel(request) ?? "off";
  const requestedThinkingBudgets = requestedPiThinkingBudgets(request);
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: request.provider_id,
    defaultModel: request.model_id,
    defaultThinkingLevel: requestedThinking,
    ...(requestedThinkingBudgets
      ? { thinkingBudgets: requestedThinkingBudgets }
      : {}),
  });
  const skillDirs = resolvePiSkillDirs(request);
  const loadedSkills = loadPiSkills(skillDirs);
  const skillMetadataByAlias = buildPiSkillMetadataByAlias(loadedSkills.skills);
  const todoTools = createPiTodoToolDefinitions({
    stateDir,
    sessionId: request.session_id,
  });
  const browserTools = request.browser_tools_enabled
    ? await resolvePiDesktopBrowserToolDefinitions({
        runtimeApiBaseUrl: request.runtime_api_base_url,
        workspaceId: request.workspace_id,
      })
    : [];
  const resourceLoader = new DefaultResourceLoader({
    cwd: request.workspace_dir,
    agentDir: stateDir,
    settingsManager,
    extensionFactories: [],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    skillsOverride: () => loadedSkills,
    systemPromptOverride: () => effectiveSystemPromptForRequest(request),
  });
  await resourceLoader.reload();

  const persistedSessionFile = resolveRequestedSessionFile(request);
  const sessionManager = persistedSessionFile
    ? SessionManager.open(persistedSessionFile)
    : SessionManager.create(request.workspace_dir, sessionDir);
  const mcpToolset = await createPiMcpToolset(request);
  const runtimeTools = await resolvePiRuntimeToolDefinitions({
    runtimeApiBaseUrl: request.runtime_api_base_url,
    workspaceId: request.workspace_id,
    sessionId: request.session_id,
    inputId: request.input_id,
    selectedModel: `${request.provider_id}/${request.model_id}`,
  });
  const webSearchTools = await resolvePiWebSearchToolDefinitions();
  const baseTools = [
    ...createCodingTools(request.workspace_dir),
    createGrepTool(request.workspace_dir),
    createFindTool(request.workspace_dir),
    createLsTool(request.workspace_dir),
  ];
  const nonSkillCustomTools: ToolDefinition[] = [
    ...todoTools,
    ...browserTools,
    ...runtimeTools,
    ...webSearchTools,
    ...mcpToolset.customTools,
  ];
  const availableToolNames = [...baseTools, ...nonSkillCustomTools].map((tool) => tool.name);
  const availableCommandIds = workspaceCommandIdsFromRunStartedPayload(request.run_started_payload);
  const workspaceBoundaryPolicy = createWorkspaceBoundaryPolicy(
    request.workspace_dir,
    workspaceBoundaryOverrideRequested(request.instruction)
  );
  const skillWideningState = createPiSkillWideningState(
    skillMetadataByAlias,
    [...availableToolNames, "skill"],
    availableCommandIds
  );
  const skillTools =
    skillMetadataByAlias.size > 0
      ? [createPiSkillToolDefinition(skillMetadataByAlias, skillWideningState, workspaceBoundaryPolicy)]
      : [];
  const tools = baseTools.map((tool) =>
    wrapToolWithWorkspaceBoundary(wrapToolWithSkillWidening(tool, skillWideningState), workspaceBoundaryPolicy)
  );
  const customTools = [
    ...nonSkillCustomTools.map((tool) =>
      wrapToolWithWorkspaceBoundary(wrapToolWithSkillWidening(tool, skillWideningState), workspaceBoundaryPolicy)
    ),
    ...skillTools.map((tool) => wrapToolWithWorkspaceBoundary(tool, workspaceBoundaryPolicy)),
  ];

  let session: AgentSession;
  try {
    ({ session } = await createAgentSession({
      cwd: request.workspace_dir,
      agentDir: stateDir,
      authStorage,
      modelRegistry,
      model,
      resourceLoader,
      sessionManager,
      settingsManager,
      tools,
      customTools,
    }));
  } catch (error) {
    await mcpToolset.runtime?.close();
    throw error;
  }

  const sessionFile = sessionManager.getSessionFile();
  if (!sessionFile) {
    session.dispose();
    await mcpToolset.runtime?.close();
    throw new Error("Pi session manager did not provide a persisted session file");
  }

  return {
    session,
    sessionFile,
    mcpToolMetadata: mcpToolset.mcpToolMetadata,
    skillMetadataByAlias,
    dispose: async () => {
      session.dispose();
      await mcpToolset.runtime?.close();
    },
  };
}

function toolCallId(event: AgentSessionEvent): string {
  if ("toolCallId" in event && typeof event.toolCallId === "string") {
    return event.toolCallId;
  }
  return "";
}

function isSkillToolName(toolName: unknown): boolean {
  return typeof toolName === "string" && toolName.trim().toLowerCase() === "skill";
}

function skillInvocationArgs(value: unknown): { requestedName: string | null; args: string | null } {
  if (!isRecord(value)) {
    return { requestedName: null, args: null };
  }
  return {
    requestedName: optionalTrimmedString(value.name),
    args: optionalTrimmedString(value.args),
  };
}

function skillInvocationResultDetails(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  return isRecord(value.details) ? value.details : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => optionalTrimmedString(item))
    .filter((item): item is string => Boolean(item));
}

function maybeMapSkillInvocationStart(event: AgentSessionEvent, state: PiEventMapperState): PiMappedEvent | null {
  if (event.type !== "tool_execution_start" || !isSkillToolName(event.toolName)) {
    return null;
  }
  const invocationArgs = skillInvocationArgs(event.args);
  const resolvedSkill = resolveSkillMetadata(state.skillMetadataByAlias, invocationArgs.requestedName);
  return {
    event_type: "skill_invocation",
    payload: {
      phase: "started",
      requested_name: invocationArgs.requestedName,
      skill_id: resolvedSkill?.skillId ?? null,
      skill_name: resolvedSkill?.skillName ?? invocationArgs.requestedName,
      skill_location: resolvedSkill?.filePath ?? null,
      granted_tools_expected: resolvedSkill?.grantedTools ?? [],
      granted_commands_expected: resolvedSkill?.grantedCommands ?? [],
      args: invocationArgs.args,
      error: false,
      event: "tool_execution_start",
      source: "pi",
      call_id: event.toolCallId,
    },
  };
}

function maybeMapSkillInvocationEnd(
  event: AgentSessionEvent,
  toolArgs: JsonValue | null,
  state: PiEventMapperState
): PiMappedEvent | null {
  if (event.type !== "tool_execution_end" || !isSkillToolName(event.toolName)) {
    return null;
  }
  const invocationArgs = skillInvocationArgs(toolArgs);
  const resolvedSkill = resolveSkillMetadata(state.skillMetadataByAlias, invocationArgs.requestedName);
  const details = skillInvocationResultDetails(event.result);
  const skillId = firstNonEmptyString(details?.skill_id, resolvedSkill?.skillId) ?? null;
  const skillName = firstNonEmptyString(details?.skill_name, resolvedSkill?.skillName, invocationArgs.requestedName) ?? null;
  const skillLocation = firstNonEmptyString(details?.skill_file_path, resolvedSkill?.filePath) ?? null;
  const policyWidening = isRecord(details?.policy_widening) ? details?.policy_widening : null;
  const wideningScope = optionalTrimmedString(policyWidening?.scope);
  const managedTools = stringList(policyWidening?.managed_tools);
  const grantedTools = stringList(policyWidening?.granted_tools);
  const activeGrantedToolsSnapshot = stringList(policyWidening?.active_granted_tools);
  const managedCommands = stringList(policyWidening?.managed_commands);
  const grantedCommands = stringList(policyWidening?.granted_commands);
  const activeGrantedCommandsSnapshot = stringList(policyWidening?.active_granted_commands);
  const workspaceBoundaryOverride =
    typeof policyWidening?.workspace_boundary_override === "boolean"
      ? policyWidening.workspace_boundary_override
      : null;
  const resultMessage = firstNonEmptyString(
    details?.message,
    details?.error_message,
    isRecord(event.result) ? event.result.message : undefined,
    isRecord(event.result) ? event.result.error : undefined,
    typeof event.result === "string" ? event.result : undefined
  );
  return {
    event_type: "skill_invocation",
    payload: {
      phase: "completed",
      requested_name: invocationArgs.requestedName,
      skill_id: skillId,
      skill_name: skillName,
      skill_location: skillLocation,
      widening_scope: wideningScope,
      managed_tools: managedTools,
      granted_tools: grantedTools,
      active_granted_tools: activeGrantedToolsSnapshot,
      managed_commands: managedCommands,
      granted_commands: grantedCommands,
      active_granted_commands: activeGrantedCommandsSnapshot,
      workspace_boundary_override: workspaceBoundaryOverride,
      args: invocationArgs.args,
      error: Boolean(event.isError),
      error_message: Boolean(event.isError) ? resultMessage ?? null : null,
      event: "tool_execution_end",
      source: "pi",
      call_id: toolCallId(event),
    },
  };
}

function assistantMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
        return "";
      }
      return block.text;
    })
    .join("")
    .trim();
}

function parseJsonIfPossible(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function extractProviderErrorMessage(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = parseJsonIfPossible(trimmed);
    if (parsed !== null) {
      const nested = extractProviderErrorMessage(parsed, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractProviderErrorMessage(item, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["error", "errors", "message", "detail", "details", "error_message", "body", "cause"] as const) {
    const nested = extractProviderErrorMessage(value[key], depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function normalizeAssistantFailureMessage(errorMessage: unknown, content: unknown, stopReason: string): string {
  return (
    extractProviderErrorMessage(errorMessage) ??
    firstNonEmptyString(
      typeof errorMessage === "string" ? errorMessage : undefined,
      assistantMessageText(content),
      `Assistant message ended with stop reason ${stopReason}`
    ) ??
    `Assistant message ended with stop reason ${stopReason}`
  );
}

function maybeMapAssistantTerminalFailure(
  event: AgentSessionEvent,
  sessionFile: string,
  state: PiEventMapperState
): PiMappedEvent[] | null {
  if (event.type !== "message_end" && event.type !== "turn_end") {
    return null;
  }
  if (state.terminalState === "failed") {
    return [];
  }
  const message = isRecord(event.message) ? event.message : null;
  if (!message || message.role !== "assistant") {
    return [];
  }
  const stopReason = optionalTrimmedString(message.stopReason);
  if (stopReason !== "error" && stopReason !== "aborted") {
    return [];
  }
  state.terminalState = "failed";
  const failureMessage = normalizeAssistantFailureMessage(message.errorMessage, message.content, stopReason);
  return [
    {
      event_type: "run_failed",
      payload: {
        type: stopReason === "aborted" ? "AbortError" : "ProviderError",
        message: failureMessage,
        stop_reason: stopReason,
        provider: optionalTrimmedString(message.provider) ?? null,
        model: optionalTrimmedString(message.model) ?? null,
        event: event.type,
        source: "pi",
        harness_session_id: sessionFile,
      },
    },
  ];
}

function mapNativePiEvent(event: AgentSessionEvent, sessionFile: string): PiMappedEvent {
  const nativeEventPayload =
    event.type === "message_update"
      ? jsonValue({
          type: event.type,
          assistantMessageEvent: Object.fromEntries(
            Object.entries(isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : {}).filter(
              ([key]) => key !== "partial"
            )
          ),
        })
      : jsonValue(event);
  return {
    event_type: "pi_native_event",
    payload: {
      native_type: event.type,
      native_event: nativeEventPayload,
      event: event.type,
      source: "pi",
      harness_session_id: sessionFile,
    },
  };
}

function mapPiEvent(
  event: AgentSessionEvent,
  sessionFile: string,
  state: PiEventMapperState
): PiMappedEvent[] {
  const nativeEvent = mapNativePiEvent(event, sessionFile);
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return [
          nativeEvent,
          {
            event_type: "output_delta",
            payload: {
              delta: event.assistantMessageEvent.delta,
              event: "message_update",
              source: "pi",
              content_index: event.assistantMessageEvent.contentIndex,
              delta_kind: "output",
            },
          },
        ];
      }
      if (event.assistantMessageEvent.type === "thinking_delta") {
        return [
          nativeEvent,
          {
            event_type: "thinking_delta",
            payload: {
              delta: event.assistantMessageEvent.delta,
              event: "message_update",
              source: "pi",
              content_index: event.assistantMessageEvent.contentIndex,
              delta_kind: "thinking",
            },
          },
        ];
      }
      return [nativeEvent];
    case "message_end":
    case "turn_end": {
      const terminalFailure = maybeMapAssistantTerminalFailure(event, sessionFile, state);
      return terminalFailure == null ? [nativeEvent] : [nativeEvent, ...terminalFailure];
    }
    case "tool_execution_start": {
      state.toolArgsByCallId.set(event.toolCallId, jsonValue(event.args));
      const metadata = state.mcpToolMetadata.get(event.toolName);
      const mapped: PiMappedEvent[] = [
        nativeEvent,
        {
          event_type: "tool_call",
          payload: {
            phase: "started",
            tool_name: metadata?.toolName ?? event.toolName,
            tool_args: jsonValue(event.args),
            result: null,
            error: false,
            event: "tool_execution_start",
            source: "pi",
            call_id: event.toolCallId,
            ...(metadata
              ? {
                  pi_tool_name: metadata.piToolName,
                  mcp_server_id: metadata.serverId,
                  tool_id: metadata.toolId,
                }
              : {}),
          },
        },
      ];
      const skillMapped = maybeMapSkillInvocationStart(event, state);
      if (skillMapped) {
        mapped.push(skillMapped);
      }
      return mapped;
    }
    case "tool_execution_end": {
      const callId = toolCallId(event);
      const args = state.toolArgsByCallId.get(callId) ?? null;
      state.toolArgsByCallId.delete(callId);
      const metadata = state.mcpToolMetadata.get(event.toolName);
      const toolName = metadata?.toolName ?? event.toolName;
      const mapped: PiMappedEvent[] = [
        nativeEvent,
        {
          event_type: "tool_call",
          payload: {
            phase: "completed",
            tool_name: toolName,
            tool_args: args,
            result: jsonValue(event.result),
            error: Boolean(event.isError),
            event: "tool_execution_end",
            source: "pi",
            call_id: callId,
            ...(metadata
              ? {
                  pi_tool_name: metadata.piToolName,
                  mcp_server_id: metadata.serverId,
                  tool_id: metadata.toolId,
                }
              : {}),
          },
        },
      ];
      if (!event.isError && toolName.trim().toLowerCase() === "question") {
        state.waitingForUser = true;
      }
      const skillMapped = maybeMapSkillInvocationEnd(event, args, state);
      if (skillMapped) {
        mapped.push(skillMapped);
      }
      return mapped;
    }
    case "compaction_start":
      return [
        nativeEvent,
        {
          event_type: "auto_compaction_start",
          payload: {
            reason: event.reason,
            event: "auto_compaction_start",
            source: "pi",
          },
        },
      ];
    case "compaction_end":
      return [
        nativeEvent,
        {
          event_type: "auto_compaction_end",
          payload: {
            result: jsonValue(event.result ?? null),
            aborted: event.aborted,
            will_retry: event.willRetry,
            error_message: typeof event.errorMessage === "string" ? event.errorMessage : null,
            event: "auto_compaction_end",
            source: "pi",
          },
        },
      ];
    case "agent_end":
      if (state.terminalState === "failed") {
        return [nativeEvent];
      }
      state.terminalState = "completed";
      return [
        nativeEvent,
        {
          event_type: "run_completed",
          payload: {
            status: state.waitingForUser ? "waiting_user" : "success",
            event: "agent_end",
            source: "pi",
            harness_session_id: sessionFile,
          },
        },
      ];
    default:
      return [nativeEvent];
  }
}

export function createPiEventMapperState(
  mcpToolMetadata: ReadonlyMap<string, PiMcpToolMetadata> = new Map(),
  skillMetadataByAlias: ReadonlyMap<string, PiSkillMetadata> = new Map()
): PiEventMapperState {
  return {
    toolArgsByCallId: new Map(),
    mcpToolMetadata,
    skillMetadataByAlias,
    terminalState: null,
    waitingForUser: false,
  };
}

export function mapPiSessionEvent(event: AgentSessionEvent, sessionFile: string, state: PiEventMapperState): PiMappedEvent[] {
  return mapPiEvent(event, sessionFile, state);
}

function defaultPiDeps(): PiDeps {
  return {
    createSession: defaultCreateSession,
  };
}

export async function runPi(request: HarnessHostPiRequest, deps: PiDeps = defaultPiDeps()): Promise<number> {
  let sequence = 0;
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  const handle = await deps.createSession(request);
  const requestedThinking = requestedPiThinkingLevel(request) ?? "off";
  (
    handle.session as AgentSession & {
      setThinkingLevel?: (level: PiThinkingLevel) => void;
    }
  ).setThinkingLevel?.(requestedThinking);
  const state = createPiEventMapperState(handle.mcpToolMetadata, handle.skillMetadataByAlias);
  const shouldEmitWaitingUser = () =>
    state.waitingForUser || hasBlockedPersistedPiTodoState(stateDir, request.session_id);
  let terminalEmitted = false;
  const stateDir = resolvePiStateDir(request.workspace_dir);
  const unsubscribe = handle.session.subscribe((event) => {
    for (const mapped of mapPiEvent(event, handle.sessionFile, state)) {
      if (
        mapped.event_type === "run_completed" &&
        typeof mapped.payload.status === "string" &&
        mapped.payload.status.trim().toLowerCase() !== "waiting_user" &&
        shouldEmitWaitingUser()
      ) {
        mapped.payload.status = "waiting_user";
      }
      if (
        mapped.event_type === "tool_call" &&
        mapped.payload.phase === "completed" &&
        mapped.payload.error !== true &&
        typeof mapped.payload.tool_name === "string" &&
        mapped.payload.tool_name.trim().toLowerCase() === "question"
      ) {
        const questionText = summarizeQuestionPrompt(
          (mapped.payload.tool_args as JsonValue | null) ?? null,
          mapped.payload.result
        );
        const detail = questionText
          ? `Blocked waiting for user input: ${questionText}`
          : "Blocked waiting for user input.";
        blockActivePiTodoTask({
          stateDir,
          sessionId: request.session_id,
          detail,
        });
      }
      if (mapped.event_type === "run_completed" || mapped.event_type === "run_failed") {
        terminalEmitted = true;
      }
      emitRunnerEvent(request, nextSequence(), mapped.event_type, mapped.payload);
    }
  });

  emitRunnerEvent(request, nextSequence(), "run_started", {
    ...request.run_started_payload,
    harness_session_id: handle.sessionFile,
  });

  let timeoutHandle: NodeJS.Timeout | null = null;
  let timedOut = false;
  if (request.timeout_seconds > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      void handle.session.abort().catch(() => {});
    }, request.timeout_seconds * 1000);
  }

  try {
    await handle.session.sendUserMessage(await promptContentForRequest(request));
    if (!terminalEmitted) {
      emitRunnerEvent(request, nextSequence(), "run_completed", {
        status: shouldEmitWaitingUser() ? "waiting_user" : "success",
        source: "pi",
        event: "send_user_message_resolved",
        harness_session_id: handle.sessionFile,
      });
    }
    return 0;
  } catch (error) {
    if (!terminalEmitted) {
      const message = timedOut
        ? `Pi session timed out after ${request.timeout_seconds} seconds`
        : sdkErrorMessage(error, "Pi session failed");
      emitRunnerEvent(request, nextSequence(), "run_failed", {
        type: timedOut ? "TimeoutError" : error instanceof Error && error.name ? error.name : "Error",
        message,
        source: "pi",
        harness_session_id: handle.sessionFile,
      });
    }
    return 1;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    unsubscribe();
    await handle.dispose();
  }
}
