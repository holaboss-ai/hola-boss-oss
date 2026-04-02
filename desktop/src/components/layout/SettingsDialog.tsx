import { useEffect } from "react";
import { CircleHelp, ExternalLink, Globe, Info, Palette, User2, Waypoints, X } from "lucide-react";
import { AuthPanel } from "@/components/auth/AuthPanel";

const THEME_SWATCHES: Record<string, [string, string, string]> = {
  "amber-minimal-dark": ["#1a1814", "#e8853a", "#2e2920"],
  "amber-minimal-light": ["#ffffff", "#e8853a", "#fef5ec"],
  "cosmic-night-dark": ["#1a1035", "#a78bfa", "#352a5c"],
  "cosmic-night-light": ["#f5f3ff", "#7c3aed", "#e4dff7"],
  "sepia-dark": ["#2c2520", "#c0825a", "#3d332e"],
  "sepia-light": ["#faf6ef", "#c0825a", "#ebe3d2"],
  "clean-slate-dark": ["#1a1d25", "#6d8cf5", "#2d3340"],
  "clean-slate-light": ["#f8f9fc", "#5b72e0", "#e4e7f0"],
  "bold-tech-dark": ["#0f0b1a", "#a855f7", "#261e3d"],
  "bold-tech-light": ["#ffffff", "#8b5cf6", "#f0ecfb"],
  "catppuccin-dark": ["#1e1e2e", "#cba6f7", "#313244"],
  "catppuccin-light": ["#eff1f5", "#8839ef", "#ccd0da"],
  "bubblegum-dark": ["#1f2937", "#f9a8d4", "#374151"],
  "bubblegum-light": ["#fef2f8", "#ec4899", "#fce7f3"],
};

interface SettingsDialogProps {
  open: boolean;
  activeSection: UiSettingsPaneSection;
  onSectionChange: (section: UiSettingsPaneSection) => void;
  onClose: () => void;
  theme: string;
  themes: readonly string[];
  onThemeChange: (theme: string) => void;
  onOpenExternalUrl: (url: string) => void;
}

const SETTINGS_SECTIONS: Array<{
  id: UiSettingsPaneSection;
  label: string;
  description: string;
  icon: typeof User2;
}> = [
  {
    id: "account",
    label: "Account",
    description: "Session and runtime connection",
    icon: User2
  },
  {
    id: "providers",
    label: "Model Providers",
    description: "Runtime providers and model catalogs",
    icon: Waypoints
  },
  {
    id: "settings",
    label: "Settings",
    description: "Appearance and desktop defaults",
    icon: Palette
  },
  {
    id: "about",
    label: "About",
    description: "Links and product references",
    icon: Info
  }
];

function titleForSection(section: UiSettingsPaneSection): string {
  switch (section) {
    case "account":
      return "Account";
    case "providers":
      return "Model Providers";
    case "about":
      return "About";
    case "settings":
    default:
      return "Settings";
  }
}

function subtitleForSection(section: UiSettingsPaneSection): string {
  switch (section) {
    case "account":
      return "Manage your desktop session and runtime binding.";
    case "providers":
      return "Configure runtime providers, credentials, and model catalogs.";
    case "about":
      return "Open product resources and support channels.";
    case "settings":
    default:
      return "Tune desktop appearance and shared preferences.";
  }
}

const THEME_DISPLAY_NAMES: Record<string, string> = {
  "amber-minimal-dark": "Default Dark",
  "amber-minimal-light": "Default Light",
};

