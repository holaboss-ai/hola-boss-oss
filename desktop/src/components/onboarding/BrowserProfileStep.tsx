import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface BrowserProfileStepProps {
  browserBootstrapMode: "fresh" | "copy_workspace" | "import_browser";
  setBrowserBootstrapMode: (
    value: "fresh" | "copy_workspace" | "import_browser",
  ) => void;
  browserBootstrapSourceWorkspaceId: string;
  setBrowserBootstrapSourceWorkspaceId: (workspaceId: string) => void;
  copySourceWorkspaces: WorkspaceRecordPayload[];
  browserImportSource: BrowserImportSource;
  setBrowserImportSource: (source: BrowserImportSource) => void;
  browserImportProfileDir: string;
  setBrowserImportProfileDir: (profileDir: string) => void;
  importProfiles: BrowserImportProfileOptionPayload[];
  importProfilesLoading: boolean;
  importProfilesError: string;
  createDisabled: boolean;
  workspaceErrorMessage: string;
  onBack: () => void;
  onCancel: () => void;
  onCreate: () => void;
}

export function BrowserProfileStep({
  browserBootstrapMode,
  setBrowserBootstrapMode,
  browserBootstrapSourceWorkspaceId,
  setBrowserBootstrapSourceWorkspaceId,
  copySourceWorkspaces,
  browserImportSource,
  setBrowserImportSource,
  browserImportProfileDir,
  setBrowserImportProfileDir,
  importProfiles,
  importProfilesLoading,
  importProfilesError,
  createDisabled,
  workspaceErrorMessage,
  onBack,
  onCancel,
  onCreate,
}: BrowserProfileStepProps) {
  const browserBootstrapOptions: Array<{
    id: "fresh" | "copy_workspace" | "import_browser";
    label: string;
    detail: string;
  }> = [
    {
      id: "fresh",
      label: "Start fresh",
      detail: "Create an empty workspace browser profile.",
    },
    {
      id: "copy_workspace",
      label: "Copy workspace",
      detail: "Clone browser data from an existing workspace.",
    },
    {
      id: "import_browser",
      label: "Import browser",
      detail: "Import bookmarks/history/cookies from another browser.",
    },
  ];

  return (
    <div>
      <div className="max-w-3xl">
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Step 2 of 2
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Browser profile
        </h1>
      </div>

      <div className="mt-6 grid gap-5" style={{ maxWidth: 560 }}>
        <div className="grid gap-2">
          <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Setup mode
          </Label>
          <div className="grid gap-2">
            {browserBootstrapOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setBrowserBootstrapMode(option.id)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  browserBootstrapMode === option.id
                    ? "border-primary/55 bg-primary/10"
                    : "border-border/65 bg-background hover:border-primary/35"
                }`}
              >
                <p className="text-sm font-medium text-foreground">{option.label}</p>
                <p className="text-xs text-muted-foreground">{option.detail}</p>
              </button>
            ))}
          </div>
        </div>

        {browserBootstrapMode === "copy_workspace" ? (
          <div className="grid gap-2">
            <Label
              htmlFor="copy-workspace-source"
              className="text-[11px] uppercase tracking-widest text-muted-foreground"
            >
              Source workspace
            </Label>
            <select
              id="copy-workspace-source"
              value={browserBootstrapSourceWorkspaceId}
              onChange={(event) =>
                setBrowserBootstrapSourceWorkspaceId(event.target.value)
              }
              className="h-10 rounded-lg border border-border/65 bg-background px-3 text-sm text-foreground"
            >
              {copySourceWorkspaces.length > 0 ? null : (
                <option value="">No workspaces available</option>
              )}
              {copySourceWorkspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name || workspace.id}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {browserBootstrapMode === "import_browser" ? (
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label
                htmlFor="import-browser-source"
                className="text-[11px] uppercase tracking-widest text-muted-foreground"
              >
                Import source
              </Label>
              <select
                id="import-browser-source"
                value={browserImportSource}
                onChange={(event) =>
                  setBrowserImportSource(event.target.value as BrowserImportSource)
                }
                className="h-10 rounded-lg border border-border/65 bg-background px-3 text-sm text-foreground"
              >
                <option value="chrome">Chrome</option>
                <option value="chromium">Chromium</option>
                <option value="arc">Arc</option>
                <option value="safari">Safari export (.zip)</option>
              </select>
            </div>

            {browserImportSource === "safari" ? (
              <p className="rounded-lg border border-border/65 bg-background px-3 py-2 text-sm text-muted-foreground">
                Safari import uses the exported ZIP file selector when you click
                Create Workspace.
              </p>
            ) : (
              <div className="grid gap-2">
                <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  Profiles
                </Label>
                <div className="max-h-44 overflow-y-auto rounded-lg border border-border/65 bg-background">
                  {importProfilesLoading ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      Loading profiles...
                    </p>
                  ) : importProfiles.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      No importable profiles found for this browser.
                    </p>
                  ) : (
                    <div className="divide-y divide-border/55">
                      {importProfiles.map((profile) => (
                        <label
                          key={profile.profileDir}
                          className="flex cursor-pointer items-start gap-2 px-3 py-2 text-sm hover:bg-muted/35"
                        >
                          <input
                            type="radio"
                            name="import-profile"
                            checked={browserImportProfileDir === profile.profileDir}
                            onChange={() =>
                              setBrowserImportProfileDir(profile.profileDir)
                            }
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block font-medium text-foreground">
                              {profile.profileLabel}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {profile.profileDir}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {importProfilesError ? (
                  <p className="text-xs text-destructive">{importProfilesError}</p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {workspaceErrorMessage ? (
        <div
          className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          style={{ maxWidth: 560 }}
        >
          {workspaceErrorMessage}
        </div>
      ) : null}

      <div className="mt-5 flex items-center gap-3">
        <Button
          onClick={onBack}
          size="lg"
          variant="outline"
          className="h-11 gap-2 rounded-xl px-5"
        >
          <ArrowLeft size={16} />
          Back
        </Button>
        <Button
          disabled={createDisabled}
          onClick={onCreate}
          size="lg"
          className="h-11 gap-2 rounded-xl px-5"
        >
          Create Workspace
          <ArrowRight size={16} />
        </Button>
        <Button
          variant="link"
          size="sm"
          onClick={onCancel}
          className="text-muted-foreground"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
