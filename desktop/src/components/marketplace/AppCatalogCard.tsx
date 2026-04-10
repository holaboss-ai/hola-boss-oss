import { Check, Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { providerIcon } from "@/components/onboarding/constants";

/** Maps app_id → providerIcon key when they differ */
const APP_PROVIDER_MAP: Record<string, string> = {
  sheets: "googlesheets",
};

type AppCardState = "available" | "installing" | "installed";

interface AppCatalogCardProps {
  entry: AppCatalogEntryPayload;
  state: AppCardState;
  disabled: boolean;
  onInstall: () => void;
}

export function AppCatalogCard({ entry, state, disabled, onInstall }: AppCatalogCardProps) {
  const label = entry.name || entry.app_id;
  const description = entry.description ?? "";
  const providerKey = APP_PROVIDER_MAP[entry.app_id] ?? entry.app_id;
  const icon = providerIcon(providerKey, 22);
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/40 text-sm font-semibold uppercase text-muted-foreground">
            {icon ?? label.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-sm">{label}</CardTitle>
            {entry.version ? (
              <Badge variant="secondary" className="mt-1 text-[10px]">
                {entry.version}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      {description ? (
        <CardContent className="flex-1">
          <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">{description}</p>
        </CardContent>
      ) : (
        <div className="flex-1" />
      )}
      <CardFooter className="justify-end">
        {state === "installed" ? (
          <Button variant="outline" size="sm" disabled>
            <Check size={13} />
            Installed
          </Button>
        ) : state === "installing" ? (
          <Button variant="outline" size="sm" disabled>
            <LoaderCircle size={13} className="animate-spin" />
            Installing…
          </Button>
        ) : (
          <Button size="sm" disabled={disabled} onClick={onInstall}>
            <Download size={13} />
            Install
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export type { AppCardState };
