// Ingest Canadian federal Act XML from the Justice Laws website into a
// diff-friendly HIERARCHICAL structure, with a built-in coverage validator so we
// KNOW when an Act doesn't fit the model instead of emitting silent garbage.
//
// The Justice Laws "LIMS" XML is consistent across vintages (see
// scripts/probe-law-xml.mjs): root <Statute>, a <Body> of <Heading>/<Section>,
// and a strict Section › Subsection › Paragraph › Subparagraph › Clause
// hierarchy where every provision has <Label>, optional <MarginalNote>, <Text>,
// and a STABLE lims:id. We parse on that real structure into a nested tree of
// Nodes { id, num, kind, heading?, marginalNote?, text, closingText?, children[] }
// keyed by lims:id — the identity a clean git-diff needs. The composed label
// ("30(1)(j)") and the hierarchy "path" are NOT stored: the tree IS the path, and
// the server (server/services/lawProvisions.ts) flattens it back at load time.
//
// Usage:
//   node --use-system-ca scripts/ingest-acts.mjs F-27 A-0.6 P-9.01   # ingest codes
//   node --use-system-ca scripts/ingest-acts.mjs --registry          # re-ingest every Act in registry.json
//   node --use-system-ca scripts/ingest-acts.mjs --list A            # discover Act codes under letter A
//   node --use-system-ca scripts/ingest-acts.mjs F-27 --dry          # parse + validate, write nothing
//   node --use-system-ca scripts/ingest-acts.mjs F-27 --write-registry  # also merge a registry entry
//   node --use-system-ca scripts/ingest-acts.mjs --from-cache        # re-parse every cached current.xml, offline
//   node --use-system-ca scripts/ingest-acts.mjs --verify --from-cache  # assert flatten(tree) === legacy flat parser
//
// Writes (unless --dry/--verify):
//   data/laws/current/federal/<slug>/current.xml             (skipped in --from-cache; the source)
//   data/laws/current/federal/<slug>/current.normalized.json { title, citation, …, sections[], schedules[], fullText }

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(REPO_ROOT, "data", "laws", "registry.json");
const OUT_BASE = path.join(REPO_ROOT, "data", "laws", "current", "federal");
const UA = "Ingenium-LawIngest/0.1 (legislative diff research)";
const BASE = "https://laws-lois.justice.gc.ca";

// slug → owning Act code, so two Acts that share a short title (a current Act
// and its repealed predecessor, e.g. Q-1 + Q-1.1 "Quarantine Act") don't
// silently overwrite each other. Seeded from the registry in main().
const slugOwner = new Map();
// Cap a slug to a safe path-component length (filesystem limit is 255 bytes;
// some Act short titles run ~280 chars, e.g. CASL E-1.6). Cut on a hyphen.
const MAX_SLUG = 120;
function capSlug(s) {
  if (s.length <= MAX_SLUG) return s;
  const cut = s.slice(0, MAX_SLUG);
  const i = cut.lastIndexOf("-");
  return (i > 40 ? cut.slice(0, i) : cut).replace(/-+$/, "");
}

// Structural elements that become diff units (a frame in the walk).
const STRUCTURAL = new Set([
  "Section", "Subsection", "Paragraph", "Subparagraph", "Clause", "Definition",
]);
const KIND = {
  Section: "section", Subsection: "subsection", Paragraph: "paragraph",
  Subparagraph: "subparagraph", Clause: "clause", Definition: "definition",
};
// Text-bearing leaf elements we capture into the current target buffer.
const CAPTURE = new Set(["Label", "MarginalNote", "Text", "TitleText"]);
// Inline elements inside <Text>/<MarginalNote> — their text is kept, tags dropped.
// (We don't need to enumerate them: any text between tags inside a capture
// context is accumulated. This set is only for the "unhandled element" audit.)
const KNOWN_INLINE = new Set([
  "XRefExternal", "XRefInternal", "DefinedTermEn", "DefinedTermFr",
  "DefinitionRef", "Emphasis", "Language", "Sup", "Sub", "FootnoteRef",
  "Repealed", "Footnote", "Fraction", "Numerator", "Denominator", "LineBreak",
]);
const KNOWN_STRUCTURAL_CONTAINERS = new Set([
  "Statute", "Regulation", "Identification", "Introduction", "Body", "Heading",
  "HistoricalNote", "HistoricalNoteSubItem", "ContinuedSectionSubsection",
  "ContinuedParagraph", "ContinuedDefinition", "Schedule", "RecentAmendments",
  "AmendedText", "Provision", "Oath", "ReadAsText", "QuotedText", "BillPiece",
  "DefinitionEnOnly", "DefinitionFrOnly",
]);

