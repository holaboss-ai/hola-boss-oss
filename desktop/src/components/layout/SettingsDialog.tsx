import {
  CircleHelp,
  CreditCard,
  ExternalLink,
  FileArchive,
  Globe,
  Info,
  Loader2,
  Plug,
  Send,
  Settings2,
  User2,
  Waypoints,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { BillingSettingsPanel } from "@/components/billing/BillingSettingsPanel";
import { IntegrationsPane } from "@/components/panes/IntegrationsPane";
import { SubmissionsPanel } from "@/components/settings/SubmissionsPanel";
import { Button } from "@/components/ui/button";

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
  icon: typeof User2;
}> = [
  { id: "account", label: "Account", icon: User2 },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "providers", label: "Model Providers", icon: Waypoints },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "submissions", label: "Submissions", icon: Send },
  { id: "about", label: "About", icon: Info },
];

const ABOUT_LINKS = [
  {
    id: "home",
    label: "Homepage",
    icon: Globe,
    href: "https://www.holaboss.ai",
  },
  {
    id: "docs",
    label: "Docs",
    icon: Info,
    href: "https://github.com/holaboss-ai/holaboss-ai",
  },
  {
    id: "help",
    label: "Get help",
    icon: CircleHelp,
    href: "https://github.com/holaboss-ai/holaboss-ai/issues",
  },
] as const;

const THEME_DISPLAY_NAMES: Record<string, string> = {
  "amber-minimal-dark": "Default Dark",
  "amber-minimal-light": "Default Light",
};

function titleForSection(section: UiSettingsPaneSection): string {
  switch (section) {
    case "account":
      return "Account";
    case "billing":
      return "Billing";
    case "providers":
      return "Model Providers";
    case "integrations":
      return "Integrations";
    case "submissions":
      return "Submissions";
    case "about":
      return "About";
    default:
      return "Settings";
  }
}

