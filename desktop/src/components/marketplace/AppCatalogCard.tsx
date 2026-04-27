import { Check, Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AppIcon } from "@/components/marketplace/AppIcon";

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
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center gap-3">
          <AppIcon
            iconUrl={entry.icon}
            appId={entry.app_id}
            label={label}
            size="card"
          />
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-sm">{label}</CardTitle>
            {entry.version ? (
              <Badge variant="secondary" className="mt-1 text-xs">
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
