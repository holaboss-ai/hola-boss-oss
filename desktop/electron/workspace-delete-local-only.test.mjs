import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSourcePath = path.join(__dirname, "main.ts");

test("workspace deletion is handled locally without calling the control plane", async () => {
  const source = await readFile(mainSourcePath, "utf8");
  const deleteWorkspaceFunction =
    source.match(
      /async function deleteWorkspace\(\s*workspaceId: string,\s*\): Promise<WorkspaceResponsePayload> \{[\s\S]*?\n}\n\nasync function listRuntimeStates/,
    )?.[0] ?? "";

  assert.match(
    deleteWorkspaceFunction,
    /return requestRuntimeJson<WorkspaceResponsePayload>\(\{\s*method: "DELETE",\s*path: `\/api\/v1\/workspaces\/\$\{encodeURIComponent\(workspaceId\)\}`,\s*\}\);/,
  );
  assert.doesNotMatch(deleteWorkspaceFunction, /requestControlPlaneJson/);
  assert.doesNotMatch(deleteWorkspaceFunction, /controlPlaneWorkspaceUserId/);
  assert.doesNotMatch(deleteWorkspaceFunction, /projects\/workspaces/);
});
