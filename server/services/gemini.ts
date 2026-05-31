import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  AmendmentExtraction,
  BaseLaw,
  Bill,
  Client,
  ClientImpactAnalysis,
} from "../../src/types.js";

// Overridable via env (documented in .env.example); falls back to a fast,
// inexpensive default so the app works the moment a key is added.
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

/** The Acts a bill touches, gathered from clause-level tags + the statute citation. */
export function billAffectedActs(bill: Bill): string[] {
  const acts = new Set<string>();
  for (const clause of bill.clauses ?? []) {
    for (const act of clause.targetActs ?? []) {
      if (act?.trim()) acts.add(act.trim());
    }
  }
  if (bill.statuteCitation?.trim()) acts.add(bill.statuteCitation.trim());
  return [...acts];
}

/** A compact, prompt-friendly digest of a bill's clause-by-clause changes. */
function billClauseDigest(bill: Bill, maxClauses = 40): string {
  const clauses = bill.clauses ?? [];
  const digest = clauses
    .slice(0, maxClauses)
    .map((c) => `${c.number ?? ""} ${c.heading ?? ""}\n${c.text}`.trim())
    .join("\n\n");
  const omitted = clauses.length - Math.min(clauses.length, maxClauses);
  return omitted > 0 ? `${digest}\n\n…(+${omitted} more clauses)` : digest;
}

export async function analyzeClientImpact(args: {
  bill: Bill;
  client: Client;
}): Promise<ClientImpactAnalysis | null> {
  const { bill, client } = args;
  const affectedActs = billAffectedActs(bill);
  const clauseDigest = billClauseDigest(bill);

  const prompt = `You are a senior Canadian regulatory and business lawyer based in Montreal working for a big firm and advising a sophisticated corporate client. Assume the audience is an in-house legal department and senior executives familiar with their industrie's regulations. Use short analytical paragraphs and business-oriented headings. Prioritize precision, commercial relevance, and regulatory analysis over general explanation.
    Return STRICT JSON with exactly these keys:

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
Analyze how [LAW CHANGE] would be relevant to ${client.name} as a [CURRENT/POTENTIAL] client.

Focus specifically on:
- the business and legal relevance of the bill to [COMPANY NAME's] operations;
- concrete commercial impacts;
- regulatory implications;
- and strategic opportunities and risks.

Include in the response:
- Executive summary
- New benefits/opportunities
- New obligations/compliance implications
- Strategic considerations
- Concrete examples of how your firm could provide relevant services

Write in a concise, professional legal-business style suitable for an internal client memorandum or partner briefing note. Avoid generic political commentary and focus on practical corporate implications.

LAW CHANGE (the whole bill):
Source: ${bill.billNumber} — ${bill.title}
Status: ${bill.status} (momentum: ${bill.legislativeMomentum})
Acts amended: ${affectedActs.join(", ") || "(not yet tagged — infer from the clauses below)"}
Summary: ${bill.summary ?? "(no summary provided)"}

Clause-by-clause changes:
${clauseDigest || "(full text not available — reason from the title, status, and Acts amended)"}

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
