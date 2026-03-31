/**
 * Static template catalog shown when the user is not authenticated.
 * Keeps the marketplace browsable before sign-in.
 * Mirrors the official templates from the backend marketplace registry.
 */

const FLUENT_CDN = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets";

function emojiUrl(name: string): string {
  const slug = name.toLowerCase().replaceAll(" ", "_").replaceAll("%20", "_");
  return `${FLUENT_CDN}/${name}/3D/${slug}_3d.png`;
}

export const FALLBACK_TEMPLATES: TemplateMetadataPayload[] = [
  {
    name: "social_media",
    repo: "",
    path: "",
    default_ref: "main",
    description:
      "AI-powered social media content creation and scheduling across Twitter, LinkedIn, and Reddit.",
    is_hidden: false,
    is_coming_soon: false,
    allowed_user_ids: [],
    icon: "Megaphone01Icon",
    emoji: emojiUrl("Megaphone"),
    apps: ["twitter", "linkedin", "reddit"],
    tags: ["social media", "automation", "content"],
    category: "marketing",
    long_description:
      "A complete AI social media operations workspace. Your AI team creates content, schedules posts across platforms, and tracks engagement — you just set the direction and review results.",
    agents: [
      { role: "Content Strategist", description: "Plans content calendar and brand voice" },
      { role: "Copywriter", description: "Generates platform-optimized content" },
      { role: "Data Analyst", description: "Reviews engagement and suggests improvements" }
    ],
    views: [
      { name: "Content Calendar", description: "Timeline of all scheduled content" },
      { name: "Publish Status", description: "Real-time publishing status across platforms" },
      { name: "Engagement Analytics", description: "Interaction trends and AI recommendations" }
    ]
  },
  {
    name: "gmail_assistant",
    repo: "",
    path: "",
    default_ref: "main",
    description:
      "Minimal Gmail workspace for testing inbox search, thread reading, and draft creation via MCP.",
    is_hidden: false,
    is_coming_soon: false,
    allowed_user_ids: [],
    icon: "Mail01Icon",
    emoji: emojiUrl("E-mail"),
    apps: ["gmail"],
    tags: ["gmail", "email", "mcp"],
    category: "productivity",
    long_description:
      "A minimal Gmail-first workspace for validating Gmail MCP access. Use it to search inbox threads, read conversations, and create email drafts without extra workflow scaffolding.",
    agents: [
      { role: "Inbox Assistant", description: "Searches threads and drafts replies in Gmail" }
    ],
    views: [
      { name: "Inbox", description: "Search and inspect Gmail threads" },
      { name: "Drafts", description: "Create and review Gmail drafts" }
    ]
  },
  {
    name: "build_in_public",
    repo: "",
    path: "",
    default_ref: "main",
    description:
      "Turn your GitHub activity into social media content automatically. Ship code, share progress.",
    is_hidden: false,
    is_coming_soon: false,
    allowed_user_ids: [],
    icon: "StartUp02Icon",
    emoji: emojiUrl("Rocket"),
    apps: ["github", "twitter"],
    tags: ["developer", "github", "content"],
    category: "marketing",
    long_description:
      "Connect GitHub and let AI turn your commits, releases, and issues into engaging social posts. Perfect for indie hackers and dev teams who want to build in public without the effort.",
    agents: [
      { role: "Dev Storyteller", description: "Converts code activity into narratives" },
      { role: "Content Adapter", description: "Formats for each social platform" }
    ],
    views: [
      { name: "Activity Feed", description: "GitHub activity timeline" },
      { name: "Content Queue", description: "Drafted posts ready for review" }
    ]
  },
  {
    name: "starter",
    repo: "",
    path: "",
    default_ref: "main",
    description: "A minimal workspace to build your own AI workflows from scratch.",
    is_hidden: false,
    is_coming_soon: false,
    allowed_user_ids: [],
    icon: "StartUp02Icon",
    emoji: emojiUrl("Glowing%20star"),
    apps: [],
    tags: ["starter", "developer"],
    category: "featured",
    long_description:
      "A blank canvas workspace with minimal configuration. Ideal for developers who want to build custom AI workflows and add modules one by one.",
    agents: [
      { role: "General Assistant", description: "A flexible AI agent ready for your instructions" }
    ],
    views: []
  }
];
