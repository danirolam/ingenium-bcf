import type {
  AmendmentExtraction,
  ClientImpactAnalysis,
} from "../../src/types.js";

export function flagAmendmentReview(a: AmendmentExtraction): {
  required: boolean;
  reason: string | null;
} {
  const reasons: string[] = [];
  if (a.confidence < 0.75) reasons.push("Confidence below 0.75");
  if (!a.affectedSections || a.affectedSections.length === 0)
    reasons.push("No affected section identified");
  if (!a.effectiveDate && !a.comingIntoForceText)
    reasons.push("Effective date missing or ambiguous");
  if (!a.operationTypes || a.operationTypes.length === 0)
    reasons.push("Amendment operation unclear");
  if ((a.newText ?? "").includes("[…]") || (a.newText ?? "").includes("???"))
    reasons.push("Updated text contains unresolved placeholders");
  if (a.affectedSections && a.affectedSections.length > 1 && a.confidence < 0.85)
    reasons.push("Multiple possible affected sections without clear best match");

  return reasons.length > 0
    ? { required: true, reason: reasons.join("; ") }
    : { required: false, reason: null };
}

export function flagImpactReview(c: ClientImpactAnalysis): {
  required: boolean;
  reason: string | null;
} {
  const reasons: string[] = [];
  if (c.affected === "unclear") reasons.push("Affected status is unclear");
  if (c.confidence < 0.75) reasons.push("Confidence below 0.75");
  if (c.relevantClientText.some((r) => /conflict|inconsist/i.test(r.issue)))
    reasons.push("Relevant client text conflicts with recommendation");
  if (
    c.affected === "yes" &&
    !/\d{4}|royal\s*assent|in\s*force/i.test(c.timing)
  )
    reasons.push("Effective date unclear and client appears affected");
  if (c.requiredAdaptations.some((r) => /interpret|judicial/i.test(r.reason)))
    reasons.push("Recommended action involves legal interpretation");

  return reasons.length > 0
    ? { required: true, reason: reasons.join("; ") }
    : { required: false, reason: null };
}
