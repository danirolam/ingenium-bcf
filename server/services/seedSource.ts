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

function normalizationCandidates(title: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  push(title);

  // Strip trailing punctuation (e.g. "Criminal Code,").
  push(title.replace(/[\s.,;:]+$/g, ""));

  // Strip parenthetical tails (e.g. "Foo Act (Sergei Magnitsky Law)").
  push(title.replace(/\s*\([^)]*\)\s*$/g, ""));

  // Strip year/number tails: ", 2001" / ", No. 1" / ", 2023, No. 1".
  push(
    title.replace(
      /(,\s*(?:No\.?\s*\d+|\d{4}))+\s*$/gi,
      "",
    ),
  );

  // "An Act to amend the X ..." → "X" (stop at " and ", " to ", parens, or end).
  const amendMatch = title.match(
    /^An Act to amend\s+(?:the\s+)?(.+?)(?=\s+(?:and|to)\s+|\s*\(|\s*,|$)/i,
  );
  if (amendMatch) push(amendMatch[1]);

  return out;
}

export function resolveActSlug(
  actTitle: string,
  registry: Record<string, RegistryEntry>,
): string | null {
  if (!actTitle) return null;

  for (const candidate of normalizationCandidates(actTitle)) {
    const lc = candidate.toLowerCase();
    for (const [slug, entry] of Object.entries(registry)) {
      if (entry.title.toLowerCase() === lc) return slug;
    }
    const slug = slugifyActTitle(candidate);
    if (registry[slug]) return slug;
  }
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
  for (const c of bill.clauses) {
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
  // When set, used directly for `operations` (and T&C/policies stay undefined).
  // When omitted, the legacy terms.txt path is used for both T&C and operations.
  operations?: string;
  riskTolerance?: "low" | "medium" | "high";
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
  {
    slug: "bayer-inc",
    name: "Bayer Inc. (acquired Monsanto)",
    industry:
      "Agricultural biotechnology and agrochemical industry (Genetically modified seeds and plant traits; Crop protection products (herbicides, fungicides, insecticides); Agricultural biotechnology and data-driven farming technologies)",
    jurisdictions: ["Federal"],
    description:
      "Bayer is a multinational life sciences company operating in both the healthcare and agriculture sectors. In agriculture, its Crop Science division focuses on improving agricultural productivity through seed innovation, biotechnology, and chemical crop protection products. The company develops and commercializes genetically modified crop traits, seeds, and crop protection solutions designed to increase yields, manage pests and weeds, and support modern farming practices.",
    operations:
      "Bayer’s Canadian agricultural operations include the development, testing, and commercialization of seeds and crop protection products, as well as digital and precision agriculture technologies. Activities involve biotechnology and trait research, seed development and distribution, herbicide and pesticide product management, field trials, agronomic advisory services, and data-driven farming tools aimed at improving productivity, sustainability, and farm efficiency.",
    riskTolerance: "medium",
  },
  {
    slug: "canneberges-bieler",
    name: "Canneberges Bieler Inc.",
    industry:
      "Agricultural production and agri-food industry (Specialty crop farming (horticulture); Cranberry cultivation and production; Post-harvest processing and agri-food supply chain integration; Primary agricultural production (soft fruit sector))",
    jurisdictions: ["Federal"],
    description:
      "Canneberges Bieler Inc. is a Québec-based agricultural producer and one of Canada’s leading cranberry farming companies. Established in the mid-1980s, it specializes in large-scale cranberry cultivation and operates multiple production sites. The company manages the full cultivation cycle, from bog development and field preparation to harvesting, storage, and shipment, supplying cranberries to major processors and cooperatives such as Ocean Spray. Its operations are supported by agronomic expertise and a focus on sustainable agricultural practices and long-term land stewardship.",
    operations:
      "Canneberges Bieler Inc.’s operations include the cultivation of cranberries in engineered bog systems, seasonal harvesting activities such as flooding and berry collection, and post-harvest handling including storage and transport. The company also engages in agricultural land management and development, supply chain coordination with processors and distributors, and agronomic practices aimed at improving crop yield, operational efficiency, and environmental sustainability in cranberry production.",
    riskTolerance: "medium",
  },
];

export async function loadTeammateClients(): Promise<Client[]> {
  const clients: Client[] = [];
  for (const spec of DEMO_CLIENT_SPECS) {
    const inlineOps = spec.operations;
    const terms = inlineOps
      ? null
      : await readText(
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
      operations: inlineOps ?? terms ?? undefined,
      riskTolerance: spec.riskTolerance ?? "medium",
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

interface CannedDiff {
  oldText: string;
  updatedText: string;
  affectedSections: string[];
  changeTypes: string[];
  deltaSummary: string;
  detailedDelta: string;
  comingIntoForceText: string | null;
  confidence: number;
  humanReviewRequired: boolean;
  humanReviewReason: string | null;
}

const CANNED_DIFFS: Record<string, CannedDiff> = {
  "S-202|food-and-drugs-act": {
    oldText: `Section 5 — Deception, etc., regarding food.
(1) No person shall label, package, treat, process, sell or advertise any food in a manner that is false, misleading or deceptive or is likely to create an erroneous impression regarding its character, value, quantity, composition, merit or safety.
(2) An article of food that is not labelled or packaged as required by, or is labelled or packaged contrary to, the regulations shall be deemed to be labelled or packaged contrary to subsection (1).`,
    updatedText: `Section 5 — Deception, etc., regarding food.
(1) No person shall label, package, treat, process, sell or advertise any food in a manner that is false, misleading or deceptive or is likely to create an erroneous impression regarding its character, value, quantity, composition, merit or safety.
(2) An article of food that is not labelled or packaged as required by, or is labelled or packaged contrary to, the regulations shall be deemed to be labelled or packaged contrary to subsection (1).

Section 5.1 — Alcoholic beverages — warning.
No person shall sell a beverage that contains 1.1 per cent or more alcohol by volume unless the package in which it is sold bears, in the prescribed form and manner, a label warning against the risks of alcohol consumption to the health of consumers and showing, in addition to any other prescribed information, (a) the volume of beverage that, in the opinion of the Department, constitutes a standard drink; (b) the number of standard drinks in the package; (c) the number of standard drinks that, in the opinion of the Department, should not be exceeded in order to avoid significant health risks; and (d) a message from the Department that sets out the direct causal link between alcohol consumption and the development of fatal cancers.`,
    affectedSections: ["s. 5", "s. 5.1 (new)"],
    changeTypes: ["add", "obligation_change"],
    deltaSummary:
      "Bill S-202 adds new section 5.1 to the Food and Drugs Act requiring alcoholic beverages of 1.1% ABV or more to bear a warning label disclosing standard-drink information and a Department message on the link between alcohol and fatal cancers.",
    detailedDelta:
      "After existing s. 5 (deception in food labelling), a new s. 5.1 is enacted prohibiting the sale of any beverage of 1.1% ABV or more unless its package bears a prescribed warning label that discloses (a) standard-drink volume, (b) number of standard drinks per package, (c) the daily limit of standard drinks above which significant health risk arises, and (d) a Department message articulating the direct causal link between alcohol consumption and fatal cancers. The bill comes into force on the first anniversary of Royal Assent.",
    comingIntoForceText:
      "First anniversary of the day on which the Act receives Royal Assent.",
    confidence: 0.74,
    humanReviewRequired: true,
    humanReviewReason:
      "Confidence below 0.75; prescribed form/manner of the label awaits regulations; coming-into-force depends on Royal Assent date.",
  },

  "C-273|feeds-act": {
    oldText: `Section 2 — Definitions.
In this Act, "feed" means any substance or mixture of substances ... [definitions of analyst, conveyance, document, environment, establishment, feed, inspection mark, inspector, label, livestock, Minister, package, penalty, prescribed, sell, Tribunal, violation].

Section 3 — Prohibitions.
(1) No person shall manufacture, sell or import into Canada any feed unless the feed
  (a) has, in accordance with the regulations, been approved by the Minister or registered;
  (b) conforms to prescribed standards; and
  (c) is packaged and labelled in accordance with the regulations.
(2) Paragraphs (1)(a) and (b) do not apply to any feed consisting of whole seeds or grains of cultivated farm crops if it is free from prescribed deleterious substances.

Section 5 — Regulations.
(1) The Governor in Council may make regulations
  (a) respecting applications for registration or for approval of feeds and the information to be furnished with the applications;
  (b) respecting the registration of feeds and prescribing fees for registration;
  (b.1) respecting the approval of feeds;
  (c) respecting the duration and cancellation of the registration or approval of feeds;
  ...`,
    updatedText: `Section 2 — Definitions.
In this Act, "feed" means any substance or mixture of substances ... [existing definitions unchanged] ...
"trusted jurisdiction" means a jurisdiction prescribed by regulation as having regulatory standards for feeds that the Minister considers to provide a level of protection of human and animal health and the environment that is comparable to the level of protection provided under this Act.

Section 3 — Prohibitions.
(1) No person shall manufacture, sell or import into Canada any feed unless the feed
  (a) has, in accordance with the regulations, been approved by the Minister or registered;
  (b) conforms to prescribed standards; and
  (c) is packaged and labelled in accordance with the regulations.
(1.1) Trusted jurisdiction. — Despite paragraphs (1)(a) and (b), a feed may be manufactured, sold or imported into Canada if it has been approved or registered by the regulatory authority of a trusted jurisdiction and the prescribed conditions are satisfied.
(2) Paragraphs (1)(a) and (b) do not apply to any feed consisting of whole seeds or grains of cultivated farm crops if it is free from prescribed deleterious substances.

Section 5.21 (new) — Provisional approval or registration.
(1) On application, the Minister may grant a provisional approval or registration of a feed for a period of not more than two years if the Minister is satisfied that the prescribed criteria are met and that granting the provisional approval or registration is unlikely to result in harm to human or animal health or the environment.
(2) The Minister may make a provisional approval or registration subject to the prescribed conditions and to any additional conditions the Minister considers appropriate.

Section 5.22 (new) — Final approval or registration.
The Minister shall, before the end of the period referred to in subsection 5.21(1), either grant a final approval or registration of the feed, refuse the application or extend the provisional approval or registration for a further period not exceeding one year.

Section 5 — Regulations.
(1) The Governor in Council may make regulations
  (a) respecting applications for registration or for approval of feeds and the information to be furnished with the applications;
  (b) respecting the registration of feeds and prescribing fees for registration;
  (b.1) respecting the approval of feeds;
  (b.2) respecting provisional and final approvals and registrations of feeds, including the criteria, terms and conditions to be imposed under sections 5.21 and 5.22;
  (b.3) prescribing trusted jurisdictions and the conditions under which a feed approved or registered by a trusted jurisdiction may be manufactured, sold or imported into Canada;
  (c) respecting the duration and cancellation of the registration or approval of feeds;
  ...`,
    affectedSections: ["s. 2 (definitions)", "s. 3(1.1) (new)", "s. 5.21 (new)", "s. 5.22 (new)", "s. 5(1)(b.2)–(b.3) (new)"],
    changeTypes: ["add", "definition_change", "obligation_change"],
    deltaSummary:
      "Bill C-273 (clauses 2–5) introduces a 'trusted jurisdiction' concept into the Feeds Act, lets feeds approved abroad be sold in Canada under prescribed conditions, and creates a two-stage provisional/final approval-or-registration regime.",
    detailedDelta:
      "Clause 2 adds a 'trusted jurisdiction' definition to s. 2. Clause 3 inserts s. 3(1.1) allowing a feed approved by a trusted-jurisdiction regulator to be manufactured, sold or imported despite the standard registration requirements. Clause 4 adds new ss. 5.21–5.22 establishing a provisional approval/registration valid for up to two years (extendable by one) followed by a final decision. Clause 5 adds regulation-making powers (paras (b.2) and (b.3) of s. 5(1)) to support the new regime.",
    comingIntoForceText:
      "On a day to be fixed by order of the Governor in Council.",
    confidence: 0.7,
    humanReviewRequired: true,
    humanReviewReason:
      "Trusted-jurisdiction list and provisional-registration criteria are entirely deferred to regulations; impact depends on which jurisdictions and conditions are prescribed.",
  },

  "C-273|fertilizers-act": {
    oldText: `Section 2 — Definitions.
In this Act, "fertilizer" means any substance or mixture of substances containing nitrogen, phosphorus, potassium or other plant food, manufactured, sold or represented for use as a plant nutrient ... "supplement" means any substance or mixture of substances ... designed for use ... in improving the physical condition of soils ...

Section 3 — Prohibitions.
(1) No person shall sell or import into Canada any fertilizer or supplement unless that fertilizer or supplement
  (a) conforms to prescribed standards; and
  (b) is packaged and labelled in accordance with the regulations.

Section 5 — Regulations.
(1) The Governor in Council may make regulations
  (a) respecting applications for registration of fertilizers and supplements;
  (b) respecting the registration of fertilizers and supplements and prescribing fees for registration;
  (b.1) respecting the approval of fertilizers and supplements;
  ...`,
    updatedText: `Section 2 — Definitions.
In this Act, "fertilizer" means ... [existing definitions unchanged] ...
"trusted jurisdiction" means a jurisdiction prescribed by regulation as having regulatory standards for fertilizers and supplements that the Minister considers to provide a level of protection of human and animal health and the environment that is comparable to the level of protection provided under this Act.

Section 3 — Prohibitions.
(1) No person shall sell or import into Canada any fertilizer or supplement unless that fertilizer or supplement
  (a) conforms to prescribed standards; and
  (b) is packaged and labelled in accordance with the regulations.
(1.1) Trusted jurisdiction. — Despite paragraphs (1)(a) and (b), a fertilizer or supplement may be manufactured, sold or imported into Canada if it has been approved or registered by the regulatory authority of a trusted jurisdiction and the prescribed conditions are satisfied.

Section 5.21 (new) — Provisional approval or registration.
(1) On application, the Minister may grant a provisional approval or registration of a fertilizer or supplement for a period of not more than two years if the Minister is satisfied that the prescribed criteria are met and that granting the provisional approval or registration is unlikely to result in harm to human or animal health or the environment.

Section 5.22 (new) — Final approval or registration.
The Minister shall, before the end of the period referred to in subsection 5.21(1), either grant a final approval or registration of the fertilizer or supplement, refuse the application or extend the provisional approval or registration for a further period not exceeding one year.

Section 5 — Regulations.
(1) The Governor in Council may make regulations
  (a) respecting applications for registration of fertilizers and supplements;
  (b) respecting the registration of fertilizers and supplements and prescribing fees for registration;
  (b.1) respecting the approval of fertilizers and supplements;
  (b.2) respecting provisional and final approvals and registrations of fertilizers and supplements;
  (b.3) prescribing trusted jurisdictions and the conditions under which a fertilizer or supplement approved or registered by a trusted jurisdiction may be manufactured, sold or imported into Canada;
  ...`,
    affectedSections: ["s. 2 (definitions)", "s. 3(1.1) (new)", "s. 5.21 (new)", "s. 5.22 (new)", "s. 5(1)(b.2)–(b.3) (new)"],
    changeTypes: ["add", "definition_change", "obligation_change"],
    deltaSummary:
      "Bill C-273 (clauses 6–9) mirrors the Feeds-Act changes for the Fertilizers Act: adds a 'trusted jurisdiction' definition, allows trusted-jurisdiction approval as a basis for sale or import, and creates a provisional/final approval-or-registration regime for fertilizers and supplements.",
    detailedDelta:
      "Clause 6 inserts a 'trusted jurisdiction' definition into s. 2. Clause 7 inserts s. 3(1.1) carving out a trusted-jurisdiction route around the standard prohibition. Clause 8 adds ss. 5.21–5.22 (provisional registration valid up to two years, final decision before expiry, one-year extension permitted). Clause 9 adds regulation-making powers in s. 5(1)(b.2)–(b.3) to operationalize the new regime.",
    comingIntoForceText:
      "On a day to be fixed by order of the Governor in Council.",
    confidence: 0.7,
    humanReviewRequired: true,
    humanReviewReason:
      "Same as Feeds Act: scope of 'trusted jurisdictions' and provisional-registration criteria are determined by future regulations.",
  },

  "C-273|seeds-act": {
    oldText: `Section 2 — Definitions.
In this Act, "seed" means any plant part of any species belonging to the plant kingdom, represented, sold or used to grow a plant ...

Section 4 — Regulations.
The Governor in Council may make regulations
  (a) prescribing standards of quality, including standards of varietal purity, for seeds;
  (b) prescribing standards for the testing, inspecting and grading of seeds;
  (c) prescribing standards for the labelling and advertising of seeds;
  ...
  (i) respecting the registration of seed varieties and prescribing fees for registration;
  (j) generally, for carrying out the purposes and provisions of this Act.`,
    updatedText: `Section 2 — Definitions.
In this Act, "seed" means ... [existing definitions unchanged] ...
"trusted jurisdiction" means a jurisdiction prescribed by regulation as having regulatory standards for seed varieties that the Minister considers to provide a level of protection comparable to the level of protection provided under this Act.

Section 4.1 (new) — Provisional variety registration.
(1) On application, the Minister may grant a provisional registration of a seed variety for a period of not more than two years if the Minister is satisfied that the prescribed criteria are met.

Section 4.2 (new) — Final variety registration.
The Minister shall, before the end of the period referred to in subsection 4.1(1), either grant a final registration of the variety, refuse the application or extend the provisional registration for a further period not exceeding one year.

Section 4.3 (new) — Trusted jurisdiction reliance.
The Minister may register a seed variety on the basis of a registration granted by the regulatory authority of a trusted jurisdiction if the prescribed conditions are satisfied.

Section 4 — Regulations.
The Governor in Council may make regulations
  (a) prescribing standards of quality, including standards of varietal purity, for seeds;
  (b) prescribing standards for the testing, inspecting and grading of seeds;
  (c) prescribing standards for the labelling and advertising of seeds;
  ...
  (i) respecting the registration of seed varieties and prescribing fees for registration;
  (j) generally, for carrying out the purposes and provisions of this Act;
  (k) respecting provisional and final variety registrations under sections 4.1 and 4.2;
  (l) prescribing trusted jurisdictions and the conditions under which a seed variety registered by a trusted jurisdiction may be registered under section 4.3.`,
    affectedSections: ["s. 2 (definitions)", "s. 4.1 (new)", "s. 4.2 (new)", "s. 4.3 (new)", "s. 4(k)–(l) (new)"],
    changeTypes: ["add", "definition_change"],
    deltaSummary:
      "Bill C-273 (clauses 10–13) adds a provisional/final seed-variety registration regime to the Seeds Act and lets the Minister register varieties already registered in a trusted jurisdiction.",
    detailedDelta:
      "Clause 10 adds a 'trusted jurisdiction' definition. Clause 11 inserts ss. 4.1–4.2 establishing provisional variety registration valid up to two years with a final decision before expiry. Clause 12 inserts s. 4.3 letting the Minister register a variety on the basis of a trusted-jurisdiction registration. Clause 13 adds regulation-making powers (paras (k) and (l) of s. 4) to support both routes.",
    comingIntoForceText:
      "On a day to be fixed by order of the Governor in Council.",
    confidence: 0.72,
    humanReviewRequired: true,
    humanReviewReason:
      "Variety-registration criteria and the list of trusted jurisdictions are deferred to regulations; coming-into-force is at the Governor in Council's discretion.",
  },

  "C-273|pest-control-products-act": {
    oldText: `Section 2 — Definitions.
In this Act, "pest control product" means
  (a) a product, an organism or a substance, including a product, an organism or a substance derived through biotechnology, that consists of its active ingredient, formulants and contaminants, and that is manufactured, represented, distributed or used as a means for directly or indirectly controlling, destroying, attracting or repelling a pest or for mitigating or preventing its injurious, noxious or troublesome effects;
  ...

Section 7 — Application for registration.
(1) Every applicant for the registration or amendment of the registration of a pest control product shall submit an application ...

Section 67(1) — Regulations.
The Governor in Council may make regulations
  (a) respecting the registration of pest control products and the amendment, renewal, suspension, cancellation or reinstatement of registrations;
  ...`,
    updatedText: `Section 2 — Definitions.
In this Act, "pest control product" means ... [existing definitions unchanged] ...
"trusted jurisdiction" means a jurisdiction prescribed by regulation as having regulatory standards for pest control products that the Minister considers to provide a level of protection of health and the environment that is comparable to the level of protection provided under this Act.

Section 7 — Application for registration.
(1) Every applicant for the registration or amendment of the registration of a pest control product shall submit an application ...

Section 7.1 (new) — Provisional registration.
(1) On application, the Minister may grant a provisional registration of a pest control product for a period of not more than two years if the Minister is satisfied that the prescribed criteria are met and that the value of the product and its health and environmental risks are acceptable.

Section 7.2 (new) — Final registration.
The Minister shall, before the end of the period referred to in subsection 7.1(1), either grant a final registration of the pest control product, refuse the application or extend the provisional registration for a further period not exceeding one year.

Section 7.3 (new) — Trusted jurisdiction reliance.
The Minister may register a pest control product on the basis of a registration granted by the regulatory authority of a trusted jurisdiction if the prescribed conditions are satisfied.

Section 67(1) — Regulations.
The Governor in Council may make regulations
  (a) respecting the registration of pest control products and the amendment, renewal, suspension, cancellation or reinstatement of registrations;
  ...
  (z.6) respecting provisional and final registrations under sections 7.1 and 7.2;
  (z.7) prescribing trusted jurisdictions and the conditions under which a pest control product registered by a trusted jurisdiction may be registered under section 7.3.

Section 80.1 (new) — Coordination with trusted jurisdictions.
The Minister may enter into an arrangement with the regulatory authority of a trusted jurisdiction respecting the exchange of information, joint reviews and the alignment of decisions in respect of pest control products.`,
    affectedSections: ["s. 2 (definitions)", "s. 7.1 (new)", "s. 7.2 (new)", "s. 7.3 (new)", "s. 67(1)(z.6)–(z.7) (new)", "s. 80.1 (new)"],
    changeTypes: ["add", "definition_change", "authority_grant"],
    deltaSummary:
      "Bill C-273 (clauses 14–18) adds provisional/final registration and trusted-jurisdiction reliance to the Pest Control Products Act, plus authority for the Minister to enter information-sharing and joint-review arrangements with trusted-jurisdiction regulators.",
    detailedDelta:
      "Clause 14 adds a 'trusted jurisdiction' definition. Clause 15 inserts ss. 7.1–7.2 establishing provisional registration valid up to two years with a final decision before expiry. Clause 16 inserts s. 7.3 permitting reliance on a trusted-jurisdiction registration. Clause 17 adds regulation-making powers (paras (z.6) and (z.7) of s. 67(1)). Clause 18 inserts s. 80.1 authorizing arrangements with trusted-jurisdiction regulators for information exchange, joint reviews and alignment of decisions.",
    comingIntoForceText:
      "On a day to be fixed by order of the Governor in Council.",
    confidence: 0.72,
    humanReviewRequired: true,
    humanReviewReason:
      "PMRA's value/risk thresholds for provisional registration and the list of trusted jurisdictions are deferred to regulations; coordination arrangements under s. 80.1 may have downstream procedural implications.",
  },

  "C-273|food-and-drugs-act": {
    oldText: `Section 30.06(1) — Foreign regulatory authority decisions.
Subject to the regulations, the Minister may, by order, designate a foreign regulatory authority for the purposes of this section in respect of a therapeutic product or a class of therapeutic products and may, in that order, deem any decision made by that foreign regulatory authority in respect of the therapeutic product or class of therapeutic products to be a decision made under this Act.`,
    updatedText: `Section 30.06(1) — Foreign regulatory authority decisions.
Subject to the regulations, the Minister may, by order, designate a foreign regulatory authority for the purposes of this section in respect of a therapeutic product, a veterinary drug or a class of either of them, and may, in that order, deem any decision made by that foreign regulatory authority in respect of the therapeutic product, the veterinary drug or the class to be a decision made under this Act.`,
    affectedSections: ["s. 30.06(1)"],
    changeTypes: ["scope_expansion"],
    deltaSummary:
      "Bill C-273 (clause 19) expands the s. 30.06(1) foreign-regulatory-authority deeming power so that the Minister may deem decisions about veterinary drugs (or classes of them) made by a designated foreign regulator to be decisions under the Food and Drugs Act.",
    detailedDelta:
      "Subsection 30.06(1) is replaced. The original wording captured only 'a therapeutic product or a class of therapeutic products'; the replacement adds 'a veterinary drug' (and a class of either) to the scope of designation and deeming. The mechanism is unchanged: the Minister still acts by order, the order still names a specific foreign regulatory authority, and downstream decisions of that authority are still deemed to be decisions made under the Act.",
    comingIntoForceText:
      "On a day to be fixed by order of the Governor in Council.",
    confidence: 0.82,
    humanReviewRequired: false,
    humanReviewReason: null,
  },
};

export function buildSeedLawVersion(args: {
  bill: Bill;
  baseLaw: BaseLaw;
}): LawVersion | null {
  const { bill, baseLaw } = args;
  const canned = CANNED_DIFFS[`${bill.billNumber}|${baseLaw.id}`];
  if (!canned) return null;

  return {
    id: `lv-${bill.id}-${baseLaw.id}-seed`,
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
    oldText: canned.oldText,
    updatedText: canned.updatedText,
    affectedSections: canned.affectedSections,
    changeTypes: canned.changeTypes,
    deltaSummary: canned.deltaSummary,
    detailedDelta: canned.detailedDelta,
    effectiveDate: null,
    comingIntoForceText: canned.comingIntoForceText,
    confidence: canned.confidence,
    humanReviewRequired: canned.humanReviewRequired,
    humanReviewReason: canned.humanReviewReason,
    createdAt: new Date().toISOString(),
  };
}

type CannedImpact = Omit<
  ClientImpactAnalysis,
  "id" | "clientId" | "lawVersionId" | "saved" | "createdAt"
>;

export const CANNED_IMPACTS: Record<string, CannedImpact> = {
  "client-eventpour-technologies|S-202": {
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

  "client-maplecellars-marketplace|S-202": {
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

  "client-north-river-brewing|S-202": {
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

  "client-bayer-inc|C-273": {
    affected: "yes",
    impactLevel: "high",
    urgency: "high",
    timing:
      "Bill C-273 is at first reading in the House of Commons. Coming-into-force is on a day to be fixed by order of the Governor in Council, and most operative thresholds (trusted-jurisdiction list, provisional-registration criteria, prescribed conditions) are deferred to regulations. Bayer should begin scenario planning now: regulatory affairs, R&D portfolio sequencing, and product launch calendars all need optionality for a near-term provisional-authorization route into the Canadian market.",
    whyItAffectsClient:
      "Bill C-273 amends every federal statute under which Bayer Crop Science operates in Canada — the Feeds Act, Fertilizers Act, Seeds Act, Pest Control Products Act, and s. 30.06(1) of the Food and Drugs Act (now extended to veterinary drugs and classes thereof). Bayer commercialises genetically modified seeds and traits, herbicides, fungicides, insecticides, and digital/precision-agriculture tools across all of these regimes. The bill creates two structural shifts that materially benefit Bayer: (1) a 'trusted jurisdiction' route under which a product already approved or registered abroad (e.g., by the EPA, EFSA, or APHIS) may be manufactured, sold, or imported in Canada under prescribed conditions, and (2) a provisional approval/registration regime (up to two years, extendable by one) that lets a product reach market while the final dossier is under review. As the example with Nutrien indicates, where a compound has already been approved in trusted jurisdictions, Bayer can leverage a provisional authorization for immediate commercial value without first obtaining a permanent authorization. The trade-off is adapted application processes that will reshape product launches and R&D sequencing, plus continuing exposure to a final-decision step that can refuse, condition, or extend the provisional grant.",
    affectedClientAreas: [
      "Regulatory affairs (Crop Science)",
      "R&D portfolio sequencing",
      "Seed variety registration pipeline",
      "Pest control product registration pipeline",
      "Trait and biotechnology submissions",
      "Veterinary drug submissions (s. 30.06(1) scope expansion)",
      "Trusted-jurisdiction reliance strategy",
      "Commercial launch calendars and supply planning",
      "Stewardship and post-market surveillance commitments",
    ],
    requiredAdaptations: [
      {
        area: "Provisional authorization playbook",
        currentIssue:
          "Bayer's Canadian regulatory submissions today are built around the existing single-stage registration pathways under the Feeds, Fertilizers, Seeds, and Pest Control Products Acts; there is no internal SOP for a two-stage provisional/final regime.",
        recommendation:
          "Stand up a cross-act provisional-authorization playbook that defines (i) the dossiers and risk evidence needed to obtain a provisional under ss. 5.21/5.22 (Feeds, Fertilizers), s. 4.1/4.2 (Seeds), and s. 7.1/7.2 (PCPA); (ii) the milestones for converting provisional to final before expiry; and (iii) the contingency if the Minister extends rather than grants final.",
        reason:
          "Provisional authorization is the most material commercial benefit in C-273. A documented playbook lets Crop Science move first the moment regulations are published.",
      },
      {
        area: "Trusted-jurisdiction reliance strategy",
        currentIssue:
          "Bayer's submissions are not currently structured to leverage a trusted-jurisdiction reliance route into Canada; there is no internal mapping of which existing US/EU/UK approvals could be invoked under Feeds Act s. 3(1.1), Fertilizers Act s. 3(1.1), Seeds Act s. 4.3, or PCPA s. 7.3.",
        recommendation:
          "Build a portfolio-wide map of Bayer's US (EPA, USDA-APHIS, FDA-CVM), EU (EFSA, ECHA), and UK (HSE, APHA) approvals and triage which products would qualify the moment Canada designates each as a trusted jurisdiction. Coordinate with global regulatory teams so the Canadian filing references the foreign decision packet directly.",
        reason:
          "The trusted-jurisdiction route is the second material commercial benefit; readiness is a sequencing advantage when the trusted-jurisdiction list is prescribed.",
      },
      {
        area: "R&D and launch sequencing",
        currentIssue:
          "Existing Canadian launch calendars assume a single, terminal registration date per SKU; provisional authorization changes the gating step and the post-launch obligations.",
        recommendation:
          "Re-baseline launch calendars and stewardship plans to reflect a provisional-then-final cadence. Tie commercial commitments (volume forecasts, distributor agreements, label printing) to the provisional milestone with a hard checkpoint at the final decision date.",
        reason:
          "If commercial commitments outrun the provisional grant and the Minister later refuses or conditions the final, the recall and supply-chain exposure is significant.",
      },
      {
        area: "Veterinary drug pathway via s. 30.06(1)",
        currentIssue:
          "Bayer's animal-health products historically rely on Health Canada's standard veterinary-drug pathway; the expansion of s. 30.06(1) to cover 'a veterinary drug or a class of either of them' is new optionality that is not yet reflected in submission strategy.",
        recommendation:
          "Identify Bayer veterinary products with an existing decision from a designated foreign regulatory authority and prepare submissions that ask the Minister to use the s. 30.06(1) deeming power to import that decision into Canada.",
        reason:
          "Where a foreign decision already exists, the deeming order is the fastest route to market — but the Minister's order is discretionary and class-scoped, so the strategy needs a curated list, not a blanket request.",
      },
      {
        area: "Stewardship and post-market commitments",
        currentIssue:
          "Provisional registrations under each act are tied to prescribed conditions and to a final-decision checkpoint; post-market data-collection obligations are likely to be heavier than under the existing standard pathway.",
        recommendation:
          "Define an internal stewardship template (data collection, adverse-event reporting cadence, real-world evidence) sized for the provisional period so the final-decision dossier is ready before expiry.",
        reason:
          "The Minister can refuse the final or extend the provisional; a strong real-world evidence record materially increases the probability of a clean final approval.",
      },
    ],
    relevantClientText: [
      {
        source: "Operations",
        excerpt:
          "Bayer’s Canadian agricultural operations include the development, testing, and commercialization of seeds and crop protection products, as well as digital and precision agriculture technologies.",
        issue:
          "Every product line listed (seeds, crop protection, biotech traits) sits inside an act that C-273 amends. Provisional authorization and trusted-jurisdiction reliance apply across the whole portfolio.",
      },
      {
        source: "Operations",
        excerpt:
          "Activities involve biotechnology and trait research, seed development and distribution, herbicide and pesticide product management, field trials, agronomic advisory services, and data-driven farming tools.",
        issue:
          "Field trials and trait research feed the registration pipeline; the new provisional-then-final cadence changes how trial timelines must align with submission dates.",
      },
      {
        source: "Industry",
        excerpt:
          "Genetically modified seeds and plant traits; Crop protection products (herbicides, fungicides, insecticides); Agricultural biotechnology and data-driven farming technologies.",
        issue:
          "Crop-protection products fall under the Pest Control Products Act amendments (provisional registration ss. 7.1/7.2, trusted-jurisdiction reliance s. 7.3, regs in s. 67(1)(z.6)–(z.7), coordination arrangements s. 80.1).",
      },
    ],
    lawyerVerificationQuestions: [
      "Confirm which Bayer Canadian SKUs already have qualifying approvals in jurisdictions likely to be designated as 'trusted jurisdictions' (US, EU, UK, AUS, NZ, JPN).",
      "Confirm whether Bayer's existing label and stewardship infrastructure can satisfy 'prescribed conditions' likely to attach to a trusted-jurisdiction route.",
      "Confirm whether s. 30.06(1) deeming orders for veterinary drugs can be requested per-class or only per-product, and the scope of regulator discretion to refuse.",
      "Confirm Bayer's contractual commitments to distributors and customers can be conditioned on the provisional-final cadence (e.g., termination/cure rights if a final decision refuses or attaches new conditions).",
      "Confirm Quebec interaction: are there provincial overlays on pesticide use or seed registration that would survive a federal trusted-jurisdiction route?",
    ],
    emailDraft: {
      subject:
        "Bill C-273 (Facilitating Agricultural Regulatory Modernization Act) — Bayer exposure: high impact, high urgency",
      body: "Hi team,\n\nSummary of the C-273 client-impact analysis for Bayer Inc. (Crop Science):\n\n- Affected: yes (directly — every act under which Crop Science operates is amended)\n- Impact level: high\n- Urgency: high (act now to capture provisional-authorization and trusted-jurisdiction benefits)\n\nKey exposure / opportunity: C-273 amends the Feeds Act, Fertilizers Act, Seeds Act, Pest Control Products Act, and s. 30.06(1) of the Food and Drugs Act (now extended to veterinary drugs). Two structural benefits stand out: (1) a provisional approval/registration valid up to two years (extendable by one) that lets products reach market while the final dossier is under review, and (2) a trusted-jurisdiction reliance route under which products already approved abroad can be manufactured, sold or imported in Canada under prescribed conditions. The downsides are heavier post-market data obligations and a discretionary final-decision step that can refuse, condition, or extend.\n\nRecommended next steps:\n1. Stand up a cross-act provisional-authorization playbook (Feeds ss. 5.21/5.22; Fertilizers ss. 5.21/5.22; Seeds ss. 4.1/4.2; PCPA ss. 7.1/7.2).\n2. Build a portfolio-wide map of existing US/EU/UK approvals and triage which qualify under Feeds s. 3(1.1), Fertilizers s. 3(1.1), Seeds s. 4.3, PCPA s. 7.3.\n3. Re-baseline launch calendars and distributor agreements around a provisional-then-final cadence.\n4. Curate a list of veterinary drugs and classes for s. 30.06(1) deeming-order requests, leveraging existing foreign decisions.\n5. Define a stewardship template sized for the provisional period so the final-decision dossier is ready before expiry.\n\nFlagged for human review: trusted-jurisdiction list, provisional-registration criteria, and prescribed conditions are all deferred to regulations not yet published; coming-into-force is at the Governor in Council's discretion.\n\n— Igenium",
    },
    confidence: 0.86,
    humanReviewRequired: true,
    humanReviewReason:
      "Operative thresholds (trusted-jurisdiction list, provisional-registration criteria, prescribed conditions, coming-into-force date) are deferred to regulations and to the Governor in Council; legal interpretation required to size the benefit and timing per product line.",
  },

  "client-canneberges-bieler|C-273": {
    affected: "yes",
    impactLevel: "high",
    urgency: "high",
    timing:
      "Bill C-273 is at first reading in the House of Commons. Coming-into-force is on a day fixed by order of the Governor in Council. Canneberges Bieler should begin agronomic-protocol scenario planning now: cranberry growers depend on a relatively narrow and slow-moving toolbox of registered pest control products, fertilizers, and seed/cultivar inputs, and the trusted-jurisdiction and provisional-registration routes will materially change which inputs are available, when, and on what terms — across one or more upcoming growing seasons.",
    whyItAffectsClient:
      "Canneberges Bieler is a primary producer in the soft-fruit / horticultural sector and depends directly on inputs regulated by every act C-273 amends. Cranberry production uses pest control products under the Pest Control Products Act (fungicides for fruit-rot complexes, insecticides for cranberry fruitworm and weevil, herbicides for bog weed management); fertilizers and supplements under the Fertilizers Act applied through engineered bog systems; certified seed and cultivar inputs under the Seeds Act; and any feed inputs used in adjacent operations under the Feeds Act. The new trusted-jurisdiction reliance routes (PCPA s. 7.3; Fertilizers s. 3(1.1); Seeds s. 4.3) and the provisional registration regimes (PCPA ss. 7.1/7.2; Fertilizers ss. 5.21/5.22; Seeds ss. 4.1/4.2) mean inputs already registered in trusted jurisdictions (e.g., the US for cranberry-specific products) could become available in Canada faster, and existing registrations could be supplemented by provisional grants for new actives. Net effect: a wider, faster-moving input toolbox, with a corresponding obligation to update agronomic protocols, supplier validation, residue/MRL alignment for downstream processors and cooperatives such as Ocean Spray, and stewardship recordkeeping.",
    affectedClientAreas: [
      "Agronomic protocols (pest control product use)",
      "Input procurement and supplier validation",
      "Fertilizer and supplement programs for engineered bog systems",
      "Seed/cultivar selection",
      "Residue and MRL alignment with downstream processors (e.g., Ocean Spray)",
      "Pesticide application records and stewardship",
      "Sustainability and land-stewardship reporting",
      "Worker training (label compliance, re-entry intervals)",
    ],
    requiredAdaptations: [
      {
        area: "Agronomic protocol refresh",
        currentIssue:
          "Existing crop-protection and fertility programs are anchored to today's set of registered products; they do not include decision rules for evaluating products that come to market under a provisional registration or via trusted-jurisdiction reliance.",
        recommendation:
          "Update the agronomic SOP to cover (i) when a provisionally-registered product may be incorporated into the rotation; (ii) what additional record-keeping is required while a registration is provisional; and (iii) a fallback if the Minister refuses the final registration or attaches new conditions before expiry.",
        reason:
          "Bringing a provisionally-registered product into the bog without a documented protocol creates exposure if the final decision changes the registration or attaches new conditions.",
      },
      {
        area: "Supplier and input validation",
        currentIssue:
          "Procurement validates inputs based on Canadian PMRA / CFIA registration numbers; there is no process for products marketed in Canada under the trusted-jurisdiction reliance route.",
        recommendation:
          "Extend input validation to capture the underlying foreign registration (regulator, registration number, expiry) when a product is sold in Canada under PCPA s. 7.3, Fertilizers Act s. 3(1.1), or Seeds Act s. 4.3, and confirm that any prescribed conditions (e.g., labelling, distribution restrictions) are met.",
        reason:
          "Trusted-jurisdiction products will carry conditions imposed by Canadian regulations rather than by an independent Canadian assessment; the grower bears compliance risk.",
      },
      {
        area: "MRL and residue alignment with processors",
        currentIssue:
          "Cooperative and processor contracts (Ocean Spray and others) require harvested cranberries to meet specified residue and MRL profiles; some buyers require a list of permitted active ingredients narrower than the federal registration list.",
        recommendation:
          "Before adopting any new provisional or trusted-jurisdiction product, confirm in writing with each downstream buyer that the active ingredient and residue profile are accepted. Maintain a per-buyer permitted-input list synchronised with the federal registration status.",
        reason:
          "Federal eligibility under C-273 does not override private contractual or export MRL requirements; a faster Canadian path can outpace the slower buyer-acceptance process.",
      },
      {
        area: "Provisional-product stewardship records",
        currentIssue:
          "Existing pesticide application logs are sized for fully-registered products; provisional registrations are likely to attract heavier post-market data and reporting obligations.",
        recommendation:
          "Add fields to the application log capturing whether a product is provisionally registered, the provisional-grant expiry, the dataset being captured for post-market evidence, and a calendar reminder before expiry.",
        reason:
          "If the Minister extends or refuses the final registration, Canneberges Bieler needs an audit-ready evidence trail of how the product was used during the provisional period.",
      },
      {
        area: "Worker training and re-entry intervals",
        currentIssue:
          "Worker training is built around current label language; provisional and trusted-jurisdiction products may carry different label conventions (e.g., labels written for the foreign regulator's framework).",
        recommendation:
          "Refresh worker training and PPE/re-entry protocols when introducing any provisional or trusted-jurisdiction product; verify the operative label complies with Canadian prescribed conditions before first use.",
        reason:
          "Mis-application risk rises when label conventions differ from the existing baseline; this is also the area most likely to be inspected.",
      },
    ],
    relevantClientText: [
      {
        source: "Operations",
        excerpt:
          "Cultivation of cranberries in engineered bog systems, seasonal harvesting activities such as flooding and berry collection, and post-harvest handling including storage and transport.",
        issue:
          "Bog cultivation depends directly on PCPA-regulated pest control products and Fertilizers-Act-regulated fertility inputs; both are reshaped by C-273.",
      },
      {
        source: "Operations",
        excerpt:
          "Supply chain coordination with processors and distributors, and agronomic practices aimed at improving crop yield, operational efficiency, and environmental sustainability in cranberry production.",
        issue:
          "Processor contracts (Ocean Spray, others) drive permitted-input lists and residue profiles; trusted-jurisdiction and provisional inputs must be cleared with downstream buyers before adoption.",
      },
      {
        source: "Industry",
        excerpt:
          "Specialty crop farming (horticulture); Cranberry cultivation and production; Post-harvest processing and agri-food supply chain integration; Primary agricultural production (soft fruit sector).",
        issue:
          "Specialty crops are particularly affected because the Canadian-specific registration pipeline is small; trusted-jurisdiction reliance materially expands the realistic input set.",
      },
    ],
    lawyerVerificationQuestions: [
      "Confirm which downstream buyers (Ocean Spray and others) accept actives registered in Canada solely on a provisional or trusted-jurisdiction basis, and at what residue thresholds.",
      "Confirm Quebec provincial overlay: are there CRAAQ / MELCCFP rules on pesticide use that would survive a federal trusted-jurisdiction reliance route?",
      "Confirm whether the operative label for a trusted-jurisdiction product satisfies Canadian worker-protection and re-entry-interval requirements without a Canadian re-labelling step.",
      "Confirm whether existing crop insurance and lender covenants restrict the use of provisionally-registered or trusted-jurisdiction inputs.",
      "Confirm record-keeping retention requirements for inputs used during a provisional registration period if the Minister later refuses the final.",
    ],
    emailDraft: {
      subject:
        "Bill C-273 (Facilitating Agricultural Regulatory Modernization Act) — Canneberges Bieler exposure: high impact, high urgency",
      body: "Hi team,\n\nSummary of the C-273 client-impact analysis for Canneberges Bieler Inc.:\n\n- Affected: yes (directly — cranberry production depends on inputs regulated by every act C-273 amends)\n- Impact level: high\n- Urgency: high (decisions are needed before the next growing season once regulations are prescribed)\n\nKey exposure / opportunity: C-273 introduces trusted-jurisdiction reliance and provisional registrations under the Pest Control Products Act, Fertilizers Act, and Seeds Act. For a specialty crop like cranberry — where the Canadian-specific registration pipeline is small and downstream buyers (Ocean Spray and others) drive permitted-input lists — this materially expands the realistic input toolbox while shifting compliance and stewardship obligations onto the grower.\n\nRecommended next steps:\n1. Refresh agronomic SOPs to handle provisional and trusted-jurisdiction products (decision rules, recordkeeping, fallback if final decision changes).\n2. Extend input validation to capture the underlying foreign registration when a product is sold in Canada via PCPA s. 7.3, Fertilizers s. 3(1.1) or Seeds s. 4.3.\n3. Confirm in writing with Ocean Spray and other buyers that any new provisional or trusted-jurisdiction active is accepted and meets residue/MRL profiles.\n4. Add provisional-grant fields to pesticide application logs (expiry, post-market data captured, expiry reminder).\n5. Refresh worker training when introducing inputs whose labels were written for a foreign regulator.\n\nFlagged for human review: trusted-jurisdiction list, provisional-registration criteria, and prescribed conditions are deferred to regulations; Quebec provincial overlay on pesticide use must be confirmed; downstream buyer acceptance is contractual, not federal, and may lag the regulatory change.\n\n— Igenium",
    },
    confidence: 0.84,
    humanReviewRequired: true,
    humanReviewReason:
      "Operative thresholds and the trusted-jurisdiction list are deferred to regulations; Quebec provincial overlay and downstream buyer acceptance must be confirmed independently of the federal change.",
  },
};
