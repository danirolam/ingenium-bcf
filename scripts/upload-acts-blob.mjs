// Upload ingested Act corpora to Vercel Blob so production can load ANY Act
// on demand without bundling the ~GB corpus into the serverless function.
//
//   node scripts/upload-acts-blob.mjs                 # upload every ingested Act
//   node scripts/upload-acts-blob.mjs criminal-code   # upload specific slug(s)
//   node scripts/upload-acts-blob.mjs --dry           # list what would upload
//
// Reads:  data/laws/current/federal/<slug>/current.normalized.json
// Writes: Blob acts/<slug>.json (public, stable pathname)
//         data/laws/blob-manifest.json { baseUrl, uploadedAt, acts: { slug: bytes } }
//
// The manifest is committed; the server (lawProvisions.ts) reads it to know
// which Acts live in Blob and where. Token comes from BLOB_READ_WRITE_TOKEN
// (.env.local pulled via `vercel env pull --environment=production`).

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const CORPUS = path.join(REPO_ROOT, "data", "laws", "current", "federal");
const MANIFEST = path.join(REPO_ROOT, "data", "laws", "blob-manifest.json");

async function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const txt = await fs.readFile(path.join(REPO_ROOT, file), "utf-8");
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
        // Skip empties: sensitive vars (the Blob token) pull as "" — leaving
        // them unset lets the SDK fall back to VERCEL_OIDC_TOKEN exchange.
        if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
      }
    } catch {
      /* absent is fine */
    }
  }
}

async function main() {
  await loadEnv();
  // Prefer an explicit RW token; otherwise the SDK exchanges VERCEL_OIDC_TOKEN
  // (present in a production `vercel env pull`) for Blob access on its own.
  const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
  if (!token && !process.env.VERCEL_OIDC_TOKEN) {
    console.error(
      "FAIL: no BLOB_READ_WRITE_TOKEN or VERCEL_OIDC_TOKEN. Run: npx vercel env pull .env.local --environment=production",
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const only = args.filter((a) => !a.startsWith("--"));

  let slugs;
  try {
    const entries = await fs.readdir(CORPUS, { withFileTypes: true });
    slugs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    console.error(`FAIL: no corpus at ${CORPUS} — run scripts/ingest-acts.mjs first.`);
    process.exit(1);
  }
  if (only.length) slugs = slugs.filter((s) => only.includes(s));

  // Carry forward the existing manifest so partial runs accumulate.
  let manifest = { baseUrl: "", uploadedAt: "", acts: {} };
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST, "utf-8"));
  } catch {
    /* first run */
  }

  console.log(`${dry ? "Would upload" : "Uploading"} ${slugs.length} Act(s) to Blob…\n`);
  let ok = 0,
    failed = 0,
    skippedNoFile = 0,
    bytes = 0;

  // Modest concurrency — large files (Criminal Code ~tens of MB) upload fine,
  // and 4-wide keeps a ~900-Act run reasonable without hammering the API.
  const queue = [...slugs];
  async function worker() {
    for (;;) {
      const slug = queue.shift();
      if (!slug) return;
      const p = path.join(CORPUS, slug, "current.normalized.json");
      let body;
      try {
        body = await fs.readFile(p);
      } catch {
        skippedNoFile++;
        continue;
      }
      if (dry) {
        console.log(`  ${slug}  ${(body.length / 1024).toFixed(0)} KB`);
        ok++;
        continue;
      }
      try {
        const res = await put(`acts/${slug}.json`, body, {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "application/json",
          token,
        });
        manifest.baseUrl = res.url.replace(/\/acts\/.*$/, "");
        manifest.acts[slug] = body.length;
        ok++;
        bytes += body.length;
        if (ok % 25 === 0 || body.length > 5_000_000)
          console.log(`  ${ok}/${slugs.length}  ${slug}  ${(body.length / 1024).toFixed(0)} KB`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${slug} — ${e?.message ?? e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  if (!dry && ok > 0) {
    manifest.uploadedAt = new Date().toISOString();
    await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
    console.log(`\nManifest → ${path.relative(REPO_ROOT, MANIFEST)} (baseUrl ${manifest.baseUrl})`);
  }
  console.log(
    `\nDone. ${ok} uploaded (${(bytes / 1024 / 1024).toFixed(1)} MB), ${failed} failed, ${skippedNoFile} missing normalized file.`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
