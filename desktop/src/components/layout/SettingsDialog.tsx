import { useEffect } from "react";
import { CircleHelp, ExternalLink, Globe, Info, Palette, User2, X } from "lucide-react";
import { AuthPanel } from "@/components/auth/AuthPanel";

const THEME_SWATCHES: Record<string, [string, string, string]> = {
  holaboss: ["#fff7f2", "#f75a54", "#d7dde8"],
  emerald: ["#081b15", "#3ddc97", "#123d31"],
  cobalt: ["#0a1528", "#5aa3ff", "#1e3f72"],
  ember: ["#20110b", "#ff8c42", "#5b2c16"],
  glacier: ["#edf8ff", "#59b8ff", "#c8e8ff"],
  mono: ["#101010", "#d6d6d6", "#454545"],
  claude: ["#f8f4ec", "#d97745", "#ead7b8"],
  slate: ["#111827", "#94a3b8", "#334155"],
  paper: ["#fcfbf7", "#8a5a44", "#e2d7c8"],
  graphite: ["#15171c", "#9ca3af", "#2a2f37"]
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
    case "about":
      return "Open product resources and support channels.";
    case "settings":
    default:
      return "Tune desktop appearance and shared preferences.";
  }
}

function prettifyThemeLabel(theme: string): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
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
        className="theme-shell soft-vignette neon-border pointer-events-auto relative z-10 grid max-h-[min(760px,calc(100vh-40px))] w-[min(980px,calc(100vw-32px))] min-w-0 overflow-hidden rounded-[28px] shadow-card lg:grid-cols-[240px_minmax(0,1fr)]"
      >
        <aside className="theme-header-surface border-b border-panel-border/35 p-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-[16px] border border-neon-green/30 bg-neon-green/10 text-neon-green">
              <Palette size={18} />
            </div>
            <div>
              <div className="text-[12px] uppercase tracking-[0.18em] text-text-dim/72">Holaboss</div>
              <div className="mt-1 text-[18px] font-semibold text-text-main">Desktop Settings</div>
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
                      ? "border-neon-green/40 bg-neon-green/10 text-text-main shadow-[0_12px_36px_rgba(0,0,0,0.16)]"
                      : "border-transparent text-text-muted hover:border-panel-border/45 hover:bg-[var(--theme-hover-bg)] hover:text-text-main"
                  }`}
                >
                  <span
                    className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[12px] border ${
                      active
                        ? "border-neon-green/35 bg-neon-green/12 text-neon-green"
                        : "border-panel-border/35 text-text-dim/80"
                    }`}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{label}</span>
                    <span className="mt-1 block text-[11px] leading-5 text-text-dim/72">{description}</span>
                  </span>
                </button>
              );
            })}
          </nav>

        </aside>

        <section className="min-h-0 min-w-0 overflow-hidden">
          <header className="theme-header-surface flex items-start justify-between gap-4 border-b border-panel-border/35 px-5 py-4">
            <div>
              <div className="text-[20px] font-semibold text-text-main">{titleForSection(activeSection)}</div>
              <div className="mt-1 text-[12px] text-text-dim/72">{subtitleForSection(activeSection)}</div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-panel-border/45 text-text-muted transition hover:border-neon-green/35 hover:text-text-main"
            >
              <X size={16} />
            </button>
          </header>

          <div className="min-h-0 overflow-y-auto px-5 py-5">
            {activeSection === "account" ? (
              <div className="max-w-[560px]">
                <AuthPanel />
              </div>
            ) : null}

            {activeSection === "settings" ? (
              <div className="grid gap-6">
                <section className="theme-subtle-surface rounded-[24px] border border-panel-border/40 p-5">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim/68">Appearance</div>
                  <div className="mt-2 max-w-[640px] text-[13px] leading-6 text-text-muted/86">
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
                              ? "border-neon-green/45 bg-neon-green/10 shadow-[0_14px_38px_rgba(0,0,0,0.18)]"
                              : "border-panel-border/40 bg-black/10 hover:border-neon-green/28 hover:bg-[var(--theme-hover-bg)]"
                          }`}
                        >
                          <div className="rounded-[16px] border border-panel-border/30 bg-panel-bg/80 p-3">
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
                            <span className="text-[13px] font-medium text-text-main">{prettifyThemeLabel(themeOption)}</span>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] ${
                                selected
                                  ? "border-neon-green/40 bg-neon-green/12 text-neon-green"
                                  : "border-panel-border/35 text-text-dim/68"
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
                <section className="theme-subtle-surface rounded-[24px] border border-panel-border/40 p-5">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-text-dim/68">Links</div>
                  <div className="mt-2 text-[13px] leading-6 text-text-muted/84">
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
                        className="flex items-center justify-between gap-3 rounded-[18px] border border-panel-border/40 bg-black/10 px-4 py-3 text-left transition hover:border-neon-green/30 hover:bg-[var(--theme-hover-bg)]"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-panel-border/35 text-text-muted/82">
                            <Icon size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-text-main">{label}</span>
                            <span className="mt-1 block text-[11px] leading-5 text-text-dim/72">{detail}</span>
                          </span>
                        </span>
                        <ExternalLink size={15} className="shrink-0 text-text-dim/70" />
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
