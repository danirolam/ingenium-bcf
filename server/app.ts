import express, { type Express } from "express";
import cors from "cors";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { billsRouter } from "./routes/bills.js";
import { deltaIndexRouter } from "./routes/deltaIndex.js";
import { lawVersionsRouter } from "./routes/lawVersions.js";
import { clientsRouter } from "./routes/clients.js";
import { clientImpactRouter } from "./routes/clientImpact.js";
import { seedDemo } from "./seed/seedDemo.js";
import { overlayBillsFromBlob } from "./services/billsBlob.js";

// Load .env / .env.local if present (no dotenv dep — DIY, keeps deps small).
// .env.local wins for sensitive vars (the Blob token); on Vercel there are no
// .env files (env comes from the platform), so this quietly no-ops.
async function loadEnv() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  for (const file of [".env.local", ".env"]) {
    try {
      const txt = await fs.readFile(path.resolve(__dirname, "..", file), "utf-8");
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
        if (!m) continue;
        const [, k, v] = m;
        if (v && process.env[k] === undefined) process.env[k] = v;
      }
    } catch {
      /* file absent — fine */
    }
  }
}

/**
 * Build the Express app, load env, and seed the demo store once.
 * Shared by the local dev entry (server/index.ts) and the Vercel
 * serverless entry (api/index.ts).
 */
export async function createApp(): Promise<Express> {
  await loadEnv();
  await seedDemo();
  // On Vercel, prefer the latest refreshed bills from Blob over the bundled snapshot.
  await overlayBillsFromBlob();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "4mb" }));

  // Health + integration status. After wiring an AI key, `ai.enabled` flips to
  // true here — the one check the team needs to confirm the key took. The
  // Anthropic key powers the provision delta and (absent Gemini) the client
  // memo; Gemini, if present, takes the memo and the legacy extraction.
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      ai: {
        enabled: Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY),
        anthropic: {
          enabled: Boolean(process.env.ANTHROPIC_API_KEY),
          model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
        },
        gemini: {
          enabled: Boolean(process.env.GEMINI_API_KEY),
          model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        },
      },
      email: { enabled: Boolean(process.env.RESEND_API_KEY) },
      // Durable cross-instance store (Vercel Blob) for briefs/approvals/scans/
      // deltas — on means runtime writes survive a cold serverless instance.
      durable: {
        enabled: Boolean(process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN),
      },
    }),
  );
  app.use("/api/bills", billsRouter);
  app.use("/api/provision-deltas", deltaIndexRouter);
  app.use("/api/law-versions", lawVersionsRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/client-impact", clientImpactRouter);

  return app;
}
