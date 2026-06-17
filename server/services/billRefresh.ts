// Live bill refresh for the CURRENT session: pull the LEGISinfo bulk list, diff
// it against the store, ADD new bills and UPDATE changed ones. New bills get a
// best-effort full-text fetch (DocumentViewer → structured XML → clauses), so
// they're delta-ready. This is the server-side, on-demand counterpart to the
// CLI fetch pipeline (scripts/fetch-bill-*.mjs) — scoped to one session so it
// fits inside a single request.
import type { Bill, BillClause } from "../../src/types.js";
import { mapMomentum } from "./billNormalizer.js";
import { derivePracticeAreas } from "../../src/lib/practiceAreas.js";

const UA = "project-injenium (legislative research; contact dev@bcf.example)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The LEGISinfo bulk record — only the fields we read (see the live shape).
interface LegisRec {
  BillId: number;
  BillNumberFormatted?: string;
  BillNumberPrefix?: string;
  BillNumber?: number;
  LongTitleEn?: string;
  ShortTitleEn?: string;
  CurrentStatusEn?: string;
  LatestCompletedMajorStageEn?: string;
  LatestActivityEn?: string;
  LatestActivityDateTime?: string;
  SponsorEn?: string;
  BillTypeEn?: string;
  ReceivedRoyalAssentDateTime?: string;
  PassedHouseFirstReadingDateTime?: string;
  PassedSenateFirstReadingDateTime?: string;
  OriginatingChamberId?: number;
}

async function fetchJson<T = any>(url: string, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (a < tries) await sleep(400 * a);
    }
  }
  throw lastErr;
}

async function fetchText(url: string, tries = 3): Promise<string> {
  let lastErr: unknown;
  for (let a = 1; a <= tries; a++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (a < tries) await sleep(400 * a);
    }
  }
  throw lastErr;
}

// ── LEGISinfo bulk record → our Bill (metadata only; text added separately) ──
const num = (r: LegisRec) => r.BillNumberFormatted ?? `${r.BillNumberPrefix ?? ""}-${r.BillNumber ?? ""}`;

function toBill(rec: LegisRec, session: string): Bill {
  const billNumber = num(rec);
  const title = rec.LongTitleEn?.trim() || rec.ShortTitleEn?.trim() || "Untitled bill";
  const status = rec.CurrentStatusEn?.trim() || rec.LatestCompletedMajorStageEn?.trim() || "Introduced";
  return {
    id: `bill-${rec.BillId}`,
    billNumber,
    title,
    status,
    legislativeMomentum: mapMomentum(status, rec.LatestCompletedMajorStageEn ?? undefined),
    latestActivity: rec.LatestActivityEn?.trim() || undefined,
    session,
    sourceUrl: `https://www.parl.ca/legisinfo/en/bill/${session}/${billNumber.toLowerCase()}`,
    uploadedAt: new Date().toISOString(),
    rawJson: rec,
    clauses: [],
    practiceAreas: derivePracticeAreas({ title, clauses: [], rawJson: rec }),
    shortTitle: rec.ShortTitleEn?.trim() || undefined,
    billType: rec.BillTypeEn?.trim() || undefined,
    sponsor: rec.SponsorEn?.trim() ? { name: rec.SponsorEn.trim() } : undefined,
    introducedDate: rec.PassedHouseFirstReadingDateTime || rec.PassedSenateFirstReadingDateTime || undefined,
    royalAssentDate: rec.ReceivedRoyalAssentDateTime || undefined,
    originatingChamber:
      rec.OriginatingChamberId === 1 ? "House of Commons" : rec.OriginatingChamberId === 2 ? "Senate" : undefined,
  };
}