function prettifyThemeLabel(theme: string): string {
  if (THEME_DISPLAY_NAMES[theme]) {
    return THEME_DISPLAY_NAMES[theme];
  }

  return theme
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
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
  onOpenExternalUrl,
}: SettingsDialogProps) {
  const [diagnosticsExportState, setDiagnosticsExportState] = useState<{
    status: "idle" | "exporting" | "success" | "error";
    message: string;
    bundlePath: string;
  }>({
    status: "idle",
    message: "",
    bundlePath: "",
  });

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

  async function handleExportDiagnosticsBundle() {
    setDiagnosticsExportState({
      status: "exporting",
      message: "",
      bundlePath: "",
    });
    try {
      const result = await window.electronAPI.diagnostics.exportBundle();
      setDiagnosticsExportState({
        status: "success",
        message:
          "Diagnostics bundle exported to Downloads and revealed in Finder.",
        bundlePath: result.bundlePath,
      });
    } catch (error) {
      setDiagnosticsExportState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to export diagnostics bundle.",
        bundlePath: "",
      });
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center px-4 py-6">
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="pointer-events-auto absolute inset-0 bg-background/70 backdrop-blur-sm"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="pointer-events-auto relative z-10 grid h-[min(780px,calc(100vh-32px))] w-[min(1080px,calc(100vw-24px))] min-w-0 overflow-hidden rounded-[28px] border border-border bg-background shadow-lg grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[248px_minmax(0,1fr)] lg:grid-rows-1"
      >
        <aside className="border-b border-sidebar-border bg-sidebar p-4 text-sidebar-foreground lg:border-b-0 lg:border-r">
          <nav className="mt-6 grid gap-1.5">
            {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => {
              const active = id === activeSection;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSectionChange(id)}
                  className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${
                      active
                        ? "bg-sidebar-primary/12 text-sidebar-primary"
                        : "text-sidebar-foreground/60"
                    }`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 text-sm font-medium">{label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-4 border-b border-border/35 px-6 py-5">
            <div className="text-xl font-semibold text-foreground">
              {titleForSection(activeSection)}
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

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 [scrollbar-gutter:stable]">
            {activeSection === "account" ? (
              <div className="w-full">
                <AuthPanel view="account" />
              </div>
            ) : null}

            {activeSection === "billing" ? <BillingSettingsPanel /> : null}

            {activeSection === "providers" ? (
              <div className="grid gap-6">
                <section className="max-w-[920px]">
                  <AuthPanel view="runtime" />
                </section>
              </div>
            ) : null}

            {activeSection === "integrations" ? (
              <IntegrationsPane embedded />
            ) : null}

            {activeSection === "submissions" ? (
              <SubmissionsPanel />
            ) : null}

            {activeSection === "settings" ? (
              <div className="grid gap-6">
                <section className="theme-subtle-surface rounded-[24px] border border-border/40 p-5">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Appearance
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {themes.map((themeOption) => {
                      const selected = themeOption === theme;
                      const swatches = THEME_SWATCHES[themeOption] ?? [
                        "#1a1a1a",
                        "#777777",
                        "#2e2e2e",
                      ];

                      return (
                        <button
                          key={themeOption}
                          type="button"
                          onClick={() => onThemeChange(themeOption)}
                          className={`rounded-[20px] border p-3 text-left transition ${
                            selected
                              ? "border-primary/45 bg-primary/10 shadow-sm"
                              : "border-border/40 bg-card/80 hover:border-primary/28 hover:bg-accent"
                          }`}
                        >
                          <div className="rounded-[16px] border border-border/30 bg-card/80 p-3">
                            <div className="grid grid-cols-[1.2fr_0.9fr] gap-2">
                              <div
                                className="h-16 rounded-[14px] border border-white/10"
                                style={{
                                  background: `linear-gradient(160deg, ${swatches[0]}, ${swatches[2]})`,
                                }}
                              />
                              <div className="grid gap-2">
                                <div
                                  className="h-7 rounded-[10px] border border-white/10"
                                  style={{ background: swatches[1] }}
                                />
                                <div
                                  className="h-7 rounded-[10px] border border-white/10"
                                  style={{
                                    background: `color-mix(in srgb, ${swatches[1]} 42%, ${swatches[0]} 58%)`,
                                  }}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-foreground">
                              {prettifyThemeLabel(themeOption)}
                            </span>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs uppercase tracking-[0.14em] ${
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
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Links
                  </div>

                  <div className="mt-5 grid gap-3">
                    {ABOUT_LINKS.map(({ id, label, icon: Icon, href }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => onOpenExternalUrl(href)}
                        className="flex items-center justify-between gap-3 rounded-[18px] border border-border/40 bg-card/80 px-4 py-3 text-left transition hover:border-primary/30 hover:bg-accent"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-border/35 text-muted-foreground/82">
                            <Icon size={16} />
                          </span>
                          <span className="min-w-0 text-sm font-medium text-foreground">
                            {label}
                          </span>
                        </span>
                        <ExternalLink
                          size={15}
                          className="shrink-0 text-muted-foreground/70"
                        />
                      </button>
                    ))}
                  </div>
                </section>

                <section className="theme-subtle-surface rounded-[24px] border border-border/40 p-5">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Diagnostics
                  </div>
                  <div className="mt-3 max-w-[620px] text-sm leading-6 text-muted-foreground">
                    Export a local diagnostics bundle with <code>runtime.log</code>,
                    a consistent snapshot of <code>runtime.db</code>, and a
                    redacted runtime config file. No upload happens automatically.
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleExportDiagnosticsBundle()}
                      disabled={diagnosticsExportState.status === "exporting"}
                    >
                      {diagnosticsExportState.status === "exporting" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <FileArchive className="size-4" />
                      )}
                      Export Diagnostics Bundle
                    </Button>
                    <span className="text-xs text-muted-foreground/80">
                      Saved to Downloads as a zip file.
                    </span>
                  </div>
                  {diagnosticsExportState.message ? (
                    <div
                      className={`mt-4 rounded-[18px] border px-4 py-3 text-sm ${
                        diagnosticsExportState.status === "error"
                          ? "border-destructive/30 bg-destructive/5 text-destructive"
                          : "border-border/40 bg-card/70 text-foreground"
                      }`}
                    >
                      <div>{diagnosticsExportState.message}</div>
                      {diagnosticsExportState.bundlePath ? (
                        <div className="mt-2 break-all font-mono text-xs text-muted-foreground">
                          {diagnosticsExportState.bundlePath}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
