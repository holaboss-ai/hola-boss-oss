import archiver from "archiver";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { Writable } from "node:stream";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";

// ---------------------------------------------------------------------------
// Ignore patterns — mirrors backend's ignore_rules.py
// ---------------------------------------------------------------------------

const GLOBAL_IGNORE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "out",
  "storybook-static",
  ".parcel-cache",
  ".vercel",
  ".yarn",
  ".pnpm-store",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "target",
  "tmp",
  "temp",
  ".cache",
  ".turbo",
  "coverage",
  ".holaboss",
]);

/** Glob-style patterns matched against the full relative path (forward-slash separated). */
const GLOBAL_IGNORE_GLOB_PATTERNS: RegExp[] = [
  /^\.env$/,
  /^\.env\./,
  /\.log$/,
  /\.DS_Store$/,
  /\.sqlite$/,
  // data/*.db
  /^data\/[^/]+\.db$/,
  // automations.yaml is always written fresh by the packager
  /^automations\.yaml$/,
];

const SENSITIVE_PATTERNS: RegExp[] = [
  /\.pem$/i,
  /\.key$/i,
  /secret/i,
  /token/i,
  /credential/i,
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AutomationsExport {
  yaml: string;
  count: number;
}

const USER_AUTHORED_CRONJOB_FIELDS = [
  "name",
  "cron",
  "description",
  "instruction",
  "enabled",
  "delivery",
  "metadata",
] as const;

export async function fetchAndSerializeAutomations(
  runtimeBaseUrl: string,
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AutomationsExport> {
  const url = `${runtimeBaseUrl.replace(/\/+$/, "")}/api/v1/cronjobs?workspace_id=${encodeURIComponent(workspaceId)}`;
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`fetch cronjobs failed: ${msg}`);
  }
  if (!res.ok) {
    throw new Error(`fetch cronjobs failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  const stripped = jobs.map((j: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const k of USER_AUTHORED_CRONJOB_FIELDS) {
      if (j[k] !== undefined) out[k] = j[k];
    }
    return out;
  });
  const doc = { version: 1, automations: stripped };
  const yaml = yamlStringify(doc);
  // Round-trip assertion
  const reparsed = yamlParse(yaml);
  if (
    reparsed?.version !== 1 ||
    !Array.isArray(reparsed.automations) ||
    reparsed.automations.length !== stripped.length
  ) {
    throw new Error("automations.yaml round-trip failed");
  }
  return { yaml, count: stripped.length };
}

export interface PackageWorkspaceParams {
  workspaceDir: string;
  apps: string[];
  manifest: Record<string, unknown>;
  runtimeBaseUrl: string;
  workspaceId: string;
  /** Test hook */
  automationsFetcher?: typeof fetchAndSerializeAutomations;
}

export interface PackageResult {
  archiveBuffer: Buffer;
  archiveSizeBytes: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isGloballyIgnored(relPath: string): boolean {
  // Check if any path segment is a globally-ignored directory name
  const parts = relPath.split("/");
  for (const part of parts.slice(0, -1)) {
    // directory segments only
    if (GLOBAL_IGNORE_DIR_NAMES.has(part)) {
      return true;
    }
  }
  // Also check if the leaf itself is a known ignored dir name (when walking dirs)
  const leaf = parts[parts.length - 1];
  if (GLOBAL_IGNORE_DIR_NAMES.has(leaf)) {
    return true;
  }
  // Check glob patterns against full relative path
  for (const re of GLOBAL_IGNORE_GLOB_PATTERNS) {
    if (re.test(relPath)) {
      return true;
    }
  }
  return false;
}

function isSensitive(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  for (const re of SENSITIVE_PATTERNS) {
    if (re.test(lower)) {
      return true;
    }
  }
  return false;
}

/**
 * Parse .hbignore content into a list of patterns.
 * Lines starting with '#' or empty lines are ignored.
 */
function parseHbIgnore(content: string): string[] {
  const patterns: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    patterns.push(line);
  }
  return patterns;
}

/**
 * Returns true if relPath matches the given hbignore pattern.
 * Supports simple filename globs and directory-prefix patterns (ending with /).
 */
function matchesHbPattern(relPath: string, pattern: string): boolean {
  const name = relPath.split("/").pop() ?? "";

  if (pattern.endsWith("/")) {
    // Directory pattern — any path segment matches
    const dirName = pattern.slice(0, -1);
    const parts = relPath.split("/");
    return parts.includes(dirName);
  }

  if (pattern.includes("/")) {
    // Path-anchored glob — match against full relPath
    return minimatch(relPath, pattern);
  }

  // Simple filename/extension glob
  return minimatch(name, pattern);
}

/**
 * Very small glob-to-regex converter supporting `*` and `?` wildcards.
 * Good enough for the patterns used in .hbignore files.
 */
function minimatch(str: string, pattern: string): boolean {
  // Convert glob to regex: escape special chars, then replace * and ?
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]") +
      "$"
  );
  return re.test(str);
}

function isHbIgnored(relPath: string, hbPatterns: string[]): boolean {
  for (const pattern of hbPatterns) {
    if (matchesHbPattern(relPath, pattern)) {
      return true;
    }
  }
  return false;
}

function parseSignedHeaderNames(url: string): string[] {
  const params = new URL(url).searchParams;
  const signedHeaders =
    params.get("X-Amz-SignedHeaders") ??
    params.get("x-amz-signedheaders") ??
    "";
  return signedHeaders
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

export function buildPresignedUploadHeaders(
  url: string,
  dataLength: number,
): Record<string, string> {
  const signedHeaders = parseSignedHeaderNames(url);
  const headers: Record<string, string> = {
    "Content-Length": String(dataLength),
  };

  if (signedHeaders.length === 0 || signedHeaders.includes("content-type")) {
    headers["Content-Type"] = "application/zip";
  }

  return headers;
}

export function buildPresignedUploadError(
  url: string,
  status: number,
  responseBody: string,
): string {
  const signedHeaders = parseSignedHeaderNames(url);
  const uploadHost = new URL(url).host;
  const signedHeadersLabel = signedHeaders.length > 0
    ? signedHeaders.join(", ")
    : "(not provided)";
  const detail = responseBody.trim().slice(0, 500);

  return detail
    ? `Presigned URL upload failed with status ${status}. Host: ${uploadHost}. Signed headers: ${signedHeadersLabel}. Response: ${detail}`
    : `Presigned URL upload failed with status ${status}. Host: ${uploadHost}. Signed headers: ${signedHeadersLabel}`;
}

/**
 * Determine whether a file should be included in the archive.
 */
function shouldInclude(
  relPath: string,
  selectedApps: string[],
  hbPatterns: string[]
): boolean {
  if (isGloballyIgnored(relPath)) {
    return false;
  }
  if (isSensitive(relPath)) {
    return false;
  }
  if (hbPatterns.length > 0 && isHbIgnored(relPath, hbPatterns)) {
    return false;
  }

  // Apps filtering: if selectedApps is non-empty, only allow apps/{selected}/**
  // Non-apps paths always pass through.
  if (selectedApps.length > 0) {
    const appsPrefix = "apps/";
    if (relPath.startsWith(appsPrefix)) {
      const rest = relPath.slice(appsPrefix.length);
      const appName = rest.split("/")[0];
      if (!selectedApps.includes(appName)) {
        return false;
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/**
 * Recursively collect all files under `dir`, returning their relative paths
 * (using forward slashes), sorted for deterministic output.
 * Skips directory trees that are globally ignored early.
 */
async function collectFiles(
  dir: string,
  baseDir: string,
  selectedApps: string[],
  hbPatterns: string[]
): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  // Sort entries for deterministic order
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = path
      .relative(baseDir, absPath)
      .split(path.sep)
      .join("/");

    if (entry.isDirectory()) {
      // Prune globally ignored directories early (no need to recurse)
      if (GLOBAL_IGNORE_DIR_NAMES.has(entry.name)) {
        continue;
      }
      // For apps filtering: prune non-selected app directories early
      if (selectedApps.length > 0 && relPath.startsWith("apps/")) {
        const appName = relPath.slice("apps/".length).split("/")[0];
        if (appName && !selectedApps.includes(appName)) {
          continue;
        }
      }
      const children = await collectFiles(
        absPath,
        baseDir,
        selectedApps,
        hbPatterns
      );
      results.push(...children);
    } else {
      if (shouldInclude(relPath, selectedApps, hbPatterns)) {
        results.push(relPath);
      }
    }
  }

  return results;
}

/**
 * Collect all files in a workspace directory, apply ignore rules and app
 * filtering, create a zip archive in memory, and return the buffer.
 */
export async function packageWorkspace(
  params: PackageWorkspaceParams
): Promise<PackageResult> {
  const {
    workspaceDir,
    apps,
    manifest,
    runtimeBaseUrl,
    workspaceId,
    automationsFetcher = fetchAndSerializeAutomations,
  } = params;

  // Read .hbignore if present
  const hbIgnorePath = path.join(workspaceDir, ".hbignore");
  let hbPatterns: string[] = [];
  if (existsSync(hbIgnorePath)) {
    const content = readFileSync(hbIgnorePath, "utf8");
    hbPatterns = parseHbIgnore(content);
  }

  // Collect files
  const relPaths = await collectFiles(workspaceDir, workspaceDir, apps, hbPatterns);

  // Fetch automations — failures bubble up to the IPC handler
  const automations = await automationsFetcher(runtimeBaseUrl, workspaceId);

  // Build archive in memory
  const chunks: Buffer[] = [];
  const archive = archiver("zip", { zlib: { level: 6 } });

  const bufferWritable = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });

  archive.pipe(bufferWritable);
  const archiveCompleted = new Promise<void>((resolve, reject) => {
    bufferWritable.on("finish", resolve);
    bufferWritable.on("error", reject);
    archive.on("error", reject);
  });

  // Write manifest.json as first entry (with automations_count injected)
  const manifestWithCount = { ...manifest, automations_count: automations.count };
  const manifestJson = JSON.stringify(manifestWithCount, null, 2);
  archive.append(manifestJson, { name: "manifest.json" });

  // Write automations.yaml
  archive.append(automations.yaml, { name: "automations.yaml" });

  // Append workspace files
  for (const relPath of relPaths) {
    const absPath = path.join(workspaceDir, ...relPath.split("/"));
    archive.file(absPath, { name: relPath });
  }

  await archive.finalize();
  await archiveCompleted;

  const archiveBuffer = Buffer.concat(chunks);
  return {
    archiveBuffer,
    archiveSizeBytes: archiveBuffer.byteLength,
  };
}

/**
 * PUT a Buffer to a presigned S3 URL.
 */
export async function uploadToPresignedUrl(
  url: string,
  data: Buffer,
  timeoutMs = 120_000,
): Promise<void> {
  const requester = url.startsWith("https") ? httpsRequest : httpRequest;

  await new Promise<void>((resolve, reject) => {
    const req = requester(
      url,
      {
        method: "PUT",
        headers: buildPresignedUploadHeaders(url, data.byteLength),
        timeout: timeoutMs,
      },
      (res: IncomingMessage) => {
        const responseChunks: string[] = [];
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseChunks.push(chunk);
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve();
          } else {
            reject(
              new Error(
                buildPresignedUploadError(
                  url,
                  status,
                  responseChunks.join(""),
                ),
              ),
            );
          }
        });
        res.on("error", reject);
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Upload timed out after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
