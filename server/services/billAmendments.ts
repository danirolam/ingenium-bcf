// Parse an amending bill's XML directly, instead of asking the AI to retype the
// inserted statutory text. The Justice/LEGISinfo bill XML wraps each amending
// clause as:
//   <Section><Text>The X Act is amended by adding ... after section 2.4:</Text>
//            <AmendedText> ...the inserted provisions, fully structured... </AmendedText>
//   </Section>
// So we read the OPERATION + ANCHOR from the instruction <Text> (regex), and
// pull the inserted provisions verbatim from <AmendedText> (no AI generation).
import { labelToPath, type Provision } from "./amendmentEngine.js";
import type { ActNode } from "./lawTree.js";
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
    // emit() is called with the just-popped frame, so `frames` holds only the
    // ancestors — include `f` to get this provision's own label segment too.
    const label =
      f.kind === "definition" ? f.label : [...frames, f].map((x) => x.label).filter(Boolean).join("");
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

// One discrete amendment from the bill: the instruction sentence plus the
// fully-structured provisions the bill inserts (empty for repeals / in-place
// edits). The locator turns each unit into { op, ancestors } against the real Act.
// `actSlugHint` is the registered Act slug the clause's <XRefExternal> named (or
// null → an untagged clause the AI must attribute via the list_acts tool).
export interface AmendmentUnit {
  clause: string;
  actSlugHint: string | null;
  instructionText: string;
  inserts: ActNode[]; // nested, so an add can splice the whole subtree into the Act
}

// ── DOM-based bill parsing ──────────────────────────────────────────────────
// A LIGHT element tree, so we can reason about the bill's structure directly.
// This is what lets us honour `type="amending"`: a follow-on amending instruction
// (e.g. a repeal) is sometimes nested INSIDE another amendment's <AmendedText> and
// flagged type="amending" — it is an instruction, NOT inserted content.
interface DomNode {
  name: string;
  attrs: string;
  kids: (DomNode | string)[];
}

function buildDom(xml: string): DomNode[] {
  const roots: (DomNode | string)[] = [];
  const stack: DomNode[] = [];
  const push = (x: DomNode | string) => (stack.length ? stack[stack.length - 1].kids : roots).push(x);
  for (const t of tokens(xml)) {
    if (t.type === "text") { push(t.value); continue; }
    if (t.type === "open") {
      const node: DomNode = { name: t.name, attrs: t.attrs, kids: [] };
      push(node);
      if (!t.self) stack.push(node);
      continue;
    }
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name === t.name) { stack.length = i; break; }
  }
  return roots.filter((r): r is DomNode => typeof r !== "string");
}

const childEls = (n: DomNode, name?: string): DomNode[] =>
  n.kids.filter((k): k is DomNode => typeof k !== "string" && (!name || k.name === name));

// All text inside an element (skipping editorial HistoricalNote citations).
function elText(n: DomNode): string {
  let s = "";
  for (const k of n.kids) s += typeof k === "string" ? k : k.name === "HistoricalNote" ? "" : elText(k);
  return s;
}
const labelOf = (n: DomNode) => squish(childEls(n, "Label").map(elText).join(""));
const directText = (n: DomNode) => squish(childEls(n, "Text").map(elText).join(" "));

// Build an ActNode subtree from an inserted CONTENT element (a Subsection /
// Paragraph / Definition …), mirroring the Act's stored shape. Non-structural
// wrappers (e.g. SectionPiece) are unwrapped; a nested <AmendedText> is not content.
let domSerial = 0;
function domToActNode(el: DomNode): ActNode | null {
  const kind = KIND[el.name];
  if (!kind) return null;
  let num = labelOf(el);
  if (kind === "definition") {
    const term = squish(childEls(el, "DefinedTermEn").map(elText).join(""));
    if (term) num = `“${term}”`;
  }
  const children: ActNode[] = [];
  const collect = (parent: DomNode) => {
    for (const c of childEls(parent)) {
      if (KIND[c.name]) { const n = domToActNode(c); if (n) children.push(n); }
      else if (!["Text", "Label", "MarginalNote", "AmendedText", "HistoricalNote"].includes(c.name)) collect(c);
    }
  };
  collect(el);
  return {
    id: `bill:${domSerial++}`,
    num,
    kind,
    marginalNote: squish(childEls(el, "MarginalNote").map(elText).join(" ")) || null,
    text: directText(el),
    children,
  };
}

