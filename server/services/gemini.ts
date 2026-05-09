import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  AmendmentExtraction,
  BaseLaw,
  Bill,
  Client,
  ClientImpactAnalysis,
  LawVersion,
} from "../../src/types.js";

const MODEL = "gemini-2.5-flash";

function getModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const genAI = new GoogleGenerativeAI(key);
    return genAI.getGenerativeModel({
      model: MODEL,
      generationConfig: { responseMimeType: "application/json" },
    });
  } catch {
    return null;
  }
}

async function callJson<T>(prompt: string): Promise<T | null> {
  const model = getModel();
  if (!model) return null;
  try {
    const r = await model.generateContent(prompt);
    const text = r.response.text();
    return JSON.parse(text) as T;
  } catch (err: any) {
    console.log(`[gemini] failed: ${err?.message ?? err}`);
    return null;
  }
}

export async function extractAmendmentsFromBill(
  bill: Bill,
  baseLaw: BaseLaw,
): Promise<AmendmentExtraction | null> {
  const clauseText = bill.clauses
    .map((c) => `${c.number ?? ""} ${c.heading ?? ""}\n${c.text}`)
    .join("\n\n");

  const prompt = `You are a Canadian legal analyst. Read the bill and extract a single structured amendment record describing how this bill modifies the base law.

Return STRICT JSON with these exact keys (no prose, no markdown):
{
  "affectedAct": string,
  "affectedSections": string[],
  "operationTypes": ("add"|"replace"|"repeal"|"renumber"|"definition_change"|"deadline_change"|"penalty_change"|"obligation_change")[],
  "oldText": string|null,
  "newText": string|null,
  "newObligations": string[],
  "removedObligations": string[],
  "changedDeadlines": string[],
  "changedPenalties": string[],
  "effectiveDate": string|null,
  "comingIntoForceText": string|null,
  "deltaSummary": string,
  "detailedDelta": string,
  "ambiguityNotes": string[],
  "confidence": number,
  "humanReviewRequired": boolean,
  "humanReviewReason": string|null
}

BILL:
${bill.billNumber} — ${bill.title}
Status: ${bill.status}

Clauses:
${clauseText}

BASE LAW (${baseLaw.title} — ${baseLaw.citation}):
${baseLaw.text}
`;

  return callJson<AmendmentExtraction>(prompt);
}

export async function generateUpdatedLawText(
  baseLaw: BaseLaw,
  amendments: AmendmentExtraction,
): Promise<string | null> {
  const prompt = `You are drafting an updated version of a statute by applying the following amendment. Return STRICT JSON: {"updatedText": string}.

BASE LAW (${baseLaw.title}):
${baseLaw.text}

AMENDMENT:
${JSON.stringify(amendments, null, 2)}

Apply the amendment to the base law. Preserve unchanged sentences verbatim. Output the full updated text in the "updatedText" field. Do not include explanations.`;

  const r = await callJson<{ updatedText: string }>(prompt);
  return r?.updatedText ?? null;
}

export async function analyzeClientImpact(args: {
  lawVersion: LawVersion;
  client: Client;
}): Promise<ClientImpactAnalysis | null> {
  const { lawVersion, client } = args;
  const prompt = `You are a Canadian legal compliance analyst. Determine how the following law change affects this specific client. Return STRICT JSON with exactly these keys:

{
  "affected": "yes"|"no"|"unclear",
  "impactLevel": "low"|"medium"|"high"|"critical",
  "urgency": "low"|"medium"|"high"|"immediate",
  "timing": string,
  "whyItAffectsClient": string,
  "affectedClientAreas": string[],
  "requiredAdaptations": [{"area": string, "currentIssue": string, "recommendation": string, "reason": string}],
  "relevantClientText": [{"source": string, "excerpt": string, "issue": string}],
  "lawyerVerificationQuestions": string[],
  "emailDraft": {"subject": string, "body": string},
  "confidence": number,
  "humanReviewRequired": boolean,
  "humanReviewReason": string|null
}

Urgency rules:
- If client is not affected, urgency = "low".
- If law is in force and client is affected, urgency may be "immediate".
- If bill received Royal Assent and client T&C/policies appear inconsistent, urgency = "high".
- If bill is at first reading, urgency is usually "low" or "medium" with monitoring.
- Consider effective date, penalty exposure, jurisdiction, industry, and operational burden.

LAW CHANGE:
Source: ${lawVersion.sourceBillNumber} — ${lawVersion.sourceBillTitle}
Status: ${lawVersion.sourceBillStatus} (momentum: ${lawVersion.legislativeMomentum})
Effective: ${lawVersion.effectiveDate ?? "unspecified"} (${lawVersion.comingIntoForceText ?? ""})
Affected sections: ${lawVersion.affectedSections.join(", ")}
Delta summary: ${lawVersion.deltaSummary}
Detailed delta: ${lawVersion.detailedDelta}

CLIENT: ${client.name}
Industry: ${client.industry}
Jurisdictions: ${client.jurisdictions.join(", ")}
Description: ${client.description}

Terms & Conditions:
${client.termsAndConditions ?? "(none provided)"}

Policies:
${client.policies ?? "(none provided)"}

Operations:
${client.operations ?? "(none provided)"}
`;

  return callJson<ClientImpactAnalysis>(prompt);
}
