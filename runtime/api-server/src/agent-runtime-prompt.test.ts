import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentCapabilityManifest } from "./agent-capability-registry.js";
import { composeBaseAgentPrompt } from "./agent-runtime-prompt.js";

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
    "workspace_policy",
  ]);
  assert.deepEqual(prompt.promptSections.map((section) => section.channel), [
    "system_prompt",
    "system_prompt",
    "system_prompt",
    "system_prompt",
    "system_prompt",
    "system_prompt",
  ]);
  assert.deepEqual(prompt.promptSections.map((section) => section.priority), [100, 200, 250, 300, 400, 600]);
  assert.deepEqual(prompt.promptSections.map((section) => section.volatility), [
    "stable",
    "stable",
    "stable",
    "run",
    "run",
    "workspace",
  ]);
  assert.deepEqual(prompt.promptSections.map((section) => section.precedence), [
    "base_runtime",
    "base_runtime",
    "base_runtime",
    "session_policy",
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
    /If local git is available, treat it as an internal recovery mechanism for the agent rather than a user-facing workflow\./
  );
  assert.match(
    prompt.systemPrompt,
    /When meaningful changes are implemented and verified, create concise local checkpoint commits for agent recovery\./
  );
  assert.match(
    prompt.systemPrompt,
    /Do not proactively surface git status, dirty or untracked file reports, repository cleanup recommendations, or checkpoint\/commit chatter to the user\./
  );
  assert.match(
    prompt.systemPrompt,
    /Only discuss explicit git operations when the user directly asks for version-control help or when the task cannot be completed otherwise\./
  );
  assert.match(
    prompt.systemPrompt,
    /Do not use destructive git history operations such as reset --hard, rebase, or force pushes unless the user explicitly asks for them\./
  );
  assert.match(
    prompt.systemPrompt,
    /Treat the active workspace root as a hard boundary: do not read, write, edit, execute against, or reference paths outside the workspace by default\./
  );
  assert.match(
    prompt.systemPrompt,
    /Block path traversal and cross-workspace access by default, including parent-directory paths, absolute external paths, and symlink escapes\./
  );
  assert.match(
    prompt.systemPrompt,
    /Keep the answer inline for simple lookups, definitions, narrow factual questions, brief clarifications, and other requests that can be answered well in a short paragraph or a few bullets\./
  );
  assert.match(
    prompt.systemPrompt,
    /Do not create a report just because you used browser or web search tools\. Tool usage alone is not a reason to artifact the answer\./
  );
  assert.match(
    prompt.systemPrompt,
    /If `write_report` is available and the full answer would be long, heavily structured, evidence-heavy, or likely to be referenced later, use `write_report` instead of placing the full content in chat\./
  );
  assert.match(
    prompt.systemPrompt,
    /When the user explicitly asks you to research, investigate, study, analyze, compare, build a timeline, or summarize current or latest developments across multiple sources, default to writing a report artifact and keep the chat reply to a minimal summary unless the user explicitly asks for inline detail\./
  );
  assert.match(
    prompt.systemPrompt,
    /When those research-style conditions apply and `write_report` is available, call `write_report` before your final reply\. Do not put the full synthesis in chat\./
  );
  assert.match(
    prompt.systemPrompt,
    /For those research-style tasks, a todo step such as 'summarize findings for the user' still means: create the report artifact first, then send only a short user-facing summary in chat\./
  );
  assert.match(
    prompt.systemPrompt,
    /If `write_report` is unavailable and you still need a report artifact, write it under `outputs\/reports\/` instead of placing the full content in chat\./
  );
  assert.match(
    prompt.systemPrompt,
    /When you create a report artifact, keep the chat reply short: state the outcome, mention the report title or path, and include only the most important takeaways\./
  );
  assert.match(
    prompt.systemPrompt,
    /For research-style tasks, keep the chat follow-up to one short paragraph or at most 3 concise bullets unless the user explicitly asks for inline detail\./
  );
  assert.match(
    prompt.systemPrompt,
    /If you are unsure, choose inline for a short single-answer lookup and choose a report for multi-source synthesis or referenceable findings\./
  );
  assert.match(
    prompt.systemPrompt,
    /Only cross the workspace boundary when the user explicitly insists, and then keep scope minimal and clearly tied to that instruction\./
  );
  assert.match(
    prompt.systemPrompt,
    /If you create or resume a todo, use it as continuity for the current turn, but the user's newest message remains the primary instruction\./
  );
  assert.match(
    prompt.systemPrompt,
    /If the user's newest message is conversational, brief, acknowledges prior progress, or is otherwise ambiguous about continuation, respond to that message directly and ask whether they want to continue the unfinished work instead of resuming it automatically\./
  );
  assert.match(
    prompt.systemPrompt,
    /Once the user has clearly asked you to continue an unfinished todo and executable items remain, do not stop merely to provide an intermediate progress update or ask whether to continue\./
  );
  assert.doesNotMatch(
    prompt.systemPrompt,
    /Check repository state with git before and after substantial edits/
  );
  assert.match(
    prompt.systemPrompt,
    /On the first strong signal that user input describes a reusable workflow, procedure, or operating pattern, proactively create or update a workspace-local skill/
  );
  assert.match(
    prompt.systemPrompt,
    /Do not create skills for transient runtime state, one-off task details, or information that only belongs in session continuity\./
  );
  assert.match(prompt.systemPrompt, /Session policy:/);
  assert.match(prompt.systemPrompt, /This is a workspace session/i);
  assert.match(prompt.systemPrompt, /Capability policy for this run:/);
  assert.match(prompt.systemPrompt, /Workspace instructions from AGENTS\.md:/);
  assert.doesNotMatch(prompt.systemPrompt, /OpenCode MCP tool naming:/);
  assert.deepEqual(prompt.contextMessages, []);
  assert.deepEqual(prompt.promptCacheProfile.cacheable_section_ids, [
    "runtime_core",
    "execution_policy",
    "response_delivery_policy",
    "workspace_policy",
  ]);
  assert.deepEqual(prompt.promptCacheProfile.volatile_section_ids, [
    "session_policy",
    "capability_policy",
  ]);
  assert.deepEqual(prompt.promptCacheProfile.compatibility_context_ids, []);
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

test("composeBaseAgentPrompt includes recent runtime context only when provided", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    recentRuntimeContext: {
      summary: "Last run failed after editing config.",
      last_stop_reason: "runner_failed",
      last_error: "config parse error",
      waiting_for_user: true,
    },
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "recent_runtime_context"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "recent_runtime_context")?.channel,
    "context_message"
  );
  assert.equal(
    prompt.promptSections.find((section) => section.id === "recent_runtime_context")?.precedence,
    "runtime_context"
  );
  assert.equal(prompt.promptLayers.some((layer) => layer.id === "recent_runtime_context"), false);
  assert.doesNotMatch(prompt.systemPrompt, /Recent runtime context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Recent runtime context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Last run failed after editing config\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Previous stop reason: runner_failed\./);
  assert.match(prompt.contextMessages.join("\n\n"), /The user's newest message is the primary instruction for this turn\./);
  assert.match(prompt.contextMessages.join("\n\n"), /waiting for user input/i);
  assert.match(
    prompt.contextMessages.join("\n\n"),
    /If the user's newest message is conversational, brief, acknowledges the prior result, or is otherwise ambiguous about continuation, respond to that message directly and ask whether they want to continue the unfinished work instead of resuming it automatically\./,
  );
  assert.match(prompt.contextMessages.join("\n\n"), /Previous runtime error: config parse error\./);
});

