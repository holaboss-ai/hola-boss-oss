import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { OnboardingUserButton } from "./OnboardingUserButton";

interface CreatingViewProps {
  sectionClassName: string;
  creatingViaMarketplace: boolean;
  showUserButton?: boolean;
  panelVariant?: boolean;
}

export function CreatingView({
  sectionClassName,
  creatingViaMarketplace,
  showUserButton = true,
  panelVariant = false,
}: CreatingViewProps) {
  const title = creatingViaMarketplace
    ? "Launching sandbox"
    : "Preparing workspace";
  const detail = creatingViaMarketplace
    ? "Starting a fresh sandbox. Workspace setup continues as soon as the sandbox is ready."
    : "Preparing the local runtime and importing your template.";
  const steps = creatingViaMarketplace
    ? ["Launching sandbox", "Configuring workspace", "Opening desktop"]
    : ["Preparing runtime", "Importing template", "Opening workspace"];

  // Simulate progress through steps for visual feedback
  const [activeStep, setActiveStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 4000);
    return () => clearInterval(timer);
  }, [steps.length]);

  return (
    <section className={`${sectionClassName} grid place-items-center`}>
      {/* Ambient glow — uses theme primary */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/3 size-[600px] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-primary/[0.04] blur-[120px]" />
      </div>

      {showUserButton ? (
        <div className="absolute right-4 top-4 z-10">
          <OnboardingUserButton />
        </div>
      ) : null}

      <div
        className={`w-full ${panelVariant ? "h-full max-w-[1020px]" : "max-w-[540px]"}`}
      >
        <div
          className={`theme-shell mx-auto flex w-full flex-col items-center rounded-xl border border-border/45 shadow-lg ${
            panelVariant
              ? "h-full max-w-[1020px] justify-center px-6 py-6 sm:px-8 sm:py-7 lg:px-10 lg:py-8"
              : "max-w-[540px] px-6 py-8 sm:px-8"
          }`}
        >
          {/* Spinner with branded ring */}
          <div className="relative flex size-14 items-center justify-center">
            <svg
              className="absolute inset-0 size-full animate-spin"
              viewBox="0 0 56 56"
              fill="none"
              style={{ animationDuration: "1.8s" }}
            >
              <circle
                cx="28"
                cy="28"
                r="24"
                stroke="currentColor"
                strokeWidth="2.5"
                className="text-border"
              />
              <path
                d="M28 4a24 24 0 0 1 24 24"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="text-primary"
              />
            </svg>
            <div className="size-2 rounded-full bg-primary animate-pulse" />
          </div>

          {/* Title */}
          <h2 className="mt-8 text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>

          {/* Description */}
          <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-muted-foreground">
            {detail}
          </p>

          {/* Progress steps */}
          <div className="mt-10 w-full max-w-xs">
            <div className="flex flex-col gap-0">
              {steps.map((step, i) => {
                const isDone = i < activeStep;
                const isActive = i === activeStep;

                return (
                  <div key={step} className="flex items-stretch gap-3">
                    {/* Vertical track */}
                    <div className="flex w-5 flex-col items-center">
                      {/* Node */}
                      <div
                        className={`relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-500 ${
                          isDone
                            ? "border-primary bg-primary"
                            : isActive
                              ? "border-primary bg-background"
                              : "border-border bg-background"
                        }`}
                      >
                        {isDone ? (
                          <Check
                            size={10}
                            className="text-primary-foreground"
                          />
                        ) : isActive ? (
                          <div className="size-1.5 rounded-full bg-primary animate-pulse" />
                        ) : null}
                      </div>
                      {/* Connector line */}
                      {i < steps.length - 1 ? (
                        <div className="relative w-0.5 flex-1 min-h-5 bg-border">
                          <div
                            className="absolute inset-0 bg-primary transition-all duration-700"
                            style={{ height: isDone ? "100%" : "0%" }}
                          />
                        </div>
                      ) : null}
                    </div>

                    {/* Label */}
                    <div className="pb-5">
                      <span
                        className={`text-sm transition-colors duration-300 ${
                          isDone
                            ? "font-medium text-foreground"
                            : isActive
                              ? "font-medium text-foreground"
                              : "text-muted-foreground"
                        }`}
                      >
                        {step}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
