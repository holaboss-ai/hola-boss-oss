import { spawnSync } from "node:child_process";

import {
  resolveRuntimeBundleState,
  runtimeBundleExists,
  runtimeBundleIsStale,
} from "./runtime-bundle-state.mjs";

const desktopRoot = process.cwd();
const runtimeBundleState = resolveRuntimeBundleState(desktopRoot);
const bundleExists = await runtimeBundleExists(
  runtimeBundleState.requiredRuntimePathGroups,
);
const bundleStale =
  runtimeBundleState.canPrepareLocalRuntime && bundleExists
    ? await runtimeBundleIsStale(runtimeBundleState)
    : false;

if (!bundleExists || bundleStale) {
  if (bundleStale && bundleExists) {
    console.log("[ensure-runtime-bundle] runtime bundle is older than local runtime sources; rebuilding.");
  }
  const prepareScript = runtimeBundleState.canPrepareLocalRuntime
    ? "prepare:runtime:local"
    : "prepare:runtime";
  const result = spawnSync("npm", ["run", prepareScript], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      HOLABOSS_RUNTIME_PLATFORM: runtimeBundleState.runtimePlatform,
    }
  });
  process.exit(result.status ?? 1);
}
