import type {
  BaseLaw,
  Bill,
  Client,
  ClientImpactAnalysis,
  LawVersion,
} from "../../src/types.js";
import { FILES, readAll, writeAll } from "../services/jsonStore.js";

const SAMPLE_BILL_RAW = {
  billNumber: "C-27",
  title: "Digital Charter Implementation Act, 2022",
  status: "Committee (House)",
  session: "44-1",
  latestActivity: "Referred to INDU committee",
  sourceUrl: "https://www.parl.ca/legisinfo/en/bill/44-1/c-27",
  clauses: [
    {
      number: "Cl. 12",
      heading: "Appropriate purposes",
      text: "Subsection 9(1) of the Consumer Privacy Protection Act is replaced by the following: An organization may collect, use or disclose personal information only in a manner and for purposes that a reasonable person would consider appropriate in the circumstances, having regard to (a) the sensitivity of the personal information; (b) whether the purposes represent legitimate business needs of the organization; (c) the effectiveness of the collection, use or disclosure in meeting the organization's legitimate business needs; (d) whether there are less intrusive means of achieving those purposes at a comparable cost and with comparable benefits; and (e) whether the individual's loss of privacy is proportionate to the benefits in light of any measures, technical or otherwise, implemented by the organization to mitigate the impacts of the loss of privacy on the individual.",
    },
    {
      number: "Cl. 15",
      heading: "Valid consent",
      text: "Subsection 15(3) is replaced: The consent of an individual is valid only if it is reasonable to expect that the individual to whom the organization's activities are directed would understand the nature, purpose and consequences of the collection, use or disclosure of the personal information to which they are consenting.",
    },
    {
      number: "Cl. 39",
      heading: "Disclosure for socially beneficial purposes",
      text: "Section 39(1) is enacted: An organization may disclose an individual's de-identified personal information without their knowledge or consent to (a) a government institution; (b) a health care institution, post-secondary educational institution or public library in Canada; or (c) any other prescribed entity, if the disclosure is made for a socially beneficial purpose.",
    },
    {
      number: "Cl. 200",
      heading: "Coming into force",
      text: "This Act comes into force on a day to be fixed by order of the Governor in Council, but not earlier than one year after the day on which it receives royal assent.",
    },
  ],
};

const SAMPLE_BASE_LAW: BaseLaw = {
  id: "cppa-baseline",
  title: "Consumer Privacy Protection Act (proposed baseline)",
  citation: "CPPA, ss. 9, 15, 39",
  text: `Section 9 — Appropriate purposes.
(1) An organization may collect, use or disclose personal information only for purposes that a reasonable person would consider appropriate in the circumstances.

Section 15 — Consent.
(3) Consent of an individual is required for the collection, use or disclosure of personal information, except as otherwise provided.

Section 39 — Disclosure without consent.
(1) An organization may disclose an individual's personal information without their knowledge or consent only in the circumstances expressly set out in this Act.`,
};

const SAMPLE_BILL: Bill = {
  id: "bill-c27-demo",
  billNumber: SAMPLE_BILL_RAW.billNumber,
  title: SAMPLE_BILL_RAW.title,
  status: SAMPLE_BILL_RAW.status,
  legislativeMomentum: "active",
  latestActivity: SAMPLE_BILL_RAW.latestActivity,
  session: SAMPLE_BILL_RAW.session,
  sourceUrl: SAMPLE_BILL_RAW.sourceUrl,
  uploadedAt: new Date().toISOString(),
  rawJson: SAMPLE_BILL_RAW,
  clauses: SAMPLE_BILL_RAW.clauses.map((c, i) => ({
    id: `cl-${i + 1}`,
    number: c.number,
    heading: c.heading,
    text: c.text,
  })),
};

