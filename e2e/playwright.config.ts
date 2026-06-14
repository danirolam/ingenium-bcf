import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the Injenium client pipeline (stages 3-4).
 *
 * Determinism rules:
 *  - reuseExistingServer is ALWAYS false: we need full control of the server's
 *    env. Ports 5173 and 8787 must be free — stop your own dev server first.
 *  - The webServer env BLANKS the AI/email keys. server/app.ts loadEnv() only
 *    fills vars that are `undefined`, so an empty string both blocks the .env
 *    value from loading and is falsy at the call sites — the server takes its
 *    deterministic keyless fallback paths.
 *  - One worker, no parallelism: specs share the server's JSON store.
 *
 * Live mode (`npm run test:live`, RUN_LIVE=1): no managed webServer at all.
 * You run `npm run dev` yourself (with real keys in .env); only @live-tagged
 * specs execute and they hit http://localhost:8787 directly. globalSetup and
 * globalTeardown still run, so the seeded bill exists for the live pair.
 */
const RUN_LIVE = Boolean(process.env.RUN_LIVE);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  globalSetup: "./seed.ts",
  globalTeardown: "./teardown.ts",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: RUN_LIVE
    ? undefined
    : {
        command: "npm run dev",
        cwd: "..",
        url: "http://localhost:5173",
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          ...process.env,
          // Empty string = "defined" (so loadEnv won't pull the real key from
          // .env) AND falsy (so the server takes its keyless fallback path).
          ANTHROPIC_API_KEY: "",
          GEMINI_API_KEY: "",
          RESEND_API_KEY: "",
        } as Record<string, string>,
      },
});
