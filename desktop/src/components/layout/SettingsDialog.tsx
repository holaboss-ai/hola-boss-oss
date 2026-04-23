import {
  AlertTriangle,
  Check,
  CircleHelp,
  Copy,
  CreditCard,
  ExternalLink,
  FolderOpen,
  Globe,
  Info,
  Loader2,
  Lock,
  Package,
  Plug,
  RotateCcw,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

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

import type { ColorScheme, ThemeVariant } from "@/components/layout/AppShell";

interface SettingsDialogProps {
  open: boolean;
  activeSection: UiSettingsPaneSection;
  appVersion: string;
  onSectionChange: (section: UiSettingsPaneSection) => void;
  onClose: () => void;
  colorScheme: ColorScheme;
  onColorSchemeChange: (scheme: ColorScheme) => void;
  themeVariant: ThemeVariant;
  themeVariants: readonly ThemeVariant[];
  onThemeVariantChange: (variant: ThemeVariant) => void;
  onOpenExternalUrl: (url: string) => void;
}

const THEME_VARIANT_LABELS: Record<ThemeVariant, string> = {
  "amber-minimal": "Default",
  "cosmic-night": "Cosmic Night",
  sepia: "Sepia",
  "clean-slate": "Clean Slate",
  "bold-tech": "Bold Tech",
  catppuccin: "Catppuccin",
  bubblegum: "Bubblegum",
};

const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

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
    href: "https://github.com/holaboss-ai/holaOS",
  },
  {
    id: "help",
    label: "Get help",
    icon: CircleHelp,
    href: "https://github.com/holaboss-ai/holaOS/issues",
  },
] as const;

function formatBundleBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

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

function aboutAppUpdateState(status: AppUpdateStatusPayload | null): {
  badge: string;
  message: string;
  progressPercent: number | null;
  error: boolean;
  readyToInstall: boolean;
} {
  if (!status) {
    return {
      badge: "Loading",
      message: "Loading desktop update status.",
      progressPercent: null,
      error: false,
      readyToInstall: false,
    };
  }

  const latestVersion = status.latestVersion?.trim()
    ? `v${status.latestVersion.trim()}`
    : "the latest release";
  const channelLabel = status.channel === "beta" ? "beta" : "stable";

  if (!status.supported) {
    return {
      badge: "Unavailable",
      message: "In-app desktop updates are unavailable on this build.",
      progressPercent: null,
      error: false,
      readyToInstall: false,
    };
  }

  if (status.error) {
    return {
      badge: "Error",
      message: status.error,
      progressPercent: null,
      error: true,
      readyToInstall: false,
    };
  }

  if (status.downloaded) {
    return {
      badge: "Ready",
      message: `${latestVersion} has finished downloading and is ready to install.`,
      progressPercent: null,
      error: false,
      readyToInstall: true,
    };
  }

  if (status.available) {
    const progressPercent =
      typeof status.downloadProgressPercent === "number"
        ? Math.max(0, Math.min(100, Math.round(status.downloadProgressPercent)))
        : 0;
    return {
      badge: "Downloading",
      message: `Downloading ${latestVersion} in the background.`,
      progressPercent,
      error: false,
      readyToInstall: false,
    };
  }

  if (status.checking) {
    return {
      badge: "Checking",
      message: `Checking for the latest ${channelLabel} desktop release.`,
      progressPercent: null,
      error: false,
      readyToInstall: false,
    };
  }

  return {
    badge: "Current",
    message: `This device is up to date on the ${channelLabel} channel.`,
    progressPercent: null,
    error: false,
    readyToInstall: false,
  };
}

