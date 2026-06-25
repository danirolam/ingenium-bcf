// Stage-3 (Client Scan) API surface - the bill-first batch-scan endpoints.
// Kept separate from src/lib/api.ts so the shared client stays untouched;
// mirrors its `j()` fetch-helper style. Wire types are re-declared locally
// (the server's clientScanCore.ts is the source of truth - do not import
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

/** A bill with at least one counsel-approved amendment - eligible for scanning. */
export interface ScanReadyBill {
  billId: string;
  billNumber: string;
  title: string;
  shortTitle?: string;
  status: string;
  session?: string;
  /** Journey stage + topics - used by the client-first board to sort/tag rows. */
  legislativeMomentum?: string;
  practiceAreas?: string[];
  approvedOpCount: number;
  actTitles: string[];
  computedAt: string;
}

/** One approved amendment op, summarised for the pre-scan review panel. */
export interface ApprovedOpSummary {
  key: string;
  op: "add" | "replace" | "repeal" | "amend" | "relabel";
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

/** Severity band of a fast impact scan - mirrors clientScanCore SCAN_BANDS. */
export type ScanBand = "low" | "medium" | "high" | "critical";

/**
 * One persisted scan as served to the client. The numeric 0-100 score is
 * backend-only (the server ranks with it and strips it from every response) -
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
 * Fast impact score for ONE (client, bill) pair - seconds, not the ~30s brief.
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
 * All persisted scans for a bill - ALREADY ranked by the server (hidden score
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

/**
 * One row of the client-first exposure board: a current-session bill ranked by
 * how dangerous it is to the chosen client. The danger comes from a fast
 * heuristic (source "heuristic"), overlaid with the sharper AI band where a scan
 * exists (source "ai"). The numeric score never leaves the backend - rows arrive
 * pre-ranked by it. Mirrors ExposureRow in server/routes/clientImpact.ts.
 */
export interface ExposureRow {
  billId: string;
  billNumber: string;
  title: string;
  shortTitle?: string;
  status: string;
  session?: string;
  legislativeMomentum?: string;
  practiceAreas: string[];
  actTitles: string[];
  band: ScanBand;
  rationale: string;
  topAreas: string[];
  source: "ai" | "heuristic";
  /** Counsel-approved ops on this bill (0 = not reviewed in stage 2 yet). */
  approvedOpCount: number;
  hasBrief: boolean;
  analysisId?: string;
  approved: boolean;
}

/**
 * Every current-session bill ranked against ONE client, most dangerous first.
 * Server-ranked; the bill metadata and review/brief status are included.
 */
export function fetchClientExposure(
  clientId: string,
  signal?: AbortSignal,
): Promise<ExposureRow[]> {
  return j<ExposureRow[]>(
    `/api/client-impact/exposure?clientId=${encodeURIComponent(clientId)}`,
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
// Wire shape for GET /api/client-impact/briefs - mirrored from
// server/routes/clientImpact.ts (BriefIndexEntry); keep in sync. A FLAT index:
// one entry per latest-(client, bill) pair, server-sorted newest first.
// `approved` mirrors the analysis' saved flag (the counsel-approval gate).
// Bands only - the numeric score never leaves the backend.

export interface BriefIndexEntry {
  analysisId: string;
  billId: string;
  billNumber: string;
  billTitle: string;
  billShortTitle?: string;
  clientId: string;
  clientName: string;
  createdAt: string;
  band?: ScanBand;
  approved: boolean;
}

/** Every brief (latest per pair), chronological - newest first. */
export function fetchBriefIndex(signal?: AbortSignal): Promise<BriefIndexEntry[]> {
  return j<BriefIndexEntry[]>("/api/client-impact/briefs", { signal });
}

// ── Consolidated client briefing (all approved bills for one client) ─────────
// One entry per latest APPROVED brief for the client; the consolidated email is
// assembled from these. Mirrors ConsolidatedItem in server/routes/clientImpact.ts.

export interface ConsolidatedItem {
  analysisId: string;
  billId: string;
  billNumber: string;
  billTitle: string;
  billShortTitle?: string;
  billStatus: string;
  band?: ScanBand;
  affected: "yes" | "no" | "unclear";
  impactLevel: "low" | "medium" | "high" | "critical";
  urgency: "low" | "medium" | "high" | "immediate";
  whyItAffectsClient: string;
  affectedClientAreas: string[];
  hasDraft: boolean;
  createdAt: string;
}

export interface ConsolidatedResponse {
  client: { id: string; name: string };
  items: ConsolidatedItem[];
}

/** Every human-approved bill affecting one client, severity-first. */
export function fetchConsolidated(
  clientId: string,
  signal?: AbortSignal,
): Promise<ConsolidatedResponse> {
  return j<ConsolidatedResponse>(
    `/api/client-impact/consolidated?clientId=${encodeURIComponent(clientId)}`,
    { signal },
  );
}

export interface ComposedEmail {
  subject: string;
  body: string;
}

/** Send one consolidated email across the selected approved bills. The server
 *  forwards this exact draft (what you see is what is sent), after re-checking
 *  the approval gate. */
export function sendConsolidatedEmail(args: {
  clientId: string;
  billIds: string[];
  email: ComposedEmail;
}): Promise<{
  email: ComposedEmail;
  result: { sent: boolean; simulated?: boolean };
  count: number;
  billNumbers: string[];
}> {
  return j("/api/client-impact/consolidated-email", {
    method: "POST",
    body: JSON.stringify({
      clientId: args.clientId,
      billIds: args.billIds,
      email: args.email,
      send: true,
    }),
  });
}

/**
 * Assemble the consolidated client email from the selected approved bills.
 * Deterministic, no model call, no em dashes: one greeting, one short paragraph
 * per bill, one close. The preview shows this and the send forwards it verbatim,
 * so it mirrors the server's synthesizeConsolidatedEmail.
 */
export function composeConsolidatedDraft(
  clientName: string,
  items: ConsolidatedItem[],
): ComposedEmail {
  const client = (clientName || "the client").trim();
  const list = items.filter((it) => it && it.billNumber);
  const n = list.length;
  const subject =
    n === 1
      ? `${list[0].billNumber.trim()}: a federal bill worth keeping an eye on`
      : `${n} federal bills we are monitoring for ${client}`;
  const intro =
    n === 1
      ? "I wanted to flag a federal bill we are watching on your behalf. It is not yet law, but if enacted it could matter to your business."
      : "I wanted to bring together the federal bills we are watching on your behalf. None is yet law, but each could matter to your business if enacted, so I have set out below what we are tracking and why.";
  const lines: string[] = [`Dear ${client} team,`, "", intro, ""];
  for (const it of list) {
    const title = (it.billTitle || "").trim();
    const status = (it.billStatus || "").trim().toLowerCase();
    const why = (it.whyItAffectsClient || "").trim();
    const areas = (it.affectedClientAreas ?? [])
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 3);
    const areaList =
      areas.length <= 1
        ? areas[0] ?? ""
        : `${areas.slice(0, -1).join(", ")} and ${areas[areas.length - 1]}`;
    const whyLine = why
      ? `${why.charAt(0).toUpperCase()}${why.slice(1)}`
      : areaList
        ? `If enacted in its current form, it could adjust obligations bearing on the parts of your business that touch ${areaList}.`
        : "If enacted in its current form, it could adjust obligations bearing on your operations.";
    lines.push(
      `Bill ${it.billNumber.trim()}${title ? ` (${title})` : ""}${status ? `, currently ${status}` : ""}.`,
      whyLine,
      "",
    );
  }
  lines.push(
    "We would be glad to review your contracts and policies for exposure across these bills, run a focused compliance check where it helps, and keep watch as each one moves through Parliament so nothing catches you off guard.",
    "",
    "If it would help, I am happy to set up a short call to talk through what these could mean for you.",
    "",
    "Kind regards,",
    "Legislative Monitoring",
  );
  return { subject, body: lines.join("\n") };
}

/**
 * Generate (or regenerate) the full brief for a pair, optionally with
 * reviewing-lawyer instructions the brief agent must follow. Guidance is
 * transient - it shapes this generation only and is never persisted. Stage 3
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
