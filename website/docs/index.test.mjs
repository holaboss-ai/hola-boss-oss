import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const APP_PACKAGE_PATH = new URL("./package.json", import.meta.url);
const WORKER_PATH = new URL("./src/worker.ts", import.meta.url);
const WRANGLER_PATH = new URL("./wrangler.jsonc", import.meta.url);
const VITEPRESS_CONFIG_PATH = new URL(
  "./docs/.vitepress/config.ts",
  import.meta.url
);
const THEME_ENTRY_PATH = new URL(
  "./docs/.vitepress/theme/index.ts",
  import.meta.url
);
const THEME_CSS_PATH = new URL(
  "./docs/.vitepress/theme/custom.css",
  import.meta.url
);
const DOC_CARDS_PATH = new URL(
  "./docs/.vitepress/theme/components/DocCards.vue",
  import.meta.url
);
const DOC_CARD_PATH = new URL(
  "./docs/.vitepress/theme/components/DocCard.vue",
  import.meta.url
);
const DOC_STEPS_PATH = new URL(
  "./docs/.vitepress/theme/components/DocSteps.vue",
  import.meta.url
);
const DOC_STEP_PATH = new URL(
  "./docs/.vitepress/theme/components/DocStep.vue",
  import.meta.url
);
const DOC_DEFINITION_PATH = new URL(
  "./docs/.vitepress/theme/components/DocDefinition.vue",
  import.meta.url
);
const DOC_TERM_PATH = new URL(
  "./docs/.vitepress/theme/components/DocTerm.vue",
  import.meta.url
);
const ROOT_PACKAGE_PATH = new URL("../../package.json", import.meta.url);
const QUICK_START_PATH = new URL(
  "./docs/getting-started/index.md",
  import.meta.url
);
const START_DEVELOPING_PATH = new URL(
  "./docs/build-on-holaos/start-developing/index.md",
  import.meta.url
);
const BUILD_ON_OVERVIEW_PATH = new URL(
  "./docs/build-on-holaos/index.md",
  import.meta.url
);
const CONTRIBUTING_PATH = new URL(
  "./docs/build-on-holaos/start-developing/contributing.md",
  import.meta.url
);
const DESKTOP_INTERNALS_PATH = new URL(
  "./docs/build-on-holaos/desktop/internals.md",
  import.meta.url
);
const RUNTIME_APIS_PATH = new URL(
  "./docs/build-on-holaos/runtime-apis.md",
  import.meta.url
);
const RUNTIME_RUN_COMPILATION_PATH = new URL(
  "./docs/build-on-holaos/runtime/run-compilation.md",
  import.meta.url
);
const RUNTIME_STATE_STORE_PATH = new URL(
  "./docs/build-on-holaos/runtime/state-store.md",
  import.meta.url
);
const INDEPENDENT_DEPLOY_PATH = new URL(
  "./docs/build-on-holaos/independent-deploy.md",
  import.meta.url
);
const HARNESS_INTERNALS_PATH = new URL(
  "./docs/build-on-holaos/agent-harness/internals.md",
  import.meta.url
);
const TROUBLESHOOTING_PATH = new URL(
  "./docs/build-on-holaos/troubleshooting.md",
  import.meta.url
);
const BRIDGE_SDK_PATH = new URL(
  "./docs/app-development/bridge-sdk.md",
  import.meta.url
);
const APP_ANATOMY_PATH = new URL(
  "./docs/app-development/applications/app-anatomy.md",
  import.meta.url
);
const FIRST_APP_PATH = new URL(
  "./docs/app-development/applications/first-app.md",
  import.meta.url
);
const APP_RUNTIME_YAML_PATH = new URL(
  "./docs/app-development/applications/app-runtime-yaml.md",
  import.meta.url
);
const MCP_TOOLS_PATH = new URL(
  "./docs/app-development/applications/mcp-tools.md",
  import.meta.url
);
const PUBLISHING_OUTPUTS_PATH = new URL(
  "./docs/app-development/applications/publishing-outputs.md",
  import.meta.url
);
const TEMPLATES_OVERVIEW_PATH = new URL(
  "./docs/templates/index.md",
  import.meta.url
);
const TEMPLATES_MATERIALIZATION_PATH = new URL(
  "./docs/templates/materialization.md",
  import.meta.url
);
const TEMPLATES_STRUCTURE_PATH = new URL(
  "./docs/templates/structure.md",
  import.meta.url
);
const TEMPLATES_VERSIONING_PATH = new URL(
  "./docs/templates/versioning.md",
  import.meta.url
);
const LEARNING_PATH_PATH = new URL(
  "./docs/getting-started/learning-path.md",
  import.meta.url
);
const HOLAOS_APPS_PATH = new URL(
  "./docs/holaos/apps.md",
  import.meta.url
);
const HOLAOS_CONCEPTS_PATH = new URL(
  "./docs/holaos/concepts.md",
  import.meta.url
);
const HOLAOS_WORKSPACE_MODEL_PATH = new URL(
  "./docs/holaos/workspace-model.md",
  import.meta.url
);
const ENVIRONMENT_ENGINEERING_PATH = new URL(
  "./docs/holaos/environment-engineering.md",
  import.meta.url
);
const MEMORY_CONTINUITY_OVERVIEW_PATH = new URL(
  "./docs/holaos/memory-and-continuity/index.md",
  import.meta.url
);
const MEMORY_RUNTIME_CONTINUITY_PATH = new URL(
  "./docs/holaos/memory-and-continuity/runtime-continuity.md",
  import.meta.url
);
const MEMORY_DURABLE_MEMORY_PATH = new URL(
  "./docs/holaos/memory-and-continuity/durable-memory.md",
  import.meta.url
);
const MEMORY_RECALL_EVOLVE_PATH = new URL(
  "./docs/holaos/memory-and-continuity/recall-and-evolve.md",
  import.meta.url
);

