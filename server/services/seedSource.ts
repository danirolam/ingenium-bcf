import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BaseLaw,
  Bill,
  Client,
  ClientImpactAnalysis,
  LawVersion,
} from "../../src/types.js";
import { mapMomentum, normalizeBill } from "./billNormalizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEAM_DATA = path.join(REPO_ROOT, "data");

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(p, "utf-8")) as T;
  } catch (err: any) {
    if (err.code !== "ENOENT") console.warn(`[seed] failed to read ${p}: ${err.message}`);
    return null;
  }
}

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

interface RecommendedBill {
  billId: number;
  session: string;
  number: string;
  title: string;
  longTitle: string;
  status: string;
  stage: string;
  latestActivity: string;
  latestActivityDate: string | null;
  sponsor: string;
  source?: { documentViewer?: string; billDetailJson?: string };
  categories: string[];
  score: number;
  recommendation: string;
}

interface NormalizedBillFile {
  session: string;
  number: string;
  sourceUrl: string;
  stage: string;
  title: string;
  shortTitle: string;
  sponsor: string;
  fullText: string;
  sections: Array<{
    label: string;
    type?: string;
    marginalNote?: string;
    text: string;
    targetActs?: string[];
    hasAmendedText?: boolean;
  }>;
}

export async function loadTeammateBills(): Promise<Bill[]> {
  const recommended =
    (await readJson<RecommendedBill[]>(
      path.join(TEAM_DATA, "normalized", "recommended-bills.45-1.json"),
    )) ?? [];

  const bills: Bill[] = [];
  for (const r of recommended) {
    const session = r.session;
    const num = r.number;
    const billDir = path.join(TEAM_DATA, "bills", session, num);
    const normalized = await readJson<NormalizedBillFile>(
      path.join(billDir, "bill.normalized.json"),
    );

    const merged = {
      id: `${session}-${num}`,
      billNumber: num,
      title: r.title,
      longTitle: r.longTitle,
      status: r.status,
      stage: normalized?.stage ?? r.stage,
      sponsor: r.sponsor || normalized?.sponsor,
      latestActivity: r.latestActivity,
      session,
      sourceUrl: r.source?.documentViewer ?? r.source?.billDetailJson ?? normalized?.sourceUrl,
      sections: normalized?.sections ?? [],
      categories: r.categories,
      score: r.score,
      recommendation: r.recommendation,
      fullText: normalized?.fullText,
    };

    const bill = normalizeBill(merged);
    // Preserve real upload-like timestamp if available.
    if (r.latestActivityDate) bill.uploadedAt = r.latestActivityDate;
    bill.id = `${session}-${num}`;
    bills.push(bill);
  }
  return bills;
}

export interface RegistryEntry {
  title: string;
  citation: string;
  jurisdiction: string;
  level: string;
  currentPath: string;
  source: { publisher: string; htmlUrl: string; xmlUrl: string };
  relatedBills?: string[];
}

interface RegistryFile {
  laws: Record<string, RegistryEntry>;
}

export async function loadActRegistry(): Promise<Record<string, RegistryEntry>> {
  const f = await readJson<RegistryFile>(
    path.join(TEAM_DATA, "laws", "registry.json"),
  );
  return f?.laws ?? {};
}

function slugifyActTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function resolveActSlug(
  actTitle: string,
  registry: Record<string, RegistryEntry>,
): string | null {
  if (!actTitle) return null;
  const wanted = actTitle.trim();
  // Exact title match.
  for (const [slug, entry] of Object.entries(registry)) {
    if (entry.title.toLowerCase() === wanted.toLowerCase()) return slug;
  }
  // Slug match.
  const slug = slugifyActTitle(wanted);
  if (registry[slug]) return slug;
  return null;
}

export interface AffectedAct {
  title: string;
  slug: string | null; // registry slug or null when unregistered
  clauseIds: string[];
}

