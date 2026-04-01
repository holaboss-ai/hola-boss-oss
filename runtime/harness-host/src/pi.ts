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
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { ResourceDiagnostic } from "@mariozechner/pi-coding-agent";
import * as XLSX from "xlsx";
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
import { resolvePiDesktopBrowserExtensionFactory } from "./pi-browser-tools.js";
import { resolvePiRuntimeToolDefinitions } from "./pi-runtime-tools.js";

export type PiMappedEvent = {
  event_type: RunnerEventType;
  payload: JsonObject;
};

export type PiEventMapperState = {
  toolArgsByCallId: Map<string, JsonValue>;
  mcpToolMetadata: ReadonlyMap<string, PiMcpToolMetadata>;
};

export interface PiSessionHandle {
  session: AgentSession;
  sessionFile: string;
  mcpToolMetadata: Map<string, PiMcpToolMetadata>;
  dispose: () => Promise<void>;
}

export interface PiDeps {
  createSession: (request: HarnessHostPiRequest) => Promise<PiSessionHandle>;
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
const require = createRequire(import.meta.url);

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

function attachmentPromptPath(attachment: PiAttachment): string {
  return `./${attachment.workspace_path}`;
}

function resolveAttachmentAbsolutePath(request: HarnessHostPiRequest, attachment: PiAttachment): string {
  return path.resolve(request.workspace_dir, attachment.workspace_path);
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
  const label = attachment.kind === "image" ? "image" : "file";
  return `- ${attachment.name} (${label}, ${attachment.mime_type}) at ${attachmentPromptPath(attachment)}`;
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
  const workbook = XLSX.read(buffer, { type: "buffer" });
  let extractedText = `<excel filename="${escapeXmlAttribute(fileName)}">`;
  for (const [index, sheetName] of workbook.SheetNames.entries()) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      continue;
    }
    const csvText = XLSX.utils.sheet_to_csv(worksheet).trim();
    extractedText += `\n<sheet name="${escapeXmlAttribute(sheetName)}" index="${index + 1}">\n${csvText}\n</sheet>`;
  }
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
    return await extractExcelAttachmentText(buffer, attachment.name);
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
  const fallbackLines: string[] = [];
  const images: ImageContent[] = [];

  const instruction = request.instruction.trim();
  if (instruction) {
    sections.push(instruction);
  }

  for (const attachment of request.attachments ?? []) {
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

  if (imageLines.length > 0) {
    sections.push(["Attached images:", ...imageLines].join("\n"));
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
  const hasGlobalAllowlist = request.mcp_tool_refs.length > 0;
  const customTools: ToolDefinition[] = [];
  const mcpToolMetadata = new Map<string, PiMcpToolMetadata>();

  for (const binding of bindings) {
    const allowedTools = allowlist.get(binding.serverId);
    if (!allowedTools && hasGlobalAllowlist) {
      continue;
    }
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

async function defaultCreateSession(request: HarnessHostPiRequest): Promise<PiSessionHandle> {
  const stateDir = resolvePiStateDir(request.workspace_dir);
  const sessionDir = resolvePiSessionDir(request.workspace_dir);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  const authStorage = AuthStorage.create(path.join(stateDir, "auth.json"));
  authStorage.setRuntimeApiKey(request.provider_id, request.model_client.api_key);

  const modelRegistry = new ModelRegistry(authStorage, path.join(stateDir, "models.json"));
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
  modelRegistry.registerProvider(request.provider_id, {
    baseUrl: firstNonEmptyString(request.model_client.base_url),
    headers: providerHeaders,
    // Prefer runtime-managed auth headers when provided by the server, otherwise let Pi attach auth from api_key.
    authHeader: !hasExplicitAuthHeader,
  });

  const model = resolvePiModel(request, modelRegistry);
  const settingsManager = SettingsManager.inMemory({
    defaultProvider: request.provider_id,
    defaultModel: request.model_id,
    defaultThinkingLevel: "medium",
  });
  const skillDirs = resolvePiSkillDirs(request);
  const browserExtensionFactory = request.browser_tools_enabled
    ? await resolvePiDesktopBrowserExtensionFactory({
        runtimeApiBaseUrl: request.runtime_api_base_url,
        workspaceId: request.workspace_id,
      })
    : null;
  const resourceLoader = new DefaultResourceLoader({
    cwd: request.workspace_dir,
    agentDir: stateDir,
    settingsManager,
    extensionFactories: browserExtensionFactory ? [browserExtensionFactory] : [],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    skillsOverride: () => loadPiSkills(skillDirs),
    systemPromptOverride: () => request.system_prompt,
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
  });

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
      tools: [
        ...createCodingTools(request.workspace_dir),
        createGrepTool(request.workspace_dir),
        createFindTool(request.workspace_dir),
        createLsTool(request.workspace_dir),
      ],
      customTools: [...runtimeTools, ...mcpToolset.customTools],
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

function mapPiEvent(
  event: AgentSessionEvent,
  sessionFile: string,
  state: PiEventMapperState
): PiMappedEvent[] {
  switch (event.type) {
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return [
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
      return [];
    case "tool_execution_start": {
      state.toolArgsByCallId.set(event.toolCallId, jsonValue(event.args));
      const metadata = state.mcpToolMetadata.get(event.toolName);
      return [
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
    }
    case "tool_execution_end": {
      const callId = toolCallId(event);
      const args = state.toolArgsByCallId.get(callId) ?? null;
      state.toolArgsByCallId.delete(callId);
      const metadata = state.mcpToolMetadata.get(event.toolName);
      return [
        {
          event_type: "tool_call",
          payload: {
            phase: "completed",
            tool_name: metadata?.toolName ?? event.toolName,
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
    }
    case "agent_end":
      return [
        {
          event_type: "run_completed",
          payload: {
            status: "success",
            event: "agent_end",
            source: "pi",
            harness_session_id: sessionFile,
          },
        },
      ];
    default:
      return [];
  }
}

export function createPiEventMapperState(mcpToolMetadata: ReadonlyMap<string, PiMcpToolMetadata> = new Map()): PiEventMapperState {
  return {
    toolArgsByCallId: new Map(),
    mcpToolMetadata,
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
  const state = createPiEventMapperState(handle.mcpToolMetadata);
  let terminalEmitted = false;
  const unsubscribe = handle.session.subscribe((event) => {
    for (const mapped of mapPiEvent(event, handle.sessionFile, state)) {
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
        status: "success",
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
