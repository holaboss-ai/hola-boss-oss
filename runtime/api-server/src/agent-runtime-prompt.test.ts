import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentCapabilityManifest } from "./agent-capability-registry.js";
import { composeAgentPrompt, composeBaseAgentPrompt } from "./agent-runtime-prompt.js";

test("composeBaseAgentPrompt returns ordered runtime prompt layers", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    defaultTools: ["read", "edit"],
    extraTools: [],
    workspaceSkillIds: ["skill-creator"],
    resolvedMcpToolRefs: [
      {
        tool_id: "workspace.lookup",
        server_id: "workspace",
        tool_name: "lookup",
      },
    ],
    toolServerIdMap: {
      workspace: "workspace__sandbox123",
    },
  });

  const prompt = composeBaseAgentPrompt("You are concise.", {
    defaultTools: ["read", "edit"],
    extraTools: [],
    workspaceSkillIds: ["skill-creator"],
    resolvedMcpToolRefs: [
      {
        tool_id: "workspace.lookup",
        server_id: "workspace",
        tool_name: "lookup",
      },
    ],
    sessionKind: "workspace_session",
    sessionMode: "code",
    harnessId: "pi",
    capabilityManifest,
  });

  assert.deepEqual(prompt.promptLayers.map((layer) => layer.id), [
    "runtime_core",
    "execution_policy",
    "response_delivery_policy",
    "session_policy",
    "capability_policy",
    "workspace_policy",
  ]);
  assert.deepEqual(prompt.promptSections.map((section) => section.id), [
    "runtime_core",
    "execution_policy",
    "response_delivery_policy",
    "session_policy",
    "capability_policy",
    "capability_availability_context",
    "workspace_policy",
  ]);
  assert.deepEqual(prompt.promptSections.map((section) => section.channel), [
    "system_prompt",
    "system_prompt",
    "system_prompt",
    "system_prompt",
    "system_prompt",
    "context_message",
    "system_prompt",
  ]);
  assert.deepEqual(prompt.promptSections.map((section) => section.priority), [100, 200, 250, 300, 400, 450, 600]);
  assert.deepEqual(prompt.promptSections.map((section) => section.volatility), [
    "stable",
    "stable",
    "stable",
    "workspace",
    "workspace",
    "run",
    "workspace",
  ]);
  assert.deepEqual(prompt.promptSections.map((section) => section.precedence), [
    "base_runtime",
    "base_runtime",
    "base_runtime",
    "session_policy",
    "capability_policy",
    "capability_policy",
    "workspace_policy",
  ]);
  assert.deepEqual(prompt.promptLayers.map((layer) => layer.apply_at), [
    "runtime_config",
    "runtime_config",
    "runtime_config",
    "runtime_config",
    "runtime_config",
    "runtime_config",
  ]);
  assert.match(prompt.systemPrompt, /^Base runtime instructions:/);
  assert.match(prompt.systemPrompt, /Execution doctrine:/);
  assert.match(prompt.systemPrompt, /Response delivery policy:/);
  assert.match(
    prompt.systemPrompt,
    /Treat local git as an internal recovery tool\./
  );
  assert.match(
    prompt.systemPrompt,
    /Inspect before mutating workspace, app, browser, runtime state, or external systems when possible\./
  );
  assert.match(
    prompt.systemPrompt,
    /After edits, commands, browser actions, or state-changing tool calls, verify the result with the most direct inspection path available\./
  );
  assert.match(
    prompt.systemPrompt,
    /Use available tools, skills, and MCP integrations when they are more reliable than reasoning alone\./
  );
  assert.match(
    prompt.systemPrompt,
    /Treat explicit user requirements and verification targets as completion criteria, not optional detail\./
  );
  assert.match(
    prompt.systemPrompt,
    /Treat the active workspace root as the default boundary\./
  );
  assert.match(
    prompt.systemPrompt,
    /Do not cross it unless the user explicitly asks, and then keep the scope minimal\./
  );
  assert.match(
    prompt.systemPrompt,
    /Keep short lookups and straightforward explanations inline\./
  );
  assert.match(
    prompt.systemPrompt,
    /Do not create a report just because tools were used\./
  );
  assert.match(
    prompt.systemPrompt,
    /Use `write_report` for long, structured, evidence-heavy, or referenceable outputs/
  );
  assert.match(
    prompt.systemPrompt,
    /For research, investigation, comparison, timeline, or latest-news tasks across multiple sources, prefer a report artifact/
  );
  assert.match(
    prompt.systemPrompt,
    /mention the report path or title and only the most important takeaways in chat\./
  );
  assert.match(
    prompt.systemPrompt,
    /Use coordination tools instead of hidden state\. The newest user message is primary\./
  );
  assert.match(
    prompt.systemPrompt,
    /Resume unfinished work only when the newest message clearly asks to continue it/
  );
  assert.match(
    prompt.systemPrompt,
    /Create or update a workspace-local skill when the user describes a reusable workflow/
  );
  assert.match(
    prompt.systemPrompt,
    /do not create skills for one-off state\./i
  );
  assert.match(prompt.systemPrompt, /Session policy:/);
  assert.match(prompt.systemPrompt, /front-of-house workspace session/i);
  assert.match(prompt.systemPrompt, /Capability policy for this run:/);
  assert.match(prompt.systemPrompt, /Workspace instructions from AGENTS\.md:/);
  assert.doesNotMatch(prompt.systemPrompt, /OpenCode MCP tool naming:/);
  assert.doesNotMatch(prompt.systemPrompt, /Inspect capabilities available now:/);
  assert.doesNotMatch(prompt.systemPrompt, /Mutating capabilities available now:/);
  assert.doesNotMatch(prompt.systemPrompt, /Connected MCP tools available now:/);
  assert.doesNotMatch(prompt.systemPrompt, /Skills available now:/);
  assert.doesNotMatch(prompt.systemPrompt, /Connected MCP access: available\./);
  assert.ok(prompt.systemPrompt.length < 4500);
  assert.equal(prompt.contextMessages.length, 1);
  assert.match(prompt.contextMessages.join("\n\n"), /Capability availability snapshot:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Inspect tools: available \(\d+ enabled\)\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Mutating tools: available \(\d+ enabled\)\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Workspace skills: available \(1 enabled\)\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Connected MCP access: available\./);
  assert.deepEqual(prompt.promptCacheProfile.cacheable_section_ids, [
    "runtime_core",
    "execution_policy",
    "response_delivery_policy",
    "session_policy",
    "capability_policy",
    "workspace_policy",
  ]);
  assert.deepEqual(prompt.promptCacheProfile.volatile_section_ids, []);
  assert.deepEqual(prompt.promptCacheProfile.compatibility_context_ids, [
    "capability_availability_context",
  ]);
  assert.deepEqual(prompt.promptCacheProfile.precedence_order, [
    "base_runtime",
    "session_policy",
    "capability_policy",
    "runtime_context",
    "workspace_policy",
    "harness_addendum",
    "agent_override",
    "emergency_override",
  ]);
  assert.match(prompt.promptCacheProfile.cacheable_fingerprint, /^[a-f0-9]{64}$/);
  assert.match(prompt.promptCacheProfile.full_system_prompt_fingerprint, /^[a-f0-9]{64}$/);
});

