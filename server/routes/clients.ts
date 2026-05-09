import { Router } from "express";
import type { Client } from "../../src/types.js";
import { FILES, findById, readAll, upsert } from "../services/jsonStore.js";

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