export function actsAffectedByBill(
  bill: import("../../src/types.js").Bill,
  registry: Record<string, RegistryEntry>,
): AffectedAct[] {
  const map = new Map<string, AffectedAct>();
  for (const c of bill.clauses ?? []) {
    if (!c.targetActs || c.targetActs.length === 0) continue;
    for (const raw of c.targetActs) {
      const title = raw.trim();
      if (!title) continue;
      const slug = resolveActSlug(title, registry);
      const key = slug ?? `unregistered:${slugifyActTitle(title)}`;
      let entry = map.get(key);
      if (!entry) {
        entry = { title, slug, clauseIds: [] };
        map.set(key, entry);
      }
      entry.clauseIds.push(c.id);
    }
  }
  return Array.from(map.values());
}

interface NormalizedLawFile {
  title: string;
  citation: string;
  jurisdiction?: string;
  level?: string;
  fullText: string;
  sections?: Array<{ label: string; marginalNote?: string; text: string }>;
}

export async function loadTeammateBaseLaws(): Promise<BaseLaw[]> {
  const registry = await readJson<RegistryFile>(
    path.join(TEAM_DATA, "laws", "registry.json"),
  );
  if (!registry) return [];

  const laws: BaseLaw[] = [];
  for (const [slug, entry] of Object.entries(registry.laws)) {
    const norm = await readJson<NormalizedLawFile>(
      path.join(REPO_ROOT, entry.currentPath, "current.normalized.json"),
    );
    laws.push({
      id: slug,
      title: entry.title,
      citation: entry.citation,
      text: norm?.fullText ?? "",
    });
  }
  return laws;
}

export interface BillLawLink {
  bill: string;
  lawSlug: string;
  lawTitle: string;
  reason: string;
}

export async function loadBillLawLinks(): Promise<BillLawLink[]> {
  const f = await readJson<{ links: BillLawLink[] }>(
    path.join(TEAM_DATA, "laws", "bill-law-links.45-1.json"),
  );
  return f?.links ?? [];
}

interface DemoClientSpec {
  slug: string;
  name: string;
  industry: string;
  jurisdictions: string[];
  description: string;
}

const DEMO_CLIENT_SPECS: DemoClientSpec[] = [
  {
    slug: "eventpour-technologies",
    name: "EventPour Technologies",
    industry: "Event-tech / SaaS for vendors",
    jurisdictions: ["Canada"],
    description:
      "SaaS platform for festivals and venues that sell food and alcoholic beverages on behalf of third-party vendors.",
  },
  {
    slug: "maplecellars-marketplace",
    name: "MapleCellars Marketplace",
    industry: "Online alcohol marketplace",
    jurisdictions: ["Canada"],
    description:
      "Canadian online marketplace listing wines, spirits and specialty alcoholic beverages from licensed third-party suppliers.",
  },
  {
    slug: "north-river-brewing",
    name: "North River Brewing Co.",
    industry: "Craft brewing / packaged alcohol",
    jurisdictions: ["Quebec", "Canada"],
    description:
      "Quebec craft brewery that manufactures, packages, labels and distributes beer and ready-to-drink alcoholic beverages across Canada.",
  },
];

export async function loadTeammateClients(): Promise<Client[]> {
  const clients: Client[] = [];
  for (const spec of DEMO_CLIENT_SPECS) {
    const terms = await readText(
      path.join(TEAM_DATA, "clients", "demo", spec.slug, "terms.txt"),
    );
    clients.push({
      id: `client-${spec.slug}`,
      name: spec.name,
      industry: spec.industry,
      jurisdictions: spec.jurisdictions,
      description: spec.description,
      termsAndConditions: terms ?? undefined,
      policies: undefined,
      operations: terms ?? undefined,
      riskTolerance: "medium",
      createdAt: new Date().toISOString(),
    });
  }
  return clients;
}

/**
 * Hand-curated LawVersion + canned client-impact analyses for the S-202
 * (alcohol warning labels on the Food and Drugs Act) demo path. This is the
 * cold-demo that works without a Gemini key. For all other (bill, client)
 * combinations the route falls through to the live Gemini call.
 */