test("composeAgentPrompt uses a conversational main-session prompt for workspace sessions", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    defaultTools: ["read", "edit"],
    extraTools: ["holaboss_delegate_task", "holaboss_get_subagent", "holaboss_list_background_tasks"],
    runtimeToolIds: ["holaboss_delegate_task", "holaboss_get_subagent", "holaboss_list_background_tasks"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    toolServerIdMap: {},
  });

  const prompt = composeAgentPrompt("You are concise.", {
    defaultTools: ["read", "edit"],
    extraTools: ["holaboss_delegate_task", "holaboss_get_subagent", "holaboss_list_background_tasks"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    harnessId: "pi",
    capabilityManifest,
  });

  assert.match(prompt.systemPrompt, /Conversation and orchestration doctrine:/);
  assert.match(prompt.systemPrompt, /single front-of-house counterpart/);
  assert.match(prompt.systemPrompt, /thoughtful human collaborator/);
  assert.match(prompt.systemPrompt, /brief warmth, curiosity, and point of view/);
  assert.match(prompt.systemPrompt, /Acknowledge what matters in the user's message before diving into execution or results\./);
  assert.match(prompt.systemPrompt, /Avoid repetitive canned phrasing or stiff assistant boilerplate/);
  assert.match(prompt.systemPrompt, /Prefer delegating long-running, tool-heavy, interruptible, or execution-heavy work to hidden subagents\./);
  assert.match(prompt.systemPrompt, /delegate instead of replying that this run lacks those tools\./);
  assert.match(prompt.systemPrompt, /missing web, browser, terminal, or other execution-heavy capabilities on the main session as a routing signal to delegate/i);
  assert.match(prompt.systemPrompt, /Do not paste long document, HTML, markdown, or report bodies into chat\./);
  assert.doesNotMatch(prompt.systemPrompt, /Execution doctrine:/);
  assert.doesNotMatch(prompt.systemPrompt, /Todo continuity policy:/);
  assert.doesNotMatch(prompt.systemPrompt, /Use `write_report` for long, structured, evidence-heavy, or referenceable outputs/);
});

