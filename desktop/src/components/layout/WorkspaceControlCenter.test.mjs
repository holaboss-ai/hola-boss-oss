import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WORKSPACE_CONTROL_CENTER_PATH = new URL(
  "./WorkspaceControlCenter.tsx",
  import.meta.url,
);

test("workspace control center renders preview cards through the main chat turn components", async () => {
  const source = await readFile(WORKSPACE_CONTROL_CENTER_PATH, "utf8");

  assert.match(
    source,
    /import \{[\s\S]*AssistantTurn,[\s\S]*ArtifactBrowserModal,[\s\S]*type ArtifactBrowserFilter,[\s\S]*type ChatMessage,[\s\S]*UserTurn,[\s\S]*\} from "@\/components\/panes\/ChatPane";/,
  );
  assert.match(source, /attachmentsFromMetadata\(message\.metadata\)/);
  assert.match(source, /nextMessage\.outputs = turnOutputs;/);
  assert.match(source, /<UserTurn/);
  assert.match(source, /<AssistantTurn/);
  assert.match(source, /onOpenOutput=\{\(output\) =>/);
  assert.match(source, /onOpenOutput\(workspaceId, output\)/);
  assert.match(source, /const \[artifactBrowserOpen, setArtifactBrowserOpen\] = useState\(false\);/);
  assert.match(source, /const \[artifactBrowserFilter, setArtifactBrowserFilter\] =\s*useState<ArtifactBrowserFilter>\("all"\);/);
  assert.match(source, /const \[artifactBrowserOutputs, setArtifactBrowserOutputs\] = useState<\s*WorkspaceOutputRecordPayload\[]\s*>\(\[\]\);/);
  assert.match(source, /const handleOpenArtifacts = useCallback\(\s*\(outputs: WorkspaceOutputRecordPayload\[]\) => \{/);
  assert.match(source, /setArtifactBrowserOutputs\(outputs\);/);
  assert.match(source, /setArtifactBrowserOpen\(true\);/);
  assert.match(source, /onOpenAllArtifacts=\{handleOpenArtifacts\}/);
  assert.match(source, /<ArtifactBrowserModal[\s\S]*layout="card"/);
});

test("workspace control center loads the latest main-session history slice and recent turn outputs", async () => {
  const source = await readFile(WORKSPACE_CONTROL_CENTER_PATH, "utf8");

  assert.match(source, /order: "desc"/);
  assert.match(source, /historyMessagesInDisplayOrder\(\s*history\.messages,\s*"desc"/);
  assert.match(source, /window\.electronAPI\.workspace\.listOutputs\(\{\s*workspaceId,\s*sessionId,/);
  assert.match(source, /turnInputIdsFromHistoryMessages\(historyMessages\)/);
  assert.match(
    source,
    /outputsResponse\.items\.filter\(\(output\) =>\s*previewInputIds\.has\(\(output\.input_id \|\| ""\)\.trim\(\)\),/,
  );
});