// ── Best-effort full-text resolution (mirrors scripts/fetch-bill-texts.mjs) ──
const decodeEntities = (v: string) =>
  v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "’").replace(/&#8212;/g, "—").replace(/&#39;/g, "'");
const textOf = (xml: string) => decodeEntities(xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
function firstTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? textOf(m[1]) : "";
}
function extractXmlLink(html: string): string | null {
  const all = [...html.matchAll(/\/Content\/Bills\/[^"'\s<>]+?\.xml/gi)].map((m) => m[0]);
  if (all.length) return all.find((u) => /_E\.xml$/i.test(u)) ?? all[0];
  const any = html.match(/[^"'\s>]+\.xml/i);
  return any ? any[0] : null;
}
function xmlToClauses(xml: string): BillClause[] {
  const clauses: BillClause[] = [];
  let i = 0;
  for (const m of xml.matchAll(/<Section\b([^>]*)>([\s\S]*?)<\/Section>/gi)) {
    const body = m[2] || "";
    const label = firstTag(body, "Label");
    if (!label) continue;
    const targetActs = [
      ...new Set(
        [...body.matchAll(/<XRefExternal[^>]*reference-type="act"[^>]*>([\s\S]*?)<\/XRefExternal>/gi)]
          .map((x) => textOf(x[1]))
          .filter(Boolean),
      ),
    ];
    clauses.push({
      id: `cl-${++i}`,
      number: label,
      heading: firstTag(body, "MarginalNote") || undefined,
      text: textOf(body),
      targetActs: targetActs.length ? targetActs : undefined,
    });
  }
  return clauses;
}

// Resolve a bill's latest published text: detail → Publications → DocumentViewer
// → structured XML. Returns null when no text is published yet (early bills).
async function resolveText(
  session: string,
  billNumber: string,
): Promise<{ clauses: BillClause[]; textSourceUrl: string; textStage?: string; sourceUrl: string } | null> {
  const detail = await fetchJson<any>(`https://www.parl.ca/legisinfo/en/bill/${session}/${billNumber.toLowerCase()}/json`).catch(() => null);
  // LEGISinfo returns the detail as a one-element array.
  const d0 = Array.isArray(detail) ? detail[0] : detail;
  const pubs = Array.isArray(d0?.Publications) ? d0.Publications : [];
  if (!pubs.length) return null;
  const latest = pubs[pubs.length - 1];
  const pubType = latest.PublicationTypeNameEn ?? latest.PublicationTypeName ?? undefined;
  const documentViewerUrl = `https://www.parl.ca/DocumentViewer/en/${latest.PublicationId}`;
  const html = await fetchText(documentViewerUrl);
  const xmlPath = extractXmlLink(html);
  if (!xmlPath) return null;
  const xmlUrl = xmlPath.startsWith("http") ? xmlPath : `https://www.parl.ca${xmlPath.startsWith("/") ? "" : "/"}${xmlPath}`;
  const xml = await fetchText(xmlUrl);
  const clauses = xmlToClauses(xml);
  return { clauses, textSourceUrl: xmlUrl, textStage: pubType, sourceUrl: documentViewerUrl };
}

export interface RefreshResult {
  session: string;
  added: string[];   // bill numbers newly added
  updated: string[]; // bill numbers whose status/activity changed
  withText: string[]; // newly-added bills we also fetched full text for
  errors: string[];
  total: number;     // bills in the session after refresh
  bills: Bill[];     // the full, updated bills array (caller persists it)
}

// A bill is "changed" when its status, stage, or latest activity moved.
function changed(existing: Bill, rec: LegisRec): boolean {
  const status = rec.CurrentStatusEn?.trim() || rec.LatestCompletedMajorStageEn?.trim() || "Introduced";
  return (
    existing.status !== status ||
    (existing.latestActivity ?? "") !== (rec.LatestActivityEn?.trim() ?? "")
  );
}

// Refresh one session against the current bills array. Pure-ish: takes the full
// bills list, returns the updated list + a summary. The caller persists.
export async function refreshSession(session: string, allBills: Bill[], maxNewText = 25): Promise<RefreshResult> {
  const records = await fetchSessionBills(session);
  // Match on the LOGICAL identity (session|billNumber). The stored `id` may be
  // synthetic (demo/eval bills) and NOT `bill-<BillId>`, so matching on id would
  // add duplicates. Existing bills keep their id; new ones get `bill-<BillId>`.
  const byId = new Map(allBills.map((b) => [b.id, b]));
  const sessionKey = (n: string) => `${session}|${n.toUpperCase()}`;
  const existingByKey = new Map<string, Bill>();
  for (const b of allBills) if (b.session === session) existingByKey.set(sessionKey(b.billNumber), b);

  const added: string[] = [];
  const updated: string[] = [];
  const withText: string[] = [];
  const errors: string[] = [];
  const newIds: string[] = []; // ids of bills we just added (for the text pass)

  for (const rec of records) {
    const billNumber = num(rec);
    const existing = existingByKey.get(sessionKey(billNumber));
    if (existing) {
      if (changed(existing, rec)) {
        const status = rec.CurrentStatusEn?.trim() || rec.LatestCompletedMajorStageEn?.trim() || existing.status;
        byId.set(existing.id, {
          ...existing,
          status,
          legislativeMomentum: mapMomentum(status, rec.LatestCompletedMajorStageEn ?? undefined),
          latestActivity: rec.LatestActivityEn?.trim() || existing.latestActivity,
          royalAssentDate: rec.ReceivedRoyalAssentDateTime || existing.royalAssentDate,
          sponsor: existing.sponsor ?? (rec.SponsorEn?.trim() ? { name: rec.SponsorEn.trim() } : undefined),
        });
        updated.push(billNumber);
      }
    } else {
      const bill = toBill(rec, session);
      byId.set(bill.id, bill);
      existingByKey.set(sessionKey(billNumber), bill);
      added.push(billNumber);
      newIds.push(bill.id);
    }
  }

  // Best-effort full text for the newest bills (bounded so we stay within a
  // request budget); a failure just leaves the bill text-less (still listed).
  for (const id of newIds.slice(0, maxNewText)) {
    const bill = byId.get(id);
    if (!bill) continue;
    try {
      const text = await resolveText(session, bill.billNumber);
      if (text && text.clauses.length) {
        byId.set(id, { ...bill, clauses: text.clauses, textSourceUrl: text.textSourceUrl, textStage: text.textStage, sourceUrl: text.sourceUrl });
        withText.push(bill.billNumber);
      }
    } catch (e: any) {
      errors.push(`${bill.billNumber}: text fetch failed (${e?.message ?? e})`);
    }
  }

  const bills = [...byId.values()];
  return { session, added, updated, withText, errors, total: records.length, bills };
}

export async function fetchSessionBills(session: string): Promise<LegisRec[]> {
  const data = await fetchJson<any>(`https://www.parl.ca/legisinfo/en/bills/json?parlsession=${session}`);
  return Array.isArray(data) ? data : (data.objects ?? []);
}