test("composeAgentPrompt keeps main sessions free of todo doctrine even if todo tools are present", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    defaultTools: ["read", "todoread", "todowrite", "holaboss_scratchpad_read", "holaboss_scratchpad_write"],
    extraTools: ["holaboss_delegate_task"],
    runtimeToolIds: ["holaboss_delegate_task", "holaboss_scratchpad_read", "holaboss_scratchpad_write"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    toolServerIdMap: {},
  });

  const prompt = composeAgentPrompt("", {
    defaultTools: ["read", "todoread", "todowrite", "holaboss_scratchpad_read", "holaboss_scratchpad_write"],
    extraTools: ["holaboss_delegate_task"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    harnessId: "pi",
    capabilityManifest,
  });

  assert.doesNotMatch(prompt.systemPrompt, /Todo continuity policy:/);
  assert.doesNotMatch(
    prompt.systemPrompt,
    /When you need the current phase ids, task ids, or recorded state from an existing todo before continuing or updating it, use `todoread` first instead of guessing\./
  );
  assert.doesNotMatch(
    prompt.systemPrompt,
    /Use `todowrite` for task structure and status only; use the scratchpad/
  );
  assert.doesNotMatch(
    prompt.contextMessages.join("\n"),
    /Do not use `todowrite` as a substitute for scratchpad notes/
  );
  assert.equal(
    prompt.promptSections.some((section) => section.id === "scratchpad_context"),
    false,
  );
  assert.equal(
    prompt.promptCacheProfile.context_message_ids.includes("scratchpad_context"),
    false,
  );
});

test("composeAgentPrompt keeps onboarding sessions free of subagent delegation doctrine", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    defaultTools: ["read", "edit"],
    extraTools: ["holaboss_onboarding_status", "holaboss_onboarding_complete"],
    runtimeToolIds: ["holaboss_onboarding_status", "holaboss_onboarding_complete"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    toolServerIdMap: {},
  });

  const prompt = composeAgentPrompt("You are concise.", {
    defaultTools: ["read", "edit"],
    extraTools: ["holaboss_onboarding_status", "holaboss_onboarding_complete"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "onboarding",
    sessionMode: "code",
    harnessId: "pi",
    capabilityManifest,
  });

  assert.match(prompt.systemPrompt, /This is an onboarding session\./);
  assert.match(prompt.systemPrompt, /Keep onboarding work in this session\./);
  assert.doesNotMatch(
    prompt.systemPrompt,
    /Prefer delegating long-running, tool-heavy, interruptible, or execution-heavy work to hidden subagents\./,
  );
  assert.doesNotMatch(
    prompt.systemPrompt,
    /delegate instead of replying that this run lacks those tools\./,
  );
  assert.doesNotMatch(prompt.systemPrompt, /Subagents are backstage executors\./);
});

