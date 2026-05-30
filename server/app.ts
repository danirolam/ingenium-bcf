import express, { type Express } from "express";
import cors from "cors";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { billsRouter } from "./routes/bills.js";
import { lawVersionsRouter } from "./routes/lawVersions.js";
import { clientsRouter } from "./routes/clients.js";
import { clientImpactRouter } from "./routes/clientImpact.js";
import { seedDemo } from "./seed/seedDemo.js";

// Load .env if present (no dotenv dep — DIY, keeps deps small).
// On Vercel there is no .env file; env vars come from the platform, so this
// quietly no-ops.
async function loadEnv() {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const envPath = path.resolve(__dirname, "..", ".env");
    const txt = await fs.readFile(envPath, "utf-8");
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

/**
 * Build the Express app, load env, and seed the demo store once.
 * Shared by the local dev entry (server/index.ts) and the Vercel
 * serverless entry (api/index.ts).
 */
export async function createApp(): Promise<Express> {
  await loadEnv();
  await seedDemo();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "4mb" }));

  // Health + integration status. After wiring GEMINI_API_KEY, `ai.enabled`
  // flips to true here — the one check the team needs to confirm the key took.
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      ai: {
        enabled: Boolean(process.env.GEMINI_API_KEY),
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      },
      email: { enabled: Boolean(process.env.RESEND_API_KEY) },
    }),
  );
  app.use("/api/bills", billsRouter);
  app.use("/api/law-versions", lawVersionsRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/client-impact", clientImpactRouter);

  return app;
}
