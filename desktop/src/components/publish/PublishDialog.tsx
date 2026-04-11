import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Loader2,
  Package,
  Pencil,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceDesktop } from "@/lib/workspaceDesktop";
import { useDesktopAuthSession } from "@/lib/auth/authClient";
import { cn } from "@/lib/utils";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

const STEPS = [
  { label: "Template info", description: "Name, description & tags" },
  { label: "Apps", description: "Select bundled apps" },
  { label: "Onboarding", description: "Setup instructions" },
  { label: "README", description: "Template documentation" },
  { label: "Review & publish", description: "Confirm and submit" },
] as const;

const TOTAL_STEPS = STEPS.length;

export function PublishDialog({
  open,
  onOpenChange,
  workspaceId,
}: PublishDialogProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState(1);

  // Step 1
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("marketing");
  const [tags, setTags] = useState("");

  // Step 2
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [appsInitialized, setAppsInitialized] = useState(false);

  // Step 3
  const [onboardingMd, setOnboardingMd] = useState("");
  const [isGeneratingOnboarding, setIsGeneratingOnboarding] = useState(false);

  // Step 4
  const [readmeMd, setReadmeMd] = useState("");
  const [isGeneratingReadme, setIsGeneratingReadme] = useState(false);

  // Submission
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { data: session } = useDesktopAuthSession();
  const { installedApps } = useWorkspaceDesktop();

  const userId = session?.user.id ?? "";
  const userName = session?.user.name ?? "";

  // Pre-select all installed apps on first load
  useEffect(() => {
    if (!appsInitialized && installedApps.length > 0) {
      setSelectedApps(new Set(installedApps.map((a) => a.id)));
      setAppsInitialized(true);
    }
  }, [installedApps, appsInitialized]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setStep(1);
      setName("");
      setDescription("");
      setCategory("marketing");
      setTags("");
      setSelectedApps(new Set());
      setAppsInitialized(false);
      setOnboardingMd("");
      setIsGeneratingOnboarding(false);
      setReadmeMd("");
      setIsGeneratingReadme(false);
      setIsSubmitting(false);
      setError(null);
      setSuccess(false);
    }
  }, [open]);

  // Escape key handler
  useEffect(() => {
    if (!open || isSubmitting) {
      return;
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, isSubmitting, onOpenChange]);

  // Focus management
  useEffect(() => {
    if (open) {
      modalRef.current?.focus();
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const toggleApp = (appId: string) => {
    setSelectedApps((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      return next;
    });
  };

  const tagArray = tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const handleGenerate = async (type: "onboarding" | "readme") => {
    const setter =
      type === "onboarding" ? setIsGeneratingOnboarding : setIsGeneratingReadme;
    const contentSetter = type === "onboarding" ? setOnboardingMd : setReadmeMd;
    setter(true);
    try {
      const result = await window.electronAPI.workspace.generateTemplateContent(
        {
          contentType: type,
          name,
          description,
          category,
          tags: tagArray,
          apps: [...selectedApps],
        },
      );
      contentSetter(result.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setter(false);
    }
  };

  const handleFileUpload = (setter: (value: string) => void) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.txt,.markdown";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        const text = await file.text();
        setter(text);
      }
    };
    input.click();
  };

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      const appsArray = [...selectedApps];

      // Step 1: Create submission
      const submission = await window.electronAPI.workspace.createSubmission({
        workspaceId,
        name,
        description,
        category,
        tags: tagArray,
        apps: appsArray,
        onboardingMd: onboardingMd || null,
        readmeMd: readmeMd || null,
      });

      // Step 2: Package & upload locally
      await window.electronAPI.workspace.packageAndUploadWorkspace({
        workspaceId,
        apps: appsArray,
        manifest: {
          template_id: submission.template_id,
          name,
          version: "1.0.0",
          description,
          category,
          tags: tagArray,
          apps: appsArray,
          onboarding_md: onboardingMd || null,
          readme_md: readmeMd || null,
          author: { id: userId, name: userName },
        },
        uploadUrl: submission.upload_url,
      });

      // Step 3: Finalize
      await window.electronAPI.workspace.finalizeSubmission(
        submission.submission_id,
      );

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setIsSubmitting(false);
    }
  };

  const close = () => {
    if (!isSubmitting) {
      onOpenChange(false);
    }
  };

  const isStep1Valid = name.trim().length > 0 && description.trim().length > 0;

  const canNavigateTo = (targetStep: number) => {
    if (targetStep <= 1) {
      return true;
    }
    return isStep1Valid;
  };

  if (!open) {
    return null;
  }

  const modalContent = (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="fixed inset-0 z-40 bg-[rgba(7,10,14,0.46)] backdrop-blur-sm"
      />

      {/* Dialog panel */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-template-title"
        tabIndex={-1}
        className="fixed top-1/2 left-1/2 z-50 flex h-[580px] max-h-[85vh] w-full max-w-[780px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-background shadow-xl ring-1 ring-border/60 focus:outline-none"
      >
        <div className="flex h-full w-full">
          {/* Left sidebar */}
          {!success && (
            <div className="flex w-52 shrink-0 flex-col border-r border-border/35 bg-muted/40">
              {/* Sidebar header */}
              <div className="px-5 pt-5 pb-4">
                <h2
                  className="text-[15px] font-semibold tracking-tight"
                  id="publish-template-title"
                >
                  Publish Template
                </h2>
              </div>

              {/* Step list */}
              <nav className="flex flex-1 flex-col gap-0.5 px-3">
                {STEPS.map((s, i) => {
                  const stepNum = i + 1;
                  const isCompleted = step > stepNum;
                  const isCurrent = step === stepNum;
                  const navigable = canNavigateTo(stepNum);

                  return (
                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                        isCurrent && "bg-background shadow-sm",
                        !isCurrent && navigable && "hover:bg-background/60",
                        !(isCurrent || navigable) &&
                          "cursor-not-allowed opacity-40",
                      )}
                      disabled={!navigable}
                      key={s.label}
                      onClick={() => {
                        if (navigable) {
                          setStep(stepNum);
                        }
                      }}
                    >
                      {/* Step indicator circle */}
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors",
                          isCompleted && "bg-primary text-primary-foreground",
                          isCurrent && "bg-primary text-primary-foreground",
                          !(isCompleted || isCurrent) &&
                            "bg-border/60 text-muted-foreground",
                        )}
                      >
                        {isCompleted ? <Check className="size-3.5" /> : stepNum}
                      </span>

                      <span
                        className={cn(
                          "text-[13px] leading-tight",
                          isCurrent
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {s.label}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </div>
          )}

          {/* Right content area */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Content header with close button */}
            <div className="flex shrink-0 items-center justify-between px-6 pt-5 pb-1">
              {!success && (
                <h3 className="text-[15px] font-semibold tracking-tight">
                  {STEPS[step - 1]?.description}
                </h3>
              )}
              {success && <span />}
              {!isSubmitting && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={close}
                  aria-label="Close"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>

            {/* Scrollable content */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {/* Step 1: Template Info */}
              {step === 1 && !success && (
                <div className="absolute inset-0 overflow-y-auto px-6 pt-4 pb-2">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="pub-name">
                        Display Name
                        <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        autoFocus
                        className="mt-1.5"
                        id="pub-name"
                        maxLength={64}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="My Template Name"
                        value={name}
                      />
                    </div>

                    <div>
                      <Label htmlFor="pub-desc">
                        Description
                        <span className="text-destructive">*</span>
                      </Label>
                      <textarea
                        className="mt-1.5 flex min-h-[80px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
                        id="pub-desc"
                        maxLength={500}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe what your template does and who it's for..."
                        rows={3}
                        value={description}
                      />
                      <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
                        {description.length}/500
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="pub-cat">Category</Label>
                      <Select
                        value={category}
                        onValueChange={(v) => {
                          if (v) {
                            setCategory(v);
                          }
                        }}
                      >
                        <SelectTrigger className="mt-1.5 w-full" id="pub-cat">
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="marketing">Marketing</SelectItem>
                          <SelectItem value="growth">Growth</SelectItem>
                          <SelectItem value="operations">Operations</SelectItem>
                          <SelectItem value="general">General</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="pub-tags">Tags</Label>
                      <Input
                        className="mt-1.5"
                        id="pub-tags"
                        onChange={(e) => setTags(e.target.value)}
                        placeholder="social media, content, automation"
                        value={tags}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Comma-separated
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Apps */}
              {step === 2 && !success && (
                <div className="absolute inset-0 overflow-y-auto px-6 pt-4 pb-2">
                  {installedApps.length === 0 ? (
                    <div className="rounded-xl border border-dashed px-4 py-10 text-center">
                      <Package className="mx-auto mb-2 size-8 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        No apps installed in this workspace.
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground/60">
                        You can still publish without apps.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {selectedApps.size} of {installedApps.length} selected
                        </span>
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => {
                            if (selectedApps.size === installedApps.length) {
                              setSelectedApps(new Set());
                            } else {
                              setSelectedApps(
                                new Set(installedApps.map((a) => a.id)),
                              );
                            }
                          }}
                          className="h-auto p-0 text-xs"
                        >
                          {selectedApps.size === installedApps.length
                            ? "Deselect all"
                            : "Select all"}
                        </Button>
                      </div>
                      <div className="space-y-1.5">
                        {installedApps.map((app) => (
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-muted/40",
                              selectedApps.has(app.id) &&
                                "border-primary/30 bg-primary/[0.03]",
                            )}
                            key={app.id}
                            onClick={() => toggleApp(app.id)}
                          >
                            {/* Checkbox indicator */}
                            <span
                              className={cn(
                                "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                                selectedApps.has(app.id)
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-input",
                              )}
                            >
                              {selectedApps.has(app.id) && (
                                <Check className="size-3" />
                              )}
                            </span>
                            <div className="flex items-center gap-2.5">
                              <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
                                <Package className="size-4 text-muted-foreground" />
                              </div>
                              <span className="text-sm font-medium">
                                {app.label || app.id}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Step 3: Onboarding */}
              {step === 3 && !success && (
                <div className="absolute inset-0 flex flex-col px-6 pt-4 pb-2">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Optional Markdown instructions shown when users first
                        open this template.
                      </p>
                      <MarkdownToolbar
                        onGenerate={() => handleGenerate("onboarding")}
                        onUpload={() => handleFileUpload(setOnboardingMd)}
                        isGenerating={isGeneratingOnboarding}
                        disabled={!name.trim() || !description.trim()}
                      />
                    </div>
                    <textarea
                      className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                      onChange={(e) => setOnboardingMd(e.target.value)}
                      placeholder={`# Welcome to ${name || "My Template"}\n\nHere's how to get started...`}
                      value={onboardingMd}
                      rows={12}
                    />
                  </div>
                </div>
              )}

              {/* Step 4: README */}
              {step === 4 && !success && (
                <div className="absolute inset-0 flex flex-col px-6 pt-4 pb-2">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Template README shown on the marketplace page, like a
                        GitHub README.
                      </p>
                      <MarkdownToolbar
                        onGenerate={() => handleGenerate("readme")}
                        onUpload={() => handleFileUpload(setReadmeMd)}
                        isGenerating={isGeneratingReadme}
                        disabled={!name.trim() || !description.trim()}
                      />
                    </div>
                    <textarea
                      className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground outline-none focus:ring-2 focus:ring-ring"
                      onChange={(e) => setReadmeMd(e.target.value)}
                      placeholder={`# ${name || "Template Name"}\n\n## Overview\n\n## Features\n\n## Getting Started`}
                      value={readmeMd}
                      rows={12}
                    />
                  </div>
                </div>
              )}

              {/* Step 5: Review */}
              {step === 5 && !success && (
                <div className="absolute inset-0 overflow-y-auto px-6 pt-3 pb-2">
                  <p className="mb-4 text-sm text-muted-foreground">
                    Everything look good? You're ready to publish.
                  </p>

                  <div className="space-y-2.5">
                    <ReviewCard
                      detail={`${category} · ${tagArray.length > 0 ? tagArray.join(", ") : "no tags"}`}
                      label="Template info"
                      onEdit={() => setStep(1)}
                      title={name || "Untitled"}
                    />
                    <ReviewCard
                      detail={
                        selectedApps.size > 0
                          ? [...selectedApps].join(", ")
                          : "Template will be published without apps"
                      }
                      label="Apps"
                      onEdit={() => setStep(2)}
                      title={
                        selectedApps.size > 0
                          ? `${selectedApps.size} app${selectedApps.size > 1 ? "s" : ""} included`
                          : "No apps"
                      }
                    />
                    <ReviewCard
                      detail={
                        onboardingMd.trim()
                          ? `${onboardingMd.trim().split("\n").length} lines of Markdown`
                          : "No onboarding instructions"
                      }
                      label="Onboarding"
                      onEdit={() => setStep(3)}
                      title={
                        onboardingMd.trim() ? "Custom onboarding" : "Skipped"
                      }
                    />
                    <ReviewCard
                      detail={
                        readmeMd.trim()
                          ? `${readmeMd.trim().split("\n").length} lines of Markdown`
                          : "No README provided"
                      }
                      label="README"
                      onEdit={() => setStep(4)}
                      title={readmeMd.trim() ? "Custom README" : "Skipped"}
                    />
                  </div>

                  {error && (
                    <div className="mt-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                      {error}
                    </div>
                  )}
                </div>
              )}

              {/* Success state */}
              {success && (
                <div className="absolute inset-0 flex flex-col items-center justify-center px-8">
                  <div className="mb-5 flex size-20 items-center justify-center rounded-full bg-success/10">
                    <Check className="size-10 text-success" />
                  </div>

                  <h3 className="mb-2 text-xl font-semibold tracking-tight">
                    Template Submitted
                  </h3>
                  <p className="mx-auto max-w-xs text-center text-sm leading-relaxed text-muted-foreground">
                    Your template has been submitted successfully and is now
                    under review. We'll notify you once it's approved and live
                    on the Store.
                  </p>

                  <div className="mt-6 flex items-center gap-3">
                    <Button type="button" onClick={() => onOpenChange(false)}>
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {!success && (
              <div className="flex shrink-0 items-center justify-between border-t border-border/35 px-6 py-3">
                {step > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => setStep(step - 1)}
                  >
                    <ChevronLeft className="size-3.5" />
                    Back
                  </Button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  {step < TOTAL_STEPS && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={step === 1 && !isStep1Valid}
                      onClick={() => setStep(step + 1)}
                    >
                      Continue
                      <ChevronRight className="size-3.5" />
                    </Button>
                  )}
                  {step === TOTAL_STEPS && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={isSubmitting || !isStep1Valid}
                      onClick={handleSubmit}
                    >
                      {isSubmitting ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Upload className="size-3.5" />
                      )}
                      {isSubmitting ? "Publishing..." : "Publish"}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}

function ReviewCard({
  label,
  title,
  detail,
  onEdit,
}: {
  label: string;
  title: string;
  detail: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background px-4 py-3.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Check className="size-3.5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onEdit}
        aria-label={`Edit ${label}`}
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  );
}

function MarkdownToolbar({
  onGenerate,
  onUpload,
  isGenerating,
  disabled,
}: {
  onGenerate: () => void;
  onUpload: () => void;
  isGenerating: boolean;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isGenerating || disabled}
          onClick={onGenerate}
        >
          {isGenerating ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isGenerating ? "Generating..." : "AI Generate"}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          className="inline-flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onUpload}
        >
          <FileUp size={14} />
        </TooltipTrigger>
        <TooltipContent side="bottom">Upload .md file</TooltipContent>
      </Tooltip>
    </div>
  );
}
