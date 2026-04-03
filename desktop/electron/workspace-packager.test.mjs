import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as workspacePackager from "./workspace-packager.ts";

test("packageWorkspace resolves for a minimal workspace", async () => {
  const workspaceDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "holaboss-workspace-packager-"),
  );

  await fs.writeFile(path.join(workspaceDir, "workspace.yaml"), "name: test\n", "utf8");
  await fs.writeFile(path.join(workspaceDir, "README.md"), "# Test\n", "utf8");

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("packageWorkspace timed out")), 1000);
  });

  const result = await Promise.race([
    workspacePackager.packageWorkspace({
      workspaceDir,
      apps: [],
      manifest: { name: "Test template", version: "1.0.0" },
    }),
    timeout,
  ]);

  assert.ok(result.archiveSizeBytes > 0);
  assert.ok(Buffer.isBuffer(result.archiveBuffer));
});

test("buildPresignedUploadHeaders omits content-type when the presigned URL does not sign it", async () => {
  const headers = workspacePackager.buildPresignedUploadHeaders(
    "https://storage.example/upload?X-Amz-SignedHeaders=host",
    Buffer.byteLength("archive"),
  );

  assert.equal(headers["Content-Type"], undefined);
  assert.equal(headers["Content-Length"], String(Buffer.byteLength("archive")));
});

test("buildPresignedUploadError includes the response body and signed headers", async () => {
  const message = workspacePackager.buildPresignedUploadError(
    "https://storage.example/upload?X-Amz-SignedHeaders=host%3Bcontent-type",
    403,
    "<Error><Code>SignatureDoesNotMatch</Code></Error>",
  );

  assert.match(message, /403/);
  assert.match(message, /SignatureDoesNotMatch/);
  assert.match(message, /host, content-type/);
  assert.match(message, /storage\.example/);
});
