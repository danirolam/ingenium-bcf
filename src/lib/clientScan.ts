// Stage-3 (Client Scan) API surface — the bill-first batch-scan endpoints.
// Kept separate from src/lib/api.ts so the shared client stays untouched;
// mirrors its `j()` fetch-helper style. Wire types are re-declared locally
// (the server's clientScanCore.ts is the source of truth — do not import
// across the server/ boundary).
import type { Client } from "../types";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return (await res.json()) as T;
}

/** A bill with at least one counsel-approved amendment — eligible for scanning. */
export interface ScanReadyBill {
  billId: string;
  billNumber: string;
  title: string;
  shortTitle?: string;
  status: string;
  session?: string;
  approvedOpCount: number;
  actTitles: string[];
  computedAt: string;
}

/** One approved amendment op, summarised for the pre-scan review panel. */
export interface ApprovedOpSummary {
  key: string;
  op: "add" | "replace" | "repeal" | "amend";
  anchor: string | null;
  instruction: string;
  beforeText?: string;
  afterText?: string;
  marginalNote?: string | null;
}

/** All approved ops for one affected Act. */
export interface ApprovedActChange {
  slug: string;
  actTitle: string;
  citation: string;
  ops: ApprovedOpSummary[];
}

/** Full approved-changes breakdown for one scan-ready bill. */
export interface ScanReadyDetail {
  billId: string;
  approvedCount: number;
  changes: ApprovedActChange[];
}

/** Bills ready to scan (>=1 approved op), newest first. `[]` when none. */
export function fetchScanReady(signal?: AbortSignal): Promise<ScanReadyBill[]> {
  return j<ScanReadyBill[]>("/api/client-impact/scan-ready", { signal });
}

/** Approved-changes detail for one bill; 404s if the bill is unknown. */
export function fetchScanReadyDetail(
  billId: string,
  signal?: AbortSignal,
): Promise<ScanReadyDetail> {
  return j<ScanReadyDetail>(
    `/api/client-impact/scan-ready/${encodeURIComponent(billId)}`,
    { signal },
  );
}

// ── Impact scans (the fast scorer agent) ────────────────────────────────────

/** Severity band of a fast impact scan — mirrors clientScanCore SCAN_BANDS. */
export type ScanBand = "low" | "medium" | "high" | "critical";

/**
 * One persisted scan as served to the client. The numeric 0–100 score is
 * backend-only (the server ranks with it and strips it from every response) —
 * this view NEVER carries a `score` field. Mirrors ImpactScanView in
 * server/routes/clientImpact.ts (kept in sync by hand).
 */
export interface ImpactScanView {
  id: string;
  clientId: string;
  billId: string;
  band: ScanBand;
  rationale: string;
  topAreas: string[];
  source: "ai" | "fallback";
  scannedAt: string;
  hasBrief: boolean;
  analysisId?: string;
}

/**
 * Fast impact score for ONE (client, bill) pair — seconds, not the ~30s brief.
 * Persisted latest-wins server-side; 400/404 on bad ids.
 */
export function runScan(
  clientId: string,
  billId: string,
): Promise<{ scan: ImpactScanView }> {
  return j<{ scan: ImpactScanView }>("/api/client-impact/scan", {
    method: "POST",
    body: JSON.stringify({ clientId, billId }),
  });
}

/**
 * All persisted scans for a bill — ALREADY ranked by the server (hidden score
 * desc, client name asc on ties); orphaned clients are filtered server-side.
 */
export function fetchScans(
  billId: string,
  signal?: AbortSignal,
): Promise<ImpactScanView[]> {
  return j<ImpactScanView[]>(
    `/api/client-impact/scans?billId=${encodeURIComponent(billId)}`,
    { signal },
  );
}

/** Partial update of a client record; returns the updated record. */
export function updateClient(id: string, patch: Partial<Client>): Promise<Client> {
  return j<Client>(`/api/clients/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

/** Delete a client (the server cascades its stored briefs). */
export function deleteClient(id: string): Promise<{ ok: boolean }> {
  return j<{ ok: boolean }>(`/api/clients/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ── Brief library (stage-4 entry) ────────────────────────────────────────────
// Wire shapes for GET /api/client-impact/briefs — mirrored from
// server/routes/clientImpact.ts (BriefIndexBill/BriefIndexClient); keep in
// sync. Bands only — the numeric score never leaves the backend.

export interface BriefIndexClient {
  clientId: string;
  name: string;
  analysisId: string;
  createdAt: string;
  band?: ScanBand;
}

export interface BriefIndexBill {
  billId: string;
  billNumber: string;
  title: string;
  shortTitle?: string;
  status: string;
  briefCount: number;
  latestAt: string;
  clients: BriefIndexClient[];
}

/**
 * Bills that have at least one brief, each with its briefed clients — server
 * sorted (bills by latest brief desc; clients by band severity desc, unknown
 * last, then name).
 */
export function fetchBriefIndex(signal?: AbortSignal): Promise<BriefIndexBill[]> {
  return j<BriefIndexBill[]>("/api/client-impact/briefs", { signal });
}

/**
 * Generate (or regenerate) the full brief for a pair, optionally with
 * reviewing-lawyer instructions the brief agent must follow. Guidance is
 * transient — it shapes this generation only and is never persisted. Stage 3
 * keeps using api.clientImpact.analyze (no guidance there).
 */
export function analyzeWithGuidance(
  clientId: string,
  billId: string,
  guidance?: string,
): Promise<{ analysis: import("../types").ClientImpactAnalysis; email: { sent: boolean; simulated?: boolean } }> {
  return j("/api/client-impact/analyze", {
    method: "POST",
    body: JSON.stringify({
      clientId,
      billId,
      ...(guidance?.trim() ? { guidance: guidance.trim() } : {}),
    }),
  });
}
