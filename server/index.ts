import { createApp } from "./app.js";

// Local dev entry. On Vercel the app is served via api/index.ts instead.
async function main() {
  const app = await createApp();

  // API_PORT first: generic PORT is often injected by dev tooling for the web
  // server (5173) and must not steer the API onto vite's port, where the
  // /api proxy would have nothing to reach.
  const rawPort = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
  const port = rawPort === 5173 ? 8787 : rawPort;
  app.listen(port, () => {
    console.log(`[ingenium] api listening on :${port}`);
    if (!process.env.GEMINI_API_KEY) console.log("[ingenium] GEMINI_API_KEY missing — fallback mode");
    if (!process.env.RESEND_API_KEY) console.log("[ingenium] RESEND_API_KEY missing — emails simulated");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
