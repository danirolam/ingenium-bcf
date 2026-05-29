// Enriches the committed bills snapshot in place: for every bill it loads the
// cached LEGISinfo detail record and bakes in the legislative path, recorded
// divisions, sponsor, bill type, statute citation and executive summary, plus a
// refreshed status/momentum. Bills are matched by number and their ids are NEVER
// changed, so the approved law-version links (which the cold demo depends on)
// stay intact. Run with:  npx tsx scripts/build-bills-snapshot.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBillDetail } from "../src/lib/legislativePath.js";
import { ensurePracticeAreas } from "../src/lib/practiceAreas.js";
import { mapMomentum } from "../server/services/billNormalizer.js";
import type { Bill } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const billsFile = path.join(root, "server", "data", "bills.json");
const billsDir = path.join(root, "data", "bills", "45-1");

// Synthetic demo bills whose curated framing diverges from the real record of
// the same number (e.g. C-27 is repurposed as the CPPA two-sided diff demo, but
// the real 45-1 C-27 is an unrelated self-government bill). Leave them untouched.
const PRESERVE = new Set(["bill-c27-demo"]);

function categoriesOf(bill: Bill): string[] | undefined {
  const raw = bill.rawJson as { categories?: unknown } | null;
  const cats = raw?.categories;
  return Array.isArray(cats)
    ? cats.filter((c): c is string => typeof c === "string")
    : undefined;
}

const bills = JSON.parse(await fs.readFile(billsFile, "utf-8")) as Bill[];
let enriched = 0;
let preserved = 0;
let withPath = 0;
let withText = 0;
const missing: string[] = [];

for (const bill of bills) {
  if (PRESERVE.has(bill.id)) {
    preserved += 1;
    continue;
  }
  const metaPath = path.join(billsDir, bill.billNumber, "metadata.json");
  let detail: unknown;
  try {
    detail = JSON.parse(await fs.readFile(metaPath, "utf-8"));
  } catch {
    missing.push(bill.billNumber);
    continue;
  }

  const parsed = parseBillDetail(detail);
  if (!parsed) continue;

  bill.shortTitle = parsed.shortTitle ?? bill.shortTitle;
  bill.summary = parsed.summaryText ?? bill.summary;
  bill.billType = parsed.billType;
  bill.billForm = parsed.billForm;
  bill.isGovernmentBill = parsed.isGovernmentBill;
  bill.isProForma = parsed.isProForma;
  bill.originatingChamber = parsed.originatingChamber;
  bill.sponsor = parsed.sponsor;
  bill.statuteCitation = parsed.statuteCitation;
  bill.introducedDate = parsed.introducedDate;
  bill.royalAssentDate = parsed.royalAssentDate;
  bill.latestEvent = parsed.latestEvent;
  bill.legislativePath = parsed.path;
  bill.divisions = parsed.divisions;
  bill.categories = categoriesOf(bill);

  // Text provenance — the latest published version — refreshed every run.
  const pubs = (
    detail as { Publications?: Array<{ PublicationTypeNameEn?: string }> }
  ).Publications;
  const latestPub =
    Array.isArray(pubs) && pubs.length ? pubs[pubs.length - 1] : null;
  if (latestPub?.PublicationTypeNameEn) {
    bill.textStage = latestPub.PublicationTypeNameEn;
  }

  // Bake the full bill text (clauses) from the parsed XML sections, leaving any
  // curated demo clauses untouched.
  try {
    const norm = JSON.parse(
      await fs.readFile(
        path.join(billsDir, bill.billNumber, "bill.normalized.json"),
        "utf-8",
      ),
    ) as {
      sections?: Array<{
        label?: string;
        marginalNote?: string;
        text?: string;
        targetActs?: string[];
      }>;
      sourceUrl?: string;
      publicationType?: string;
    };
    if (norm.sourceUrl) bill.textSourceUrl = norm.sourceUrl;
    if (!bill.textStage && norm.publicationType) {
      bill.textStage = norm.publicationType;
    }
    const sections = Array.isArray(norm.sections) ? norm.sections : [];
    if (sections.length && bill.clauses.length === 0) {
      bill.clauses = sections
        .map((s, i) => ({
          id: `${bill.id}-c${i + 1}`,
          number: s.label || undefined,
          heading: s.marginalNote || undefined,
          text: s.text ?? "",
          targetActs:
            s.targetActs && s.targetActs.length ? s.targetActs : undefined,
        }))
        .filter((c) => c.text.trim());
      if (bill.clauses.length) withText += 1;
    }
  } catch {
    /* no parsed text for this bill */
  }

  // Refresh status + momentum from the authoritative current record.
  if (parsed.status) bill.status = parsed.status;
  if (parsed.latestEvent?.name) {
    const chamber = parsed.latestEvent.chamber ? ` · ${parsed.latestEvent.chamber}` : "";
    bill.latestActivity = `${parsed.latestEvent.name}${chamber}`;
  }
  bill.legislativeMomentum = mapMomentum(
    parsed.status,
    parsed.latestEvent?.name,
    bill.legislativeMomentum,
  );

  ensurePracticeAreas(bill);
  if (parsed.path.length) withPath += 1;
  enriched += 1;
}

await fs.writeFile(billsFile, `${JSON.stringify(bills, null, 2)}\n`, "utf-8");

const momentumTally: Record<string, number> = {};
for (const b of bills) {
  momentumTally[b.legislativeMomentum] = (momentumTally[b.legislativeMomentum] ?? 0) + 1;
}

console.log(`bills: ${bills.length}`);
console.log(`enriched: ${enriched}  (with legislative path: ${withPath})`);
console.log(`with full bill text (clauses): ${withText}`);
console.log(`preserved (curated demo bills): ${preserved}`);
console.log(`missing metadata: ${missing.length}${missing.length ? " " + missing.join(", ") : ""}`);
console.log("momentum:", JSON.stringify(momentumTally));