const SAMPLE_LAW_VERSION: LawVersion = {
  id: "lv-c27-cppa-demo",
  baseLawId: SAMPLE_BASE_LAW.id,
  baseLawTitle: SAMPLE_BASE_LAW.title,
  sourceBillId: SAMPLE_BILL.id,
  sourceBillNumber: SAMPLE_BILL.billNumber,
  sourceBillTitle: SAMPLE_BILL.title,
  sourceBillStatus: SAMPLE_BILL.status,
  legislativeMomentum: "active",
  versionStatus: "proposed_future",
  humanApproved: false,
  oldText: SAMPLE_BASE_LAW.text,
  updatedText: `Section 9 — Appropriate purposes.
(1) An organization may collect, use or disclose personal information only in a manner and for purposes that a reasonable person would consider appropriate in the circumstances, having regard to (a) the sensitivity of the personal information; (b) whether the purposes represent legitimate business needs of the organization; (c) the effectiveness of the collection, use or disclosure in meeting the organization's legitimate business needs; (d) whether there are less intrusive means of achieving those purposes at a comparable cost and with comparable benefits; and (e) whether the individual's loss of privacy is proportionate to the benefits.

Section 15 — Valid consent.
(3) The consent of an individual is valid only if it is reasonable to expect that the individual would understand the nature, purpose and consequences of the collection, use or disclosure of the personal information to which they are consenting.

Section 39 — Disclosure for socially beneficial purposes.
(1) An organization may disclose an individual's de-identified personal information without their knowledge or consent to a government institution, a health care institution, a post-secondary educational institution or public library in Canada, or any other prescribed entity, if the disclosure is made for a socially beneficial purpose.`,
  affectedSections: ["s. 9(1)", "s. 15(3)", "s. 39(1)"],
  changeTypes: ["replace", "definition_change", "add", "obligation_change"],
  deltaSummary:
    "C-27 introduces a five-factor reasonable-purposes test, narrows consent to 'valid consent', and adds a socially beneficial disclosure pathway for de-identified personal information.",
  detailedDelta:
    "Section 9(1) is replaced with a factor-based appropriateness test (sensitivity, legitimate business need, effectiveness, less intrusive alternatives, proportionality). Section 15(3) replaces 'consent' with 'valid consent', requiring that the individual could reasonably understand the nature, purpose and consequences. New s. 39(1) creates a permitted disclosure of de-identified personal information to government, health, post-secondary, library, or prescribed entities for socially beneficial purposes.",
  effectiveDate: null,
  comingIntoForceText:
    "On a day fixed by order of the Governor in Council, no earlier than one year after Royal Assent.",
  confidence: 0.72,
  humanReviewRequired: true,
  humanReviewReason:
    "Confidence below 0.75; effective date depends on order in council; coming-into-force language requires lawyer verification.",
  createdAt: new Date().toISOString(),
};

const SAMPLE_CLIENT: Client = {
  id: "client-corebloom",
  name: "Corebloom Health AI Inc.",
  industry: "Health-tech / AI",
  jurisdictions: ["Vancouver, BC", "Canada"],
  description:
    "Clinical AI company processing patient data and de-identified datasets for diagnostic models and academic research partnerships.",
  termsAndConditions:
    "By creating a Corebloom account, the patient grants Corebloom and its affiliates a perpetual, broad licence to use, store and disclose their personal health information, including in de-identified form, for any secondary purpose Corebloom determines, including model training, product improvement, and research collaborations, without further notice.",
  policies:
    "Privacy Policy v3.2: Corebloom may share de-identified patient data with academic partners under data-sharing MOUs. Patients consent to research uses at onboarding. Corebloom does not seek separate consent for downstream secondary uses.",
  operations:
    "AI model training pipeline ingests EHR exports nightly. Three active hospital research MOUs (UBC, McGill, U of T). Onboarding flow: single checkbox for terms + privacy policy. No granular purpose-by-purpose consent.",
  riskTolerance: "medium",
  createdAt: new Date().toISOString(),
};

const SAMPLE_CANNED_IMPACT: Omit<
  ClientImpactAnalysis,
  "id" | "clientId" | "lawVersionId" | "saved" | "createdAt"
