// BCF practice-group taxonomy and deterministic bill classification.
// Bills are tagged by keyword matching against their title, categories, and
// clause headings — no model calls, fully reproducible.

export interface PracticeArea {
  id: string;
  label: string;
  keywords: string[];
}

// Ordered by how a business-law firm reads its docket. The label is the
// canonical display string used in filters and tags across the app.
export const PRACTICE_AREAS: PracticeArea[] = [
  {
    id: "business-ma",
    label: "Business & M&A",
    keywords: [
      "business corporation",
      "canada business corporations",
      "corporation",
      "incorporation",
      "amalgamation",
      "merger",
      "acquisition",
      "competition act",
      "anti-competitive",
      "shareholder",
      "not-for-profit corporation",
      "investment canada",
      "corporate governance",
      "free trade",
      "trade agreement",
      "economic partnership",
      "comprehensive economic",
      "trans-pacific",
      "small business",
    ],
  },
  {
    id: "banking-securities",
    label: "Banking & Securities",
    keywords: [
      "bank act",
      "banking",
      "securities",
      "financial institution",
      "insurance",
      "pension",
      "payment",
      "currency",
      "money laundering",
      "proceeds of crime",
      "credit union",
      "deposit",
      "financial administration",
      "borrowing",
      "use of cash",
    ],
  },
  {
    id: "taxation",
    label: "Taxation",
    keywords: [
      "income tax",
      "excise tax",
      "excise act",
      "tax act",
      "taxation",
      "gst",
      "hst",
      "customs tariff",
      "tariff",
      "duty",
      "duties",
      "fiscal",
      "budget",
      "economic update",
      "appropriation",
    ],
  },
  {
    id: "ip",
    label: "Intellectual Property",
    keywords: [
      "copyright",
      "patent",
      "trademark",
      "trade-mark",
      "trade mark",
      "intellectual property",
      "industrial design",
      "trade secret",
    ],
  },
  {
    id: "labour-employment",
    label: "Labour & Employment",
    keywords: [
      "labour",
      "labor",
      "employment",
      "employee",
      "worker",
      "workplace",
      "wages",
      "occupational health",
      "pay equity",
      "collective bargaining",
      "canada labour code",
    ],
  },
  {
    id: "privacy-technology",
    label: "Privacy & Technology",
    keywords: [
      "privacy",
      "personal information",
      "telecommunications",
      "broadcasting",
      "consumer protection",
      "electronic commerce",
      "electronic documents",
      "online",
      "cybersecurity",
      "spectrum",
      "electronic products",
      "information technology",
      "interoperability",
      "data blocking",
      "digital charter",
    ],
  },
  {
    id: "immigration",
    label: "Immigration",
    keywords: [
      "immigration",
      "refugee",
      "citizenship",
      "foreign national",
      "asylum",
      "permanent resident",
      "visa",
    ],
  },
  {
    id: "health-life-sciences",
    label: "Health & Life Sciences",
    keywords: [
      "health",
      "drugs",
      "food and drugs",
      "medical",
      "patient",
      "cannabis",
      "tobacco",
      "vaping",
      "pharmaceutical",
      "therapeutic",
    ],
  },
  {
    id: "litigation-regulatory",
    label: "Litigation & Regulatory",
    keywords: [
      "criminal code",
      "criminal",
      "evidence act",
      "sentencing",
      "offence",
      "offences",
      "penalty",
      "penalties",
      "prosecution",
      "judicial",
      "administrative tribunal",
    ],
  },
];

const LABEL_BY_ID = new Map(PRACTICE_AREAS.map((p) => [p.id, p.label] as const));

export function practiceAreaLabel(id: string): string {
  return LABEL_BY_ID.get(id) ?? id;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Pre-compile one boundary-anchored matcher per practice area.
const MATCHERS: Array<{ label: string; re: RegExp }> = PRACTICE_AREAS.map(
  (p) => ({
    label: p.label,
    re: new RegExp(`\\b(?:${p.keywords.map(escapeRegExp).join("|")})\\b`, "i"),
  }),
);

interface DerivableBill {
  title?: string;
  clauses?: Array<{ heading?: string; text?: string }>;
  rawJson?: unknown;
}

// The bill-intake pipeline tags records with coarse subject flags; map the ones
// that correspond cleanly to a practice group so framework/short-title bills
// (whose title alone carries no statutory keyword) still classify.
const CATEGORY_TAG_TO_LABEL: Record<string, string> = {
  health_relevant: "Health & Life Sciences",
  tech_relevant: "Privacy & Technology",
  commercial_relevant: "Business & M&A",
};

function asStringArray(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

// The descriptive "An Act to amend the X Act" long title usually carries more
// statutory signal than a marketing short title, so fold both into the text.
function collectTextFields(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const obj = raw as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["longTitle", "shortTitle", "name", "subjects", "keywords", "themes"]) {
    parts.push(...asStringArray(obj[key]));
  }
  return parts.join(" ");
}

function categoryTags(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  return asStringArray((raw as Record<string, unknown>).categories);
}

// Build the text we classify against: title + long title carry the most signal,
// then clause headings (clause bodies are skipped to keep matching fast and
// high-precision).
function buildHaystack(bill: DerivableBill): string {
  const headings = (bill.clauses ?? [])
    .map((c) => c.heading ?? "")
    .filter(Boolean)
    .join(" ");
  return [bill.title ?? "", collectTextFields(bill.rawJson), headings]
    .join(" ")
    .toLowerCase();
}

export function derivePracticeAreas(bill: DerivableBill): string[] {
  const found = new Set<string>();
  const haystack = buildHaystack(bill);
  if (haystack.trim()) {
    for (const m of MATCHERS) {
      if (m.re.test(haystack)) found.add(m.label);
    }
  }
  for (const tag of categoryTags(bill.rawJson)) {
    const label = CATEGORY_TAG_TO_LABEL[tag];
    if (label) found.add(label);
  }
  // Return in canonical taxonomy order regardless of match order.
  return PRACTICE_AREAS.filter((p) => found.has(p.label)).map((p) => p.label);
}

// Guarantees the field is present even when reading a snapshot written before
// practice-area tagging existed (e.g. a stale committed bills.json on Vercel).
export function ensurePracticeAreas<T extends DerivableBill & { practiceAreas?: string[] }>(
  bill: T,
): T & { practiceAreas: string[] } {
  if (Array.isArray(bill.practiceAreas) && bill.practiceAreas.length > 0) {
    return bill as T & { practiceAreas: string[] };
  }
  return { ...bill, practiceAreas: derivePracticeAreas(bill) };
}
