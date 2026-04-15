const fs = require("node:fs");
const path = require("node:path");

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

module.exports = {
  appId: "com.holaboss.workspace",
  productName: "Holaboss",
  directories: {
    output: "out/release"
  },
  files: [
    "out/dist/**/*",
    "out/dist-electron/**/*",
    "package.json"
  ],
  extraResources: [
    {
      from: "resources/icon.png",
      to: "icon.png"
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
        "package-metadata.json",
        "runtime/**/*"
      ]
    }
  ],
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
      repo: "holaOS"
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
  }
};
