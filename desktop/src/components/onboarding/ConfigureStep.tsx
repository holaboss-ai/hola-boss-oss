import { ArrowRight, FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IntegrationsList } from "./IntegrationsList";
import { TemplateCard } from "./TemplateCard";

interface ConfigureStepProps {
  templateSourceMode: string;
  selectedMarketplaceTemplate: TemplateMetadataPayload | null;
  selectedTemplateFolder: TemplateFolderSelectionPayload | null;
  selectedWorkspaceFolder: WorkspaceRuntimeFolderSelectionPayload | null;
  newWorkspaceName: string;
  setNewWorkspaceName: (value: string) => void;
  pendingIntegrations: ResolveTemplateIntegrationsResult | null;
  isResolvingIntegrations: boolean;
  connectingProvider: string | null;
  connectStatus: string;
  workspaceErrorMessage: string;
  continueDisabled: boolean;
  hasUnconnectedIntegrations: boolean;
  onChangeKit: () => void;
  onChangeFolder: () => void;
  onChooseWorkspaceFolder: () => void;
  onClearWorkspaceFolder: () => void;
  defaultWorkspaceRoot: string | null;
  onCancel: () => void;
  onConnect: (provider: string) => void;
  onContinue: () => void;
}

export function ConfigureStep({
  templateSourceMode,
  selectedMarketplaceTemplate,
  selectedTemplateFolder,
  selectedWorkspaceFolder,
  newWorkspaceName,
  setNewWorkspaceName,
  pendingIntegrations,
  isResolvingIntegrations,
  connectingProvider,
  connectStatus,
  workspaceErrorMessage,
  continueDisabled,
  hasUnconnectedIntegrations,
  onChangeKit,
  onChangeFolder,
  onChooseWorkspaceFolder,
  onClearWorkspaceFolder,
  defaultWorkspaceRoot,
  onCancel,
  onConnect,
  onContinue,
}: ConfigureStepProps) {
  return (
    <div>
      <div className="max-w-3xl">
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          New workspace
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Configure &amp; launch
        </h1>
      </div>

      <TemplateCard
        templateSourceMode={templateSourceMode}
        selectedMarketplaceTemplate={selectedMarketplaceTemplate}
        selectedTemplateFolder={selectedTemplateFolder}
        onChangeKit={onChangeKit}
        onChangeFolder={onChangeFolder}
      />

      <div className="mt-6 grid gap-5" style={{ maxWidth: 480 }}>
        <div className="grid gap-2">
          <Label
            htmlFor="workspace-name"
            className="text-[11px] uppercase tracking-widest text-muted-foreground"
          >
            Workspace name
          </Label>
          <Input
            id="workspace-name"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            placeholder="My first workspace"
            className="h-10"
          />
        </div>

        <div className="grid gap-2">
          <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Workspace folder
            <span className="ml-2 text-muted-foreground/70 normal-case tracking-normal">
              optional
            </span>
          </Label>
          {selectedWorkspaceFolder?.rootPath ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
              <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-sm text-foreground" title={selectedWorkspaceFolder.rootPath}>
                {selectedWorkspaceFolder.rootPath}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearWorkspaceFolder}
                className="h-7 px-2 text-muted-foreground hover:bg-accent"
                aria-label="Clear workspace folder"
              >
                <X size={14} />
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onChooseWorkspaceFolder}
              className="h-9 justify-start gap-2 font-normal"
            >
              <FolderOpen size={14} />
              Choose an empty folder…
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            {selectedWorkspaceFolder?.rootPath ? (
              <>Your workspace's files will be stored in the folder above.</>
            ) : defaultWorkspaceRoot ? (
              <>
                Defaults to{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  {defaultWorkspaceRoot}/workspace/&lt;id&gt;
                </code>
                . Pick a folder if you'd rather keep the files somewhere you control.
              </>
            ) : (
              <>Pick an empty folder if you'd rather keep the workspace files on a drive you control.</>
            )}
          </p>
        </div>
      </div>

      <IntegrationsList
        pendingIntegrations={pendingIntegrations}
        isResolvingIntegrations={isResolvingIntegrations}
        connectingProvider={connectingProvider}
        connectStatus={connectStatus}
        onConnect={onConnect}
      />

      {workspaceErrorMessage ? (
        <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive" style={{ maxWidth: 480 }}>
          {workspaceErrorMessage}
        </div>
      ) : null}

      <div className="mt-5 flex items-center gap-3">
        <Button
          disabled={
            continueDisabled ||
            hasUnconnectedIntegrations ||
            isResolvingIntegrations ||
            connectingProvider !== null
          }
          onClick={onContinue}
          size="lg"
          className="h-11 gap-2 rounded-xl px-5"
        >
          Next
          <ArrowRight size={16} />
        </Button>
        <Button variant="link" size="sm" onClick={onCancel} className="text-muted-foreground">
          Cancel
        </Button>
      </div>
    </div>
  );
}