test("composeAgentPrompt tells main sessions how to inspect legacy session exports", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    defaultTools: ["read", "glob", "list"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    toolServerIdMap: {},
  });

  const prompt = composeAgentPrompt("", {
    defaultTools: ["read", "glob", "list"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    harnessId: "pi",
    legacySessionHistoryContext: {
      manifest_path: ".holaboss/legacy-session-histories/index.json",
      legacy_session_count: 2,
      entries: [
        {
          session_id: "session-older",
          title: "Earlier planning chat",
          kind: "workspace_session",
          archived_at: "2026-04-24T06:52:27.419Z",
          message_count: 14,
          output_count: 1,
          json_path: ".holaboss/legacy-session-histories/session-older.json",
          markdown_path: ".holaboss/legacy-session-histories/session-older.md",
        },
      ],
    },
    capabilityManifest,
  });

  assert.match(prompt.contextMessages.join("\n"), /Legacy session history exports:/);
  assert.match(prompt.contextMessages.join("\n"), /consult the manifest or a directly relevant export before saying that prior session context is unavailable/i);
  assert.match(prompt.contextMessages.join("\n"), /Manifest path: `\.holaboss\/legacy-session-histories\/index\.json`\./);
  assert.match(prompt.contextMessages.join("\n"), /Earlier planning chat:/);
});

test("composeBaseAgentPrompt includes shared todo continuity policy when todo tools are available", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    defaultTools: ["read", "todoread", "todowrite"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
  });

  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read", "todoread", "todowrite"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    capabilityManifest,
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "todo_continuity_policy"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "todo_continuity_policy")?.channel,
    "system_prompt"
  );
  assert.equal(
    prompt.promptSections.find((section) => section.id === "todo_continuity_policy")?.precedence,
    "capability_policy"
  );
  assert.deepEqual(prompt.promptLayers.map((layer) => layer.id), [
    "runtime_core",
    "execution_policy",
    "response_delivery_policy",
    "session_policy",
    "todo_continuity_policy",
    "capability_policy",
  ]);
  assert.match(prompt.systemPrompt, /Todo continuity policy:/);
  assert.match(
    prompt.systemPrompt,
    /Treat the user's newest message as the primary instruction for the current turn even when unfinished todo state may already exist\./
  );
  assert.match(
    prompt.systemPrompt,
    /When you need the current phase ids, task ids, or recorded state from an existing todo before continuing or updating it, use `todoread` first instead of guessing\./
  );
  assert.match(
    prompt.systemPrompt,
    /Do not stop only to give progress updates or ask whether to continue while executable todo items remain after the user already asked you to continue\./
  );
  assert.match(
    prompt.systemPrompt,
    /If the user's newest message clearly redirects to unrelated work, handle that new request first without marking the unfinished todo complete, then propose continuing it afterward\./
  );
  assert.deepEqual(prompt.promptCacheProfile.cacheable_section_ids, [
    "runtime_core",
    "execution_policy",
    "response_delivery_policy",
    "session_policy",
    "todo_continuity_policy",
    "capability_policy",
  ]);
  assert.deepEqual(prompt.promptCacheProfile.volatile_section_ids, []);
});

test("composeBaseAgentPrompt promotes scratchpad as working memory even before a scratchpad file exists", () => {
  const defaultTools = ["read", "todoread", "todowrite", "holaboss_scratchpad_read", "holaboss_scratchpad_write"];
  const capabilityManifest = buildAgentCapabilityManifest({
    runtimeToolIds: ["todoread", "todowrite", "holaboss_scratchpad_read", "holaboss_scratchpad_write"],
    defaultTools,
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
  });

  const prompt = composeBaseAgentPrompt("", {
    defaultTools,
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    capabilityManifest,
  });

  assert.match(
    prompt.systemPrompt,
    /When a task becomes multi-step, evidence-heavy, or long-running, create or update the session scratchpad early and keep the current working state there\./
  );
  assert.match(
    prompt.systemPrompt,
    /Use `todowrite` for task structure and status only; use the scratchpad for verified findings, interim evidence, candidate lists, open questions, and compacted current state\./
  );
  assert.ok(prompt.promptSections.some((section) => section.id === "scratchpad_context"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "scratchpad_context")?.channel,
    "context_message"
  );
  assert.match(
    prompt.contextMessages.join("\n"),
    /A session-scoped scratchpad is available for this session, but no scratchpad file exists yet\./
  );
  assert.match(
    prompt.contextMessages.join("\n"),
    /Do not use `todowrite` as a substitute for scratchpad notes; todo state is for task coordination, not evidence or long-form working memory\./
  );
  assert.ok(prompt.promptCacheProfile.context_message_ids.includes("scratchpad_context"));
  assert.ok(prompt.promptCacheProfile.compatibility_context_ids.includes("scratchpad_context"));
});