test("docs app exposes vitepress build and preview scripts", async () => {
  const source = await readFile(APP_PACKAGE_PATH, "utf8");

  assert.match(source, /"typecheck":\s*"tsc -p tsconfig\.json --noEmit"/);
  assert.match(source, /"build":\s*"vitepress build docs"/);
  assert.match(source, /"dev":\s*"vitepress dev docs/);
  assert.match(source, /"docs:dev":\s*"vitepress dev docs/);
  assert.match(source, /"docs:preview":\s*"vitepress preview docs/);
  assert.match(
    source,
    /"deploy:staging":\s*"npm run build && wrangler deploy --env staging"/
  );
  assert.match(
    source,
    /"deploy:production":\s*"npm run build && wrangler deploy --env production"/
  );
  assert.match(source, /"vitepress-mermaid-renderer":/);
});

test("vitepress config is set up for the agreed documentation structure", async () => {
  const source = await readFile(VITEPRESS_CONFIG_PATH, "utf8");

  assert.match(source, /base:\s*"\/docs\/"/);
  assert.match(source, /provider:\s*"local"/);
  assert.match(source, /text:\s*"Get Started"/);
  assert.match(source, /text:\s*"holaOS"/);
  assert.match(source, /text:\s*"Build on holaOS"/);
  assert.match(source, /text:\s*"Reference"/);
  assert.match(source, /text:\s*"Runtime"/);
  assert.match(source, /"\/build-on-holaos\/"/);
  assert.match(source, /"\/getting-started\/"/);
  assert.match(source, /"\/getting-started\/learning-path"/);
  assert.match(source, /"\/holaos\/concepts"/);
  assert.match(source, /"\/holaos\/apps"/);
  assert.match(source, /"\/holaos\/agent-harness\/"/);
  assert.match(source, /"\/holaos\/agent-harness\/adapter-capabilities"/);
  assert.match(source, /"\/holaos\/agent-harness\/runtime-tools"/);
  assert.match(source, /"\/holaos\/agent-harness\/mcp-support"/);
  assert.match(source, /"\/holaos\/agent-harness\/skills-usage"/);
  assert.match(source, /"\/holaos\/agent-harness\/model-routing"/);
  assert.match(source, /"\/holaos\/workspace-model"/);
  assert.match(source, /"\/holaos\/memory-and-continuity\/"/);
  assert.match(source, /"\/holaos\/memory-and-continuity\/runtime-continuity"/);
  assert.match(source, /"\/desktop\/workspace-experience"/);
  assert.match(source, /"\/build-on-holaos\/desktop\/internals"/);
  assert.match(source, /"\/app-development\/applications\/first-app"/);
  assert.match(source, /"\/templates\/"/);
  assert.match(source, /"\/templates\/materialization"/);
  assert.match(source, /"\/templates\/structure"/);
  assert.match(source, /"\/build-on-holaos\/runtime-apis"/);
  assert.match(source, /"\/build-on-holaos\/runtime\/run-compilation"/);
  assert.match(source, /"\/build-on-holaos\/runtime\/state-store"/);
  assert.match(source, /"\/build-on-holaos\/independent-deploy"/);
  assert.match(source, /"\/build-on-holaos\/agent-harness\/internals"/);
  assert.match(source, /"\/build-on-holaos\/start-developing\/"/);
  assert.match(source, /"\/build-on-holaos\/start-developing\/contributing"/);
  assert.match(source, /"\/build-on-holaos\/troubleshooting"/);
  assert.match(source, /"\/reference\/environment-variables"/);
  assert.match(source, /editLink:\s*\{/);
  assert.match(
    source,
    /https:\/\/github\.com\/holaboss-ai\/holaOS\/edit\/main\/website\/docs\/docs\/:path/
  );
  assert.match(source, /https:\/\/github\.com\/holaboss-ai\/holaOS/);
  assert.match(source, /text:\s*"Edit this page on GitHub"/);
  assert.doesNotMatch(source, /text:\s*"Holaboss Desktop"/);
  assert.doesNotMatch(source, /github\.com\/holaboss-ai\/holaboss-ai/);
  assert.doesNotMatch(source, /"\/desktop\/quickstart"/);
  assert.doesNotMatch(source, /link:\s*"\/concepts"/);
  assert.doesNotMatch(source, /link:\s*"\/learning-path"/);
  assert.doesNotMatch(source, /"\/app-development\/agent-harness"/);
  assert.doesNotMatch(source, /"\/holaos\/agent-harness\/capabilities"/);
  assert.doesNotMatch(source, /"\/holaos\/agent-harness\/baseline-tools"/);
  assert.doesNotMatch(source, /"\/holaos\/agent-harness\/browser-use"/);
  assert.doesNotMatch(
    source,
    /"\/holaos\/agent-harness\/attachments-and-model-routing"/
  );
  assert.doesNotMatch(
    source,
    /"\/build-on-holaos\/start-developing\/agent-harness"/
  );
  assert.doesNotMatch(source, /text:\s*"OSS"/);
  assert.doesNotMatch(source, /text:\s*"Product"/);
  assert.doesNotMatch(source, /text:\s*"Developers"/);
});

test("docs root page is a normal documentation page instead of a home hero landing page", async () => {
  const source = await readFile(
    new URL("./docs/index.md", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(source, /layout:\s*home/);
  assert.match(source, /# Overview/);
  assert.match(source, /## Read Next/);
});

test("docs pages point to the holaOS repository instead of the legacy repo path", async () => {
  const quickStart = await readFile(QUICK_START_PATH, "utf8");
  const troubleshooting = await readFile(TROUBLESHOOTING_PATH, "utf8");

  assert.match(
    quickStart,
    /raw\.githubusercontent\.com\/holaboss-ai\/holaOS\/main\/scripts\/install\.sh/
  );
  assert.match(quickStart, /github\.com\/holaboss-ai\/holaOS\.git/);
  assert.match(troubleshooting, /github\.com\/holaboss-ai\/holaOS\/issues\/new\/choose/);
  assert.doesNotMatch(quickStart, /holaboss-ai\/holaboss-ai/);
  assert.doesNotMatch(troubleshooting, /holaboss-ai\/holaboss-ai/);
});

test("build on holaOS pages expose the real developer seams and validation paths", async () => {
  const buildOnOverview = await readFile(BUILD_ON_OVERVIEW_PATH, "utf8");
  const startDeveloping = await readFile(START_DEVELOPING_PATH, "utf8");
  const contributing = await readFile(CONTRIBUTING_PATH, "utf8");
  const desktopInternals = await readFile(DESKTOP_INTERNALS_PATH, "utf8");
  const runtimeApis = await readFile(RUNTIME_APIS_PATH, "utf8");
  const runtimeRunCompilation = await readFile(
    RUNTIME_RUN_COMPILATION_PATH,
    "utf8"
  );
  const runtimeStateStore = await readFile(RUNTIME_STATE_STORE_PATH, "utf8");
  const independentDeploy = await readFile(INDEPENDENT_DEPLOY_PATH, "utf8");
  const harnessInternals = await readFile(HARNESS_INTERNALS_PATH, "utf8");
  const troubleshooting = await readFile(TROUBLESHOOTING_PATH, "utf8");

  assert.match(buildOnOverview, /Template Materialization/);
  assert.match(buildOnOverview, /npm run runtime:test/);
  assert.match(buildOnOverview, /\/build-on-holaos\/desktop\/internals/);

  assert.match(startDeveloping, /npm run desktop:dev/);
  assert.match(startDeveloping, /desktop\/scripts\/watch-runtime-bundle\.mjs/);
  assert.match(startDeveloping, /desktop\/out\/runtime-<platform>/);
  assert.match(startDeveloping, /http:\/\/127\.0\.0\.1:5060/);

  assert.match(contributing, /Conventional Commits/);
  assert.match(contributing, /npm run docs:test/);
  assert.match(contributing, /desktop\/electron\/preload\.ts/);

  assert.match(desktopInternals, /handleTrustedIpc/);
  assert.match(desktopInternals, /HB_SANDBOX_ROOT/);
  assert.match(desktopInternals, /runtime\.log/);
  assert.match(desktopInternals, /operator-surface-context/);
  assert.match(desktopInternals, /workspace\.setOperatorSurfaceContext/);

  assert.match(runtimeApis, /runtime\/api-server\/src\/app\.ts/);
  assert.match(runtimeApis, /\/api\/v1\/agent-runs\/stream/);
  assert.match(runtimeApis, /\/api\/v1\/task-proposals\/unreviewed\/stream/);
  assert.match(runtimeApis, /runtime\/api-server\/src\/app\.test\.ts/);
  assert.match(runtimeApis, /\/build-on-holaos\/runtime\/state-store/);
  assert.match(runtimeApis, /\/build-on-holaos\/runtime\/run-compilation/);
  assert.match(runtimeApis, /\/api\/v1\/capabilities\/runtime-tools\/reports/);
  assert.match(runtimeApis, /x-holaboss-selected-model/);

  assert.match(runtimeRunCompilation, /workspace-runtime-plan\.ts/);
  assert.match(runtimeRunCompilation, /workspace_config_checksum/);
  assert.match(runtimeRunCompilation, /persist_turn_request_snapshot/);
  assert.match(runtimeRunCompilation, /runtime\/api-server\/src\/ts-runner\.ts/);
  assert.match(runtimeRunCompilation, /operator surface context/);

  assert.match(runtimeStateStore, /runtime\/state-store\/src\/store\.ts/);
  assert.match(runtimeStateStore, /HOLABOSS_RUNTIME_DB_PATH/);
  assert.match(runtimeStateStore, /sqlite-vec/);
  assert.match(runtimeStateStore, /claimInputs/);
  assert.match(runtimeStateStore, /runtime:state-store:test/);
  assert.match(runtimeStateStore, /exclude specific session ids/);

  assert.match(independentDeploy, /package-metadata\.json/);
  assert.match(independentDeploy, /runtime\/metadata\.json/);
  assert.match(independentDeploy, /HB_SANDBOX_ROOT/);
  assert.match(independentDeploy, /runtime\/deploy\/build_runtime_root/);

  assert.match(harnessInternals, /runtime\/api-server\/src\/ts-runner\.ts/);
  assert.match(harnessInternals, /runtime\/harness-host\/src\/pi\.ts/);
  assert.match(harnessInternals, /npm run runtime:harness-host:test/);
  assert.match(harnessInternals, /write_report/);
  assert.match(harnessInternals, /pi-runtime-tools\.ts/);

  assert.match(troubleshooting, /desktop\/scripts\/check-runtime-status\.sh/);
  assert.match(troubleshooting, /HOLABOSS_BACKEND_BASE_URL/);
  assert.match(troubleshooting, /workspace_session/);
  assert.match(troubleshooting, /desktop\/out\/runtime-/);
});

test("app development and templates pages expose runtime-true developer contracts", async () => {
  const bridgeSdk = await readFile(BRIDGE_SDK_PATH, "utf8");
  const appAnatomy = await readFile(APP_ANATOMY_PATH, "utf8");
  const firstApp = await readFile(FIRST_APP_PATH, "utf8");
  const appRuntimeYaml = await readFile(APP_RUNTIME_YAML_PATH, "utf8");
  const mcpTools = await readFile(MCP_TOOLS_PATH, "utf8");
  const publishingOutputs = await readFile(PUBLISHING_OUTPUTS_PATH, "utf8");
  const templatesOverview = await readFile(TEMPLATES_OVERVIEW_PATH, "utf8");
  const templatesMaterialization = await readFile(
    TEMPLATES_MATERIALIZATION_PATH,
    "utf8"
  );
  const templatesStructure = await readFile(TEMPLATES_STRUCTURE_PATH, "utf8");
  const templatesVersioning = await readFile(TEMPLATES_VERSIONING_PATH, "utf8");

  assert.match(bridgeSdk, /HOLABOSS_INTEGRATION_BROKER_URL/);
  assert.match(bridgeSdk, /resolveHolabossTurnContext/);
  assert.match(bridgeSdk, /npm run sdk:bridge:test/);

  assert.match(appAnatomy, /runtime\/api-server\/src\/app-lifecycle-worker\.ts/);
  assert.match(appAnatomy, /GET http:\/\/localhost:\$PORT\//);
  assert.match(appAnatomy, /HOLABOSS_APP_GRANT/);

  assert.match(firstApp, /POST \/api\/v1\/apps\/install-archive/);
  assert.match(firstApp, /workspace\.yaml/);
  assert.match(firstApp, /mcp\.tools/);

  assert.match(appRuntimeYaml, /credential_source/);
  assert.match(appRuntimeYaml, /mcp\.port/);
  assert.match(appRuntimeYaml, /timeout_s/);

  assert.match(mcpTools, /writeWorkspaceMcpRegistryEntry/);
  assert.match(mcpTools, /app_id\.tool_name/);
  assert.match(mcpTools, /runtime\/api-server\/src\/app\.test\.ts/);

  assert.match(publishingOutputs, /publishSessionArtifact/);
  assert.match(publishingOutputs, /x-holaboss-session-id/);
  assert.match(publishingOutputs, /buildAppResourcePresentation/);
  assert.match(publishingOutputs, /artifact_type: "report"/);

  assert.match(templatesOverview, /empty_onboarding/);
  assert.match(templatesOverview, /@holaboss\/app-sdk/);

  assert.match(templatesMaterialization, /apply-template-from-url/);
  assert.match(templatesMaterialization, /replace_existing/);
  assert.match(templatesMaterialization, /GET \/api\/v1\/workspaces\/:workspaceId\/export/);

  assert.match(templatesStructure, /parseLocalTemplateMetadata/);
  assert.match(templatesStructure, /workspace\.yaml/);
  assert.match(templatesStructure, /\.hb_template_bootstrap_tmp/);

  assert.match(templatesVersioning, /template_commit/);
  assert.match(templatesVersioning, /renderMinimalWorkspaceYaml/);
  assert.match(templatesVersioning, /repo: "local"/);
});

test("high-level docs route developers into the concrete builder pages", async () => {
  const learningPath = await readFile(LEARNING_PATH_PATH, "utf8");
  const holaosApps = await readFile(HOLAOS_APPS_PATH, "utf8");
  const concepts = await readFile(HOLAOS_CONCEPTS_PATH, "utf8");
  const workspaceModel = await readFile(HOLAOS_WORKSPACE_MODEL_PATH, "utf8");
  const environmentEngineering = await readFile(
    ENVIRONMENT_ENGINEERING_PATH,
    "utf8"
  );
  const quickStart = await readFile(QUICK_START_PATH, "utf8");
  const docsIndex = await readFile(new URL("./docs/index.md", import.meta.url), "utf8");

  assert.match(learningPath, /\/build-on-holaos\//);
  assert.match(holaosApps, /applications:/);
  assert.match(holaosApps, /mcp\.tools/);
  assert.match(concepts, /workspace registers it under `applications\[\]`/);
  assert.match(concepts, /Operator Surface/);
  assert.match(concepts, /\/build-on-holaos\//);
  assert.match(workspaceModel, /applications\[\]\.app_id/);
  assert.match(workspaceModel, /\/templates\/materialization/);
  assert.match(environmentEngineering, /\/build-on-holaos\//);
  assert.match(quickStart, /\/build-on-holaos\/start-developing\//);
  assert.match(docsIndex, /\/build-on-holaos\//);
});

test("memory and continuity pages stay aligned with the runtime memory pipeline", async () => {
  const overview = await readFile(MEMORY_CONTINUITY_OVERVIEW_PATH, "utf8");
  const runtimeContinuity = await readFile(
    MEMORY_RUNTIME_CONTINUITY_PATH,
    "utf8"
  );
  const durableMemory = await readFile(MEMORY_DURABLE_MEMORY_PATH, "utf8");
  const recallAndEvolve = await readFile(MEMORY_RECALL_EVOLVE_PATH, "utf8");

  assert.match(overview, /pending user-memory proposals/);
  assert.match(
    overview,
    /background evolve path does not create user preference or profile memory on its own/
  );
  assert.match(overview, /state\/runtime\.db/);

  assert.match(runtimeContinuity, /turn_results/);
  assert.match(runtimeContinuity, /compaction boundaries/);
  assert.match(runtimeContinuity, /background evolve job/);
  assert.match(runtimeContinuity, /session-memory/);
  assert.match(runtimeContinuity, /Imagine a deploy run pauses/);
  assert.match(runtimeContinuity, /What it intentionally does not restore/);

  assert.match(
    durableMemory,
    /workspace facts, procedures, and repeated permission blockers/
  );
  assert.match(durableMemory, /accepted user-memory proposals/);
  assert.match(durableMemory, /workspace\/<workspace-id>\/knowledge/);
  assert.match(durableMemory, /absolute paths/);
  assert.match(durableMemory, /stable across runs/);
  assert.match(durableMemory, /useful without replaying the full transcript/);
  assert.match(durableMemory, /not everything that happened/i);

  assert.match(
    recallAndEvolve,
    /queued evolve does not create user preference or profile memory automatically/i
  );
  assert.match(
    recallAndEvolve,
    /durable recall currently requires a selector model/
  );
  assert.match(recallAndEvolve, /derived vector index/);
  assert.match(recallAndEvolve, /Human review boundary/);
  assert.match(recallAndEvolve, /stay pending until someone accepts them/);
  assert.match(recallAndEvolve, /should not quietly rewrite long-term human-facing truth/);
});

test("vitepress theme extends the default theme and registers shared doc components", async () => {
  const source = await readFile(THEME_ENTRY_PATH, "utf8");

  assert.match(source, /import DefaultTheme from "vitepress\/theme"/);
  assert.match(source, /createMermaidRenderer/);
  assert.match(source, /GlobalTopBar/);
  assert.match(source, /app\.component\("DocCards"/);
  assert.match(source, /app\.component\("DocCard"/);
  assert.match(source, /app\.component\("DocSteps"/);
  assert.match(source, /app\.component\("DocStep"/);
  assert.match(source, /app\.component\("DocDefinition"/);
  assert.match(source, /app\.component\("DocTerm"/);
  assert.match(source, /import "\.\/custom\.css"/);
});

test("shared documentation components and mermaid styles exist", async () => {
  const files = [
    THEME_CSS_PATH,
    DOC_CARDS_PATH,
    DOC_CARD_PATH,
    DOC_STEPS_PATH,
    DOC_STEP_PATH,
    DOC_DEFINITION_PATH,
    DOC_TERM_PATH,
  ];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.ok(source.length > 0);
  }

  const cssSource = await readFile(THEME_CSS_PATH, "utf8");
  assert.match(cssSource, /\.mermaid-container/);
  assert.match(cssSource, /\.HBGlobalTopBar/);
});

test("docs worker strips the /docs prefix before serving static assets", async () => {
  const source = await readFile(WORKER_PATH, "utf8");

  assert.match(
    source,
    /pathname\.replace\(\s*\/\^\\\/docs\(\?=\\\/\|\$\)\/\s*,\s*""\s*\)/
  );
  assert.match(source, /env\.ASSETS\.fetch/);
});

test("wrangler config serves vitepress output and binds the docs routes", async () => {
  const source = await readFile(WRANGLER_PATH, "utf8");

  assert.match(source, /"main":\s*"src\/worker\.ts"/);
  assert.match(source, /"binding":\s*"ASSETS"/);
  assert.match(source, /"directory":\s*"docs\/\.vitepress\/dist"/);
  assert.match(source, /"run_worker_first":\s*true/);
  assert.match(source, /"not_found_handling":\s*"404-page"/);
  assert.match(source, /www\.holaboss\.ai\/docs\*/);
  assert.match(source, /www\.imerchstaging\.com\/docs\*/);
});

test("holaOS root scripts expose docs entrypoints", async () => {
  const source = await readFile(ROOT_PACKAGE_PATH, "utf8");

  assert.match(source, /"docs:dev":\s*"npm --prefix website\/docs run dev"/);
  assert.match(source, /"docs:test":\s*"npm --prefix website\/docs run test"/);
  assert.match(source, /"docs:typecheck":\s*"npm --prefix website\/docs run typecheck"/);
  assert.match(source, /"docs:build":\s*"npm --prefix website\/docs run build"/);
  assert.match(
    source,
    /"docs:deploy:production":\s*"npm --prefix website\/docs run deploy:production"/
  );
});
