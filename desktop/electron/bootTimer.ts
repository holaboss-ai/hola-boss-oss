/**
 * BootTimer — milestone-based instrumentation for desktop startup.
 *
 * The user-visible cost of "Preparing your desktop" depends on a chain
 * of ~10 main-process steps + 2-3 renderer-process events. To optimise
 * it we need numbers. This module records wall-clock timestamps for
 * named milestones, computes deltas relative to `app.whenReady` start,
 * and surfaces them once the renderer reports hydration so we can A/B
 * across runs.
 *
 * Usage (main process):
 *   import { bootTimer } from "./bootTimer.js";
 *   bootTimer.start();                          // call ONCE in app.whenReady()
 *   bootTimer.mark("db-bootstrap-done");
 *   bootTimer.mark("main-window-ready-to-show");
 *   bootTimer.complete("renderer-hydrated");    // prints summary + writes JSON
 *
 * Usage (renderer):
 *   window.electronAPI.boot.mark("renderer-hydrated");
 *   // → forwards to bootTimer.mark over IPC, which auto-completes.
 *
 * Output:
 *   - console.log of an aligned table on completion
 *   - JSON snapshot under <userData>/boot-timings/boot-<isoStamp>.json
 *     (one file per launch — easy to diff across optimisations)
 */

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

interface BootMark {
  label: string;
  /** ms since process start (`performance.now`-style). */
  monotonic: number;
}

const KNOWN_LABELS = [
  "whenReady-start",
  "db-bootstrap-done",
  "ipc-handlers-registered",
  "main-window-created",
  "main-window-ready-to-show",
  "browser-service-ready",
  "runtime-spawn-start",
  "runtime-healthy",
  "first-list-workspaces",
  "renderer-hydrated",
] as const;

class BootTimer {
  private startedAt: number | null = null;
  private marks: BootMark[] = [];
  private completed = false;

  start(): void {
    if (this.startedAt !== null) {
      // Already started — re-entry from a hot reload, ignore.
      return;
    }
    this.startedAt = performance.now();
    this.marks.push({ label: "whenReady-start", monotonic: this.startedAt });
  }

  mark(label: string): void {
    if (this.startedAt === null || this.completed) {
      return;
    }
    // Idempotent on label — first occurrence wins, so a re-mark from a
    // retry path (e.g. runtime restart) doesn't move the recorded time.
    if (this.marks.some((m) => m.label === label)) {
      return;
    }
    this.marks.push({ label, monotonic: performance.now() });
  }

  /**
   * Mark the final milestone and emit the summary. Safe to call more
   * than once — only the first call prints/writes.
   */
  complete(label: string): void {
    if (this.startedAt === null || this.completed) {
      return;
    }
    this.mark(label);
    this.completed = true;
    this.emit();
  }

  /**
   * Snapshot for debugging (used by a `boot:getTimings` IPC if we want
   * to surface this in the renderer dev panel later).
   */
  snapshot(): {
    started: boolean;
    completed: boolean;
    marks: Array<{ label: string; offsetMs: number }>;
  } {
    if (this.startedAt === null) {
      return { started: false, completed: false, marks: [] };
    }
    return {
      started: true,
      completed: this.completed,
      marks: this.marks.map((m) => ({
        label: m.label,
        offsetMs: m.monotonic - (this.startedAt ?? 0),
      })),
    };
  }

  private emit(): void {
    if (this.startedAt === null) return;
    const start = this.startedAt;

    const rows = this.marks.map((m, i) => {
      const offset = m.monotonic - start;
      const prevOffset = i === 0 ? 0 : this.marks[i - 1].monotonic - start;
      const delta = offset - prevOffset;
      return { label: m.label, offsetMs: offset, deltaMs: delta };
    });

    const labelWidth = Math.max(
      "label".length,
      ...rows.map((r) => r.label.length),
    );
    const fmt = (n: number) => `${n.toFixed(1).padStart(8)} ms`;
    const sep = `${"─".repeat(labelWidth + 2)}┼${"─".repeat(11)}┼${"─".repeat(11)}`;

    const lines = [
      "",
      "──── BootTimer ─────────────────────────────────────",
      `${"label".padEnd(labelWidth)}  │ ${"offset".padStart(8)} │ ${"Δ prev".padStart(8)}`,
      sep,
      ...rows.map(
        (r) =>
          `${r.label.padEnd(labelWidth)}  │ ${fmt(r.offsetMs)} │ ${fmt(r.deltaMs)}`,
      ),
      "────────────────────────────────────────────────────",
      "",
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));

    // Best-effort persistence — don't crash boot if this fails.
    try {
      const dir = path.join(app.getPath("userData"), "boot-timings");
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = path.join(dir, `boot-${stamp}.json`);
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            started_at_iso: new Date(
              Date.now() - (performance.now() - start),
            ).toISOString(),
            marks: rows,
          },
          null,
          2,
        ),
        "utf8",
      );
    } catch {
      // ignore — instrumentation must not affect launch
    }
  }
}

export const bootTimer = new BootTimer();

/** Exposed for renderer IPC + future inspection. */
export function bootTimerMark(label: string): void {
  bootTimer.mark(label);
}

export function bootTimerComplete(label: string): void {
  bootTimer.complete(label);
}

export function bootTimerSnapshot() {
  return bootTimer.snapshot();
}

export const BOOT_TIMER_LABELS = KNOWN_LABELS;