// A <BilingualGroup> in an <AmendedText> is a schedule insert: pair its
// <BilingualItemEn>/<BilingualItemFr> children into scheduleEntry nodes (en + fr),
// so "Schedule I … add the following in alphabetical order" yields real entries.
function bilingualEntries(group: DomNode): ActNode[] {
  const out: ActNode[] = [];
  let en: string | null = null;
  for (const c of childEls(group)) {
    if (c.name === "BilingualItemEn") en = squish(elText(c));
    else if (c.name === "BilingualItemFr") {
      const fr = squish(elText(c));
      if (en) out.push({ id: `bill:${domSerial++}`, num: en.length > 90 ? en.slice(0, 90) : en, kind: "scheduleEntry", text: en, ...(fr ? { textFr: fr } : {}), children: [] });
      en = null;
    }
  }
  if (en) out.push({ id: `bill:${domSerial++}`, num: en, kind: "scheduleEntry", text: en, children: [] });
  return out;
}

// One discrete amending instruction, pre-extraction.
interface RawUnit { instruction: string; inserts: ActNode[] }

// Split an <AmendedText> into the provisions it INSERTS and the amending
// INSTRUCTIONS nested inside it (type="amending"). The latter become their own
// ops — this is the fix for a repeal/replace bundled inside another amendment's
// content (e.g. "(4) Subsection 12(7) … is repealed" inside the 12(6) replacement).
function splitAmended(amended: DomNode): { inserts: ActNode[]; nested: RawUnit[] } {
  const outer: ActNode[] = [];
  const nested: RawUnit[] = [];
  // Content nodes accumulate into the CURRENT instruction, in document order: the
  // outer (parent) instruction until a nested type="amending" instruction appears,
  // then that instruction — whose content is its FOLLOWING SIBLINGS (e.g. "(2) …
  // is replaced:" followed by the new subsection (7)).
  let current = outer;
  const walk = (parent: DomNode) => {
    for (const c of childEls(parent)) {
      if (attr(c.attrs, "type") === "amending") {
        const unit: RawUnit = { instruction: [labelOf(c), directText(c)].filter(Boolean).join(" "), inserts: [] };
        nested.push(unit);
        const own = childEls(c, "AmendedText")[0];
        if (own) { const sub = splitAmended(own); unit.inserts.push(...sub.inserts); nested.push(...sub.nested); }
        current = unit.inserts;
      } else if (KIND[c.name]) {
        const n = domToActNode(c);
        if (n) current.push(n);
      } else if (c.name === "BilingualGroup") {
        for (const e of bilingualEntries(c)) current.push(e); // schedule entries (en + fr)
      } else if (!["Text", "Label", "MarginalNote", "HistoricalNote"].includes(c.name)) {
        walk(c); // unwrap SectionPiece etc., preserving the current instruction
      }
    }
  };
  walk(amended);
  return { inserts: outer, nested };
}

// One amending-instruction element (a sub-amendment Subsection, or a type="amending"
// element): its direct <Text> is the instruction; its <AmendedText> (if any) is the
// content, which may itself carry further nested instructions.
function unitsInInstruction(el: DomNode): RawUnit[] {
  const instruction = [labelOf(el), directText(el)].filter(Boolean).join(" ");
  const amended = childEls(el, "AmendedText")[0];
  if (amended) {
    const { inserts, nested } = splitAmended(amended);
    return [{ instruction, inserts }, ...nested];
  }
  return [{ instruction, inserts: [] }];
}

