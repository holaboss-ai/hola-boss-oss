import { useEffect, useState } from "react";

// Pass `key: undefined` to opt out of persistence (e.g. ephemeral previews).
export function usePersistedState<T>(
  key: string | undefined,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    if (!key || typeof localStorage === "undefined") return initial;
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (!key || typeof localStorage === "undefined") return;
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // ignore
      }
    }, 200);
    return () => window.clearTimeout(id);
  }, [key, state]);

  return [state, setState];
}