export function SettingsDialog({
  open,
  activeSection,
  appVersion,
  onSectionChange,
  onClose,
  colorScheme,
  onColorSchemeChange,
  themeVariant,
  themeVariants,
  onThemeVariantChange,
  onOpenExternalUrl,
}: SettingsDialogProps) {
  const displayAppVersion = appVersion.trim() || "Unavailable";
  const [diagnosticsExportState, setDiagnosticsExportState] = useState<{
    status: "idle" | "exporting" | "success" | "error";
    message: string;
    bundlePath: string;
    sizeBytes: number;
  }>({
    status: "idle",
    message: "",
    bundlePath: "",
    sizeBytes: 0,
  });
  const [diagnosticsPathCopied, setDiagnosticsPathCopied] = useState(false);
  const [appUpdateStatus, setAppUpdateStatus] =
    useState<AppUpdateStatusPayload | null>(null);
  const [appUpdateChannelPending, setAppUpdateChannelPending] = useState(false);
  const [appUpdateInstallPending, setAppUpdateInstallPending] = useState(false);

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

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    void window.electronAPI.appUpdate.getStatus().then((status) => {
      if (!cancelled) {
        setAppUpdateStatus(status);
      }
    });
    void window.electronAPI.appUpdate.checkNow().then((status) => {
      if (!cancelled) {
        setAppUpdateStatus(status);
      }
    });
    const unsubscribe = window.electronAPI.appUpdate.onStateChange((status) => {
      if (!cancelled) {
        setAppUpdateStatus(status);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [open]);

  useEffect(() => {
    if (!appUpdateStatus?.downloaded) {
      setAppUpdateInstallPending(false);
    }
  }, [appUpdateStatus?.downloaded]);

  async function handleExportDiagnosticsBundle() {
    setDiagnosticsPathCopied(false);
    setDiagnosticsExportState((prev) => ({
      ...prev,
      status: "exporting",
      message: "",
    }));
    try {
      const result = await window.electronAPI.diagnostics.exportBundle();
      setDiagnosticsExportState({
        status: "success",
        message: "",
        bundlePath: result.bundlePath,
        sizeBytes: result.archiveSizeBytes,
      });
    } catch (error) {
      setDiagnosticsExportState((prev) => ({
        ...prev,
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to export diagnostics bundle.",
      }));
    }
  }

  async function handleRevealDiagnosticsBundle() {
    if (!diagnosticsExportState.bundlePath) {
      return;
    }
    await window.electronAPI.diagnostics.revealBundle(
      diagnosticsExportState.bundlePath,
    );
  }

  async function handleCopyDiagnosticsPath() {
    if (!diagnosticsExportState.bundlePath) {
      return;
    }
    try {
      await navigator.clipboard.writeText(diagnosticsExportState.bundlePath);
      setDiagnosticsPathCopied(true);
      window.setTimeout(() => setDiagnosticsPathCopied(false), 1500);
    } catch {
      setDiagnosticsPathCopied(false);
    }
  }

  async function handleSetBetaChannel(checked: boolean) {
    setAppUpdateChannelPending(true);
    try {
      const status = await window.electronAPI.appUpdate.setChannel(
        checked ? "beta" : "latest",
      );
      setAppUpdateStatus(status);
    } finally {
      setAppUpdateChannelPending(false);
    }
  }

  function handleInstallAppUpdateNow() {
    if (appUpdateInstallPending) {
      return;
    }

    setAppUpdateInstallPending(true);
    void window.electronAPI.appUpdate.installNow().catch((error) => {
      console.error("Failed to install the downloaded desktop update.", error);
      setAppUpdateInstallPending(false);
    });
  }

  if (!open) {
    return null;
  }

  const betaChannelEnabled = appUpdateStatus?.channel === "beta";
  const appUpdateChannelUnavailable = appUpdateStatus
    ? !appUpdateStatus.supported
    : true;
  const appUpdateState = aboutAppUpdateState(appUpdateStatus);

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
        className="pointer-events-auto relative z-10 grid h-[min(780px,calc(100vh-32px))] w-[min(980px,calc(100vw-24px))] min-w-0 overflow-hidden rounded-2xl border border-border bg-background shadow-lg grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-1"
      >
        <aside className="border-b border-sidebar-border bg-sidebar p-4 text-sidebar-foreground lg:border-b-0 lg:border-r">
          <nav className="mt-4 grid gap-1">
            {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => {
              const active = id === activeSection;

              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSectionChange(id)}
                  className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors ${
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <Icon className="size-3.5 shrink-0" />
                  <span className="min-w-0 font-medium">{label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
            <div className="text-lg font-semibold text-foreground">
              {titleForSection(activeSection)}
            </div>

            <Button
              variant="outline"
              size="icon"
              onClick={onClose}
              aria-label="Close settings"
            >
              <X size={16} />
            </Button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 [scrollbar-gutter:stable]">
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

            {activeSection === "submissions" ? <SubmissionsPanel /> : null}

            {activeSection === "settings" ? (
              <div className="grid gap-6">
                <section>
                  <div className="text-base font-medium text-foreground">
                    App
                  </div>

                  <div className="mt-3 overflow-hidden rounded-xl bg-card ring-1 ring-border">
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">
                          Holaboss Desktop
                        </div>
                        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          Version
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className="border-border bg-background/60 font-mono text-[11px] text-foreground"
                      >
                        v{displayAppVersion}
                      </Badge>
                    </div>

                    <div className="h-px bg-border" />

                    <div aria-live="polite" className="px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <span>Desktop updates</span>
                            <Badge
                              variant="outline"
                              className={`border-border bg-background/60 text-[11px] ${
                                appUpdateState.error
                                  ? "text-destructive"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {appUpdateState.badge}
                            </Badge>
                          </div>
                          <div
                            className={`mt-0.5 text-xs leading-5 ${
                              appUpdateState.error
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }`}
                          >
                            {appUpdateState.message}
                          </div>
                        </div>

                        {appUpdateState.progressPercent !== null ? (
                          <div className="shrink-0 text-xs font-medium tabular-nums text-foreground">
                            {appUpdateState.progressPercent}%
                          </div>
                        ) : null}
                      </div>

                      {appUpdateState.progressPercent !== null ? (
                        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-border/60">
                          <div
                            className={`h-full rounded-full transition-[width] ${
                              appUpdateState.error
                                ? "bg-destructive"
                                : "bg-primary/80"
                            }`}
                            style={{
                              width: `${appUpdateState.progressPercent}%`,
                            }}
                          />
                        </div>
                      ) : null}

                      {appUpdateState.readyToInstall ? (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleInstallAppUpdateNow}
                            disabled={appUpdateInstallPending}
                          >
                            {appUpdateInstallPending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <RotateCcw className="size-4" />
                            )}
                            {appUpdateInstallPending
                              ? "Restarting..."
                              : "Update and Restart Now"}
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <div className="h-px bg-border" />

                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <span>Beta updates</span>
                          <Badge
                            variant="outline"
                            className="border-border bg-background/60 text-[11px] text-muted-foreground"
                          >
                            {betaChannelEnabled ? "Beta" : "Latest"}
                          </Badge>
                        </div>
                        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {appUpdateChannelUnavailable
                            ? "In-app update channels are unavailable on this build."
                            : "Opt into beta desktop releases before they reach the stable channel."}
                        </div>
                      </div>

                      <Switch
                        checked={betaChannelEnabled}
                        disabled={
                          appUpdateChannelPending || appUpdateChannelUnavailable
                        }
                        onCheckedChange={(checked) => {
                          void handleSetBetaChannel(checked);
                        }}
                        aria-label="Enable beta updates"
                      />
                    </div>
                  </div>
                </section>

                <section>
                  <div className="text-base font-medium text-foreground">
                    Appearance
                  </div>

                  <div className="mt-3 overflow-hidden rounded-xl bg-card ring-1 ring-border">
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">
                          Color scheme
                        </div>
                        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          Choose whether Holaboss follows the system, light, or
                          dark theme
                        </div>
                      </div>
                      <Select
                        value={colorScheme}
                        onValueChange={(value) =>
                          onColorSchemeChange(value as ColorScheme)
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-auto min-w-[96px] justify-end gap-1.5 border-transparent bg-transparent px-2 text-xs font-medium hover:bg-accent dark:bg-transparent dark:hover:bg-accent"
                        >
                          <SelectValue>
                            {(value: string) =>
                              COLOR_SCHEME_LABELS[value as ColorScheme] ?? value
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                          align="end"
                          alignItemWithTrigger={false}
                          className="min-w-[140px] gap-0 rounded-lg p-1 shadow-subtle-sm ring-0"
                        >
                          {(["system", "light", "dark"] as const).map(
                            (scheme) => (
                              <SelectItem
                                key={scheme}
                                value={scheme}
                                className="rounded-md px-2.5 py-1.5 text-xs"
                              >
                                {COLOR_SCHEME_LABELS[scheme]}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="h-px bg-border" />

                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">
                          Theme
                        </div>
                        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          Customise how Holaboss is themed
                        </div>
                      </div>
                      <Select
                        value={themeVariant}
                        onValueChange={(value) =>
                          onThemeVariantChange(value as ThemeVariant)
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-auto min-w-[128px] justify-end gap-1.5 border-transparent bg-transparent px-2 text-xs font-medium hover:bg-accent dark:bg-transparent dark:hover:bg-accent"
                        >
                          <SelectValue>
                            {(value: string) =>
                              THEME_VARIANT_LABELS[value as ThemeVariant] ??
                              value
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent
                          align="end"
                          alignItemWithTrigger={false}
                          className="min-w-[180px] gap-0 rounded-lg p-1 shadow-subtle-sm ring-0"
                        >
                          {themeVariants.map((variant) => {
                            const swatch =
                              THEME_SWATCHES[`${variant}-light`]?.[1] ??
                              THEME_SWATCHES[`${variant}-dark`]?.[1] ??
                              "#808080";
                            return (
                              <SelectItem
                                key={variant}
                                value={variant}
                                className="gap-2 rounded-md px-2.5 py-1.5 text-xs"
                              >
                                <span
                                  aria-hidden="true"
                                  className="size-3 shrink-0 rounded-[4px] border border-border"
                                  style={{ background: swatch }}
                                />
                                <span className="min-w-0 flex-1">
                                  {THEME_VARIANT_LABELS[variant]}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}

            {activeSection === "about" ? (
              <div className="grid gap-6">
                <section>
                  <div className="text-base font-medium text-foreground">
                    Links
                  </div>

                  <div className="mt-3 overflow-hidden rounded-xl bg-card ring-1 ring-border">
                    {ABOUT_LINKS.map(
                      ({ id, label, icon: Icon, href }, index) => (
                        <div key={id}>
                          {index > 0 ? (
                            <div className="h-px bg-border" />
                          ) : null}
                          <button
                            type="button"
                            onClick={() => onOpenExternalUrl(href)}
                            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-accent"
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <Icon className="size-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 text-sm font-medium text-foreground">
                                {label}
                              </span>
                            </span>
                            <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </section>

                <section>
                  <div className="text-base font-medium text-foreground">
                    Diagnostics
                  </div>
                  <div className="mt-3 overflow-hidden rounded-xl bg-card ring-1 ring-border">
                    <div className="flex items-start gap-4 px-4 py-4">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Package className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-foreground">
                              Diagnostics bundle
                            </div>
                            <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                              A zip with logs, a database snapshot, and a
                              redacted config — useful when reporting an
                              issue.
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void handleExportDiagnosticsBundle()
                            }
                            disabled={
                              diagnosticsExportState.status === "exporting"
                            }
                          >
                            {diagnosticsExportState.status === "exporting" ? (
                              <>
                                <Loader2 className="size-3.5 animate-spin" />
                                Exporting…
                              </>
                            ) : diagnosticsExportState.status === "success" ? (
                              "Re-export"
                            ) : (
                              "Export"
                            )}
                          </Button>
                        </div>
                        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
                          <li className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="size-1 rounded-full bg-muted-foreground/50"
                            />
                            <code className="font-mono text-[11px]">
                              runtime.log
                            </code>
                          </li>
                          <li className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="size-1 rounded-full bg-muted-foreground/50"
                            />
                            <code className="font-mono text-[11px]">
                              runtime.db
                            </code>
                            <span>(consistent snapshot)</span>
                          </li>
                          <li className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="size-1 rounded-full bg-muted-foreground/50"
                            />
                            <span>Runtime config (secrets redacted)</span>
                          </li>
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
                      <Lock className="size-3.5 shrink-0" />
                      <span>
                        Stays on your device — nothing is uploaded automatically.
                      </span>
                    </div>
                    {diagnosticsExportState.status === "success" &&
                    diagnosticsExportState.bundlePath ? (
                      <div className="border-t border-border px-4 py-3">
                        <div className="flex items-center gap-2 text-sm text-foreground">
                          <Check className="size-4 text-emerald-600 dark:text-emerald-500" />
                          <span className="font-medium">Bundle ready</span>
                          <span className="text-muted-foreground">
                            ·{" "}
                            {formatBundleBytes(
                              diagnosticsExportState.sizeBytes,
                            )}
                          </span>
                        </div>
                        <div className="mt-1.5 truncate font-mono text-xs text-muted-foreground">
                          {diagnosticsExportState.bundlePath}
                        </div>
                        <div className="mt-2.5 flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant="bordered"
                            size="xs"
                            onClick={() =>
                              void handleRevealDiagnosticsBundle()
                            }
                          >
                            <FolderOpen className="size-3" />
                            Show in Finder
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => void handleCopyDiagnosticsPath()}
                          >
                            {diagnosticsPathCopied ? (
                              <>
                                <Check className="size-3" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="size-3" />
                                Copy path
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {diagnosticsExportState.status === "error" &&
                    diagnosticsExportState.message ? (
                      <div className="border-t border-border bg-destructive/5 px-4 py-3">
                        <div className="flex items-start gap-2 text-sm text-destructive">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-medium">
                              Couldn&apos;t export bundle
                            </div>
                            <div className="mt-0.5 break-words text-xs text-destructive/80">
                              {diagnosticsExportState.message}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
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