// Every amendment a clause makes. A clause is either ONE instruction with its own
// <AmendedText> ("Section 12.6 … is replaced by the following:"), a set of
// sub-amendment Subsections ("3 (1) … (2) …"), or instruction-only ("… is repealed").
function unitsInClause(clause: DomNode): RawUnit[] {
  const out: RawUnit[] = [];
  const directAmended = childEls(clause, "AmendedText")[0];
  if (directAmended) {
    const { inserts, nested } = splitAmended(directAmended);
    out.push({ instruction: [labelOf(clause), directText(clause)].filter(Boolean).join(" "), inserts }, ...nested);
    return out;
  }
  for (const sub of childEls(clause)) {
    if ((sub.name === "Subsection" || sub.name === "Section") && (childEls(sub, "AmendedText").length || directText(sub))) {
      out.push(...unitsInInstruction(sub));
    }
  }
  if (!out.length && directText(clause)) out.push({ instruction: [labelOf(clause), directText(clause)].filter(Boolean).join(" "), inserts: [] });
  return out;
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

/**
 * Extract every discrete amendment a bill makes as a flat, ordered list of
 * AmendmentUnits — the reliable, structural half of the pipeline (element
 * boundaries, not prose). We honour `type="amending"`, so a repeal/replace nested
 * inside another amendment's <AmendedText> becomes its own unit. The locator turns
 * each unit's instruction into { op, ancestors } against the real Act; inserted
 * text is taken verbatim from <AmendedText> (no AI generation).
 */
export function extractAmendmentUnits(
  xml: string,
  registry: Record<string, RegistryEntry>,
): AmendmentUnit[] {
  const bodyStart = xml.indexOf("<Body");
  const bodyEnd = xml.lastIndexOf("</Body>");
  const body = bodyStart >= 0 && bodyEnd > bodyStart ? xml.slice(bodyStart, bodyEnd) : xml;

  const units: AmendmentUnit[] = [];
  let currentSlug: string | null = null;

  for (const clauseXml of topLevelSections(body)) {
    const clause = buildDom(clauseXml)[0];
    if (!clause) continue;
    const clauseLabel = labelOf(clause);

    // Which Act? The first act cross-reference in the clause's instruction text
    // (outside any AmendedText). A clause with no <XRefExternal> ("The Act is
    // amended…") carries over the last named Act; a clause naming an Act we don't
    // have registered resets the hint to null (the locator then can't place it,
    // unless the AI attributes it to a registered Act via list_acts).
    const instrOnly = clauseXml.replace(/<AmendedText\b[^>]*>[\s\S]*?<\/AmendedText>/g, " ");
    const actRef = /<XRefExternal\b[^>]*reference-type="act"[^>]*>([\s\S]*?)<\/XRefExternal>/i.exec(instrOnly);
    if (actRef) currentSlug = resolveActSlug(squish(actRef[1]), registry);

    for (const ru of unitsInClause(clause)) {
      if (!ru.instruction) continue;
      units.push({ clause: clauseLabel, actSlugHint: currentSlug, instructionText: ru.instruction, inserts: ru.inserts });
    }
  }
  return units;
}

// Overlay the French bill's inserted text onto the English units so added/replaced
// provisions render in French too. The EN and FR bills mirror each other, so we
// pair the k-th unit of each clause and walk the insert trees in parallel by
// position, copying text → textFr. Schedule entries already carry French inline.
export function overlayFrenchInserts(enUnits: AmendmentUnit[], frXml: string, registry: Record<string, RegistryEntry>): void {
  const frUnits = extractAmendmentUnits(frXml, registry);
  const frByClause = new Map<string, AmendmentUnit[]>();
  for (const u of frUnits) { const a = frByClause.get(u.clause) ?? []; a.push(u); frByClause.set(u.clause, a); }
  const seen = new Map<string, number>();
  const pair = (en: ActNode[], fr: ActNode[]) => {
    const n = Math.min(en.length, fr.length);
    for (let i = 0; i < n; i++) {
      if (!en[i].textFr && en[i].text && fr[i].text) en[i].textFr = fr[i].text;
      if (!en[i].marginalNoteFr && en[i].marginalNote && fr[i].marginalNote) en[i].marginalNoteFr = fr[i].marginalNote;
      pair(en[i].children ?? [], fr[i].children ?? []);
    }
  };
  for (const u of enUnits) {
    const k = seen.get(u.clause) ?? 0;
    seen.set(u.clause, k + 1);
    const fr = frByClause.get(u.clause)?.[k];
    if (fr) pair(u.inserts, fr.inserts);
  }
}
