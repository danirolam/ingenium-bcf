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
  lawVersionId: string;

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
