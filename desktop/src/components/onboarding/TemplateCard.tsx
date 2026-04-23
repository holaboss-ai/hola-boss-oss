import { FolderOpen } from "lucide-react";
import { KitEmoji } from "@/components/marketplace/KitEmoji";
import { Button } from "@/components/ui/button";

interface MarketplaceCardProps {
  template: TemplateMetadataPayload;
  onChangeKit: () => void;
}

function MarketplaceCard({ template, onChangeKit }: MarketplaceCardProps) {
  return (
    <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3">
      <KitEmoji emoji={template.emoji} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {template.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {template.description || template.apps.map((a) => a.name).join(", ")}
        </div>
      </div>
      <Button variant="link" size="sm" onClick={onChangeKit}>
        Change
      </Button>
    </div>
  );
}

function EmptyCard({ onChangeKit }: { onChangeKit: () => void }) {
  return (
    <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3">
      <span className="text-3xl leading-none">+</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          Starting from scratch
        </div>
        <div className="text-xs text-muted-foreground">
          Empty workspace scaffold
        </div>
      </div>
      <Button variant="link" size="sm" onClick={onChangeKit}>
        Change
      </Button>
    </div>
  );
}

function LocalTemplateCard({
  folder,
  onChangeFolder,
}: {
  folder: TemplateFolderSelectionPayload | null;
  onChangeFolder: () => void;
}) {
  return (
    <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3">
      <FolderOpen size={24} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {folder?.templateName || "Local template"}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {folder?.rootPath || "No folder selected"}
        </div>
      </div>
      <Button variant="link" size="sm" onClick={onChangeFolder}>
        Change folder
      </Button>
    </div>
  );
}

export function TemplateCard({
  templateSourceMode,
  selectedMarketplaceTemplate,
  selectedTemplateFolder,
  onChangeKit,
  onChangeFolder,
}: {
  templateSourceMode: string;
  selectedMarketplaceTemplate: TemplateMetadataPayload | null;
  selectedTemplateFolder: TemplateFolderSelectionPayload | null;
  onChangeKit: () => void;
  onChangeFolder: () => void;
}) {
  if (
    templateSourceMode === "marketplace" &&
    selectedMarketplaceTemplate
  ) {
    return (
      <MarketplaceCard
        template={selectedMarketplaceTemplate}
        onChangeKit={onChangeKit}
      />
    );
  }

  if (
    templateSourceMode === "empty" ||
    templateSourceMode === "empty_onboarding"
  ) {
    return <EmptyCard onChangeKit={onChangeKit} />;
  }

  if (templateSourceMode === "local") {
    return (
      <LocalTemplateCard
        folder={selectedTemplateFolder}
        onChangeFolder={onChangeFolder}
      />
    );
  }

  return null;
}