> = {
  affected: "yes",
  impactLevel: "high",
  urgency: "high",
  timing:
    "Bill C-27 is at committee stage; if it receives Royal Assent and is brought into force, Corebloom would have approximately one year of transition time. Begin remediation now to be ready by Q3 2027.",
  whyItAffectsClient:
    "Corebloom's onboarding language relies on broad, perpetual consent for secondary use of de-identified patient data, and its academic-research MOUs assume blanket downstream sharing. Bill C-27's proposed five-factor 'appropriate purposes' test, the new 'valid consent' standard, and the prescriptive socially beneficial disclosure pathway each tighten the conditions under which Corebloom may currently operate.",
  affectedClientAreas: [
    "Patient onboarding consent",
    "Privacy policy",
    "Academic data-sharing MOUs",
    "AI model training pipeline",
  ],
  requiredAdaptations: [
    {
      area: "Patient onboarding consent",
      currentIssue:
        "Single broad checkbox grants perpetual licence for any secondary use, without articulating necessity, sensitivity or less intrusive alternatives.",
      recommendation:
        "Re-paper consent into purpose-specific layers (clinical use, model training, research disclosures) with plain-language explanations of nature, purpose and consequences.",
      reason:
        "Required to satisfy proposed 'valid consent' standard in s. 15(3) and the factor-based appropriateness test in s. 9(1).",
    },
    {
      area: "Academic data-sharing MOUs",
      currentIssue:
        "MOUs with UBC, McGill and U of T assume blanket disclosure of de-identified data for any research purpose.",
      recommendation:
        "Annex MOUs to confirm each disclosure fits the socially beneficial purpose pathway in proposed s. 39(1) and document the prescribed-entity status of each partner.",
      reason:
        "Section 39(1) limits without-consent disclosure to specified categories of recipient and to socially beneficial purposes.",
    },
    {
      area: "Internal compliance evidence",
      currentIssue:
        "No internal record of how Corebloom assesses sensitivity, business necessity, or proportionality of each personal-information use.",
      recommendation:
        "Build a five-factor compliance checklist tied to each new product feature; require sign-off before processing.",
      reason:
        "The factor-based test in proposed s. 9(1) requires demonstrable contemporaneous assessment.",
    },
  ],
  relevantClientText: [
    {
      source: "Terms & Conditions",
      excerpt:
        "perpetual, broad licence to use, store and disclose their personal health information, including in de-identified form, for any secondary purpose Corebloom determines",
      issue:
        "Inconsistent with the 'valid consent' standard — patients cannot reasonably understand the nature, purpose and consequences of an open-ended secondary-use grant.",
    },
    {
      source: "Privacy Policy",
      excerpt:
        "Patients consent to research uses at onboarding. Corebloom does not seek separate consent for downstream secondary uses.",
      issue:
        "Likely fails the factor-based appropriateness test; downstream uses are not assessed for proportionality or less intrusive alternatives.",
    },
  ],
  lawyerVerificationQuestions: [
    "Confirm whether each named research partner qualifies as a 'prescribed entity' under proposed s. 39(1) regulations.",
    "Confirm whether de-identification at Corebloom meets the threshold contemplated by C-27 (vs. CPPA's anonymization standard).",
    "Confirm the implementation lead time required given the order-in-council coming-into-force language.",
  ],
  emailDraft: {
    subject:
      "Bill C-27 — Corebloom Health AI exposure: consent + research disclosures",
    body: "Hi team,\n\nSummary of the C-27 client-impact analysis for Corebloom Health AI:\n\n- Affected: yes\n- Impact level: high\n- Urgency: high (begin remediation now; ~1 year transition after Royal Assent)\n\nKey exposure: Corebloom's perpetual broad-consent T&Cs and blanket research MOUs are unlikely to satisfy the proposed s. 15(3) 'valid consent' standard or the s. 9(1) factor-based appropriateness test, and the s. 39(1) socially-beneficial-disclosure pathway is narrower than current MOU practice.\n\nRecommended next steps:\n1. Re-paper patient onboarding consent into purpose-specific layers.\n2. Annex existing UBC / McGill / U of T MOUs to confirm prescribed-entity status and socially beneficial purpose framing.\n3. Stand up an internal five-factor compliance checklist for new product features.\n\nFlagged for human review: coming-into-force timing depends on order in council; prescribed-entity definitions await regulations.\n\n— Injenium",
  },
  confidence: 0.81,
  humanReviewRequired: true,
  humanReviewReason:
    "Recommendation depends on legal interpretation of 'prescribed entity' and the order-in-council coming-into-force timing.",
};

export async function seedDemo() {
  const bills = await readAll(FILES.bills);
  if (bills.length === 0) await writeAll(FILES.bills, [SAMPLE_BILL]);

  const baseLaws = await readAll(FILES.baseLaws);
  if (baseLaws.length === 0) await writeAll(FILES.baseLaws, [SAMPLE_BASE_LAW]);

  const lvs = await readAll(FILES.lawVersions);
  if (lvs.length === 0) await writeAll(FILES.lawVersions, [SAMPLE_LAW_VERSION]);

  const clients = await readAll(FILES.clients);
  if (clients.length === 0) await writeAll(FILES.clients, [SAMPLE_CLIENT]);

  // Impacts left empty so the demo flow exercises analyze.
}

export const DEMO = {
  bill: SAMPLE_BILL,
  baseLaw: SAMPLE_BASE_LAW,
  lawVersion: SAMPLE_LAW_VERSION,
  client: SAMPLE_CLIENT,
  cannedImpact: SAMPLE_CANNED_IMPACT,
};
