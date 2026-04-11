import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  RefreshCcw,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspaceBrowser } from "@/components/panes/useWorkspaceBrowser";

const HOME_URL = "https://www.google.com";
const EXPLICIT_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;
const LOCALHOST_PATTERN = /^localhost(?::\d+)?(?:[/?#]|$)/i;
const IPV4_HOST_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[/?#]|$)/;
const IPV6_HOST_PATTERN = /^\[[0-9a-fA-F:]+\](?::\d+)?(?:[/?#]|$)/;

function normalizeUrl(rawInput: string) {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return HOME_URL;
  }

  if (EXPLICIT_SCHEME_PATTERN.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  if (
    LOCALHOST_PATTERN.test(trimmed) ||
    IPV4_HOST_PATTERN.test(trimmed) ||
    IPV6_HOST_PATTERN.test(trimmed)
  ) {
    return `http://${trimmed}`;
  }
  if (trimmed.includes(".")) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

interface SpaceBrowserDisplayPaneProps {
  browserSpace: BrowserSpaceId;
  suspendNativeView?: boolean;
  layoutSyncKey?: string;
  embedded?: boolean;
}

export function SpaceBrowserDisplayPane({
  browserSpace,
  suspendNativeView = false,
  layoutSyncKey = "",
  embedded = false,
}: SpaceBrowserDisplayPaneProps) {
  const [inputValue, setInputValue] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { activeTab, activeBookmark, isBookmarked } =
    useWorkspaceBrowser(browserSpace);

  useEffect(() => {
    setInputValue(activeTab.url || "");
  }, [activeTab.id, activeTab.url]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    if (suspendNativeView) {
      void window.electronAPI.browser.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      return;
    }

    let rafId = 0;

    const syncBounds = () => {
      const rect = viewport.getBoundingClientRect();
      void window.electronAPI.browser.setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };

    const queueSync = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(syncBounds);
    };

    queueSync();
    const observer = new ResizeObserver(queueSync);
    observer.observe(viewport);
    window.addEventListener("resize", queueSync);
    window.setTimeout(queueSync, 100);
    window.setTimeout(queueSync, 400);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", queueSync);
      window.cancelAnimationFrame(rafId);
      void window.electronAPI.browser.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    };
  }, [layoutSyncKey, suspendNativeView]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void window.electronAPI.browser.navigate(normalizeUrl(inputValue));
  };

  const onToggleBookmark = () => {
    if (!activeTab.url) {
      return;
    }

    if (activeBookmark) {
      void window.electronAPI.browser.removeBookmark(activeBookmark.id);
      return;
    }

    void window.electronAPI.browser.addBookmark({
      url: activeTab.url,
      title: activeTab.title || activeTab.url,
    });
  };

  return (
    <section
      className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${
        embedded
          ? "bg-transparent"
          : "rounded-xl border border-border bg-card/80 shadow-md backdrop-blur-sm"
      }`}
    >
      <div className="shrink-0 border-b border-border/45 px-4 py-2">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            onClick={() => void window.electronAPI.browser.back()}
            disabled={!activeTab.canGoBack}
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Forward"
            onClick={() => void window.electronAPI.browser.forward()}
            disabled={!activeTab.canGoForward}
          >
            <ChevronRight size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh"
            onClick={() => void window.electronAPI.browser.reload()}
            disabled={!activeTab.initialized}
          >
            <RefreshCcw size={13} />
          </Button>

          <form onSubmit={onSubmit} className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 transition-colors focus-within:border-ring">
              <Globe size={13} className="shrink-0 text-muted-foreground" />
              <input
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                className="embedded-input w-full min-w-0 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/55"
                placeholder="Enter URL or search"
              />
            </div>
          </form>

          <Button
            type="button"
            variant={isBookmarked ? "secondary" : "outline"}
            size="icon"
            onClick={onToggleBookmark}
            disabled={!activeTab.url}
            className={`shrink-0 rounded-full ${
              isBookmarked ? "border-primary/50 bg-primary/10 text-primary" : ""
            }`}
            aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
          >
            <Star size={13} fill={isBookmarked ? "currentColor" : "none"} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div
          ref={viewportRef}
          className="relative h-full min-h-0 overflow-hidden rounded-xl border border-border bg-card"
        >
          {!activeTab.initialized ? (
            <div className="absolute inset-0 grid place-items-center bg-card p-6 text-center">
              <div className="pointer-events-none w-full max-w-[360px] rounded-[24px] border border-border bg-card/92 px-6 py-6 shadow-lg backdrop-blur-sm">
                <div className="mx-auto flex size-12 items-center justify-center rounded-[18px] border border-primary/25 bg-primary/10 text-primary">
                  <Loader2 size={18} className="animate-spin" />
                </div>
                <div className="mt-4 text-[15px] font-medium tracking-[-0.02em] text-foreground">
                  Starting {browserSpace === "agent" ? "agent" : "user"} browser
                </div>
                <div className="mt-1.5 text-[12px] leading-6 text-muted-foreground">
                  Opening the embedded{" "}
                  {browserSpace === "agent" ? "agent" : "user"} browser for this
                  workspace.
                </div>
              </div>
            </div>
          ) : null}

          {activeTab.initialized && activeTab.loading ? (
            <div className="pointer-events-none absolute inset-x-4 top-4 z-10">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/92 px-3 py-1.5 text-[11px] text-muted-foreground shadow-md backdrop-blur-sm">
                <Loader2 size={12} className="animate-spin text-primary" />
                <span>Loading page</span>
              </div>
            </div>
          ) : null}

          {activeTab.error ? (
            <div className="absolute inset-x-4 bottom-4 rounded-xl border border-amber-300/40 bg-black/70 px-3 py-2 text-xs text-amber-100/85">
              {activeTab.error}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
