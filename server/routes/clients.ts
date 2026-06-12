import { Router } from "express";
import type { Client, ClientImpactAnalysis } from "../../src/types.js";
import {
  FILES,
  findById,
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

export const clientsRouter = Router();

clientsRouter.get("/", async (_req, res) => {
  const clients = await readAll<Client>(FILES.clients);
  res.json(clients);
});

clientsRouter.get("/:id", async (req, res) => {
  const client = await findById<Client>(FILES.clients, req.params.id);
  if (!client) return res.status(404).json({ error: "not_found" });
  res.json(client);
});

clientsRouter.post("/", async (req, res) => {
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
    riskTolerance: b.riskTolerance,
    createdAt: new Date().toISOString(),
  };
  await upsert(FILES.clients, client);
  res.json(client);
});

clientsRouter.put("/:id", async (req, res) => {
  const existing = await findById<Client>(FILES.clients, req.params.id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  const b = req.body ?? {};
  if (b.name !== undefined && (typeof b.name !== "string" || !b.name.trim())) {
    return res.status(400).json({ error: "name required" });
  }
  const updated: Client = {
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
      b.riskTolerance !== undefined ? b.riskTolerance : existing.riskTolerance,
    id: existing.id,
    createdAt: existing.createdAt,
  };
  await upsert(FILES.clients, updated);
  res.json(updated);
});

clientsRouter.delete("/:id", async (req, res) => {
  const existing = await findById<Client>(FILES.clients, req.params.id);
  if (!existing) return res.status(404).json({ error: "not_found" });
  await removeById(FILES.clients, req.params.id);
  // Cascade: a deleted client's impact analyses are orphans — remove them.
  const impacts = await readAll<ClientImpactAnalysis>(FILES.impacts);
  const remaining = impacts.filter((a) => a.clientId !== req.params.id);
  if (remaining.length !== impacts.length) {
    await writeAll(FILES.impacts, remaining);
  }
  res.json({ ok: true });
});
