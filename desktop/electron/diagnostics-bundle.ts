import archiver from "archiver";
import Database from "better-sqlite3";
import { createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface DiagnosticsBundleExportParams {
  bundlePath: string;
  runtimeLogPath: string;
  runtimeDbPath: string;
  runtimeConfigPath: string;
  summary: Record<string, unknown>;
}

export interface DiagnosticsBundleExportResult {
  bundlePath: string;
  fileName: string;
  archiveSizeBytes: number;
  includedFiles: string[];
}

const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /cookie/i,
  /^authorization$/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /refresh[_-]?token/i,
  /access[_-]?token/i,
];

function shouldRedactKey(key: string): boolean {
  const normalized = key.trim();
  if (!normalized) {
    return false;
  }
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function redactDiagnosticsValue(
  value: unknown,
  keyName = "",
): unknown {
  if (shouldRedactKey(keyName)) {
    if (value === null || value === undefined) {
      return value;
    }
    return REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnosticsValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactDiagnosticsValue(entry, key),
      ]),
    );
  }

  return value;
}

async function copyIfPresent(sourcePath: string, targetPath: string) {
  if (!existsSync(sourcePath)) {
    return false;
  }
  await fs.copyFile(sourcePath, targetPath);
  return true;
}

async function backupRuntimeDatabase(sourcePath: string, targetPath: string) {
  if (!existsSync(sourcePath)) {
    return false;
  }

  const database = new Database(sourcePath, { fileMustExist: true });
  try {
    await database.backup(targetPath);
    return true;
  } finally {
    database.close();
  }
}

async function writeRedactedRuntimeConfig(
  sourcePath: string,
  targetPath: string,
) {
  if (!existsSync(sourcePath)) {
    return false;
  }

  const rawDocument = await fs.readFile(sourcePath, "utf8");
  let serialized = "";
  try {
    const parsed = JSON.parse(rawDocument) as unknown;
    serialized = `${JSON.stringify(redactDiagnosticsValue(parsed), null, 2)}\n`;
  } catch {
    serialized = `${JSON.stringify(
      {
        error:
          "runtime-config.json could not be parsed for redaction.",
      },
      null,
      2,
    )}\n`;
  }

  await fs.writeFile(targetPath, serialized, "utf8");
  return true;
}

async function createZipArchive(
  bundlePath: string,
  entries: Array<{ sourcePath: string; archivePath: string }>,
) {
  await fs.mkdir(path.dirname(bundlePath), { recursive: true });
  await fs.rm(bundlePath, { force: true });

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(bundlePath);
    const archive = archiver("zip", { zlib: { level: 6 } });

    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    for (const entry of entries) {
      archive.file(entry.sourcePath, { name: entry.archivePath });
    }
    void archive.finalize();
  });
}

export async function exportDiagnosticsBundle(
  params: DiagnosticsBundleExportParams,
): Promise<DiagnosticsBundleExportResult> {
  const stagingRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "holaboss-diagnostics-"),
  );
  const includedFiles: string[] = [];

  try {
    const entries: Array<{ sourcePath: string; archivePath: string }> = [];

    const summaryPath = path.join(stagingRoot, "diagnostics-summary.json");
    await fs.writeFile(
      summaryPath,
      `${JSON.stringify(params.summary, null, 2)}\n`,
      "utf8",
    );
    entries.push({
      sourcePath: summaryPath,
      archivePath: "diagnostics-summary.json",
    });
    includedFiles.push("diagnostics-summary.json");

    const runtimeLogSnapshotPath = path.join(stagingRoot, "runtime.log");
    if (
      await copyIfPresent(params.runtimeLogPath, runtimeLogSnapshotPath)
    ) {
      entries.push({
        sourcePath: runtimeLogSnapshotPath,
        archivePath: "runtime.log",
      });
      includedFiles.push("runtime.log");
    }

    const runtimeDbSnapshotPath = path.join(stagingRoot, "runtime.db");
    if (
      await backupRuntimeDatabase(params.runtimeDbPath, runtimeDbSnapshotPath)
    ) {
      entries.push({
        sourcePath: runtimeDbSnapshotPath,
        archivePath: "runtime.db",
      });
      includedFiles.push("runtime.db");
    }

    const redactedConfigPath = path.join(
      stagingRoot,
      "runtime-config.redacted.json",
    );
    if (
      await writeRedactedRuntimeConfig(
        params.runtimeConfigPath,
        redactedConfigPath,
      )
    ) {
      entries.push({
        sourcePath: redactedConfigPath,
        archivePath: "runtime-config.redacted.json",
      });
      includedFiles.push("runtime-config.redacted.json");
    }

    await createZipArchive(params.bundlePath, entries);
    const archiveStats = await fs.stat(params.bundlePath);

    return {
      bundlePath: params.bundlePath,
      fileName: path.basename(params.bundlePath),
      archiveSizeBytes: archiveStats.size,
      includedFiles,
    };
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}