const FDA_S5_OLD = `Section 5 — Deception, etc., regarding food.
(1) No person shall label, package, treat, process, sell or advertise any food in a manner that is false, misleading or deceptive or is likely to create an erroneous impression regarding its character, value, quantity, composition, merit or safety.
(2) An article of food that is not labelled or packaged as required by, or is labelled or packaged contrary to, the regulations shall be deemed to be labelled or packaged contrary to subsection (1).`;

const FDA_S5_UPDATED = `Section 5 — Deception, etc., regarding food.
(1) No person shall label, package, treat, process, sell or advertise any food in a manner that is false, misleading or deceptive or is likely to create an erroneous impression regarding its character, value, quantity, composition, merit or safety.
(2) An article of food that is not labelled or packaged as required by, or is labelled or packaged contrary to, the regulations shall be deemed to be labelled or packaged contrary to subsection (1).

Section 5.1 — Alcoholic beverages — warning.
No person shall sell a beverage that contains 1.1 per cent or more alcohol by volume unless the package in which it is sold bears, in the prescribed form and manner, a label warning against the risks of alcohol consumption to the health of consumers and showing, in addition to any other prescribed information, (a) the volume of beverage that, in the opinion of the Department, constitutes a standard drink; (b) the number of standard drinks in the package; (c) the number of standard drinks that, in the opinion of the Department, should not be exceeded in order to avoid significant health risks; and (d) a message from the Department that sets out the direct causal link between alcohol consumption and the development of fatal cancers.`;

export function buildSeedLawVersion(args: {
  bill: Bill;
  baseLaw: BaseLaw;
}): LawVersion {
  const { bill, baseLaw } = args;
  return {
    id: `lv-${bill.id}-seed`,
    baseLawId: baseLaw.id,
    baseLawTitle: baseLaw.title,
    sourceBillId: bill.id,
    sourceBillNumber: bill.billNumber,
    sourceBillTitle: bill.title,
    sourceBillStatus: bill.status,
    legislativeMomentum: bill.legislativeMomentum,
    versionStatus:
      bill.legislativeMomentum === "passed"
        ? "passed_pending_review"
        : bill.legislativeMomentum === "in_force"
          ? "in_force"
          : "proposed_future",
    humanApproved: false,
    oldText: FDA_S5_OLD,
    updatedText: FDA_S5_UPDATED,
    affectedSections: ["s. 5", "s. 5.1 (new)"],
    changeTypes: ["add", "obligation_change"],
    deltaSummary:
      "Bill S-202 adds new section 5.1 to the Food and Drugs Act requiring alcoholic beverages of 1.1% ABV or more to bear a warning label disclosing standard-drink information and a Department message on the link between alcohol and fatal cancers.",
    detailedDelta:
      "After existing s. 5 (deception in food labelling), a new s. 5.1 is enacted prohibiting the sale of any beverage of 1.1% ABV or more unless its package bears a prescribed warning label that discloses (a) standard-drink volume, (b) number of standard drinks per package, (c) the daily limit of standard drinks above which significant health risk arises, and (d) a Department message articulating the direct causal link between alcohol consumption and fatal cancers. The bill comes into force on the first anniversary of Royal Assent.",
    effectiveDate: null,
    comingIntoForceText:
      "First anniversary of the day on which the Act receives Royal Assent.",
    confidence: 0.74,
    humanReviewRequired: true,
    humanReviewReason:
      "Confidence below 0.75; prescribed form/manner of the label awaits regulations; coming-into-force depends on Royal Assent date.",
    createdAt: new Date().toISOString(),
  };
}

type CannedImpact = Omit<
  ClientImpactAnalysis,
  "id" | "clientId" | "lawVersionId" | "saved" | "createdAt"
>;

