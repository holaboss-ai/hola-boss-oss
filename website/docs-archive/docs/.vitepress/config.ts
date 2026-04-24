import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Holaboss Docs",
  description: "Documentation for Holaboss.",
  base: "/docs/",
  cleanUrls: true,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/docs/logo.svg" }],
  ],
  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "holaOS",
    search: {
      provider: "local",
    },
    nav: [
      {
        text: "Get Started",
        link: "/getting-started/",
        activeMatch: "^/getting-started(/|$)",
      },
      {
        text: "holaOS",
        link: "/holaos/environment-engineering",
        activeMatch: "^/holaos(/|$)",
      },
      {
        text: "Build on holaOS",
        link: "/build-on-holaos/",
        activeMatch: "^/(app-development/|templates/|build-on-holaos/)",
      },
      {
        text: "Reference",
        link: "/reference/environment-variables",
        activeMatch: "^/reference(/|$)",
      },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Overview", link: "/" },
          { text: "Quick Start", link: "/getting-started/" },
          { text: "Learning Path", link: "/getting-started/learning-path" },
        ],
      },
      {
        text: "About holaOS",
        items: [
          {
            text: "Environment Engineering",
            link: "/holaos/environment-engineering",
          },
          { text: "Concepts", link: "/holaos/concepts" },
          { text: "Workspace Model", link: "/holaos/workspace-model" },
          {
            text: "Memory and Continuity",
            collapsed: true,
            items: [
              {
                text: "Memory at a glance",
                link: "/holaos/memory-and-continuity/",
              },
              {
                text: "Runtime Continuity",
                link: "/holaos/memory-and-continuity/runtime-continuity",
              },
              {
                text: "Durable Memory",
                link: "/holaos/memory-and-continuity/durable-memory",
              },
              {
                text: "Recall and Evolve",
                link: "/holaos/memory-and-continuity/recall-and-evolve",
              },
            ],
          },
          {
            text: "Agent Harness",
            collapsed: true,
            items: [
              { text: "Harness Overview", link: "/holaos/agent-harness/" },
              {
                text: "Adapter Capabilities",
                link: "/holaos/agent-harness/adapter-capabilities",
              },
              {
                text: "Runtime Tools",
                link: "/holaos/agent-harness/runtime-tools",
              },
              {
                text: "MCP Support",
                link: "/holaos/agent-harness/mcp-support",
              },
              {
                text: "Skills Usage",
                link: "/holaos/agent-harness/skills-usage",
              },
              {
                text: "Model Routing",
                link: "/holaos/agent-harness/model-routing",
              },
            ],
          },
          {
            text: "Apps in holaOS",
            link: "/holaos/apps",
          },
        ],
      },
      {
        text: "Build on holaOS",
        items: [
          {
            text: "Overview",
            link: "/build-on-holaos/",
          },
          {
            text: "Start Developing",
            link: "/build-on-holaos/start-developing/",
          },
          {
            text: "Contributing",
            link: "/build-on-holaos/start-developing/contributing",
          },
          {
            text: "Desktop",
            collapsed: true,
            items: [
              {
                text: "Workspace Experience",
                link: "/build-on-holaos/desktop/workspace-experience",
              },
              {
                text: "Model Configuration",
                link: "/build-on-holaos/desktop/model-configuration",
              },
              {
                text: "Desktop Internals",
                link: "/build-on-holaos/desktop/internals",
              },
            ],
          },
          {
            text: "Runtime",
            collapsed: true,
            items: [
              { text: "Runtime APIs", link: "/build-on-holaos/runtime/apis" },
              {
                text: "Run Compilation",
                link: "/build-on-holaos/runtime/run-compilation",
              },
              {
                text: "Runtime State Store",
                link: "/build-on-holaos/runtime/state-store",
              },
              {
                text: "Independent Deploy",
                link: "/build-on-holaos/runtime/independent-deploy",
              },
            ],
          },
          {
            text: "Agent Harness",
            collapsed: true,
            items: [
              {
                text: "Internals and Contracts",
                link: "/build-on-holaos/agent-harness/internals",
              },
            ],
          },
          {
            text: "Apps",
            collapsed: true,
            items: [
              {
                text: "App Anatomy",
                link: "/app-development/applications/app-anatomy",
              },
              { text: "Bridge SDK", link: "/app-development/bridge-sdk" },
              {
                text: "Build Your First App",
                link: "/app-development/applications/first-app",
              },
              {
                text: "app.runtime.yaml",
                link: "/app-development/applications/app-runtime-yaml",
              },
              {
                text: "MCP Tools",
                link: "/app-development/applications/mcp-tools",
              },
              {
                text: "Publishing Outputs",
                link: "/app-development/applications/publishing-outputs",
              },
            ],
          },
          {
            text: "Workspace Templates",
            collapsed: true,
            items: [
              { text: "Overview", link: "/templates/" },
              {
                text: "Template Materialization",
                link: "/templates/materialization",
              },
              { text: "Template Structure", link: "/templates/structure" },
              { text: "Template Versioning", link: "/templates/versioning" },
            ],
          },
          {
            text: "Troubleshooting",
            link: "/build-on-holaos/troubleshooting",
          },
        ],
      },
      {
        text: "Reference",
        items: [
          {
            text: "Environment Variables",
            link: "/reference/environment-variables",
          },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/holaboss-ai/holaOS" },
    ],
    editLink: {
      pattern:
        "https://github.com/holaboss-ai/holaOS/edit/main/website/docs/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
});
