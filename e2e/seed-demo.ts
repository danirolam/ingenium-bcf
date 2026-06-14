/**
 * DEMO fixture seeder — makes Bill C-265 (45-1) scan-ready and adds the two
 * demo clients it affects. Run with:  npm run seed:demo   (inside e2e/)
 *
 * What it writes (idempotent — replaces its own records on re-run):
 *   server/data/provisionDeltas.json  ← the approved delta for bill-13953578,
 *     authored to mirror what stages 1–2 produce. Every anchor (s. 2.4,
 *     s. 21.96, s. 30(1), s. 30) is a REAL provision of the ingested Food and
 *     Drugs Act, and every operation paraphrases C-265's real clauses.
 *   server/data/approvals.json        ← all six operations approved.
 *   server/data/clients.json          ← upserts Aurelia Therapeutics (high
 *     exposure: import/sale/licensing) and Lakehead Regional Health Network
 *     (medium exposure: clinical governance/reporting).
 *
 * Unlike the e2e fixtures (seed.ts), the delta and approval records carry
 * __demoSeed (not __e2eSeed) and the clients survive by id/name rules, so the
 * Playwright teardown leaves all of it alone. The two runtime files are
 * gitignored — re-run this script after any data reset.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, "..", "server", "data");
const DELTAS_FILE = path.join(DATA, "provisionDeltas.json");
const APPROVALS_FILE = path.join(DATA, "approvals.json");
const CLIENTS_FILE = path.join(DATA, "clients.json");

const BILL_ID = "bill-13953578"; // C-265 (45-1) — An Act to amend the Food and Drugs Act
const SLUG = "food-and-drugs-act";

// ── helpers ──
// Missing file = empty store; anything else (corrupt JSON, permissions) must
// THROW, not silently become [] — main() rewrites these files, and swallowing
// a read error here would replace real stage-1/2 cached output with only the
// demo record.
async function readArray<T>(file: string): Promise<T[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}
// Atomic write (temp + rename), mirroring jsonStore — a crash mid-write must
// never leave a half-written store behind.
async function writeArray(file: string, items: unknown[]): Promise<void> {
  const tmp = `${file}.${process.pid}.demo.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

// ── the approved delta (mirrors stage-2 output; statutory text from C-265) ──
const prov = (
  id: string,
  label: string,
  marginalNote: string,
  text: string,
) => ({ id, label, kind: "section", marginalNote, text });

const ROWS = [
  // 0 — clause 1
  {
    status: "added",
    label: "2.5",
    after: prov(
      "fda-2.5",
      "2.5",
      "Clinical judgment",
      "For greater certainty, nothing in this Act or the regulations is to be interpreted as preventing, in an emergency situation, a person who is entitled to practise medicine under the laws of a province from temporarily administering to a person under their care any therapeutic product that was lawfully manufactured in or imported into Canada and that is available to them if doing so is the best available treatment based on their clinical judgment.",
    ),
  },
  // 1–2 — clause 2 (Part I.1, interpretation + the List)
  {
    status: "added",
    label: "21.9701",
    after: prov(
      "fda-21.9701",
      "21.9701",
      "Definitions",
      "In this Part, establishment licence means a licence issued under section C.01A.008 of the Food and Drug Regulations or under section 46 of the Medical Devices Regulations. List of Therapeutic Products Pre-approved for Special Access means the list established under subsection 21.9702(1). non-marketed, in respect of a therapeutic product, means that it is not the subject of a therapeutic product authorization or it is no longer marketed in Canada. practitioner means a person who (a) is entitled under the laws of a province to treat patients with a therapeutic product; and (b) is practising their profession in that province. site licence means a licence issued under section 29 of the Natural Health Products Regulations.",
    ),
  },
  {
    status: "added",
    label: "21.9702",
    after: prov(
      "fda-21.9702",
      "21.9702",
      "Establishment of list",
      "(1) The Minister shall establish and maintain a list of pre-approved non-marketed therapeutic products or classes of such products for use in the treatment or prevention of the progression of serious or life-threatening conditions, including rare diseases, and for use where a comparable therapeutic product is not available on the Canadian market. (3) The Minister shall publish the List of Therapeutic Products Pre-approved for Special Access and any changes to it on the website of the Department of Health. (4) The list must set out the name of the therapeutic product, the uses for which it is authorized and any limitations on the practitioners who may use it or on the settings in which it may be used.",
    ),
  },
  // 3–5 — clause 2 (requests, sale, import)
  {
    status: "added",
    label: "21.9706",
    after: prov(
      "fda-21.9706",
      "21.9706",
      "Practitioner request",
      "(1) Subject to any limitations on practitioners set out in the List of Therapeutic Products Pre-approved for Special Access, a practitioner may make a request, in the form specified by the Minister, to a manufacturer of a therapeutic product on that list to purchase a specified quantity of the therapeutic product for use in the treatment of a person under the care of the practitioner, if that use corresponds to a use included in the list. (3) The practitioner is not required to know the identity of the person under their care at the time the request is made.",
    ),
  },
  {
    status: "added",
    label: "21.9707",
    after: prov(
      "fda-21.9707",
      "21.9707",
      "Sale by manufacturer",
      "(1) A manufacturer may sell a therapeutic product on the List of Therapeutic Products Pre-approved for Special Access (a) in accordance with a request made under subsection 21.9706(1); or (b) in anticipation of such a request, subject to any limitations or conditions specified by the Minister. (2) A sale made in accordance with subsection (1) is exempt from the provisions of this Act and any regulations made under it other than the provisions of this Part and any regulations made for the purposes of this Part.",
    ),
  },
  {
    status: "added",
    label: "21.9708",
    after: prov(
      "fda-21.9708",
      "21.9708",
      "Import",
      "(1) The holder of an establishment licence or a site licence that authorizes the importation of a therapeutic product in the same category as the one to be imported may import a therapeutic product on the List of Therapeutic Products Pre-approved for Special Access (a) in accordance with a request made under subsection 21.9706(1); or (b) in anticipation of such a request, subject to any limitations or conditions specified by the Minister. (3) The Minister may, by order, specify provisions of the regulations that apply to such importation for the purposes of storage, transportation, quality control, tracking and record keeping.",
    ),
  },
  // 6–7 — clause 2 (notices + anti-circumvention)
  {
    status: "added",
    label: "21.971",
    after: prov(
      "fda-21.971",
      "21.971",
      "Notice to Minister by manufacturer — sale",
      "(1) A manufacturer who sells a therapeutic product under subsection 21.9707(1) shall submit notice of the sale to the Minister, in the manner and form specified by the Minister, within 90 days after the day of the sale. (2) The notice must include (a) the name of the practitioner who requested the therapeutic product; (b) the name and the civic address of the person to whom the therapeutic product was shipped; (c) the name of the therapeutic product and its intended use; and (d) the quantity of the therapeutic product provided.",
    ),
  },
  {
    status: "added",
    label: "21.9712",
    after: prov(
      "fda-21.9712",
      "21.9712",
      "Reasons for not seeking regulatory approval",
      "(1) If the Minister believes on reasonable grounds that a manufacturer is using the List of Therapeutic Products Pre-approved for Special Access to circumvent the regulatory process for approval of a therapeutic product, the Minister may require the manufacturer to give reasons for not submitting the therapeutic product to that process. (2) If the Minister is of the opinion that the reasons are not sufficient, the Minister may maintain the product on the list until approval is obtained or remove it from the list.",
    ),
  },
  // 8 — clause 3 (amend s. 30(1) regulation-making powers) — REAL before text
  {
    status: "changed",
    label: "30(1)",
    before: prov(
      "fda-30-1",
      "30(1)",
      "Regulations",
      "The Governor in Council may make regulations for carrying the purposes and provisions of this Act into effect, and, in particular, but without restricting the generality of the foregoing, may make regulations … (j) exempting, with or without conditions, any food, drug, cosmetic, device, person or activity from all or any of the provisions of this Act or the regulations;",
    ),
    after: prov(
      "fda-30-1",
      "30(1)",
      "Regulations",
      "The Governor in Council may make regulations for carrying the purposes and provisions of this Act into effect, and, in particular, but without restricting the generality of the foregoing, may make regulations … (j) exempting, with or without conditions, any food, drug, cosmetic, device, person or activity from all or any of the provisions of this Act or the regulations; (j.01) respecting the establishment, maintenance and publication of the List of Therapeutic Products Pre-approved for Special Access referred to in Part I.1 and any additional criteria for addition or removal of a therapeutic product to or from the list; (j.02) respecting the creation and maintenance of an electronic information exchange to facilitate requests and notifications required under Part I.1; … (o.1) respecting a process to request the Minister to reconsider the refusal to issue a letter of authorization under subsection C.08.010(1) of the Food and Drug Regulations;",
    ),
  },
  // 9–10 — clause 4 (Emergency Access to New Drugs)
  {
    status: "added",
    label: "30.002",
    after: prov(
      "fda-30.002",
      "30.002",
      "Criteria for issuing letter of authorization",
      "In determining whether to issue a letter of authorization, the Minister shall (a) weigh the benefits of the new drug against its risks to the person being treated, while considering the risk to the person should the use of the new drug not be authorized; and (b) consider all available medical evidence in respect of treatment with the new drug, including evidence derived from routine clinical practice, controlled clinical trials, observational studies and clinical data recognized by a foreign regulatory authority.",
    ),
  },
  {
    status: "added",
    label: "30.007",
    after: prov(
      "fda-30.007",
      "30.007",
      "Emergency clinical judgment",
      "(1) In an emergency situation, a practitioner may, without a letter of authorization, temporarily administer to a person under their care any new drug that was lawfully manufactured in or imported into Canada and that is available to them if doing so is the best available treatment based on their clinical judgment. (2) A practitioner who administers a new drug under subsection (1) shall submit notice of that fact to the Minister, in the manner and form specified by the Minister. (3) Nothing in this section authorizes the continued use of a new drug without a letter of authorization.",
    ),
  },
];

const op = (
  i: number,
  clause: string,
  kind: "add" | "amend",
  anchor: string,
  marginalNote: string,
  instruction: string,
  newText: string | null,
  rows: number[],
) => ({
  key: `${SLUG}#${i}`,
  clause,
  op: kind,
  anchor,
  position: kind === "add" ? "after" : null,
  count: rows.length,
  newLabel: null,
  newMarginalNote: marginalNote,
  newText,
  note: null,
  anchorFound: true,
  resolution: "structured",
  instruction,
  producedRowIndices: rows,
  contextRowIndices: rows,
});

const OPERATIONS = [
  op(
    0,
    "1",
    "add",
    "2.4",
    "Clinical judgment",
    "The Food and Drugs Act is amended by adding the following after section 2.4: Clinical judgment — 2.5 For greater certainty, nothing in this Act or the regulations prevents a physician, in an emergency, from temporarily administering an available, lawfully manufactured or imported therapeutic product on the basis of their clinical judgment.",
    ROWS[0].after!.text,
    [0],
  ),
  op(
    1,
    "2",
    "add",
    "21.96",
    "Part I.1 — List of Therapeutic Products Pre-approved for Special Access",
    "The Act is amended by adding, after section 21.96, Part I.1 (interpretation; establishment, publication and contents of the List of Therapeutic Products Pre-approved for Special Access; expert advisory committee; submissions by practitioners, pharmacists, hospitals and medical non-profits; annual report).",
    ROWS[2].after!.text,
    [1, 2],
  ),
  op(
    2,
    "2",
    "add",
    "21.96",
    "Requests, sale and import under the List",
    "Part I.1 (continued): a practitioner may request a listed product directly from its manufacturer (patient identity not required at request time); the manufacturer may sell — and an establishment- or site-licence holder may import — a listed product in accordance with, or in anticipation of, such a request, exempt from the rest of the Act other than this Part.",
    ROWS[4].after!.text,
    [3, 4, 5],
  ),
  op(
    3,
    "2",
    "add",
    "21.96",
    "Notices, reports and anti-circumvention",
    "Part I.1 (continued): 90-day notices to the Minister for every sale (naming the practitioner, ship-to address, product, intended use and quantity) and for every import (with the information the Minister specifies); 90-day reports by requesting practitioners; and Ministerial power to demand a manufacturer's reasons for not seeking full regulatory approval, with removal from the list as the sanction.",
    ROWS[6].after!.text,
    [6, 7],
  ),
  op(
    4,
    "3",
    "amend",
    "30(1)",
    "Regulations",
    "Subsection 30(1) of the Act is amended by adding, after paragraph (j), (j.01) respecting the establishment, maintenance and publication of the List of Therapeutic Products Pre-approved for Special Access and criteria for addition or removal, and (j.02) respecting an electronic information exchange for the requests and notifications required under Part I.1; and by adding, after paragraph (o), (o.1) respecting a process to request reconsideration of a refusal to issue a letter of authorization under subsection C.08.010(1) of the Food and Drug Regulations.",
    "(j.01) respecting the establishment, maintenance and publication of the List of Therapeutic Products Pre-approved for Special Access referred to in Part I.1 and any additional criteria for addition or removal of a therapeutic product to or from the list; (j.02) respecting the creation and maintenance of an electronic information exchange to facilitate requests and notifications required under Part I.1;",
    [8],
  ),
  op(
    5,
    "4",
    "add",
    "30",
    "Emergency Access to New Drugs",
    "The Act is amended by adding, after section 30, sections 30.001 to 30.008 (Emergency Access to New Drugs): letters of authorization with published issuance guidelines; a presumption in favour of the practitioner's clinical judgment where information is insufficient; written reasons for any refusal; a departmental emergency line the Minister must make every effort to keep available at all times; emergency administration without prior authorization (with notice to the Minister); and an annual operational review.",
    ROWS[9].after!.text,
    [9, 10],
  ),
];

const DELTA_RECORD = {
  id: BILL_ID,
  __demoSeed: true,
  deltas: [
    {
      slug: SLUG,
      title: "Food and Drugs Act",
      citation: "R.S.C., 1985, c. F-27",
      summary: { added: 10, changed: 1, repealed: 0, unchanged: 0 },
      operations: OPERATIONS,
      rows: ROWS,
      source: "bill-xml",
      incomplete: false,
    },
  ],
  errors: [],
  createdAt: "2026-06-11T14:05:00.000Z",
};

const APPROVAL_RECORD = {
  id: BILL_ID,
  __demoSeed: true,
  keys: OPERATIONS.map((o) => o.key),
};

// ── the two demo clients (upserted; existing trio untouched) ──
const CLIENTS = [
  {
    id: "client-aurelia-thx",
    name: "Aurelia Therapeutics Inc.",
    industry: "Specialty pharmaceutical import & distribution",
    jurisdictions: ["Toronto, ON", "Canada"],
    description:
      "Importer-distributor of non-marketed specialty therapeutics (oncology, rare disease) supplied to roughly forty hospital pharmacy accounts across Canada, exclusively through Health Canada's Special Access Programme (SAP). Holds a Health Canada establishment licence covering import, storage and distribution of drugs in dosage form.",
    termsAndConditions:
      "Hospital Supply Terms (v4.2, in force) — 1. Authorization-gated supply: Aurelia will accept a purchase order for a non-marketed product only upon receipt of a Special Access Programme authorization letter issued by Health Canada that names the requesting practitioner and the individual patient. 2. No anticipatory supply: Aurelia does not sell, ship, reserve or hold inventory of any non-marketed product in anticipation of an authorization; each shipment corresponds to one patient-named authorization. 3. Import on authorization: import of the authorized quantity is initiated only after the authorization letter is received, and customs entries reference the authorization number. 4. Records: Aurelia maintains shipment records keyed to the patient-named authorization number and retains them for 5 years. 5. Returns of unused special-access stock are mandatory on treatment discontinuation.",
    policies:
      "SAP Request Handling SOP: completed practitioner SAP forms are processed within 48 hours; files are indexed by patient identity and authorization number. Inventory Policy: zero on-hand inventory of non-marketed products (no stocking ahead of a named authorization). Pharmacovigilance Policy: adverse drug reactions reported to the manufacturer and Health Canada within 15 days. Regulatory Pathway Policy: any product distributed under special access for more than 24 consecutive months without a New Drug Submission being filed triggers executive review to document why full market authorization is not being sought.",
    operations:
      "Operates a bonded GMP warehouse in Mississauga; customs broker files per-shipment import entries only after an authorization letter is on file. Intake desk receives SAP authorization letters by secure fax and email during business hours. Order-management system requires a patient name and SAP authorization number to open a shipment record. Quarterly compliance reviews reconcile every shipment against its authorization letter. No notice of individual sales is currently submitted to Health Canada beyond the SAP paperwork itself.",
    riskTolerance: "low",
    createdAt: "2026-06-11T14:05:00.000Z",
  },
  {
    id: "client-lakehead-health",
    name: "Lakehead Regional Health Network",
    industry: "Hospital network / acute & cancer care",
    jurisdictions: ["Thunder Bay, ON", "Canada"],
    description:
      "Three-hospital regional network serving Northwestern Ontario, including a regional cancer centre and the area's only Level III emergency department. Central pharmacy manages all drug procurement; a Pharmacy & Therapeutics (P&T) committee governs the formulary and all non-formulary or emergency drug use.",
    termsAndConditions:
      "Medical Staff Rules and Supplier Purchasing Terms (extracts) — R7.3 Emergency use of unapproved drugs: a physician may administer a drug that lacks Canadian market authorization only after a Special Access Programme authorization letter for the named patient is on file with Pharmacy, except under the Crash Protocol (R7.4), which requires contemporaneous sign-off by two attending physicians and next-business-day notification to the P&T chair. P12.1 Procurement: Pharmacy may purchase non-marketed drugs only against a patient-specific authorization; standing inventory of non-marketed drugs is prohibited. S4.2 Suppliers must warrant that every non-marketed product shipped is matched to a Health Canada authorization document.",
    policies:
      "Emergency Drug Access Policy: SAP requests are prepared by oncology pharmacists and submitted by the central Drug Access Desk, which operates Monday to Friday, 08:00–16:00; after-hours requests wait for the next business day unless the Crash Protocol applies. Documentation Policy: the administering physician files an internal outcome report to the P&T committee within 30 days of any special-access administration; no external report is filed unless requested by Health Canada. Formulary Policy: only products with Canadian market authorization are stocked; special-access drugs are dispensed one patient at a time.",
    operations:
      "Central pharmacy in Thunder Bay distributes to the two community sites twice weekly. The Drug Access Desk (2 FTE pharmacists) handles roughly 150 SAP requests a year, with a median 4-business-day turnaround from physician request to drug-in-hand. The emergency department maintains the Crash Protocol kit but holds no non-marketed drugs. Physician onboarding includes annual training on R7.3/R7.4 and SAP paperwork.",
    riskTolerance: "medium",
    createdAt: "2026-06-11T14:05:00.000Z",
  },
];

async function main(): Promise<void> {
  // provisionDeltas.json — replace our record, keep everything else.
  const deltas = await readArray<{ id: string }>(DELTAS_FILE);
  await writeArray(DELTAS_FILE, [
    ...deltas.filter((r) => r.id !== BILL_ID),
    DELTA_RECORD,
  ]);

  // approvals.json — replace our record, keep everything else.
  const approvals = await readArray<{ id: string }>(APPROVALS_FILE);
  await writeArray(APPROVALS_FILE, [
    ...approvals.filter((r) => r.id !== BILL_ID),
    APPROVAL_RECORD,
  ]);

  // clients.json — upsert the two demo clients by id.
  const clients = await readArray<{ id: string }>(CLIENTS_FILE);
  const ids = new Set(CLIENTS.map((c) => c.id));
  await writeArray(CLIENTS_FILE, [
    ...clients.filter((c) => !ids.has(c.id)),
    ...CLIENTS,
  ]);

  console.log(
    `[demo seed] C-265 (${BILL_ID}) is scan-ready: ${OPERATIONS.length} approved ops ` +
      `across the Food and Drugs Act; clients upserted: ${CLIENTS.map((c) => c.name).join(", ")}.`,
  );
}

main().catch((err) => {
  console.error("[demo seed] failed:", err);
  process.exitCode = 1;
});