test("composeBaseAgentPrompt warns when the previous run was user-paused", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    recentRuntimeContext: {
      summary: "Run was paused by the user before completion.",
      last_stop_reason: "paused",
      last_error: null,
      waiting_for_user: null,
    },
  });

  assert.match(prompt.contextMessages.join("\n\n"), /Previous stop reason: paused\./);
  assert.match(
    prompt.contextMessages.join("\n\n"),
    /The previous run was paused before completion\. Do not treat that work as finished\./,
  );
  assert.match(
    prompt.contextMessages.join("\n\n"),
    /Only resume the unfinished prior work immediately when the user's newest message clearly asks to continue it or clearly advances the same task\./,
  );
  assert.match(
    prompt.contextMessages.join("\n\n"),
    /If the user's newest message is conversational, brief, acknowledges the prior result, or is otherwise ambiguous about continuation, respond to that message directly and ask whether they want to continue the unfinished work instead of resuming it automatically\./,
  );
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
  assert.match(prompt.contextMessages.join("\n\n"), /Draft skill artifact: `workspace\/workspace-1\/evolve\/skills\/evolve-skill-input-10\/SKILL\.md`\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Target live workspace skill path: `skills\/release-verification\/SKILL\.md`\./);
  assert.match(prompt.contextMessages.join("\n\n"), /name: release-verification/);
});

