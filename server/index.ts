import express from "express";
import cors from "cors";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { billsRouter } from "./routes/bills.js";
import { lawVersionsRouter } from "./routes/lawVersions.js";
import { clientsRouter } from "./routes/clients.js";
import { clientImpactRouter } from "./routes/clientImpact.js";
import { seedDemo } from "./seed/seedDemo.js";

// Load .env if present (no dotenv dep — DIY, keeps deps small)
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

async function main() {
  await loadEnv();
  await seedDemo();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "4mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/bills", billsRouter);
  app.use("/api/law-versions", lawVersionsRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/client-impact", clientImpactRouter);

  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => {
    console.log(`[injenium] api listening on :${port}`);
    if (!process.env.GEMINI_API_KEY) console.log("[injenium] GEMINI_API_KEY missing — fallback mode");
    if (!process.env.RESEND_API_KEY) console.log("[injenium] RESEND_API_KEY missing — emails simulated");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