test("composeBaseAgentPrompt exposes existing scratchpad metadata without collapsing it into todo state", () => {
  const defaultTools = ["read", "todoread", "todowrite", "holaboss_scratchpad_read", "holaboss_scratchpad_write"];
  const capabilityManifest = buildAgentCapabilityManifest({
    runtimeToolIds: ["todoread", "todowrite", "holaboss_scratchpad_read", "holaboss_scratchpad_write"],
    defaultTools,
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
  });

  const prompt = composeBaseAgentPrompt("", {
    defaultTools,
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    capabilityManifest,
    scratchpadContext: {
      exists: true,
      file_path: ".holaboss/scratchpads/session-main.md",
      updated_at: "2026-04-23T15:00:00.000Z",
      size_bytes: 128,
      preview: "- verified finding\n- open question",
    },
  });

  const scratchpadMessage = prompt.contextMessages.join("\n");
  assert.match(scratchpadMessage, /A session-scoped scratchpad file already exists for this session\./);
  assert.match(
    scratchpadMessage,
    /Use the scratchpad as the session's working memory for multi-step execution, interim findings, open questions, candidate lists, and compacted current state\./
  );
  assert.match(scratchpadMessage, /Path: `\.holaboss\/scratchpads\/session-main\.md`\./);
  assert.match(scratchpadMessage, /Preview: - verified finding/);
  assert.match(
    scratchpadMessage,
    /Do not use `todowrite` as a substitute for scratchpad notes; todo state is for task coordination, not evidence or long-form working memory\./
  );
});

test("composeBaseAgentPrompt keeps the cacheable fingerprint stable across runtime-only context changes", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    harnessId: "pi",
    sessionKind: "workspace_session",
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
  });

  const basePrompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    capabilityManifest,
  });

  const promptWithRuntimeContext = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    capabilityManifest,
    operatorSurfaceContext: {
      active_surface_id: "browser:user",
      surfaces: [
        {
          surface_id: "browser:user",
          surface_type: "browser",
          owner: "user",
          active: true,
          mutability: "inspect_only",
          summary: "User browser currently focused on the release dashboard.",
        },
      ],
    },
    pendingUserMemoryContext: {
      entries: [
        {
          proposal_id: "proposal-1",
          proposal_kind: "preference",
          target_key: "response-style",
          title: "Response style",
          summary: "Prefer terse answers.",
        },
      ],
    },
  });

  assert.equal(
    basePrompt.promptCacheProfile.cacheable_fingerprint,
    promptWithRuntimeContext.promptCacheProfile.cacheable_fingerprint,
  );
  assert.equal(basePrompt.systemPrompt, promptWithRuntimeContext.systemPrompt);
  assert.notDeepEqual(basePrompt.contextMessages, promptWithRuntimeContext.contextMessages);
});

test("composeBaseAgentPrompt includes current user context when provided", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    currentUserContext: {
      profile_id: "default",
      name: "Jeffrey",
      name_source: "manual",
    },
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "current_user_context"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "current_user_context")?.channel,
    "context_message"
  );
  assert.equal(
    prompt.promptSections.find((section) => section.id === "current_user_context")?.precedence,
    "runtime_context"
  );
  assert.equal(prompt.promptLayers.some((layer) => layer.id === "current_user_context"), false);
  assert.doesNotMatch(prompt.systemPrompt, /Current user context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Current user context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /The current operator name is `Jeffrey`\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Name source: `manual`\./);
});

