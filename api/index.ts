import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../server/app.js";

// Vercel serverless entry. Build the Express app + seed the demo store once
// per warm instance, then delegate every request to it. vercel.json rewrites
// /api/* here while preserving the original URL, so the app's /api/bills etc.
// routes match unchanged.
let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  appPromise ??= createApp();
  const app = await appPromise;
  return app(req, res);
}
