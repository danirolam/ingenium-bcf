import type {
  Bill,
  Client,
  ClientImpactAnalysis,
  LawVersion,
} from "../types";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return (await res.json()) as T;
}

export type EmailResult = { sent: boolean; simulated: boolean; info?: string };

export const api = {
  bills: {
    list: () => j<Bill[]>("/api/bills"),
    get: (id: string) => j<Bill>(`/api/bills/${id}`),
    upload: (raw: unknown) =>
      j<{ bill: Bill; email: EmailResult }>("/api/bills/upload", {
        method: "POST",
        body: JSON.stringify(raw),
      }),
    extractDelta: (id: string) =>
      j<{ lawVersions: LawVersion[]; errors: string[] }>(
        `/api/bills/${id}/extract-delta`,
        { method: "POST" },
      ),
    lawVersions: (id: string) =>
      j<LawVersion[]>(`/api/bills/${id}/law-versions`),
  },
  lawVersions: {
    list: () => j<LawVersion[]>("/api/law-versions"),
    get: (id: string) => j<LawVersion>(`/api/law-versions/${id}`),
    // Pass the full record so the mutation works even if this serverless
    // instance's ephemeral store doesn't have it yet.
    approve: (lv: LawVersion) =>
      j<LawVersion>(`/api/law-versions/${lv.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ lawVersion: lv }),
      }),
    needsReview: (lv: LawVersion, reason?: string) =>
      j<LawVersion>(`/api/law-versions/${lv.id}/needs-review`, {
        method: "POST",
        body: JSON.stringify({ reason, lawVersion: lv }),
      }),
    remove: (id: string) =>
      j<{ ok: boolean }>(`/api/law-versions/${id}`, { method: "DELETE" }),
  },
  clients: {
    list: () => j<Client[]>("/api/clients"),
    get: (id: string) => j<Client>(`/api/clients/${id}`),
    create: (input: Partial<Client>) =>
      j<Client>("/api/clients", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },
  clientImpact: {
    analyze: (clientId: string, billId: string) =>
      j<{ analysis: ClientImpactAnalysis; email: EmailResult }>(
        "/api/client-impact/analyze",
        {
          method: "POST",
          body: JSON.stringify({ clientId, billId }),
        },
      ),
    // The brief is keyed by (client, bill); returns the latest one or 404.
    byPair: (clientId: string, billId: string) =>
      j<ClientImpactAnalysis>(
        `/api/client-impact/by-pair?clientId=${encodeURIComponent(clientId)}&billId=${encodeURIComponent(billId)}`,
      ),
    get: (id: string) => j<ClientImpactAnalysis>(`/api/client-impact/${id}`),
    save: (id: string) =>
      j<ClientImpactAnalysis>(`/api/client-impact/${id}/save`, {
        method: "POST",
      }),
    emailLawyer: (id: string) =>
      j<{ email: EmailResult }>(`/api/client-impact/${id}/email-lawyer`, {
        method: "POST",
      }),
  },
};
