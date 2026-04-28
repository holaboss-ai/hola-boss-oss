import { Check, Download, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppIcon } from "@/components/marketplace/AppIcon";

type AppCardState = "available" | "installing" | "installed";

interface AppCatalogCardProps {
  entry: AppCatalogEntryPayload;
  state: AppCardState;
  disabled: boolean;
  onInstall: () => void;
  /**
   * Active connections matching the app's expected provider. When the
   * caller has computed this list, the install footer renders an inline
   * account picker so the user binds at install time instead of
   * post-install in AppSurfacePane.
   *
   * - empty / undefined → no picker shown (legacy "connect first" flow
   *   still applies in AppsGallery if the app needs an integration).
   * - exactly one entry → no picker shown either; the caller silently
   *   binds to that account when Install is clicked.
   * - two or more → inline Select renders above the Install button.
   */
  availableAccounts?: IntegrationConnectionPayload[];
  selectedConnectionId?: string | null;
  onSelectAccount?: (connectionId: string) => void;
}

function pickAccountLabel(conn: IntegrationConnectionPayload): string {
  const trimmedLabel = conn.account_label?.trim() ?? "";
  if (trimmedLabel.length > 0) return trimmedLabel;
  const handle = conn.account_handle?.trim() ?? "";
  if (handle.length > 0) return `@${handle}`;
  const email = conn.account_email?.trim() ?? "";
  if (email.length > 0) return email;
  const externalId = conn.account_external_id?.trim() ?? "";
  if (externalId.length > 0) return externalId;
  return conn.connection_id;
}

export function AppCatalogCard({
  entry,
  state,
  disabled,
  onInstall,
  availableAccounts,
  selectedConnectionId,
  onSelectAccount,
}: AppCatalogCardProps) {
  const label = entry.name || entry.app_id;
  const description = entry.description ?? "";
  const showAccountPicker =
    state === "available" &&
    Array.isArray(availableAccounts) &&
    availableAccounts.length >= 2 &&
    typeof onSelectAccount === "function";
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
      <CardFooter className="flex-wrap items-center justify-end gap-2">
        {showAccountPicker ? (
          <Select
            value={selectedConnectionId ?? availableAccounts?.[0]?.connection_id ?? ""}
            onValueChange={(next) => {
              if (next) onSelectAccount?.(next);
            }}
          >
            <SelectTrigger
              className="mr-auto h-7 min-w-[140px] gap-1.5 border-border/55 bg-transparent px-2 text-xs"
              size="sm"
              aria-label="Choose account"
            >
              <SelectValue placeholder="Choose account" />
            </SelectTrigger>
            <SelectContent
              align="start"
              className="min-w-[200px] gap-0 rounded-lg p-1 shadow-subtle-sm"
            >
              {availableAccounts?.map((conn) => (
                <SelectItem
                  key={conn.connection_id}
                  value={conn.connection_id}
                  className="rounded-md px-2.5 py-1.5 text-xs"
                >
                  {pickAccountLabel(conn)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
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
