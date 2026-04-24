const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function resolveRuntimePlatform() {
  const explicitPlatform = (process.env.HOLABOSS_RUNTIME_PLATFORM || "").trim().toLowerCase();
  if (explicitPlatform) {
    switch (explicitPlatform) {
      case "macos":
      case "linux":
      case "windows":
        return explicitPlatform;
      default:
        throw new Error(`Unsupported HOLABOSS_RUNTIME_PLATFORM: ${explicitPlatform}`);
    }
  }

  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      throw new Error(`Unsupported host platform: ${process.platform}`);
  }
}

const runtimePlatform = resolveRuntimePlatform();
const runtimeBundleDir = `runtime-${runtimePlatform}`;
const runtimeBundlePath = path.join(__dirname, "out", runtimeBundleDir);
const windowsSigningConfigured = Boolean(
  (process.env.WIN_CSC_LINK || process.env.CSC_LINK || "").trim(),
);
const configuredReleaseChannel = (
  process.env.HOLABOSS_RELEASE_CHANNEL || ""
).trim().toLowerCase();

function resolveReleaseChannel() {
  if (!configuredReleaseChannel || configuredReleaseChannel === "latest") {
    return "latest";
  }
  if (configuredReleaseChannel === "beta") {
    return "beta";
  }
  throw new Error(
    `Unsupported HOLABOSS_RELEASE_CHANNEL: ${configuredReleaseChannel}`,
  );
}

const releaseChannel = resolveReleaseChannel();
const extraResources = [
  {
    from: "resources/icon.png",
    to: "icon.png"
  },
  {
    from: "resources/holaStatusTemplate.png",
    to: "holaStatusTemplate.png"
  },
  {
    from: "resources/holaStatusTemplate@2x.png",
    to: "holaStatusTemplate@2x.png"
  },
  {
    from: "out/holaboss-config.json",
    to: "holaboss-config.json"
  },
  {
    from: runtimeBundlePath,
    to: runtimeBundleDir,
    filter: [
      "bin/**/*",
      "node-runtime/**/*",
      "package-metadata.json",
      "python-runtime/**/*",
      "runtime/**/*"
    ]
  }
];

module.exports = {
  appId: "com.holaboss.workspace",
  productName: "Holaboss",
  generateUpdatesFilesForAllChannels: true,
  directories: {
    output: "out/release"
  },
  files: [
    "out/dist/**/*",
    "out/dist-electron/**/*",
    "package.json"
  ],
  extraResources,
  asar: true,
  protocols: [
    {
      name: "Holaboss Auth Callback",
      schemes: [
        "ai.holaboss.app"
      ]
    }
  ],
  icon: "resources/icon.png",
  mac: {
    icon: "resources/icon.icns",
    category: "public.app-category.developer-tools",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.mac.plist",
    entitlementsInherit: "resources/entitlements.mac.plist"
  },
  publish: [
    {
      provider: "github",
      owner: "holaboss-ai",
      repo: "holaOS",
      ...(releaseChannel === "beta" ? { channel: releaseChannel } : {})
    }
  ],
  win: {
    icon: "resources/icon.ico",
    signAndEditExecutable: windowsSigningConfigured,
    target: [
      {
        target: "nsis",
        arch: [
          "x64"
        ]
      }
    ]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  },
  beforePack: async () => {
    if (!fs.existsSync(runtimeBundlePath)) {
      throw new Error(
        `Missing staged runtime bundle at ${runtimeBundlePath}. Run the matching prepare:runtime command before packaging.`
      );
    }
  },
  afterPack: async (context) => {
    if (context.electronPlatformName !== "darwin") {
      return;
    }
    const { writeAppUpdateConfig } = await import(
      pathToFileURL(
        path.join(__dirname, "scripts", "write-app-update-config.mjs")
      ).href
    );
    const appBundlePath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`
    );
    await writeAppUpdateConfig(appBundlePath);
  }
};