test("composeBaseAgentPrompt includes operator surface context when provided", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    operatorSurfaceContext: {
      active_surface_id: "browser:user",
      surfaces: [
        {
          surface_id: "browser:user",
          surface_type: "browser",
          owner: "user",
          active: true,
          mutability: "inspect_only",
          summary: "User browser surface with 1 open tab. Active tab: \"Inbox\" at https://mail.google.com. It shares the workspace browser session and auth state with the other browser surface.",
        },
        {
          surface_id: "browser:agent",
          surface_type: "browser",
          owner: "agent",
          active: false,
          mutability: "agent_owned",
          summary: "Agent browser surface with 2 open tabs. Active tab: \"Docs\" at https://docs.example.com. It shares the workspace browser session and auth state with the other browser surface.",
        },
      ],
    },
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "operator_surface_context"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "operator_surface_context")?.channel,
    "context_message"
  );
  assert.equal(
    prompt.promptSections.find((section) => section.id === "operator_surface_context")?.precedence,
    "runtime_context"
  );
  assert.equal(prompt.promptLayers.some((layer) => layer.id === "operator_surface_context"), false);
  assert.doesNotMatch(prompt.systemPrompt, /Operator surface context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Operator surface context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /default referent for deictic questions such as `what am I looking at right now`/i);
  assert.match(prompt.contextMessages.join("\n\n"), /continue from what they already opened, navigated, selected, or prepared/i);
  assert.match(prompt.contextMessages.join("\n\n"), /do not answer from browser state just because browser tools are available/i);
  assert.match(prompt.contextMessages.join("\n\n"), /Do not mutate a user-owned surface unless runtime context or capabilities explicitly allow takeover or direct control\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Current active surface id: `browser:user`\./);
  assert.match(prompt.contextMessages.join("\n\n"), /\[user\/browser\] `browser:user` \(active, mutability=`inspect_only`\):/);
  assert.match(prompt.contextMessages.join("\n\n"), /\[agent\/browser\] `browser:agent` \(mutability=`agent_owned`\):/);
});

test("composeBaseAgentPrompt includes pending user memory context when provided", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    pendingUserMemoryContext: {
      entries: [
        {
          proposal_id: "proposal-1",
          proposal_kind: "preference",
          target_key: "file-delivery",
          title: "File delivery preference",
          summary: "Do not compress or zip multiple files; deliver them individually.",
          evidence: "Please do not zip the files. Send them individually.",
        },
      ],
    },
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "pending_user_memory"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "pending_user_memory")?.channel,
    "context_message"
  );
  assert.equal(
    prompt.promptSections.find((section) => section.id === "pending_user_memory")?.precedence,
    "runtime_context"
  );
  assert.equal(prompt.promptLayers.some((layer) => layer.id === "pending_user_memory"), false);
  assert.match(prompt.contextMessages.join("\n\n"), /Current-turn inferred user memory:/);
  assert.match(prompt.contextMessages.join("\n\n"), /not durably saved yet/i);
  assert.match(prompt.contextMessages.join("\n\n"), /File delivery preference: Do not compress or zip multiple files; deliver them individually\./);
});

test("composeBaseAgentPrompt includes accepted evolve candidate context when provided", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "task_proposal",
    sessionMode: "code",
    evolveCandidateContext: {
      candidate_id: "evolve-skill-input-10",
      kind: "skill_create",
      title: "Release verification skill",
      summary: "Reusable release verification workflow.",
      slug: "release-verification",
      skill_path: "workspace/workspace-1/evolve/skills/evolve-skill-input-10/SKILL.md",
      target_skill_path: "skills/release-verification/SKILL.md",
      skill_markdown: [
        "---",
        "name: release-verification",
        "description: Reusable release verification workflow.",
        "---",
        "# Release verification skill",
      ].join("\n"),
      task_proposal_id: "evolve-proposal-1",
    },
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "evolve_candidate_context"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "evolve_candidate_context")?.channel,
    "context_message"
  );
  assert.match(prompt.contextMessages.join("\n\n"), /Accepted evolve candidate:/);
  assert.match(prompt.contextMessages.join("\n\n"), /background evolve phase/i);
  assert.match(prompt.contextMessages.join("\n\n"), /Candidate id: `evolve-skill-input-10`\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Stored draft artifact in memory service: `workspace\/workspace-1\/evolve\/skills\/evolve-skill-input-10\/SKILL\.md`\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Target live workspace skill path: `skills\/release-verification\/SKILL\.md`\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Do not create or keep promoted workspace skills under `evolve\/`/);
  assert.match(prompt.contextMessages.join("\n\n"), /name: release-verification/);
});