function prettifyThemeLabel(theme: string): string {
  if (THEME_DISPLAY_NAMES[theme]) {
    return THEME_DISPLAY_NAMES[theme];
  }
  return theme
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function SettingsDialog({
  open,
  activeSection,
  onSectionChange,
  onClose,
  theme,
  themes,
  onThemeChange,
  onOpenExternalUrl
}: SettingsDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center px-4 py-6">
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="pointer-events-auto absolute inset-0 bg-[rgba(7,10,14,0.46)] backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="theme-shell soft-vignette neon-border pointer-events-auto relative z-10 grid max-h-[min(760px,calc(100vh-40px))] w-[min(980px,calc(100vw-32px))] min-w-0 overflow-hidden rounded-[28px] shadow-lg grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1"
      >
        <aside className="theme-header-surface border-b border-border/35 p-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-[16px] border border-primary/30 bg-primary/10 text-primary">
              <Palette size={18} />
            </div>
            <div>
              <div className="text-[12px] uppercase tracking-[0.18em] text-muted-foreground/72">Holaboss</div>
              <div className="mt-1 text-[18px] font-semibold text-foreground">Desktop Settings</div>
            </div>
          </div>

          <nav className="mt-6 grid gap-2">
            {SETTINGS_SECTIONS.map(({ id, label, description, icon: Icon }) => {
              const active = id === activeSection;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSectionChange(id)}
                  className={`flex items-start gap-3 rounded-[18px] border px-3.5 py-3 text-left transition ${
                    active
                      ? "border-primary/40 bg-primary/10 text-foreground shadow-[0_12px_36px_rgba(0,0,0,0.16)]"
                      : "border-transparent text-muted-foreground hover:border-border/45 hover:bg-accent hover:text-foreground"
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[12px] border ${
                      active
                        ? "border-primary/35 bg-primary/12 text-primary"
                        : "border-border/35 text-muted-foreground/80"
                    }`}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{label}</span>
                    <span className="mt-1 block text-[11px] leading-5 text-muted-foreground/72">{description}</span>
                  </span>
                </button>
              );
            })}
          </nav>

        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="theme-header-surface flex items-start justify-between gap-4 border-b border-border/35 px-5 py-4">
            <div>
              <div className="text-[20px] font-semibold text-foreground">{titleForSection(activeSection)}</div>
              <div className="mt-1 text-[12px] text-muted-foreground/72">{subtitleForSection(activeSection)}</div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-border/45 text-muted-foreground transition hover:border-primary/35 hover:text-foreground"
            >
              <X size={16} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {activeSection === "account" ? (
              <div className="max-w-[560px]">
                <AuthPanel view="account" />
              </div>
            ) : null}

            {activeSection === "providers" ? (
              <div className="grid gap-6">
                <section className="max-w-[920px]">
                  <AuthPanel view="runtime" />
                </section>
              </div>
            ) : null}

            {activeSection === "settings" ? (
              <div className="grid gap-6">
                <section className="theme-subtle-surface rounded-[24px] border border-border/40 p-5">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/68">Appearance</div>
                  <div className="mt-2 max-w-[640px] text-[13px] leading-6 text-muted-foreground/86">
                    Choose the global desktop theme for shell surfaces, overlays, controls, and the account menu.
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {themes.map((themeOption) => {
                      const selected = themeOption === theme;
                      const swatches = THEME_SWATCHES[themeOption] ?? ["#1a1a1a", "#777", "#2e2e2e"];
                      return (
                        <button
                          key={themeOption}
                          type="button"
                          onClick={() => onThemeChange(themeOption)}
                          className={`rounded-[20px] border p-3 text-left transition ${
                            selected
                              ? "border-primary/45 bg-primary/10 shadow-[0_14px_38px_rgba(0,0,0,0.18)]"
                              : "border-border/40 bg-black/10 hover:border-primary/28 hover:bg-accent"
                          }`}
                        >
                          <div className="rounded-[16px] border border-border/30 bg-card/80 p-3">
                            <div className="grid grid-cols-[1.2fr_0.9fr] gap-2">
                              <div
                                className="h-16 rounded-[14px] border border-white/10"
                                style={{ background: `linear-gradient(160deg, ${swatches[0]}, ${swatches[2]})` }}
                              />
                              <div className="grid gap-2">
                                <div
                                  className="h-7 rounded-[10px] border border-white/10"
                                  style={{ background: swatches[1] }}
                                />
                                <div
                                  className="h-7 rounded-[10px] border border-white/10"
                                  style={{ background: `color-mix(in srgb, ${swatches[1]} 42%, ${swatches[0]} 58%)` }}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-[13px] font-medium text-foreground">{prettifyThemeLabel(themeOption)}</span>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] ${
                                selected
                                  ? "border-primary/40 bg-primary/12 text-primary"
                                  : "border-border/35 text-muted-foreground/68"
                              }`}
                            >
                              {selected ? "Active" : "Preview"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            ) : null}

            {activeSection === "about" ? (
              <div className="grid max-w-[720px] gap-4">
                <section className="theme-subtle-surface rounded-[24px] border border-border/40 p-5">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/68">Links</div>
                  <div className="mt-2 text-[13px] leading-6 text-muted-foreground/84">
                    Open the main product site, OSS docs, or support issue tracker in your default browser.
                  </div>

                  <div className="mt-5 grid gap-3">
                    {[
                      {
                        id: "home",
                        label: "Homepage",
                        detail: "Product homepage and company landing page.",
                        icon: Globe,
                        href: "https://holaboss.ai"
                      },
                      {
                        id: "docs",
                        label: "Docs",
                        detail: "Open-source repository, releases, and setup notes.",
                        icon: Info,
                        href: "https://github.com/holaboss-ai/hola-boss-oss"
                      },
                      {
                        id: "help",
                        label: "Get help",
                        detail: "Open the issue tracker for support and bug reports.",
                        icon: CircleHelp,
                        href: "https://github.com/holaboss-ai/hola-boss-oss/issues"
                      }
                    ].map(({ id, label, detail, icon: Icon, href }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onOpenExternalUrl(href)}
                        className="flex items-center justify-between gap-3 rounded-[18px] border border-border/40 bg-black/10 px-4 py-3 text-left transition hover:border-primary/30 hover:bg-accent"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-border/35 text-muted-foreground/82">
                            <Icon size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-foreground">{label}</span>
                            <span className="mt-1 block text-[11px] leading-5 text-muted-foreground/72">{detail}</span>
                          </span>
                        </span>
                        <ExternalLink size={15} className="shrink-0 text-muted-foreground/70" />
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
