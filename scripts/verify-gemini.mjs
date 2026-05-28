// Quick connectivity check for the Gemini API.
//   node --use-system-ca scripts/verify-gemini.mjs
// Reads .env (GEMINI_API_KEY, optional GEMINI_MODEL), pings the model with a
// trivial JSON prompt, and reports pass/fail with a short diagnostic.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenerativeAI } from "@google/generative-ai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadEnv() {
  try {
    const txt = await fs.readFile(path.resolve(__dirname, "..", ".env"), "utf-8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, v] = m;
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* no .env, fine */
  }
}

function fail(msg) {
  console.error(`\n  FAIL: ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`\n  OK: ${msg}\n`);
}

async function main() {
  await loadEnv();

  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!key) {
    fail(
      "GEMINI_API_KEY is empty. Paste your key into .env and re-run.\n" +
        "       Get a key: https://aistudio.google.com/apikey",
    );
  }

  console.log(`[verify] using model: ${model}`);
  console.log(`[verify] key length:  ${key.length} chars`);

  const genAI = new GoogleGenerativeAI(key);
  const m = genAI.getGenerativeModel({
    model,
    generationConfig: { responseMimeType: "application/json" },
  });

  let response;
  try {
    response = await m.generateContent(
      'Return strict JSON: {"ping":"pong","modelEcho":"' + model + '"}',
    );
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (/API key not valid/i.test(msg)) {
      fail(`API key rejected by Google. Re-check the key in .env.\n       Detail: ${msg}`);
    }
    if (/not found|404|unsupported/i.test(msg)) {
      fail(
        `Model "${model}" is not available for this key.\n` +
          `       Try GEMINI_MODEL=gemini-3-flash (free tier) or gemini-2.5-flash.\n` +
          `       Detail: ${msg}`,
      );
    }
    fail(`Request failed: ${msg}`);
  }

  let text;
  try {
    text = response.response.text();
    JSON.parse(text);
  } catch (err) {
    fail(`Got a response but it wasn't JSON: ${err?.message ?? err}\n  Raw: ${text}`);
  }

  ok(`Gemini reachable. Sample response: ${text}`);
}

main().catch((err) => fail(err?.message ?? String(err)));
