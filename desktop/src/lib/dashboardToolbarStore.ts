import { useSyncExternalStore } from "react";

// Module-level store for dashboard toolbar state (full-width toggle +
// refresh trigger). Lives outside React because more than one
// `<InternalSurfacePane>` can be mounted simultaneously (chat surface
// + main display) and each component-local useState would diverge —
// clicking the visible button would flip state in one instance while
// the other instance keeps showing its stale value.
//
// The store is synced into React via useSyncExternalStore — every
// mounted pane subscribes and re-renders on every change, so all of
// them paint the same toolbar state and the renderer body sees a
// consistent fullWidth/refreshKey pair.

const STORAGE_KEY = "dashboardRenderer:fullWidth";

interface State {
  fullWidth: boolean;
  refreshKey: number;
}

let state: State = {
  fullWidth: readPersistedFullWidth(),
  refreshKey: 0,
};

const listeners = new Set<() => void>();

function readPersistedFullWidth(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistFullWidth(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // ignore — quota / private mode
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): State {
  return state;
}

export function setDashboardFullWidth(next: boolean): void {
  if (state.fullWidth === next) return;
  state = { ...state, fullWidth: next };
  persistFullWidth(next);
  emit();
}

export function toggleDashboardFullWidth(): void {
  setDashboardFullWidth(!state.fullWidth);
}

export function bumpDashboardRefreshKey(): void {
  state = { ...state, refreshKey: state.refreshKey + 1 };
  emit();
}

export function useDashboardToolbarState(): State {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
