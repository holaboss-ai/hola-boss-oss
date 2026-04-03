import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TemplateCard } from "./TemplateCard";
import { IntegrationsList } from "./IntegrationsList";

interface ConfigureStepProps {
  templateSourceMode: string;
  selectedMarketplaceTemplate: TemplateMetadataPayload | null;
  selectedTemplateFolder: TemplateFolderSelectionPayload | null;
  newWorkspaceName: string;
  setNewWorkspaceName: (value: string) => void;
  pendingIntegrations: ResolveTemplateIntegrationsResult | null;
  isResolvingIntegrations: boolean;
  connectingProvider: string | null;
  connectStatus: string;
  workspaceErrorMessage: string;
  createDisabled: boolean;
  hasUnconnectedIntegrations: boolean;
  onChangeKit: () => void;
  onChangeFolder: () => void;
  onBackToKits: () => void;
  onConnect: (provider: string) => void;
  onCreate: () => void;
}

export function ConfigureStep({
  templateSourceMode,
  selectedMarketplaceTemplate,
  selectedTemplateFolder,
  newWorkspaceName,
  setNewWorkspaceName,
  pendingIntegrations,
  isResolvingIntegrations,
  connectingProvider,
  connectStatus,
  workspaceErrorMessage,
  createDisabled,
  hasUnconnectedIntegrations,
  onChangeKit,
  onChangeFolder,
  onBackToKits,
  onConnect,
  onCreate,
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
            createDisabled ||
            hasUnconnectedIntegrations ||
            isResolvingIntegrations ||
            connectingProvider !== null
          }
          onClick={onCreate}
          size="lg"
          className="h-11 gap-2 rounded-xl px-5"
        >
          Create Workspace
          <ArrowRight size={16} />
        </Button>
        <Button variant="link" size="sm" onClick={onBackToKits} className="text-muted-foreground">
          Back to workers
        </Button>
      </div>
    </div>
  );
}
