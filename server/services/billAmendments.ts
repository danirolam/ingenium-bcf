// Parse an amending bill's XML directly, instead of asking the AI to retype the
// inserted statutory text. The Justice/LEGISinfo bill XML wraps each amending
// clause as:
//   <Section><Text>The X Act is amended by adding ... after section 2.4:</Text>
//            <AmendedText> ...the inserted provisions, fully structured... </AmendedText>
//   </Section>
// So we read the OPERATION + ANCHOR from the instruction <Text> (regex), and
// pull the inserted provisions verbatim from <AmendedText> (no AI generation).
import { findByPath, labelToPath, type Provision } from "./amendmentEngine.js";
import { resolveActSlug, type RegistryEntry } from "./seedSource.js";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (f, c) => {
    if (c[0] === "#") {
      const n = c[1] === "x" || c[1] === "X" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : f;
    }
    return ENT[c] ?? f;
  });
}
const squish = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const squishText = (s: string) => decode(s).replace(/\s+/g, " ").trim();

type Tok =
  | { type: "text"; value: string }
  | { type: "open" | "close"; name: string; attrs: string; self: boolean };

function* tokens(xml: string): Generator<Tok> {
  const re = /<(\/?)([A-Za-z][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) {
      yield { type: "text", value: m[5] };
      continue;
    }
    const name = m[2];
    if (name === "?xml" || name.startsWith("!")) continue;
    yield { type: m[1] === "/" ? "close" : "open", name, attrs: m[3], self: m[4] === "/" };
  }
}
function attr(attrs: string, k: string) {
  const m = attrs.match(new RegExp(`\\b${k}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

const STRUCTURAL = new Set(["Section", "Subsection", "Paragraph", "Subparagraph", "Clause", "Definition"]);
const KIND: Record<string, string> = {
  Section: "section", Subsection: "subsection", Paragraph: "paragraph",
  Subparagraph: "subparagraph", Clause: "clause", Definition: "definition",
};
const CAPTURE = new Set(["Label", "MarginalNote", "Text"]);

// Parse a LIMS XML fragment (an <AmendedText> body) into leaf provisions —
// same model as the Act ingester: a flat list keyed by label, definitions
// labelled by their defined term.
export function parseProvisions(xml: string): Provision[] {
  const out: Provision[] = [];
  const frames: any[] = [];
  const captureStack: { kind: string; buf: string[] }[] = [];
  let termBuf: string[] | null = null;
  let headingBuf: string[] | null = null;
  let curHeading: string | null = null;
  let skip = 0;
  const top = () => frames[frames.length - 1] ?? null;

  function emit(f: any) {
    const text = squishText(f.textBuf.join(""));
    if (!text) return;
    const label =
      f.kind === "definition" ? f.label : frames.map((x) => x.label).filter(Boolean).join("");
    const finalLabel = label || f.marginalNote || `¶${out.length + 1}`;
    out.push({
      id: f.id || `ins:${out.length}`,
      label: finalLabel,
      kind: f.kind,
      heading: curHeading,
      marginalNote: f.marginalNote || null,
      text,
      path: labelToPath(finalLabel),
    });
  }

  for (const t of tokens(xml)) {
    if (t.type === "text") {
      if (skip > 0) continue;
      if (termBuf) termBuf.push(t.value);
      const c = captureStack[captureStack.length - 1];
      if (c) c.buf.push(t.value);
      else if (headingBuf) headingBuf.push(t.value);
      continue;
    }
    if (t.type === "open") {
      if (t.name === "HistoricalNote") { if (!t.self) skip++; continue; }
      if (skip > 0) { if (!t.self) skip++; continue; }
      if (t.name === "TitleText") { headingBuf = []; continue; }
      if (STRUCTURAL.has(t.name)) {
        frames.push({
          kind: KIND[t.name], label: "", marginalNote: "",
          id: attr(t.attrs, "lims:fid") || attr(t.attrs, "lims:id") || "",
          textBuf: [],
        });
        if (t.self) emit(frames.pop());
        continue;
      }
      if (t.name === "DefinedTermEn") {
        const f = top();
        if (f && f.kind === "definition" && !f.label && !f._t && !t.self) termBuf = [];
        continue;
      }
      if (CAPTURE.has(t.name)) { if (!t.self) captureStack.push({ kind: t.name, buf: [] }); continue; }
      continue;
    }
    // close
    if (t.name === "HistoricalNote") { if (skip > 0) skip--; continue; }
    if (skip > 0) { skip--; continue; }
    if (t.name === "DefinedTermEn" && termBuf) {
      const f = top();
      if (f) { f.label = `“${squishText(termBuf.join(""))}”`; f._t = true; }
      termBuf = null;
      continue;
    }
    if (t.name === "TitleText" && headingBuf) {
      curHeading = squishText(headingBuf.join("")) || curHeading;
      headingBuf = null;
      continue;
    }
    if (CAPTURE.has(t.name)) {
      const c = captureStack.pop();
      if (!c) continue;
      const f = top();
      if (!f) continue;
      const v = squishText(c.buf.join(""));
      if (c.kind === "Label") f.label = v || f.label;
      else if (c.kind === "MarginalNote") f.marginalNote = v || f.marginalNote;
      else if (c.kind === "Text") f.textBuf.push(c.buf.join("") + " ");
      continue;
    }
    if (STRUCTURAL.has(t.name) && frames.length) { emit(frames.pop()); continue; }
  }
  return out;
}

export interface AmendGroup {
  actSlug: string;
  op: "add" | "replace" | "repeal";
  anchor: string | null;
  position: "after" | "before" | null;
  provisions: Provision[];
  instruction: string;
}

// Top-level <Section> spans within the Body (the amending clauses). Sections
// nest (AmendedText contains Sections), so track depth and capture depth-0 spans.
function topLevelSections(xml: string): string[] {
  const re = /<(\/?)Section\b[^>]*?(\/?)>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  let depth = 0, start = -1;
  while ((m = re.exec(xml))) {
    const close = m[1] === "/", self = m[2] === "/";
    if (self) continue;
    if (!close) { if (depth === 0) start = m.index; depth++; }
    else { depth--; if (depth === 0 && start >= 0) { out.push(xml.slice(start, re.lastIndex)); start = -1; } }
  }
  return out;
}

function parseInstruction(text: string): { op: "add" | "replace" | "repeal"; anchor: string | null; position: "after" | "before" | null } {
  const anchorOf = () => {
    const a = text.match(/(?:sections?|subsections?|paragraphs?)\s+([\w.()]+)/i);
    return a ? a[1] : null;
  };
  if (/replaced by the following/i.test(text)) return { op: "replace", anchor: anchorOf(), position: null };
  if (/\b(?:is|are)\s+repealed\b/i.test(text)) return { op: "repeal", anchor: anchorOf(), position: null };
  let m = text.match(/adding the following after (?:section|subsection|paragraph)\s+([\w.()]+)/i);
  if (m) return { op: "add", anchor: m[1], position: "after" };
  m = text.match(/adding the following before (?:section|subsection|paragraph)\s+([\w.()]+)/i);
  if (m) return { op: "add", anchor: m[1], position: "before" };
  return { op: "add", anchor: null, position: "after" }; // append-style add
}

// A clause (or sub-clause) that edits text *inside* an existing provision —
// "striking out 'or' at the end of paragraph (b)", "replacing the expression
// X with Y". No full replacement text; the AI applies it to the current text.
export interface PartialEdit {
  actSlug: string;
  instruction: string;
  sectionHint: string | null; // the provision label the clause names, if any
}

// Edit-verb phrases that signal a partial (in-provision) text change rather
// than a whole-provision add/replace/repeal.
const PARTIAL_EDIT =
  /striking out|by replacing the (?:word|words|expression|portion|reference)|by adding the (?:word|words|expression)|wherever it occurs/i;

/**
 * Parse an amending bill into structured operations, grouped by the registered
 * Act slug they target. Clauses that don't name an Act inherit the last named
 * one ("The Act is amended..."). Only registered Acts are returned.
 *
 * Returns both whole-provision `groups` (applied deterministically) and
 * `edits` — partial in-provision edits the AI scalpel resolves.
 */
export function parseBillAmendments(
  xml: string,
  registry: Record<string, RegistryEntry>,
): { groups: Map<string, AmendGroup[]>; edits: Map<string, PartialEdit[]> } {
  const bodyStart = xml.indexOf("<Body");
  const bodyEnd = xml.lastIndexOf("</Body>");
  const body = bodyStart >= 0 && bodyEnd > bodyStart ? xml.slice(bodyStart, bodyEnd) : xml;

  const groups = new Map<string, AmendGroup[]>();
  const edits = new Map<string, PartialEdit[]>();
  let currentSlug: string | null = null;

  for (const clause of topLevelSections(body)) {
    const am = /<AmendedText\b[^>]*>([\s\S]*)<\/AmendedText>/.exec(clause);
    const amendedXml = am ? am[1] : "";
    const instructionXml = clause.replace(/<AmendedText\b[^>]*>[\s\S]*<\/AmendedText>/, "");

    // Which Act? The first act cross-reference in the instruction, else carry over.
    const actRef = /<XRefExternal\b[^>]*reference-type="act"[^>]*>([\s\S]*?)<\/XRefExternal>/i.exec(instructionXml);
    if (actRef) {
      const slug = resolveActSlug(squish(actRef[1]), registry);
      if (slug) currentSlug = slug;
    }
    if (!currentSlug || !registry[currentSlug]) continue; // unregistered Act → no diff target

    const instruction = squish(instructionXml);

    // Partial edit (text surgery inside a provision) → hand to the AI scalpel.
    if (PARTIAL_EDIT.test(instruction)) {
      const hint = instruction.match(/(?:section|subsection|paragraph|subparagraph)\s+([\w.()]+)/i);
      const list = edits.get(currentSlug) ?? [];
      list.push({ actSlug: currentSlug, instruction, sectionHint: hint ? hint[1] : null });
      edits.set(currentSlug, list);
    }

    // Whole-provision add/replace/repeal applied deterministically from <AmendedText>.
    const provisions = parseProvisions(amendedXml);
    if (provisions.length > 0 || /repealed/i.test(instruction)) {
      const { op, anchor, position } = parseInstruction(instruction);
      const list = groups.get(currentSlug) ?? [];
      list.push({ actSlug: currentSlug, op, anchor, position, provisions, instruction });
      groups.set(currentSlug, list);
    }
  }
  return { groups, edits };
}

export interface AppliedOp {
  op: "add" | "replace" | "repeal" | "amend";
  anchor: string | null;
  position: "after" | "before" | null;
  count: number;
  anchorFound: boolean;
  note: string;
}

// Apply structured amendment groups to an Act's provisions (block inserts), in
// document order. Anchors are matched by label against the (mutating) result.
export function applyGroups(
  before: Provision[],
  groups: AmendGroup[],
): { after: Provision[]; verified: AppliedOp[] } {
  const after: Provision[] = before.map((p) => ({ ...p }));
  const verified: AppliedOp[] = [];

  for (const g of groups) {
    // Level-by-level match: exact path, else deepest existing ancestor.
    const hit = findByPath(after, g.anchor);
    const i = hit.index;
    const anchorFound = hit.matched === "exact" || (g.op === "add" && !g.anchor);
    verified.push({
      op: g.op, anchor: g.anchor, position: g.position,
      count: g.provisions.length, anchorFound,
      note: g.instruction.slice(0, 160),
    });
    if (g.op === "repeal") {
      if (i >= 0) after.splice(i, 1);
    } else if (g.op === "replace") {
      if (i >= 0) after.splice(i, 1, ...g.provisions);
    } else {
      const at = i < 0 ? after.length : g.position === "before" ? i : i + 1;
      after.splice(at, 0, ...g.provisions);
    }
  }
  return { after, verified };
}
