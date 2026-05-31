// Probe the structure of Justice Laws federal Act XML across several Acts of
// different vintages, WITHOUT printing their content. Goal: learn the schema
// and confirm (or disprove) that it is consistent enough to parse generically.
//
// Run:  node --use-system-ca scripts/probe-law-xml.mjs [CODE ...]
// e.g.  node --use-system-ca scripts/probe-law-xml.mjs F-27 A-0.6 P-9.01
//
// It prints, per Act: size, root element, an element-frequency table, the set
// of attributes seen per element, parent→children relationships for the
// structural elements, and ONE raw <Section> block (truncated) so we can see
// real shape. Nothing here is written to disk.

const ACTS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["F-27", "A-0.6", "P-9.01"];

const UA = "Ingenium-LawIngest/0.1 (legislative diff research)";
const STRUCTURAL = [
  "Statute", "Regulation", "Body", "Section", "Subsection", "Paragraph",
  "Subparagraph", "Clause", "Definition", "Heading", "MarginalNote",
  "Label", "Text", "Provision", "List", "Item", "Schedule", "FormGroup",
];

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

// Tokenize tags in order so we can track nesting with a stack.
function* tags(xml) {
  const re = /<(\/?)([A-Za-z][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    yield {
      close: m[1] === "/",
      name: m[2],
      attrs: m[3],
      selfClose: m[4] === "/",
    };
  }
}

function attrNames(attrStr) {
  const names = [];
  const re = /([A-Za-z][\w.:-]*)\s*=/g;
  let m;
  while ((m = re.exec(attrStr))) names.push(m[1]);
  return names;
}

function analyze(code, xml) {
  const freq = new Map();
  const attrsByEl = new Map();
  const childrenByEl = new Map();
  const stack = [];
  let root = null;

  for (const t of tags(xml)) {
    if (t.name === "?xml" || t.name.startsWith("!")) continue;
    if (t.close) {
      stack.pop();
      continue;
    }
    freq.set(t.name, (freq.get(t.name) ?? 0) + 1);
    if (!root) root = t.name;

    const parent = stack[stack.length - 1];
    if (parent) {
      if (!childrenByEl.has(parent)) childrenByEl.set(parent, new Set());
      childrenByEl.get(parent).add(t.name);
    }
    for (const a of attrNames(t.attrs)) {
      if (!attrsByEl.has(t.name)) attrsByEl.set(t.name, new Set());
      attrsByEl.get(t.name).add(a);
    }
    if (!t.selfClose) stack.push(t.name);
  }

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`\n${"═".repeat(70)}\n${code}  ·  ${(xml.length / 1024 / 1024).toFixed(2)} MB  ·  root <${root}>`);
  console.log(`\n  Element frequency (top 30):`);
  for (const [name, n] of sorted.slice(0, 30)) {
    console.log(`    ${String(n).padStart(6)}  ${name}`);
  }
  console.log(`\n  Distinct element count: ${freq.size}`);

  console.log(`\n  Attributes on structural elements:`);
  for (const el of STRUCTURAL) {
    if (attrsByEl.has(el)) {
      console.log(`    ${el.padEnd(14)} [${[...attrsByEl.get(el)].join(", ")}]`);
    }
  }

  console.log(`\n  Children of structural elements:`);
  for (const el of STRUCTURAL) {
    if (childrenByEl.has(el)) {
      console.log(`    ${el.padEnd(14)} → ${[...childrenByEl.get(el)].join(", ")}`);
    }
  }

  // One real <Section> block so we see how label/marginal-note/text nest.
  const secStart = xml.indexOf("<Section");
  if (secStart >= 0) {
    const secEnd = xml.indexOf("</Section>", secStart);
    const snippet = xml.slice(secStart, secEnd >= 0 ? secEnd + 10 : secStart + 800);
    console.log(`\n  First <Section> block (truncated to 900 chars):`);
    console.log(snippet.slice(0, 900).replace(/^/gm, "    "));
  }
}

for (const code of ACTS) {
  try {
    const xml = await fetchText(`https://laws-lois.justice.gc.ca/eng/XML/${code}.xml`);
    analyze(code, xml);
  } catch (err) {
    console.log(`\n${code}: FAILED — ${err.message}`);
  }
}