test("composeBaseAgentPrompt includes recalled durable memory as context message", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    recalledMemoryContext: {
      entries: [
        {
          scope: "user",
          memory_type: "preference",
          title: "User response style",
          summary: "User prefers concise responses.",
          path: "preference/response-style.md",
          verification_policy: "none",
          staleness_policy: "stable",
          freshness_state: "stable",
          freshness_note: "This memory is treated as stable unless explicitly changed.",
        },
        {
          scope: "workspace",
          memory_type: "blocker",
          title: "Deploy permission blocker",
          summary: "Deploy calls may be denied by workspace policy.",
          path: "workspace/workspace-1/knowledge/blockers/deploy.md",
          verification_policy: "check_before_use",
          staleness_policy: "workspace_sensitive",
          freshness_state: "fresh",
          freshness_note: "Verify this memory against the current workspace state before acting on it.",
        },
      ],
    },
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "memory_recall"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "memory_recall")?.channel,
    "context_message"
  );
  assert.equal(
    prompt.promptSections.find((section) => section.id === "memory_recall")?.precedence,
    "runtime_context"
  );
  assert.equal(prompt.promptLayers.some((layer) => layer.id === "memory_recall"), false);
  assert.doesNotMatch(prompt.systemPrompt, /Recalled durable memory:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Recalled durable memory:/);
  assert.match(prompt.contextMessages.join("\n\n"), /User response style/);
  assert.match(prompt.contextMessages.join("\n\n"), /Deploy permission blocker/);
  assert.match(prompt.contextMessages.join("\n\n"), /check_before_use/);
  assert.match(prompt.contextMessages.join("\n\n"), /Freshness: `stable` \(`stable`\)/);
  assert.match(prompt.contextMessages.join("\n\n"), /Freshness: `fresh` \(`workspace_sensitive`\)/);
});

test("composeBaseAgentPrompt includes cronjob delivery routing guidance when cronjob tools are available", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    defaultTools: ["read"],
    extraTools: ["holaboss_cronjobs_create"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    harnessId: "pi",
  });

  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: ["holaboss_cronjobs_create"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    harnessId: "pi",
    capabilityManifest,
  });

  assert.match(prompt.systemPrompt, /Cronjob delivery routing:/);
  assert.match(prompt.systemPrompt, /use `session_run` for recurring agent work/i);
  assert.match(prompt.systemPrompt, /Use `system_notification` only for lightweight reminders or notifications/i);
  assert.match(prompt.systemPrompt, /put the executable task in `instruction`/i);
  assert.match(prompt.systemPrompt, /Do not repeat schedule wording/i);
});

test("composeBaseAgentPrompt includes background terminal guidance when terminal session tools are available", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    defaultTools: ["read", "bash"],
    extraTools: ["terminal_session_start", "terminal_session_wait", "terminal_session_read"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    harnessId: "pi",
  });

  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read", "bash"],
    extraTools: ["terminal_session_start", "terminal_session_wait", "terminal_session_read"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    harnessId: "pi",
    capabilityManifest,
  });

  assert.match(prompt.systemPrompt, /Background terminal routing:/);
  assert.match(prompt.systemPrompt, /prefer `terminal_session_start` for long-running, interactive, or revisitable shell work/i);
  assert.match(prompt.systemPrompt, /Prefer one-shot `bash` for short commands/i);
  assert.match(prompt.systemPrompt, /inspect it with `terminal_session_read` or `terminal_session_wait` before claiming success/i);
});

test("composeBaseAgentPrompt requires proactive fallback when partial retrieval cannot satisfy required facts", () => {
  const capabilityManifest = buildAgentCapabilityManifest({
    harnessId: "pi",
    sessionKind: "workspace_session",
    browserToolsAvailable: true,
    browserToolIds: ["browser_get_state"],
    defaultTools: ["read"],
    extraTools: ["browser_get_state", "web_search"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
  });

  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: ["browser_get_state", "web_search"],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    harnessId: "pi",
    capabilityManifest,
  });

  assert.match(
    prompt.systemPrompt,
    /Treat explicit user requirements and verification targets as completion criteria, not optional detail\./
  );
  assert.match(
    prompt.systemPrompt,
    /If evidence is incomplete, keep retrieving or say exactly what remains unverified\./
  );
  assert.match(
    prompt.systemPrompt,
    /Use available tools, skills, and MCP integrations when they are more reliable than reasoning alone\./
  );
  assert.match(
    prompt.systemPrompt,
    /When browser tools are available, use them for UI-specific verification and prefer DOM-grounded actions and extraction; use screenshots only when visual confirmation matters\./
  );
  assert.match(
    prompt.systemPrompt,
    /When browser tools are available, use them for UI-specific verification and prefer DOM-grounded actions and extraction; use screenshots only when visual confirmation matters\./
  );
});
