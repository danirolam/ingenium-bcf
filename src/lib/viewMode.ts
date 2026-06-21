// The workspace can be driven from either end of the same pipeline:
//
//   law-first    pick a bill   → see which clients it exposes → brief them
//   client-first pick a client → rank the bills that threaten it → brief them
//
// Both share Stage 2 (Legal delta) and Stage 4 (Client brief + email); only the
// entry differs. This module is the single source of truth for which way the
// user is working. It is a tiny external store (localStorage-backed) so the rail
// switch, the overview, and the pages can all read/flip it without prop-drilling.
import { useSyncExternalStore } from "react";

export type ViewMode = "law-first" | "client-first";

const STORAGE_KEY = "ingenium.viewMode";
const CLIENT_KEY = "ingenium.activeClient";
const listeners = new Set<() => void>();

function read(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function persist(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Private-mode / disabled storage: keep the in-memory value, skip persisting.
  }
}
function notify(): void {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// ── Orientation ──────────────────────────────────────────────────────────────
let current: ViewMode = read(STORAGE_KEY) === "client-first" ? "client-first" : "law-first";

export function getViewMode(): ViewMode {
  return current;
}
export function setViewMode(mode: ViewMode): void {
  if (mode === current) return;
  current = mode;
  persist(STORAGE_KEY, mode);
  notify();
}
/** Reactive read of the current orientation. */
export function useViewMode(): ViewMode {
  return useSyncExternalStore(subscribe, getViewMode, () => "law-first");
}

// ── Active client (client-first context) ─────────────────────────────────────
// Remembered so the rail's Exposure step and a return to /watch land back on the
// client you were working, instead of dumping you at the picker.
let activeClient: string = read(CLIENT_KEY);

export function getActiveClientId(): string {
  return activeClient;
}
export function setActiveClientId(id: string): void {
  if (id === activeClient) return;
  activeClient = id;
  persist(CLIENT_KEY, id);
  notify();
}
export function useActiveClientId(): string {
  return useSyncExternalStore(subscribe, getActiveClientId, () => "");
}
