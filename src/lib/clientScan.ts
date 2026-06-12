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
 * Bands whose rows lead with the emphasized Analyze CTA — scan first, brief
 * these pairs. Mirrors ANALYZE_EMPHASIS_BANDS in
 * server/services/clientScanCore.ts (kept in sync by hand).
 */
export const ANALYZE_EMPHASIS_BANDS: ReadonlySet<ScanBand> = new Set([
  "high",
  "critical",
]);

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
