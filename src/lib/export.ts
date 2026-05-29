// Client-side export helpers — no dependencies. CSV for lists; a Word-openable
// .doc (HTML blob) and a print-to-PDF window for documents (briefs, deltas).

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvEscape = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
) {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ];
  // BOM so Excel reads UTF-8 correctly.
  triggerDownload(
    new Blob(["﻿" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    }),
    filename,
  );
}

const DOC_STYLE = `
  body{font-family:Georgia,'Times New Roman',serif;color:#111;line-height:1.55;max-width:7.2in;margin:0 auto;padding:0.6in}
  h1{font-size:21pt;margin:0 0 2pt} h2{font-size:13pt;margin:20pt 0 6pt;border-bottom:1px solid #ddd;padding-bottom:3pt}
  h3{font-size:11pt;margin:14pt 0 4pt} p{font-size:11pt;margin:0 0 8pt} ul{font-size:11pt}
  .doc-meta{color:#555;font-size:9.5pt;margin:0 0 16pt} .doc-foot{color:#888;font-size:8.5pt;margin-top:28pt;border-top:1px solid #ddd;padding-top:8pt}
  .doc-label{font-size:8.5pt;letter-spacing:.06em;text-transform:uppercase;color:#888}
  table{border-collapse:collapse;width:100%;margin:8pt 0} td,th{border:1px solid #ccc;padding:6px 8px;font-size:10pt;text-align:left;vertical-align:top}
  blockquote{margin:6pt 0;padding:6pt 12pt;border-left:3px solid #bbb;color:#333;font-size:10.5pt}
`;

function docHtml(title: string, bodyHtml: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${DOC_STYLE}</style></head><body>${bodyHtml}</body></html>`;
}

export function downloadDoc(filename: string, title: string, bodyHtml: string) {
  triggerDownload(
    new Blob(["﻿", docHtml(title, bodyHtml)], {
      type: "application/msword",
    }),
    filename,
  );
}

/** Opens a print window (the browser's "Save as PDF" produces the PDF). */
export function printDoc(title: string, bodyHtml: string) {
  const w = window.open("", "_blank", "width=860,height=900");
  if (!w) return false;
  w.document.write(
    docHtml(title, bodyHtml) +
      "<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},250)}<\/script>",
  );
  w.document.close();
  return true;
}

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
