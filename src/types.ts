import type {
  BillStageEntry,
  BillDivision,
  LegislativeSponsor,
} from "./lib/legislativePath";

export type {
  BillStageEntry,
  BillDivision,
  LegislativeSponsor,
  StageState,
  StageChamber,
} from "./lib/legislativePath";

export type LegislativeMomentum =
  | "early"
  | "active"
  | "advanced"
  | "passed"
  | "in_force";

export type VersionStatus =
  | "current"
  | "proposed_future"
  | "passed_pending_review"
  | "in_force";

export interface BillClause {
  id: string;
  number?: string;
  heading?: string;
  text: string;
  targetActs?: string[];
}

export interface Bill {
  id: string;
  billNumber: string;
  title: string;
  status: string;
  legislativeMomentum: LegislativeMomentum;
  latestActivity?: string;
  session?: string;
  sourceUrl?: string;
  uploadedAt: string;
  rawJson: unknown;
  clauses: BillClause[];
  practiceAreas: string[];

  // Legislative profile (derived from the LEGISinfo detail record).
  shortTitle?: string;
  summary?: string;
  billType?: string;
  billForm?: string;
  isGovernmentBill?: boolean;
  isProForma?: boolean;
  originatingChamber?: string;
  sponsor?: LegislativeSponsor;
  statuteCitation?: string;
  introducedDate?: string;
  royalAssentDate?: string;
  latestEvent?: { name?: string; date?: string; chamber?: string };
  categories?: string[];

  // Provenance of the full text baked into `clauses` (latest published version).
  textStage?: string;
  textSourceUrl?: string;

  // The path a bill travels — the centrepiece of the bill detail view.
  legislativePath?: BillStageEntry[];
  divisions?: BillDivision[];
}

export interface AmendmentExtraction {
  affectedAct: string;
  affectedSections: string[];
  operationTypes: Array<
    | "add"
    | "replace"
    | "repeal"
    | "renumber"
    | "definition_change"
    | "deadline_change"
    | "penalty_change"
    | "obligation_change"
  >;
  oldText: string | null;
  newText: string | null;
  newObligations: string[];
  removedObligations: string[];
  changedDeadlines: string[];
  changedPenalties: string[];
  effectiveDate: string | null;
  comingIntoForceText: string | null;
  deltaSummary: string;
  detailedDelta: string;
  ambiguityNotes: string[];
  confidence: number;
  humanReviewRequired: boolean;
  humanReviewReason: string | null;
}

export interface LawVersion {
  id: string;
  baseLawId: string;
  baseLawTitle: string;

  sourceBillId: string;
  sourceBillNumber: string;
  sourceBillTitle: string;
  sourceBillStatus: string;
  legislativeMomentum: LegislativeMomentum;

  versionStatus: VersionStatus;
  humanApproved: boolean;

  oldText: string;
  updatedText: string;

  affectedSections: string[];
  changeTypes: string[];

  deltaSummary: string;
  detailedDelta: string;

  effectiveDate: string | null;
  comingIntoForceText: string | null;

  confidence: number;
  humanReviewRequired: boolean;
  humanReviewReason: string | null;

  createdAt: string;
}

export interface Client {
  id: string;
  name: string;
  industry: string;
  jurisdictions: string[];
  description: string;
  termsAndConditions?: string;
  policies?: string;
  operations?: string;
  riskTolerance?: "low" | "medium" | "high";
  createdAt: string;
}

export interface ClientImpactAnalysis {
  id: string;
  clientId: string;
  billId: string;

  affected: "yes" | "no" | "unclear";
  impactLevel: "low" | "medium" | "high" | "critical";
  urgency: "low" | "medium" | "high" | "immediate";

  timing: string;
  whyItAffectsClient: string;

  affectedClientAreas: string[];

  requiredAdaptations: {
    area: string;
    currentIssue: string;
    recommendation: string;
    reason: string;
  }[];

  relevantClientText: {
    source: string;
    excerpt: string;
    issue: string;
  }[];

  lawyerVerificationQuestions: string[];

  emailDraft: {
    subject: string;
    body: string;
  };

  confidence: number;
  humanReviewRequired: boolean;
  humanReviewReason: string | null;

  saved: boolean;
  createdAt: string;
}

export interface BaseLaw {
  id: string;
  title: string;
  citation: string;
  text: string;
}

// ── Provision-level delta (the grounded bill→Act diff) ──
export interface ActProvision {
  id: string;
  label: string;
  kind: string;
  heading?: string | null;
  marginalNote?: string | null;
  text: string;
  /** French text/marginal note (v2 bilingual ingest), for the EN/FR toggle. */
  textFr?: string;
  marginalNoteFr?: string | null;
  /** Structured hierarchy path (section → subsection → paragraph → …). */
  path?: { kind: string; label: string }[];
}

export interface ProvisionDiffRow {
  status: "added" | "changed" | "repealed" | "unchanged";
  label: string;
  before?: ActProvision;
  after?: ActProvision;
}

export interface BillAmendmentOp {
  /** Stable approval identity, "<actSlug>#<opIndex>" — matches the approvals API. */
  key: string;
  clause?: string;
  op: "add" | "replace" | "repeal" | "amend";
  /** Structured address of the target — the source of truth for location. For an
   *  add it is the new provision's full path (incl. its bill-given leaf label). */
  ancestors: { kind: string; label: string }[];
  /** Composed display label derived from `ancestors` (e.g. "30(1)(j.01)"). */
  anchor: string | null;
  position?: string | null;
  /** Number of provisions inserted/replaced. */
  count?: number;
  newLabel?: string | null;
  newMarginalNote?: string | null;
  newText?: string | null;
  note?: string | null;
  /** The target resolved against the real Act tree. */
  anchorFound: boolean;
  /** The AI read the resolved provision back and confirmed it matches. */
  confirmed: boolean;
  /** How this op was resolved. "ai" = AI-located + deterministically applied. */
  resolution?: "structured" | "ai";
  /** Full instruction text — what the bill says. */
  instruction: string;
  /** Indices into `ProvisionDelta.rows` of the provisions this op produced. */
  producedRowIndices: number[];
  /** Indices into `ProvisionDelta.rows` for the ±5 document-order context window. */
  contextRowIndices: number[];
}

/** An amendment the locator could not place — surfaced subtly, never dropped. */
export interface AmendmentFailure {
  clause: string;
  actSlug: string | null;
  instruction: string;
  reason: string;
}

export interface ProvisionDelta {
  slug: string;
  title: string;
  citation: string;
  summary: { added: number; changed: number; repealed: number; unchanged: number };
  operations: BillAmendmentOp[];
  rows: ProvisionDiffRow[];
  /** Full Act text before/after the bill — the two sides of the diff. */
  oldText?: string;
  newText?: string;
  /** How the delta was produced. "ai-located" = AI ancestor-path locating +
   *  deterministic apply (the current pipeline). */
  source?: "bill-xml" | "ai-assisted" | "ai" | "ai-located";
  /** True when an AI call was cut short (rate limit / failure) so this Act's
   *  changes may be partial. */
  incomplete?: boolean;
  /** The ingested Act text predates the current format (not yet re-ingested to
   *  bilingual + structured schedules) — shown as a temporary warning in the UI. */
  outdated?: boolean;
}
