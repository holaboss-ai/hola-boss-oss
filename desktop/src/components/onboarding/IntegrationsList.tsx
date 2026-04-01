import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { providerDisplayName } from "./constants";

interface IntegrationsListProps {
  pendingIntegrations: ResolveTemplateIntegrationsResult | null;
  isResolvingIntegrations: boolean;
  connectingProvider: string | null;
  connectStatus: string;
  onConnect: (provider: string) => void;
}

export function IntegrationsList({
  pendingIntegrations,
  isResolvingIntegrations,
  connectingProvider,
  connectStatus,
  onConnect,
}: IntegrationsListProps) {
  if (isResolvingIntegrations) {
    return (
      <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground" style={{ maxWidth: 480 }}>
        <Loader2 size={12} className="animate-spin" />
        Checking integrations...
      </div>
    );
  }

  if (!pendingIntegrations || pendingIntegrations.requirements.length === 0) {
    return null;
  }

  return (
    <div className="mt-6" style={{ maxWidth: 480 }}>
      <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        Integrations
      </div>
      <div className="mt-2 grid gap-2">
        {pendingIntegrations.connected_providers.map((provider) => (
          <IntegrationRow
            key={provider}
            provider={provider}
            connected
            connecting={connectingProvider === provider}
            disabled={connectingProvider !== null}
            onAction={() => onConnect(provider)}
          />
        ))}
        {pendingIntegrations.missing_providers.map((provider) => (
          <IntegrationRow
            key={provider}
            provider={provider}
            connected={false}
            connecting={connectingProvider === provider}
            disabled={connectingProvider !== null}
            onAction={() => onConnect(provider)}
          />
        ))}
      </div>
      {connectStatus ? (
        <p className="mt-2 text-xs text-muted-foreground">{connectStatus}</p>
      ) : null}
    </div>
  );
}

function IntegrationRow({
  provider,
  connected,
  connecting,
  disabled,
  onAction,
}: {
  provider: string;
  connected: boolean;
  connecting: boolean;
  disabled: boolean;
  onAction: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
        connected
          ? "border-primary/25 bg-primary/5"
          : "border-border bg-muted/50"
      }`}
    >
      <span className="text-sm font-medium text-foreground">
        {providerDisplayName(provider)}
      </span>
      {connected ? (
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="border-primary/25 text-primary">
            <span className="inline-block size-1.5 rounded-full bg-primary" />
            Connected
          </Badge>
          <Button
            variant="link"
            size="xs"
            disabled={disabled}
            onClick={onAction}
            className="text-muted-foreground"
          >
            {connecting ? "Reconnecting..." : "Reconnect"}
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onAction}
        >
          {connecting ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Connecting...
            </>
          ) : (
            "Connect"
          )}
        </Button>
      )}
    </div>
  );
}
