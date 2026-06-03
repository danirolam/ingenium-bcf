// Ingest Canadian federal Act XML from the Justice Laws website into a
// diff-friendly normalized structure, with a built-in coverage validator so we
// KNOW when an Act doesn't fit the model instead of emitting silent garbage.
//
// The Justice Laws "LIMS" XML is consistent across vintages (see
// scripts/probe-law-xml.mjs): root <Statute>, a <Body> of <Heading>/<Section>,
// and a strict Section › Subsection › Paragraph › Subparagraph › Clause
// hierarchy where every provision has <Label>, optional <MarginalNote>, <Text>,
// and a STABLE lims:id. We parse on that real structure and key each provision
// by lims:id — the identity a clean git-diff needs.
//
// Usage:
//   node --use-system-ca scripts/ingest-acts.mjs F-27 A-0.6 P-9.01   # ingest codes
//   node --use-system-ca scripts/ingest-acts.mjs --registry          # re-ingest every Act in registry.json
//   node --use-system-ca scripts/ingest-acts.mjs --list A            # discover Act codes under letter A
//   node --use-system-ca scripts/ingest-acts.mjs F-27 --dry          # parse + validate, write nothing
//   node --use-system-ca scripts/ingest-acts.mjs F-27 --write-registry  # also merge a registry entry
//
// Writes (unless --dry):
//   data/laws/current/federal/<slug>/current.xml
//   data/laws/current/federal/<slug>/current.normalized.json   (superset of the old format)

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

// ───────────────────────── parser ─────────────────────────
function parseAct(xml, code) {
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

// Section-level compatibility view (old format): group leaf provisions by section.
function sectionsView(provisions) {
  const out = [];
  let cur = null;
  for (const p of provisions) {
    const secNum = (p.label.match(/^[^()]+/) ?? [p.label])[0];
    if (!cur || cur.label !== secNum) {
      cur = { label: secNum, marginalNote: p.marginalNote ?? "", text: "" };
      out.push(cur);
    }
    if (!cur.marginalNote && p.marginalNote) cur.marginalNote = p.marginalNote;
    cur.text += (cur.text ? " " : "") + `${p.label} ${p.text}`;
  }
  return out;
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
  const xml = await fetchText(`${BASE}/eng/XML/${code}.xml`);
  const { provisions: body, unknown, missingLabel } = parseAct(xml, code);
  const provisions = body.concat(parseSchedules(xml, code, body.length));
  const cov = coverage(xml, provisions);
  const parsed = ident(xml, code);

  // Reuse the existing slug for already-registered Acts; else derive from title.
  const existingSlug = Object.entries(registry.laws ?? {})
    .find(([, e]) => codeOf(e) === code)?.[0];
  const existing = existingSlug ? registry.laws[existingSlug] : null;
  // Prefer the registry's stable slug for this code; else derive (capped) from
  // the title, disambiguating with the Act code if another code already owns it.
  let slug = existingSlug || capSlug(slugify(parsed.title));
  const owner = slugOwner.get(slug);
  if (owner && owner !== code) slug = capSlug(`${slug}-${code.toLowerCase()}`);
  slugOwner.set(slug, code);
  // Prefer the registry's curated title/citation (e.g. "R.S.C., 1985, c. F-27").
  const title = existing?.title || parsed.title;
  const citation = existing?.citation || parsed.citation;

  const warn = [];
  if (cov.ratio < 0.9) warn.push(`LOW COVERAGE ${(cov.ratio * 100).toFixed(1)}% of operative text`);
  if (unknown.size) warn.push(`unhandled: ${[...unknown].map(([k, n]) => `${k}×${n}`).join(", ")}`);
  if (missingLabel) warn.push(`${missingLabel} provisions missing a Label`);

  const flag = warn.length ? "⚠" : "✓";
  console.log(
    `${flag} ${code.padEnd(8)} ${slug.padEnd(34)} ` +
    `${String(provisions.length).padStart(5)} provisions  ` +
    `cov ${(cov.ratio * 100).toFixed(1)}%` +
    (warn.length ? `  — ${warn.join("; ")}` : ""),
  );

  if (opts.dry) return { slug, code };

  const normalized = {
    title, citation, jurisdiction: "Canada", level: "federal",
    code,
    currentPath: `data/laws/current/federal/${slug}`,
    source: { publisher: "Justice Laws Website", xmlUrl: `${BASE}/eng/XML/${code}.xml`, htmlUrl: `${BASE}/eng/acts/${code}/index.html` },
    normalizedAt: new Date().toISOString(),
    coverage: { ratio: Number(cov.ratio.toFixed(4)), provisions: provisions.length, scheduleHasText: cov.scheduleHasText },
    provisions,                          // ← leaf-level diff units, keyed by stable lims:id
    sections: sectionsView(provisions),  // ← Section-level compat view (old consumers)
    fullText: provisions.map((p) => `${p.marginalNote ? p.marginalNote + "\n" : ""}${p.label} ${p.text}`).join("\n\n"),
  };

  const dir = path.join(OUT_BASE, slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "current.xml"), xml, "utf8");
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
if (args.includes("--registry")) {
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

console.log(`Ingesting ${codes.length} Act(s)${opts.dry ? " (dry run — no writes)" : ""}…\n`);
let ok = 0, failed = 0;
for (const code of codes) {
  try { await ingestCode(code, registry, opts); ok++; }
  catch (e) { failed++; console.log(`✗ ${code.padEnd(8)} FAILED — ${e.message}`); }
  if (codes.length > 20) await sleep(150); // be polite to laws-lois on a full run
}

if (opts.writeRegistry && !opts.dry) {
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf8");
  console.log("\nregistry.json updated.");
}
console.log(`\nDone. ${ok} ok, ${failed} failed.`);
