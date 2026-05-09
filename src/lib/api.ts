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
      j<LawVersion>(`/api/bills/${id}/extract-delta`, { method: "POST" }),
  },
  lawVersions: {
    list: () => j<LawVersion[]>("/api/law-versions"),
    get: (id: string) => j<LawVersion>(`/api/law-versions/${id}`),
    approve: (id: string) =>
      j<LawVersion>(`/api/law-versions/${id}/approve`, { method: "POST" }),
    needsReview: (id: string, reason?: string) =>
      j<LawVersion>(`/api/law-versions/${id}/needs-review`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
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
    analyze: (clientId: string, lawVersionId: string) =>
      j<{ analysis: ClientImpactAnalysis; email: EmailResult }>(
        "/api/client-impact/analyze",
        {
          method: "POST",
          body: JSON.stringify({ clientId, lawVersionId }),
        },
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
