import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { providerDisplayName } from "./constants";

interface ConnectIntegrationsStepProps {
  pendingIntegrations: ResolveTemplateIntegrationsResult;
  connectingProvider: string | null;
  connectStatus: string;
  onConnect: (provider: string) => void;
  onBack: () => void;
}

export function ConnectIntegrationsStep({
  pendingIntegrations,
  connectingProvider,
  connectStatus,
  onConnect,
  onBack,
}: ConnectIntegrationsStepProps) {
  return (
    <div>
      <div className="max-w-3xl">
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Connect integrations
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          This workspace needs access
        </h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          Connect the following accounts to continue.
        </p>
      </div>

      <div className="mt-6 grid gap-3" style={{ maxWidth: 480 }}>
        {pendingIntegrations.missing_providers.map((provider) => (
          <div
            key={provider}
            className="flex items-center justify-between rounded-xl border border-border bg-muted/50 px-5 py-4"
          >
            <span className="text-sm font-medium text-foreground">
              {providerDisplayName(provider)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={connectingProvider !== null}
              onClick={() => onConnect(provider)}
            >
              {connectingProvider === provider ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </div>
        ))}
        {pendingIntegrations.connected_providers.map((provider) => (
          <div
            key={provider}
            className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-5 py-4"
          >
            <span className="text-sm font-medium text-foreground">
              {providerDisplayName(provider)}
            </span>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="border-primary/25 text-primary">
                Connected
              </Badge>
              <Button
                variant="link"
                size="xs"
                disabled={connectingProvider !== null}
                onClick={() => onConnect(provider)}
                className="text-muted-foreground"
              >
                {connectingProvider === provider ? "Reconnecting..." : "Reconnect"}
              </Button>
            </div>
          </div>
        ))}
      </div>

      {connectStatus ? (
        <p className="mt-4 text-sm text-muted-foreground">{connectStatus}</p>
      ) : null}

      <div className="mt-5">
        <Button variant="link" size="sm" onClick={onBack} className="text-muted-foreground">
          &larr; Back to configure
        </Button>
      </div>
    </div>
  );
}