test("composeBaseAgentPrompt includes session resume context only when provided", () => {
  const prompt = composeBaseAgentPrompt("", {
    defaultTools: ["read"],
    extraTools: [],
    workspaceSkillIds: [],
    resolvedMcpToolRefs: [],
    sessionKind: "workspace_session",
    sessionMode: "code",
    sessionResumeContext: {
      recent_turns: [
        {
          input_id: "input-1",
          status: "failed",
          stop_reason: "permission_denied",
          summary: "Deploy failed because policy denied the action.",
          completed_at: "2026-04-02T10:00:00.000Z",
        },
      ],
      recent_user_messages: [
        "Finish the deploy flow after fixing policy.",
      ],
      compaction_boundary_id: "compaction:input-1",
      compaction_boundary_summary: "Deploy failed because policy denied the action.",
      restoration_order: [
        "boundary_summary",
        "recent_runtime_context",
        "session_resume_context",
        "preserved_turn_input_ids",
        "restored_memory_paths",
      ],
      preserved_turn_input_ids: ["input-1"],
      restored_memory_paths: [
        "workspace/workspace-1/runtime/latest-turn.md",
        "workspace/workspace-1/runtime/session-state/session-1.md",
      ],
    },
  });

  assert.ok(prompt.promptSections.some((section) => section.id === "resume_context"));
  assert.equal(
    prompt.promptSections.find((section) => section.id === "resume_context")?.channel,
    "resume_context"
  );
  assert.equal(
    prompt.promptSections.find((section) => section.id === "resume_context")?.precedence,
    "runtime_context"
  );
  assert.equal(prompt.promptLayers.some((layer) => layer.id === "resume_context"), false);
  assert.doesNotMatch(prompt.systemPrompt, /Session resume context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Session resume context:/);
  assert.match(prompt.contextMessages.join("\n\n"), /persisted turn results and selected prior session messages/i);
  assert.match(prompt.contextMessages.join("\n\n"), /Treat the user's newest message as authoritative for this turn\./);
  assert.match(
    prompt.contextMessages.join("\n\n"),
    /If the newest message is conversational, brief, or ambiguous about continuation, respond to it directly first and ask whether the user wants to continue the unfinished prior work\./,
  );
  assert.match(prompt.contextMessages.join("\n\n"), /compaction boundary `compaction:input-1`/i);
  assert.match(prompt.contextMessages.join("\n\n"), /Boundary summary: Deploy failed because policy denied the action\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Restoration order: `boundary_summary` -> `recent_runtime_context` -> `session_resume_context` -> `preserved_turn_input_ids` -> `restored_memory_paths`\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Preserved turn ids: `input-1`\./);
  assert.match(prompt.contextMessages.join("\n\n"), /workspace\/workspace-1\/runtime\/latest-turn\.md/);
  assert.match(prompt.contextMessages.join("\n\n"), /Recent prior turns:/);
  assert.match(prompt.contextMessages.join("\n\n"), /input-1/);
  assert.match(prompt.contextMessages.join("\n\n"), /permission_denied/);
  assert.match(prompt.contextMessages.join("\n\n"), /Deploy failed because policy denied the action\./);
  assert.match(prompt.contextMessages.join("\n\n"), /Recent prior user requests:/);
  assert.match(prompt.contextMessages.join("\n\n"), /Finish the deploy flow after fixing policy\./);
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
    /Treat user-specified requirements such as exact fields, counts, rankings, filters, timestamps, and verification targets as completion criteria, not optional detail\./
  );
  assert.match(
    prompt.systemPrompt,
    /Before answering, compare the evidence you gathered against the user's requested fields, constraints, thresholds, rankings, timestamps, and verification targets\./
  );
  assert.match(
    prompt.systemPrompt,
    /Do not present partial evidence as task completion\./
  );
  assert.match(
    prompt.systemPrompt,
    /If the first retrieval path only gives partial evidence, do not stop there: proactively switch to a more direct capability path until the required facts are verified or you can clearly explain what remains unavailable\./
  );
  assert.match(
    prompt.systemPrompt,
    /If a more direct capability is unavailable or blocked, explicitly name which required facts or constraints remain unverified\./
  );
  assert.match(
    prompt.systemPrompt,
    /When browser capabilities are available, use them as the direct verification path for site-specific or UI-dependent requirements that search or summary tools cannot fully prove\./
  );
  assert.match(
    prompt.systemPrompt,
    /Within browser workflows, prefer DOM and structured page state for actions and routine extraction\./
  );
  assert.match(
    prompt.systemPrompt,
    /Use browser_get_state with include_screenshot=true, or browser_screenshot, only when visual appearance, layout, prominence, overlays, canvas\/chart\/PDF content, or user-visible confirmation matters, or when DOM signals remain ambiguous or unreliable\./
  );
  assert.match(
    prompt.systemPrompt,
    /Even in screenshot-assisted browser work, keep using DOM-grounded browser actions for clicking, typing, scrolling, and stable extraction whenever possible\./
  );
});
