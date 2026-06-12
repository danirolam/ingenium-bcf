import { Router } from "express";
import type { Client, ClientImpactAnalysis } from "../../src/types.js";
import { findRecord, safe, withFileLock } from "../services/clientScan.js";
import {
  FILES,
  readAll,
  removeById,
  upsert,
  writeAll,
} from "../services/jsonStore.js";

// Same coercion as POST: accept an array or a comma-separated string.
function coerceJurisdictions(v: unknown, fallback: string[]): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    return v.split(",").map((s: string) => s.trim()).filter(Boolean);
  }
  return fallback;
}

// riskTolerance is a closed enum — anything else is ignored (POST) or keeps
// the existing value (PUT) rather than writing garbage into the store.
const RISK_LEVELS = ["low", "medium", "high"] as const;
function coerceRiskTolerance(v: unknown): Client["riskTolerance"] | undefined {
  return (RISK_LEVELS as readonly string[]).includes(v as string)
    ? (v as Client["riskTolerance"])
    : undefined;
}

export const clientsRouter = Router();

clientsRouter.get(
  "/",
  safe(async (_req, res) => {
    const clients = await readAll<Client>(FILES.clients);
    // Guard: a stored `null` element must not leak into the payload.
    res.json(clients.filter((c) => !!c && typeof c === "object"));
  }),
);

clientsRouter.get(
  "/:id",
  safe(async (req, res) => {
    const client = await findRecord<Client>(FILES.clients, String(req.params.id));
    if (!client) return res.status(404).json({ error: "not_found" });
    res.json(client);
  }),
);

clientsRouter.post(
  "/",
  safe(async (req, res) => {
    const b = req.body ?? {};
    if (typeof b.name !== "string" || !b.name.trim()) {
      return res.status(400).json({ error: "name required" });
    }
    const client: Client = {
      id: `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: b.name,
      industry: b.industry ?? "",
      jurisdictions: Array.isArray(b.jurisdictions)
        ? b.jurisdictions
        : typeof b.jurisdictions === "string"
          ? b.jurisdictions.split(",").map((s: string) => s.trim()).filter(Boolean)
          : [],
      description: b.description ?? "",
      termsAndConditions: b.termsAndConditions,
      policies: b.policies,
      operations: b.operations,
      riskTolerance: coerceRiskTolerance(b.riskTolerance),
      createdAt: new Date().toISOString(),
    };
    await withFileLock(FILES.clients, () => upsert(FILES.clients, client));
    res.json(client);
  }),
);

clientsRouter.put(
  "/:id",
  safe(async (req, res) => {
    const b = req.body ?? {};
    if (b.name !== undefined && (typeof b.name !== "string" || !b.name.trim())) {
      return res.status(400).json({ error: "name required" });
    }
    // Read + merge + write under the lock so concurrent PUTs can't lose updates.
    const updated = await withFileLock(FILES.clients, async () => {
      const existing = await findRecord<Client>(FILES.clients, String(req.params.id));
      if (!existing) return null;
      const next: Client = {
        ...existing,
        name: typeof b.name === "string" ? b.name.trim() : existing.name,
        industry: b.industry !== undefined ? b.industry : existing.industry,
        jurisdictions:
          b.jurisdictions !== undefined
            ? coerceJurisdictions(b.jurisdictions, existing.jurisdictions)
            : existing.jurisdictions,
        description: b.description !== undefined ? b.description : existing.description,
        termsAndConditions:
          b.termsAndConditions !== undefined
            ? b.termsAndConditions
            : existing.termsAndConditions,
        policies: b.policies !== undefined ? b.policies : existing.policies,
        operations: b.operations !== undefined ? b.operations : existing.operations,
        riskTolerance:
          b.riskTolerance !== undefined
            ? (coerceRiskTolerance(b.riskTolerance) ?? existing.riskTolerance)
            : existing.riskTolerance,
        id: existing.id,
        createdAt: existing.createdAt,
      };
      await upsert(FILES.clients, next);
      return next;
    });
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json(updated);
  }),
);

clientsRouter.delete(
  "/:id",
  safe(async (req, res) => {
    const id = String(req.params.id); // safe() loses the route-string param inference
    // removeById reports whether anything was removed — checking its result
    // under the lock avoids a check-then-act race between concurrent DELETEs.
    const removed = await withFileLock(FILES.clients, () =>
      removeById(FILES.clients, id),
    );
    if (!removed) return res.status(404).json({ error: "not_found" });
    // Cascade: a deleted client's impact analyses are orphans — remove them.
    // readAll → filter → writeAll is a read-modify-write: take the impacts
    // lock so a concurrent /analyze upsert isn't clobbered.
    await withFileLock(FILES.impacts, async () => {
      const impacts = (await readAll<ClientImpactAnalysis>(FILES.impacts)).filter(
        (a) => !!a && typeof a === "object",
      );
      const remaining = impacts.filter((a) => a.clientId !== id);
      if (remaining.length !== impacts.length) {
        await writeAll(FILES.impacts, remaining);
      }
    });
    res.json({ ok: true });
  }),
);
