import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type {
  AmendmentExtraction,
  BaseLaw,
  Bill,
  Client,
  ClientImpactAnalysis,
} from "../../src/types.js";
import { normLabel, type Amendment, type Provision } from "./amendmentEngine.js";

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

// Interpret a bill's amending instructions into structured operations. The AI
// only classifies and locates changes — it copies inserted text verbatim and
// must anchor to a REAL provision label (we verify in applyAmendments). It does
// NOT generate the resulting Act text.
export async function interpretAmendments(args: {
  bill: Bill;
  actTitle: string;
  actLabels: string[];
}): Promise<{ operations: Amendment[] } | null> {
  const clauseText = args.bill.clauses
    .map((c) => `Clause ${c.number ?? ""}: ${(c.heading ?? "") + " " + c.text}`.trim())
    .join("\n\n");
  const labels = args.actLabels.slice(0, 900).join(", ");

  const prompt = `You are a Canadian legislative-drafting analyst. The bill below amends an existing Act. Extract EACH discrete amending operation as structured data. Do NOT invent statutory text — copy "newText" verbatim from the bill, omitting the instruction phrasing ("The Act is amended by adding...").

Return STRICT JSON: {"operations":[{
  "clause": string,
  "op": "add"|"replace"|"repeal"|"amend",
  "anchor": string|null,
  "position": "after"|"before"|"replaces"|"within"|null,
  "newLabel": string|null,
  "newMarginalNote": string|null,
  "newText": string|null,
  "note": string
}]}

Rules:
- "anchor" MUST be an existing provision label from this list (or null only when the bill adds an entirely new Part with no in-Act anchor): ${labels}
- "op": "add" inserts new provision(s); "replace" substitutes an existing provision's wording; "repeal" deletes a provision; "amend" makes a small in-text edit (striking/inserting words).
- "newLabel"/"newMarginalNote"/"newText" describe the inserted or replacement provision (null for repeals).
- Emit one operation per discrete change.

ACT BEING AMENDED: ${args.actTitle}

BILL CLAUSES:
${clauseText}`;

  return callJson<{ operations: Amendment[] }>(prompt);
}

// Tool-based interpreter: instead of sending the whole Act, give Gemini tools
// to look up the specific provisions the bill references. Scales to any Act
// size and grounds anchors against real text the model actually fetched.
export async function interpretAmendmentsTooled(args: {
  bill: Bill;
  actTitle: string;
  provisions: Provision[];
}): Promise<{ operations: Amendment[] } | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const byLabel = new Map<string, Provision>();
  for (const p of args.provisions) byLabel.set(normLabel(p.label), p);

  const tools: any = [
    {
      functionDeclarations: [
        {
          name: "look_up_provision",
          description:
            "Return the current wording of a provision in the Act by its label (e.g. '30', '30(1)', '2.4'). Call this to confirm an anchor exists and to read text you must replace or amend.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              label: { type: SchemaType.STRING, description: "Provision label, e.g. 30(1)(a)" },
            },
            required: ["label"],
          },
        },
        {
          name: "search_provisions",
          description:
            "Find provisions whose label or marginal note contains the query. Returns up to 10 {label, marginalNote}. Use when you don't know the exact label.",
          parameters: {
            type: SchemaType.OBJECT,
            properties: { query: { type: SchemaType.STRING } },
            required: ["query"],
          },
        },
      ],
    },
  ];

  const clauseText = args.bill.clauses
    .map((c) => `Clause ${c.number ?? ""}: ${(c.heading ?? "") + " " + c.text}`.trim())
    .join("\n\n");

  const prompt = `You extract how a bill amends an existing Act, as structured operations. Use the tools to locate and read the exact provisions the bill references — do NOT guess labels.

ACT BEING AMENDED: ${args.actTitle}

When finished, reply with ONLY strict JSON (no prose):
{"operations":[{"clause":string,"op":"add"|"replace"|"repeal"|"amend","anchor":string|null,"position":"after"|"before"|"replaces"|"within"|null,"newLabel":string|null,"newMarginalNote":string|null,"newText":string|null,"note":string}]}
Rules:
- "anchor" must be a real provision label you confirmed via a tool (or null only for a brand-new Part with no in-Act anchor).
- "newText" = the verbatim inserted/replacement statutory text from the bill (omit the instruction phrasing).
- One operation per discrete change.

BILL CLAUSES:
${clauseText}`;

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: MODEL, tools });
    const chat = model.startChat();

    let result = await chat.sendMessage(prompt);
    for (let hop = 0; hop < 12; hop++) {
      const calls = result.response.functionCalls() ?? [];
      if (calls.length === 0) break;
      const responses = calls.map((call) => {
        const a = call.args as Record<string, unknown>;
        let response: unknown;
        if (call.name === "look_up_provision") {
          const p = byLabel.get(normLabel(String(a.label ?? "")));
          response = p
            ? { found: true, label: p.label, marginalNote: p.marginalNote, text: p.text }
            : { found: false };
        } else if (call.name === "search_provisions") {
          const q = String(a.query ?? "").toLowerCase();
          response = {
            matches: args.provisions
              .filter((p) => `${p.label} ${p.marginalNote ?? ""}`.toLowerCase().includes(q))
              .slice(0, 10)
              .map((p) => ({ label: p.label, marginalNote: p.marginalNote })),
          };
        } else {
          response = { error: "unknown tool" };
        }
        return { functionResponse: { name: call.name, response: response as object } };
      });
      result = await chat.sendMessage(responses);
    }

    const text = result.response.text();
    const json = text.match(/\{[\s\S]*\}/);
    return json ? (JSON.parse(json[0]) as { operations: Amendment[] }) : null;
  } catch (err: any) {
    console.log(`[gemini] tooled interpret failed: ${err?.message ?? err}`);
    return null;
  }
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

// The memo prompt is provider-neutral: gemini.ts uses it below, and the route
// falls back to the Anthropic key (claude.ts claudeJson) with the same prompt.
export function buildImpactPrompt(args: { bill: Bill; client: Client }): string {
  const { bill, client } = args;
  const affectedActs = billAffectedActs(bill);
  const clauseDigest = billClauseDigest(bill);

  return `You are a senior Canadian regulatory and business lawyer based in Montreal working for a big firm and advising a sophisticated corporate client. Assume the audience is an in-house legal department and senior executives familiar with their industrie's regulations. Use short analytical paragraphs and business-oriented headings. Prioritize precision, commercial relevance, and regulatory analysis over general explanation.
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
}

export async function analyzeClientImpact(args: {
  bill: Bill;
  client: Client;
}): Promise<ClientImpactAnalysis | null> {
  return callJson<ClientImpactAnalysis>(buildImpactPrompt(args));
}
