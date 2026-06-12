/** Playwright globalTeardown entrypoint — delegates to the surgical cleanup in seed.ts. */
import { teardown } from "./seed";

export default async function globalTeardown(): Promise<void> {
  await teardown();
}