// ───────────────────────── fetch ─────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Timeout + retry so a single hung/throttled request can't stall (or silently
// drop an Act from) a long full-corpus run.
async function fetchText(url, attempt = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return await res.text();
  } catch (e) {
    if (attempt < 2) {
      await sleep(1500 * (attempt + 1));
      return fetchText(url, attempt + 1);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── tokenizer ─────────────────────────
// Yields { type:'open'|'close'|'text', name?, attrs?, selfClose?, value? } in order.
function* tokens(xml) {
  const re = /<(\/?)([A-Za-z][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let last = 0, m;
  while ((m = re.exec(xml))) {
    if (m.index > last) {
      const t = xml.slice(last, m.index);
      if (t) yield { type: "text", value: t };
    }
    const name = m[2];
    last = re.lastIndex;
    if (name === "?xml" || name.startsWith("!")) continue; // decl / comment / doctype
    yield { type: m[1] === "/" ? "close" : "open", name, attrs: m[3], selfClose: m[4] === "/" };
  }
  if (last < xml.length) {
    const t = xml.slice(last);
    if (t) yield { type: "text", value: t };
  }
}

function attr(attrs, key) {
  const m = attrs.match(new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#160": " " };
function decode(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, code) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X"
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : full;
    }
    return ENTITIES[code] ?? full;
  });
}
const squish = (s) => decode(s).replace(/\s+/g, " ").trim();

// ───────────────────────── parser (legacy flat — kept as a verification oracle) ─────────────────────────
// The hierarchical parseActTree below is the source of truth. This legacy flat
// parser is retained ONLY so `--verify` can assert that flatten(tree) reproduces
// the exact provision list the engine was validated against (C-265). Not used to
// write output.
function parseActLegacy(xml, code) {
  const provisions = [];
  const unknown = new Map();      // element name -> count (audit)
  const headingByLevel = [];      // current Part/Division titles by level
  const frames = [];              // structural frame stack
  let inBody = false, inSchedule = false, skipDepth = 0;
  const captureStack = [];        // { kind: 'Label'|'MarginalNote'|'Text'|'TitleText', buf:[] }
  let termBuf = null;             // capturing a Definition's <DefinedTermEn> (its label)

  let headingTitleBuf = null;     // capturing a <Heading><TitleText>
  let headingLevel = null;

  let missingLabel = 0;
  const note = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);

  const topFrame = () => frames[frames.length - 1] ?? null;

  function emit(frame) {
    const text = squish(frame.textBuf.join(""));
    if (!text) return; // no own operative text (e.g. a Section whose text lives in subsections)
    // Definitions are addressed by their term, not the section-number chain.
    // emit() is called with the just-popped frame, so `frames` holds only the
    // ancestors — include `frame` itself or every provision loses its own leaf
    // label (e.g. all paragraphs of 30(1) collapse to "30(1)").
    const labelChain = frame.kind === "definition"
      ? frame.label
      : [...frames, frame].map((f) => f.label).filter(Boolean).join("");
    if (!frame.label) missingLabel++;
    provisions.push({
      id: frame.limsId || `${code}:${provisions.length}`,
      label: labelChain || frame.marginalNote || `¶${provisions.length + 1}`,
      kind: frame.kind,
      heading: headingByLevel.filter(Boolean).slice(-1)[0] ?? null,
      marginalNote: frame.marginalNote || null,
      text,
    });
  }

  for (const t of tokens(xml)) {
    if (t.type === "text") {
      if (skipDepth > 0) continue;
      if (termBuf) termBuf.push(t.value);
      const cap = captureStack[captureStack.length - 1];
      if (cap) cap.buf.push(t.value);
      else if (headingTitleBuf) headingTitleBuf.push(t.value);
      continue;
    }

    if (t.type === "open") {
      // Region tracking.
      if (t.name === "Body") { inBody = true; if (!t.selfClose) {/* fallthrough */} }
      if (t.name === "Schedule") inSchedule = true;

      // Skip whole subtrees we never treat as operative text.
      if (t.name === "HistoricalNote" || t.name === "RecentAmendments") {
        if (!t.selfClose) skipDepth++;
        continue;
      }
      if (skipDepth > 0) { if (!t.selfClose) skipDepth++; continue; }

      // Headings (Part/Division context) — only inside Body, not schedules.
      if (t.name === "Heading" && inBody && !inSchedule) {
        headingLevel = parseInt(attr(t.attrs, "level") ?? "1", 10) || 1;
        continue;
      }
      if (t.name === "TitleText" && headingLevel != null) {
        headingTitleBuf = [];
        continue;
      }

      // Structural frame open (operative provisions live in Body, outside schedules).
      if (STRUCTURAL.has(t.name) && inBody && !inSchedule) {
        frames.push({
          kind: KIND[t.name],
          label: "",
          marginalNote: "",
          // fid = "family id", stable across consolidations; id changes when a
          // provision is amended. Diff on fid; fall back to id, then label/text.
          limsId: attr(t.attrs, "lims:fid") || attr(t.attrs, "lims:id") || "",
          textBuf: [],
        });
        if (t.selfClose) { emit(frames.pop()); }
        continue;
      }

      // A Definition's term doubles as its label — capture the first
      // <DefinedTermEn> inside a definition frame (text still flows to <Text>).
      if (t.name === "DefinedTermEn") {
        const f = topFrame();
        if (f && f.kind === "definition" && !f.label && !f._term && !t.selfClose) termBuf = [];
        continue;
      }

      // Capture contexts.
      if (CAPTURE.has(t.name)) {
        if (!t.selfClose) captureStack.push({ kind: t.name, buf: [] });
        continue;
      }

      // Audit: flag only genuinely-unexpected OPERATIVE elements — i.e. inside
      // the Body and outside Schedules. This excludes front-matter metadata
      // (Identification) and schedule/table/form markup, leaving a true signal
      // of operative structure the parser doesn't yet model (e.g. ITA Formulas).
      if (inBody && !inSchedule &&
          !KNOWN_INLINE.has(t.name) && !KNOWN_STRUCTURAL_CONTAINERS.has(t.name) && !CAPTURE.has(t.name)) {
        note(unknown, t.name);
      }
      continue;
    }

    // close
    if (t.name === "Body") inBody = false;
    if (t.name === "Schedule") inSchedule = false;

    if (t.name === "HistoricalNote" || t.name === "RecentAmendments") {
      if (skipDepth > 0) skipDepth--;
      continue;
    }
    if (skipDepth > 0) { skipDepth--; continue; }

    if (t.name === "DefinedTermEn" && termBuf) {
      const f = topFrame();
      if (f) { f.label = `“${squish(termBuf.join(""))}”`; f._term = true; }
      termBuf = null;
      continue;
    }

    if (t.name === "Heading") { headingLevel = null; continue; }
    if (t.name === "TitleText" && headingTitleBuf) {
      const title = squish(headingTitleBuf.join(""));
      const lvl = headingLevel ?? 1;
      headingByLevel[lvl - 1] = title;
      headingByLevel.length = lvl; // drop deeper headings
      headingTitleBuf = null;
      continue;
    }

    if (CAPTURE.has(t.name)) {
      const cap = captureStack.pop();
      if (!cap) continue;
      const frame = topFrame();
      const val = squish(cap.buf.join(""));
      if (!frame) continue;
      if (cap.kind === "Label") frame.label = val || frame.label;
      else if (cap.kind === "MarginalNote") frame.marginalNote = val || frame.marginalNote;
      else if (cap.kind === "Text") frame.textBuf.push(cap.buf.join("") + " ");
      continue;
    }

    if (STRUCTURAL.has(t.name) && frames.length) {
      emit(frames.pop());
      continue;
    }
  }

  return { provisions, unknown, missingLabel };
}

// ───────────────────────── parser (hierarchical tree — source of truth) ─────────────────────────
// Build the real nested structure instead of a flat list. Each provision is a
// Node { id, num, kind, heading?, marginalNote?, text, closingText?, children[] }:
//   num         — this provision's OWN label segment only ("30", "(1)", "(a)"),
//                 or, for a definition, its quoted term (“advertisement”).
//   kind        — section | subsection | paragraph | subparagraph | clause | definition.
//   heading     — the Part/Division heading string; set on TOP-LEVEL nodes only.
//   text        — this provision's own operative text (the chapeau / lead-in);
//                 a parent may have its own text AND children.
//   closingText — flush text that follows a child list (LIMS Continued* blocks).
//   children    — nested provisions, in document order.
// The composed label ("30(1)(a)") and the hierarchy "path" are NOT stored — they
// are the tree itself, recomputed in memory by the loader for anchor matching.
function parseActTree(xml, code) {
  const roots = [];               // top-level Section nodes
  const frames = [];              // stack of in-progress nodes
  const unknown = new Map();
  const headingByLevel = [];
  let inBody = false, inSchedule = false, skipDepth = 0, continuedDepth = 0;
  const captureStack = [];
  let termBuf = null;
  let headingTitleBuf = null, headingLevel = null;
  const note = (map, k) => map.set(k, (map.get(k) ?? 0) + 1);
  const top = () => frames[frames.length - 1] ?? null;

  // Squish buffers, prune fully-empty nodes, drop scratch fields.
  function finalize(node) {
    node.text = squish(node._textBuf.join(""));
    const closing = squish(node._closeBuf.join(""));
    delete node._textBuf;
    delete node._closeBuf;
    delete node._term;
    delete node._locked;
    if (!node.text && !closing && node.children.length === 0) return null; // empty frame
    if (closing) node.closingText = closing;
    return node;
  }

  for (const t of tokens(xml)) {
    if (t.type === "text") {
      if (skipDepth > 0) continue;
      if (termBuf) termBuf.push(t.value);
      const cap = captureStack[captureStack.length - 1];
      if (cap) cap.buf.push(t.value);
      else if (headingTitleBuf) headingTitleBuf.push(t.value);
      continue;
    }

    if (t.type === "open") {
      if (t.name === "Body") inBody = true;
      if (t.name === "Schedule") inSchedule = true;

      if (t.name === "HistoricalNote" || t.name === "RecentAmendments") {
        if (!t.selfClose) skipDepth++;
        continue;
      }
      if (skipDepth > 0) { if (!t.selfClose) skipDepth++; continue; }

      // Continued* blocks carry the flush text after a child list → closingText.
      if (t.name === "ContinuedSectionSubsection" || t.name === "ContinuedParagraph" || t.name === "ContinuedDefinition") {
        if (!t.selfClose) continuedDepth++;
        continue;
      }

      if (t.name === "Heading" && inBody && !inSchedule) {
        headingLevel = parseInt(attr(t.attrs, "level") ?? "1", 10) || 1;
        continue;
      }
      if (t.name === "TitleText" && headingLevel != null) { headingTitleBuf = []; continue; }

      if (STRUCTURAL.has(t.name) && inBody && !inSchedule) {
        const node = {
          id: attr(t.attrs, "lims:fid") || attr(t.attrs, "lims:id") || "",
          num: "",
          kind: KIND[t.name],
          marginalNote: null,
          _textBuf: [],
          _closeBuf: [],
          children: [],
        };
        if (frames.length === 0) node.heading = headingByLevel.filter(Boolean).slice(-1)[0] ?? null;
        frames.push(node);
        if (t.selfClose) {
          const done = finalize(frames.pop());
          const parent = top();
          if (done) (parent?.children ?? roots).push(done);
          if (parent) parent._locked = true; // a child has attached → lock parent's num
        }
        continue;
      }

      if (t.name === "DefinedTermEn") {
        const f = top();
        if (f && f.kind === "definition" && !f.num && !f._term && !t.selfClose) termBuf = [];
        continue;
      }

      if (CAPTURE.has(t.name)) { if (!t.selfClose) captureStack.push({ kind: t.name, buf: [] }); continue; }

      if (inBody && !inSchedule &&
          !KNOWN_INLINE.has(t.name) && !KNOWN_STRUCTURAL_CONTAINERS.has(t.name) && !CAPTURE.has(t.name)) {
        note(unknown, t.name);
      }
      continue;
    }

    // close
    if (t.name === "Body") inBody = false;
    if (t.name === "Schedule") inSchedule = false;

    if (t.name === "HistoricalNote" || t.name === "RecentAmendments") { if (skipDepth > 0) skipDepth--; continue; }
    if (skipDepth > 0) { skipDepth--; continue; }
    if (t.name === "ContinuedSectionSubsection" || t.name === "ContinuedParagraph" || t.name === "ContinuedDefinition") {
      if (continuedDepth > 0) continuedDepth--;
      continue;
    }

    if (t.name === "DefinedTermEn" && termBuf) {
      const f = top();
      if (f) { f.num = `“${squish(termBuf.join(""))}”`; f._term = true; }
      termBuf = null;
      continue;
    }

    if (t.name === "Heading") { headingLevel = null; continue; }
    if (t.name === "TitleText" && headingTitleBuf) {
      const title = squish(headingTitleBuf.join(""));
      const lvl = headingLevel ?? 1;
      headingByLevel[lvl - 1] = title;
      headingByLevel.length = lvl;
      headingTitleBuf = null;
      continue;
    }

    if (CAPTURE.has(t.name)) {
      const cap = captureStack.pop();
      if (!cap) continue;
      const frame = top();
      const val = squish(cap.buf.join(""));
      if (!frame) continue;
      // A provision's own number is set by the <Label>(s) in its HEADER, before
      // any child provision. Once a structural child has attached (frame._locked),
      // later <Label>s belong to unmodeled descendants (FormulaParagraph, Subclause…)
      // and must NOT overwrite this frame's num — doing so corrupted descendant
      // labels in formula-heavy Acts (ITA, ETA, Bank Act…). Header labels still
      // resolve last-wins, so an empty-then-"*" marker sequence keeps "*".
      if (cap.kind === "Label") { if (!frame._locked) frame.num = val || frame.num; }
      else if (cap.kind === "MarginalNote") frame.marginalNote = val || frame.marginalNote;
      else if (cap.kind === "Text") (continuedDepth > 0 ? frame._closeBuf : frame._textBuf).push(cap.buf.join("") + " ");
      continue;
    }

    if (STRUCTURAL.has(t.name) && frames.length) {
      const done = finalize(frames.pop());
      const parent = top();
      if (done) (parent?.children ?? roots).push(done);
      if (parent) parent._locked = true; // a child has attached → lock parent's num
      continue;
    }
  }

  bakeIds(roots, code);
  return { sections: roots, unknown };
}

// Assign a stable id to every node. Real provisions carry a lims id; the rare
// label-less one falls back to `<code>:<n>` where n is its post-order position
// among text-bearing nodes — identical to the legacy flat id, so diffs are stable.
function bakeIds(roots, code) {
  let counter = 0;
  const walk = (node) => {
    node.children.forEach(walk);
    const hasText = !!(node.text || node.closingText);
    if (!node.id) node.id = hasText ? `${code}:${counter}` : `${code}:c${counter}`;
    if (hasText) counter++;
  };
  roots.forEach(walk);
}

// Flatten the tree to the engine's leaf-provision view — the SAME projection the
// loader builds at runtime, kept here so `--verify` and coverage/fullText agree.
// Post-order (children before parents), composed labels, section heading pushed
// down to descendants, chapeau+closing merged, empty-text nodes skipped.
function flattenTree(roots) {
  const flat = [];
  const walk = (node, ancestors) => {
    for (const ch of node.children) walk(ch, [...ancestors, node]);
    const own = (node.text ?? "").trim();
    const close = (node.closingText ?? "").trim();
    const text = [own, close].filter(Boolean).join(" ");
    if (!text) return;
    const chain = node.kind === "definition"
      ? (node.num ?? "")
      : [...ancestors, node].map((n) => n.num ?? "").filter(Boolean).join("");
    const heading = ancestors.length ? (ancestors[0].heading ?? null) : (node.heading ?? null);
    const label = chain || node.marginalNote || `¶${flat.length + 1}`;
    flat.push({ id: node.id, label, kind: node.kind, heading, marginalNote: node.marginalNote ?? null, text });
  };
  roots.forEach((r) => walk(r, []));
  return flat;
}

// ───────────────────────── coverage validator ─────────────────────────
// Body <Text> chars (operative) vs what we captured. High ratio + no unknowns = trust.
function coverage(xml, provisions) {
  // Denominator = all operative text the doc carries (body + schedules), so the
  // ratio reflects schedule capture too. Strip HistoricalNote subtrees first.
  const operative = xml.replace(/<HistoricalNote[\s\S]*?<\/HistoricalNote>/g, "");
  let rawTextChars = 0;
  let m;
  const tre = /<Text\b[^>]*>([\s\S]*?)<\/Text>/g;
  while ((m = tre.exec(operative))) rawTextChars += squish(m[1]).length;
  // Table cell text lives directly in <entry>, not in <Text>.
  const ere = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g;
  while ((m = ere.exec(operative))) rawTextChars += squish(m[1].replace(/<[^>]+>/g, " ")).length;
  const capturedChars = provisions.reduce((n, p) => n + p.text.length, 0);
  const scheduleHasText = /<Schedule[\s\S]*?<Text\b/.test(xml);
  return {
    rawTextChars,
    capturedChars,
    ratio: rawTextChars ? capturedChars / rawTextChars : 0,
    scheduleHasText,
  };
}

// ───────────────────────── schedules ─────────────────────────
// Schedules (forms, tables, treaty text, designated-item lists) sit after the
// Body and the main walk skips them. Parse them here into provisions: prose
// units (Provision/Section/…) keep their <Text>, table rows join their <entry>
// cells. Labelled by schedule + a counter so they stay unique and identifiable.
const SCHED_UNIT = new Set([
  "Provision", "Section", "Subsection", "Paragraph", "Subparagraph", "Clause", "Definition", "Item",
]);

function parseSchedules(xml, code, startCount = 0) {
  if (!xml.includes("<Schedule")) return [];
  const out = [];
  let counter = startCount;
  let schedDepth = 0, schedLabel = "", group = "";
  let headKind = null, hLabel = "", hTitle = "";
  let cap = null, capBuf = "";
  const units = [];                 // open Provision/Section/… text frames
  let inEntry = false, entryBuf = "", rowCells = null;

  const push = (text, kind) => {
    const t = squish(text);
    if (!t) return;
    counter++;
    out.push({
      id: `${code}:sch:${counter}`,
      label: `${schedLabel || "SCHEDULE"} ${kind === "row" ? "row " : "¶"}${counter}`,
      kind: "schedule",
      heading: schedLabel || null,
      marginalNote: group || null,
      text: t,
    });
  };

  for (const t of tokens(xml)) {
    if (t.type === "text") {
      if (cap) capBuf += t.value;
      else if (inEntry) entryBuf += t.value;
      else if (schedDepth > 0 && units.length) units[units.length - 1].buf += t.value;
      continue;
    }
    if (t.type === "open") {
      if (t.name === "Schedule") { schedDepth++; if (schedDepth === 1) { schedLabel = ""; group = ""; } continue; }
      if (schedDepth === 0) continue;
      if (t.name === "ScheduleFormHeading") { headKind = "sched"; hLabel = ""; hTitle = ""; continue; }
      if (t.name === "GroupHeading") { headKind = "group"; hLabel = ""; hTitle = ""; continue; }
      if (!t.selfClose && (t.name === "Label" || t.name === "TitleText" || t.name === "Text")) { cap = t.name; capBuf = ""; continue; }
      if (t.name === "row") { rowCells = []; continue; }
      if (t.name === "entry") { if (!t.selfClose) { inEntry = true; entryBuf = ""; } continue; }
      if (!t.selfClose && SCHED_UNIT.has(t.name)) units.push({ buf: "" });
      continue;
    }
    // close
    if (cap === "Text" && t.name === "Text") {
      if (units.length) units[units.length - 1].buf += " " + capBuf + " ";
      else push(capBuf);
      cap = null; capBuf = ""; continue;
    }
    if (cap && (t.name === "Label" || t.name === "TitleText")) {
      if (headKind && t.name === "Label") hLabel = squish(capBuf);
      else if (headKind && t.name === "TitleText") hTitle = squish(capBuf);
      cap = null; capBuf = ""; continue;
    }
    if (t.name === "ScheduleFormHeading") { schedLabel = hLabel || schedLabel; headKind = null; continue; }
    if (t.name === "GroupHeading") { group = [hLabel, hTitle].filter(Boolean).join(" — "); headKind = null; continue; }
    if (t.name === "entry" && inEntry) { rowCells && rowCells.push(squish(entryBuf)); inEntry = false; entryBuf = ""; continue; }
    if (t.name === "row") { if (rowCells) push(rowCells.filter(Boolean).join(" · "), "row"); rowCells = null; continue; }
    if (SCHED_UNIT.has(t.name) && units.length) { push(units.pop().buf); continue; }
    if (t.name === "Schedule" && schedDepth > 0) schedDepth--;
  }
  return out;
}

// ───────────────────────── identification ─────────────────────────
function ident(xml, code) {
  const grab = (tag) => {
    const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? squish(m[1].replace(/<[^>]+>/g, " ")) : null; // strip inner tags
  };
  const title = grab("ShortTitle") || grab("LongTitle") || code;
  const citation = grab("Chapter") || `c. ${code}`;
  return { title, citation };
}

function slugify(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// --verify oracle: assert the tree's flat projection reproduces the legacy flat
// parser's provisions exactly (id, label, kind, heading, marginalNote, text), so
// the C-265-validated engine sees an identical "before" list. Returns the first
// mismatch or null.
function compareFlat(treeFlat, legacy) {
  if (treeFlat.length !== legacy.length) {
    return `count ${treeFlat.length} vs legacy ${legacy.length}`;
  }
  const fields = ["id", "label", "kind", "marginalNote", "text"];
  for (let i = 0; i < legacy.length; i++) {
    const a = treeFlat[i], b = legacy[i];
    for (const f of fields) {
      if ((a[f] ?? null) !== (b[f] ?? null)) {
        return `#${i} ${f}: tree=${JSON.stringify(a[f])} legacy=${JSON.stringify(b[f])} (label ${JSON.stringify(b.label)})`;
      }
    }
    // heading: legacy attaches it to every provision; tree pushes the section's
    // heading down in flattenTree, so these must match too.
    if ((a.heading ?? null) !== (b.heading ?? null)) {
      return `#${i} heading: tree=${JSON.stringify(a.heading)} legacy=${JSON.stringify(b.heading)} (label ${JSON.stringify(b.label)})`;
    }
  }
  return null;
}

// ───────────────────────── per-Act ingest ─────────────────────────
async function loadRegistry() {
  try { return JSON.parse(await fs.readFile(REGISTRY_PATH, "utf8")); }
  catch { return { laws: {} }; }
}
function codeOf(entry) {
  const m = entry?.source?.xmlUrl?.match(/\/XML\/([^/]+)\.xml/i);
  return m ? m[1] : null;
}

async function ingestCode(code, registry, opts) {
  // Slug first (needed to locate the cached XML in --from-cache mode); registry
  // holds the stable slug for every code.
  const existingSlug = Object.entries(registry.laws ?? {})
    .find(([, e]) => codeOf(e) === code)?.[0];
  const existing = existingSlug ? registry.laws[existingSlug] : null;

  // XML source: the cached local copy (offline re-ingest) or a fresh fetch.
  let xml;
  if (opts.fromCache) {
    if (!existingSlug) throw new Error(`no cached dir (code ${code} not in registry)`);
    xml = await fs.readFile(path.join(OUT_BASE, existingSlug, "current.xml"), "utf8");
  } else {
    xml = await fetchText(`${BASE}/eng/XML/${code}.xml`);
  }

  // Parse the hierarchical tree; flatten it the way the loader will at runtime.
  const { sections, unknown } = parseActTree(xml, code);
  const bodyFlat = flattenTree(sections);
  const schedules = parseSchedules(xml, code, bodyFlat.length);
  const flat = bodyFlat.concat(schedules); // leaf view for coverage / fullText / counts
  const cov = coverage(xml, flat);
  const parsed = ident(xml, code);
  const missingLabel = bodyFlat.filter((p) => /^¶/.test(p.label)).length;

  // Prefer the registry's stable slug for this code; else derive (capped) from
  // the title, disambiguating with the Act code if another code already owns it.
  let slug = existingSlug || capSlug(slugify(parsed.title));
  const owner = slugOwner.get(slug);
  if (owner && owner !== code) slug = capSlug(`${slug}-${code.toLowerCase()}`);
  slugOwner.set(slug, code);
  // Prefer the registry's curated title/citation (e.g. "R.S.C., 1985, c. F-27").
  const title = existing?.title || parsed.title;
  const citation = existing?.citation || parsed.citation;

  // Oracle check: the tree's flat projection must equal the legacy flat parser.
  let verifyErr = null;
  if (opts.verify) {
    const legacy = parseActLegacy(xml, code).provisions;
    verifyErr = compareFlat(bodyFlat, legacy);
  }

  const warn = [];
  if (cov.ratio < 0.9) warn.push(`LOW COVERAGE ${(cov.ratio * 100).toFixed(1)}% of operative text`);
  if (unknown.size) warn.push(`unhandled: ${[...unknown].map(([k, n]) => `${k}×${n}`).join(", ")}`);
  if (missingLabel) warn.push(`${missingLabel} provisions missing a Label`);
  if (verifyErr) warn.push(`TREE≠LEGACY ${verifyErr}`);

  const flag = verifyErr ? "✗" : warn.length ? "⚠" : "✓";
  console.log(
    `${flag} ${code.padEnd(8)} ${slug.padEnd(34)} ` +
    `${String(flat.length).padStart(5)} provisions  ` +
    `cov ${(cov.ratio * 100).toFixed(1)}%` +
    (warn.length ? `  — ${warn.join("; ")}` : ""),
  );

  if (opts.dry || opts.verify) return { slug, code, verifyErr };

  const normalized = {
    title, citation, jurisdiction: "Canada", level: "federal",
    code,
    currentPath: `data/laws/current/federal/${slug}`,
    source: { publisher: "Justice Laws Website", xmlUrl: `${BASE}/eng/XML/${code}.xml`, htmlUrl: `${BASE}/eng/acts/${code}/index.html` },
    normalizedAt: new Date().toISOString(),
    coverage: { ratio: Number(cov.ratio.toFixed(4)), provisions: flat.length, scheduleHasText: cov.scheduleHasText },
    sections,    // ← hierarchical tree: Section › Subsection › Paragraph › … (children[])
    schedules,   // ← schedules/forms/tables as a separate list
    fullText: flat.map((p) => `${p.marginalNote ? p.marginalNote + "\n" : ""}${p.label} ${p.text}`).join("\n\n"),
  };

  const dir = path.join(OUT_BASE, slug);
  await fs.mkdir(dir, { recursive: true });
  if (!opts.fromCache) await fs.writeFile(path.join(dir, "current.xml"), xml, "utf8");
  await fs.writeFile(path.join(dir, "current.normalized.json"), JSON.stringify(normalized, null, 2), "utf8");

  if (opts.writeRegistry) {
    registry.laws ??= {};
    registry.laws[slug] = {
      ...(registry.laws[slug] ?? {}),
      title, citation, jurisdiction: "Canada", level: "federal",
      currentPath: normalized.currentPath,
      source: { publisher: "Justice Laws Website", htmlUrl: normalized.source.htmlUrl, xmlUrl: normalized.source.xmlUrl },
      relatedBills: registry.laws[slug]?.relatedBills ?? [],
    };
  }
  return { slug, code };
}

// ───────────────────────── discovery (A–Z index) ─────────────────────────
async function listCodes(letter) {
  const html = await fetchText(`${BASE}/eng/acts/${letter}.html`);
  const codes = new Map();
  // Index pages link to each Act with a RELATIVE href, e.g. `I-3.3/index.html`.
  const re = /href="([A-Z]-[\w.-]+)\/(?:index|FullText)\.html"/g;
  let m;
  while ((m = re.exec(html))) codes.set(m[1], true);
  return [...codes.keys()];
}

// ───────────────────────── main ─────────────────────────
const args = process.argv.slice(2);
const opts = {
  dry: args.includes("--dry"),
  writeRegistry: args.includes("--write-registry"),
  fromCache: args.includes("--from-cache"), // re-parse the cached local XML, no network
  verify: args.includes("--verify"),        // assert flatten(tree) === legacy flat, write nothing
};
const positional = args.filter((a) => !a.startsWith("--"));

const registry = await loadRegistry();
for (const [slug, entry] of Object.entries(registry.laws ?? {})) {
  const c = codeOf(entry);
  if (c) slugOwner.set(slug, c);
}

if (args.includes("--list")) {
  const letter = (positional[0] || "A").toUpperCase();
  const codes = await listCodes(letter);
  console.log(`${codes.length} Acts under "${letter}":`);
  console.log(codes.join("  "));
  process.exit(0);
}

let codes;
if (args.includes("--registry") || ((opts.fromCache || opts.verify) && !positional.length)) {
  // --from-cache / --verify default to the whole registry (every ingested Act).
  codes = Object.values(registry.laws ?? {}).map(codeOf).filter(Boolean);
} else if (args.includes("--all")) {
  codes = [];
  for (const L of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    try { codes.push(...await listCodes(L)); } catch (e) { console.log(`list ${L} failed: ${e.message}`); }
  }
} else {
  codes = positional;
}

if (!codes.length) {
  console.log("Nothing to do. Pass Act codes (F-27 …), --registry, or --all. See header for usage.");
  process.exit(1);
}

const mode = opts.verify ? " (verify — no writes)" : opts.dry ? " (dry run — no writes)" : opts.fromCache ? " (from cached XML — offline)" : "";
console.log(`${opts.verify ? "Verifying" : "Ingesting"} ${codes.length} Act(s)${mode}…\n`);
let ok = 0, failed = 0, mismatched = 0;
for (const code of codes) {
  try {
    const r = await ingestCode(code, registry, opts);
    ok++;
    if (r?.verifyErr) mismatched++;
  } catch (e) { failed++; console.log(`✗ ${code.padEnd(8)} FAILED — ${e.message}`); }
  // Politeness delay only matters for live network fetches.
  if (!opts.fromCache && !opts.verify && codes.length > 20) await sleep(150);
}

if (opts.writeRegistry && !opts.dry && !opts.verify) {
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf8");
  console.log("\nregistry.json updated.");
}
console.log(`\nDone. ${ok} ok, ${failed} failed${opts.verify ? `, ${mismatched} mismatched` : ""}.`);
if (opts.verify && mismatched > 0) process.exitCode = 1;
