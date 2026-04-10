import { ArrowLeft, Check, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SelectAppsStepProps {
  template: TemplateMetadataPayload;
  selectedApps: Set<string>;
  onToggleApp: (appName: string) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function SelectAppsStep({
  template,
  selectedApps,
  onToggleApp,
  onBack,
  onContinue,
}: SelectAppsStepProps) {
  const apps = template.apps;
  const minOptional = template.min_optional_apps ?? 0;
  const optionalSelectedCount = [...selectedApps].filter(
    (name) => !apps.find((a) => a.name === name && a.required),
  ).length;
  const canContinue = minOptional === 0 || optionalSelectedCount >= minOptional;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 pb-5">
        <button
          type="button"
          onClick={onBack}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-base font-semibold tracking-tight">Choose your apps</h2>
          <p className="text-sm text-muted-foreground">
            Select which apps to include in your workspace.
            {minOptional > 0 ? ` At least ${minOptional} must be selected.` : ""}
          </p>
        </div>
      </div>

      {/* App list */}
      <div className="flex-1 space-y-2 overflow-y-auto">
        {apps.map((app) => {
          const isChecked = selectedApps.has(app.name);
          return (
            <button
              key={app.name}
              type="button"
              disabled={app.required}
              onClick={() => onToggleApp(app.name)}
              className={[
                "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                isChecked
                  ? "border-primary/20 bg-primary/[0.04]"
                  : "border-border bg-card",
                app.required
                  ? "cursor-default opacity-90"
                  : "cursor-pointer hover:bg-accent",
              ].join(" ")}
            >
              {/* Checkbox indicator */}
              <div
                className={[
                  "grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors",
                  isChecked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/30 bg-background",
                ].join(" ")}
              >
                {isChecked ? <Check size={10} strokeWidth={3} /> : null}
              </div>

              <span className="flex-1 text-sm font-medium capitalize">{app.name}</span>

              {app.required ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Lock size={12} />
                  Required
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 pt-5">
        <Button onClick={onContinue} disabled={!canContinue}>
          Continue
        </Button>
      </div>
    </div>
  );
}