export const CANNED_IMPACTS: Record<string, CannedImpact> = {
  "client-eventpour-technologies": {
    affected: "yes",
    impactLevel: "medium",
    urgency: "medium",
    timing:
      "Bill S-202 is currently at third reading in the Senate. If it passes and receives Royal Assent, alcohol vendors using EventPour will have one year to comply. EventPour itself is a platform, not a seller, but its vendor onboarding and compliance workflows will need updates well before that date.",
    whyItAffectsClient:
      "EventPour does not sell alcoholic beverages directly, but its product is the operational layer alcohol vendors at festivals and venues use to onboard, sell, and prove compliance. The new s. 5.1 warning-label obligation lands on the package — i.e., on EventPour's vendors. EventPour's customer terms already push compliance responsibility to vendors, which is helpful, but the platform's vendor checklists, onboarding flows, and indemnity language do not currently surface the s. 5.1 obligation. Expect customers to ask whether EventPour can help them prove compliance at point of sale.",
    affectedClientAreas: [
      "Vendor onboarding workflow",
      "Compliance checklists",
      "Customer terms / indemnities",
      "Marketing collateral (compliance positioning)",
    ],
    requiredAdaptations: [
      {
        area: "Vendor onboarding checklist",
        currentIssue:
          "Onboarding does not explicitly surface the s. 5.1 alcohol warning-label requirement; vendors selling alcoholic beverages of ≥1.1% ABV may unknowingly list non-compliant inventory through EventPour.",
        recommendation:
          "Add a checklist item that requires alcohol vendors to confirm that each SKU's package carries the prescribed warning label and standard-drink information.",
        reason:
          "EventPour's risk is reputational and contractual. Surfacing the obligation in onboarding lets EventPour rely on the vendor's representation when investigating disputes.",
      },
      {
        area: "Customer master agreement",
        currentIssue:
          "Indemnity language references general regulatory compliance but does not name federal labelling obligations under the Food and Drugs Act.",
        recommendation:
          "Update the standard indemnity in the customer master agreement to specifically name Food and Drugs Act labelling obligations, including the new s. 5.1 once in force.",
        reason:
          "Specificity tightens the indemnity and signals to customers that EventPour treats labelling compliance as an in-scope risk.",
      },
      {
        area: "Compliance product positioning",
        currentIssue:
          "EventPour's marketing emphasises age-gating and POS workflows; it does not advertise help with packaging-side compliance.",
        recommendation:
          "Decide whether to offer a 'compliance evidence' add-on that captures vendor declarations of warning-label compliance — a possible up-sell.",
        reason:
          "S-202 creates a recurring compliance burden for EventPour's vendor base; selling them the proof tooling fits EventPour's existing product surface.",
      },
    ],
    relevantClientText: [
      {
        source: "Customer terms",
        excerpt:
          "Customer and its vendors are responsible for obtaining all permits and complying with laws applicable to the sale, service, marketing, labelling, and distribution of regulated products.",
        issue:
          "Already pushes compliance risk to the customer, but does not name the new s. 5.1 obligation. Update for clarity, not because the clause is broken.",
      },
    ],
    lawyerVerificationQuestions: [
      "Confirm that EventPour itself is not a 'person who sells' under proposed s. 5.1 in any provincial liquor regime that overlays the Food and Drugs Act.",
      "Confirm that EventPour's pass-through indemnity is enforceable for federal labelling violations, especially in Quebec.",
      "Decide whether EventPour should require evidence of label compliance at vendor onboarding or rely on representation only.",
    ],
    emailDraft: {
      subject:
        "Bill S-202 (alcohol warning labels) — EventPour exposure: indirect / vendor-driven",
      body: "Hi team,\n\nSummary of the S-202 client-impact analysis for EventPour Technologies:\n\n- Affected: yes (indirectly — vendors selling on the platform are the obligated party)\n- Impact level: medium\n- Urgency: medium (bill at third reading; +1 year transition after Royal Assent)\n\nKey exposure: EventPour does not sell alcoholic beverages, but its vendor-onboarding and compliance workflows do not currently surface the new s. 5.1 warning-label obligation under the Food and Drugs Act. Customer terms already push compliance to vendors, which is good; the gap is operational (checklists, indemnity language, product positioning), not contractual at first principles.\n\nRecommended next steps:\n1. Add a s. 5.1 confirmation step to the vendor onboarding checklist.\n2. Refresh the standard indemnity to explicitly name Food and Drugs Act labelling obligations.\n3. Decide whether to productise a 'compliance evidence' add-on as an up-sell.\n\nFlagged for human review: form/manner of the prescribed label awaits regulations; coming-into-force depends on Royal Assent date.\n\n— Injenium",
    },
    confidence: 0.82,
    humanReviewRequired: true,
    humanReviewReason:
      "Form/manner of the prescribed label is delegated to regulations not yet published; coming-into-force date depends on Royal Assent.",
  },

  "client-maplecellars-marketplace": {
    affected: "yes",
    impactLevel: "high",
    urgency: "high",
    timing:
      "Bill S-202 is at third reading in the Senate. If it receives Royal Assent in this session, MapleCellars will have one year to ensure that every SKU it lists from licensed Canadian suppliers ships with the new s. 5.1 warning label and standard-drink disclosures.",
    whyItAffectsClient:
      "MapleCellars hosts third-party supplier listings for alcoholic beverages and coordinates delivery. The new s. 5.1 obligation is on the package, which means it is on MapleCellars' suppliers — but MapleCellars' marketplace surface (product images, label information, listing fields) is what consumers and regulators will look at first when assessing whether the marketplace is hosting non-compliant products. The current supplier compliance warranty is broad; it does not require evidence of warning-label compliance, and the platform does not currently capture standard-drink data fields per SKU.",
    affectedClientAreas: [
      "Supplier listing schema",
      "Supplier onboarding warranties",
      "Take-down / risk-removal policy",
      "Customer-facing product detail page",
    ],
    requiredAdaptations: [
      {
        area: "Supplier listing schema",
        currentIssue:
          "MapleCellars' listing fields do not capture the new prescribed information (standard drink volume, drinks per package, daily limit, Department warning).",
        recommendation:
          "Add structured fields for standard-drink volume, drinks per package, and a flag confirming the package bears the prescribed s. 5.1 warning label. Surface these on the product detail page.",
        reason:
          "Without structured data, MapleCellars cannot programmatically detect non-compliant SKUs and cannot give regulators a clean audit trail.",
      },
      {
        area: "Supplier onboarding warranty",
        currentIssue:
          "Supplier represents that products comply with applicable laws — broad and unverified, with no specific warning-label warranty.",
        recommendation:
          "Add a specific representation that each SKU's package complies with the Food and Drugs Act and, once in force, with s. 5.1. Require suppliers to upload a label image at SKU creation.",
        reason:
          "S-202 creates a labelling obligation that is straightforward to verify at listing time. A specific warranty with evidence is materially stronger than the existing general one.",
      },
      {
        area: "Risk-removal / take-down policy",
        currentIssue:
          "MapleCellars 'may remove' listings that create legal or reputational risk — discretionary, without a documented trigger for federal labelling violations.",
        recommendation:
          "Add a documented take-down trigger for SKUs that fail s. 5.1 verification once the section is in force, with a 7-day cure window for the supplier.",
        reason:
          "A documented trigger turns a discretionary power into a defensible compliance process.",
      },
    ],
    relevantClientText: [
      {
        source: "Supplier terms",
        excerpt:
          "Supplier is solely responsible for ensuring that all products, product descriptions, labels, warnings, packaging, and sales practices comply with applicable federal, provincial, and municipal laws.",
        issue:
          "General compliance pass-through. Sufficient as a starting point but does not specify warning-label obligations or require evidence — leaves MapleCellars exposed if a regulator audits its catalogue.",
      },
      {
        source: "Operational facts",
        excerpt:
          "Does not currently require a specific alcohol warning-label certification.",
        issue:
          "Direct gap against the proposed s. 5.1 obligation; first remediation target.",
      },
    ],
    lawyerVerificationQuestions: [
      "Confirm whether MapleCellars qualifies as 'sells' under s. 5.1 given that title transfers through the marketplace, even though licensed suppliers fulfil.",
      "Confirm whether listing-page disclosures (label image + standard-drink data) satisfy the 'prescribed form and manner' requirement once regulations are published.",
      "Confirm what cure window for non-compliant suppliers would be defensible in a regulator inquiry.",
    ],
    emailDraft: {
      subject:
        "Bill S-202 (alcohol warning labels) — MapleCellars: high exposure, listing schema work needed",
      body: "Hi team,\n\nSummary of the S-202 client-impact analysis for MapleCellars Marketplace:\n\n- Affected: yes\n- Impact level: high\n- Urgency: high (bill at third reading; +1 year after Royal Assent — schema work has to start now)\n\nKey exposure: MapleCellars hosts third-party alcohol listings. The new s. 5.1 obligation is on the package, but the marketplace surface is what consumers and regulators will see first. Today the listing schema does not capture standard-drink data, and the supplier warranty is general. Both need to change.\n\nRecommended next steps:\n1. Extend the listing schema with structured s. 5.1 fields (standard-drink volume, drinks per package, label-confirmed flag).\n2. Add a specific warning-label representation to supplier onboarding and require an uploaded label image.\n3. Document a take-down trigger for s. 5.1 failures with a short cure window.\n\nFlagged for human review: whether MapleCellars 'sells' under s. 5.1 given marketplace mechanics; what 'prescribed form and manner' will require under the eventual regulations.\n\n— Injenium",
    },
    confidence: 0.84,
    humanReviewRequired: true,
    humanReviewReason:
      "Whether MapleCellars qualifies as 'a person who sells' under s. 5.1 turns on legal interpretation of marketplace mechanics; awaiting regulations on prescribed label form.",
  },

  "client-north-river-brewing": {
    affected: "yes",
    impactLevel: "high",
    urgency: "high",
    timing:
      "Bill S-202 is at third reading in the Senate. North River manufactures and packages alcoholic beverages and would be a directly obligated party once the bill receives Royal Assent. With a six-month packaging inventory cycle and annual label review, North River must begin label redesign and inventory planning now to be compliant within one year of Royal Assent.",
    whyItAffectsClient:
      "North River is squarely the obligated party under proposed s. 5.1: it manufactures, cans, labels and sells beverages between 4% and 7% ABV — well above the 1.1% threshold. Every SKU's packaging will need to bear the prescribed warning label, standard-drink volume, drinks per package, daily-limit message, and the Department's causal-link statement. North River's existing label-review cadence (annual) and packaging inventory cycle (six months) are too slow for the one-year transition; the third-party printer relationship adds lead time. This is a planning, capital, and operations problem, not a contractual one.",
    affectedClientAreas: [
      "Product label design",
      "Packaging inventory planning",
      "Third-party printer relationship",
      "Annual label review cadence",
      "Marketing claims / can art",
    ],
    requiredAdaptations: [
      {
        area: "Label redesign program",
        currentIssue:
          "Current labels do not include the prescribed s. 5.1 elements (standard-drink volume, drinks per package, daily limit, Department message on the alcohol-cancer link).",
        recommendation:
          "Stand up a label redesign program with the in-house design team and outside regulatory counsel. Aim for redesigns approved within 4 months of Royal Assent so printers can deliver new stock within the one-year transition.",
        reason:
          "S-202 requires every covered package to bear the warning label in the prescribed form. North River's six-month inventory cycle plus printer lead time will consume most of the one-year transition.",
      },
      {
        area: "Inventory & sell-through plan",
        currentIssue:
          "North River keeps roughly six months of packaging inventory; non-compliant inventory cannot be sold once s. 5.1 is in force.",
        recommendation:
          "Run a sell-through plan that depletes legacy packaging before the in-force date, or budget for write-offs. Coordinate with provincial distributors on shelf rotation.",
        reason:
          "Selling non-compliant packaged inventory after the in-force date triggers s. 5.1 directly.",
      },
      {
        area: "Annual label review cadence",
        currentIssue:
          "Labels are reviewed annually unless a regulator forces faster updates.",
        recommendation:
          "Move to an event-triggered review cadence keyed to the s. 5.1 regulations and any Department guidance updating the prescribed message text.",
        reason:
          "Once s. 5.1 is in force, the Department-prescribed elements may be revised; annual review will be insufficient.",
      },
      {
        area: "Marketing claim review",
        currentIssue:
          "Existing can art and marketing collateral may emphasise health-adjacent positioning ('craft', 'natural', etc.) that, paired with the new prescribed cancer-warning, becomes more legally fraught.",
        recommendation:
          "Review marketing claims against the new mandatory disclosures; remove or adjust positioning that could be characterised as misleading once the warning label is in place.",
        reason:
          "Section 5(1) prohibits misleading or deceptive food labelling; the new s. 5.1 warning will sharpen the contrast for any borderline claim.",
      },
    ],
    relevantClientText: [
      {
        source: "Operational facts",
        excerpt:
          "Manufactures alcoholic beverages. Controls product packaging and labelling. Sells packaged alcoholic beverages to Canadian consumers.",
        issue:
          "North River is the obligated party for s. 5.1 — every consumer-facing package is in scope.",
      },
      {
        source: "Operational facts",
        excerpt:
          "Uses third-party printers for can and bottle labels. Maintains a six-month packaging inventory cycle.",
        issue:
          "Printer lead time and inventory cycle materially compress the one-year transition window. Plan now.",
      },
      {
        source: "Operational facts",
        excerpt:
          "Product labels are reviewed annually unless a regulator requires faster updates.",
        issue:
          "Cadence is too slow for the post-Royal-Assent transition; needs to be event-triggered.",
      },
    ],
    lawyerVerificationQuestions: [
      "Confirm exemption analysis (if any) for sub-1.1% products in North River's portfolio.",
      "Confirm whether existing 'standard drink' calculations on North River's marketing materials will satisfy the eventual regulations.",
      "Confirm whether label changes can be staggered SKU-by-SKU during the one-year transition or must occur on a single in-force date.",
      "Coordinate with provincial liquor regulators on shelf-rotation and cure for legacy inventory.",
    ],
    emailDraft: {
      subject:
        "Bill S-202 (alcohol warning labels) — North River: directly obligated, start label redesign now",
      body: "Hi team,\n\nSummary of the S-202 client-impact analysis for North River Brewing Co.:\n\n- Affected: yes (directly obligated)\n- Impact level: high\n- Urgency: high (third reading; +1 year after Royal Assent — too tight for the existing label cadence)\n\nKey exposure: North River manufactures, packages, and sells beverages between 4% and 7% ABV. Every SKU is in scope of the proposed s. 5.1. The combination of annual label reviews, third-party printer lead time, and a six-month packaging inventory cycle will consume most of the one-year transition. This is a planning and operations problem, not a contractual one.\n\nRecommended next steps:\n1. Stand up a label redesign program targeting approved designs within 4 months of Royal Assent.\n2. Run a sell-through plan with provincial distributors so legacy inventory clears before the in-force date; budget for write-offs.\n3. Move from annual to event-triggered label review cadence keyed to s. 5.1 regulations.\n4. Review marketing claims that may become more legally fraught once the cancer-warning is mandatory.\n\nFlagged for human review: portfolio review for sub-1.1% exemptions; whether label changes can be SKU-staggered during the transition.\n\n— Injenium",
    },
    confidence: 0.88,
    humanReviewRequired: true,
    humanReviewReason:
      "Implementation depends on regulations on prescribed form/manner and on coordination with provincial liquor regimes; legal interpretation required.",
  },
};
