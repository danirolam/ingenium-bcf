import { createApp } from "./app.js";

// Local dev entry. On Vercel the app is served via api/index.ts instead.
async function main() {
  const app = await createApp();

  const port = Number(process.env.PORT ?? 8787);
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
