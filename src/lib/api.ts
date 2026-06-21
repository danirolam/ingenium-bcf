import type {
  AmendmentFailure,
  Bill,
  Client,
  ClientImpactAnalysis,
  DeltaIndexEntry,
  LawVersion,
  ProvisionDelta,
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

export type ProvisionDeltaResult = {
  deltas: ProvisionDelta[];
  errors: string[];
  failures?: AmendmentFailure[];
  /** The server logs from this run, verbatim, for the Inspect panel. */
  logs?: string[];
  cached?: boolean;
  computedAt?: string;
  aiIncomplete?: boolean;
  aiIncompleteReason?: "rate-limit" | "ai-error" | null;
  /** How many times the AI was rate-limited and auto-retried this run. */
  rateLimited?: number;
};

export const api = {
  bills: {
    list: (signal?: AbortSignal) => j<Bill[]>("/api/bills", { signal }),
    get: (id: string, signal?: AbortSignal) => j<Bill>(`/api/bills/${id}`, { signal }),
    // Stage-2 Delta Library: every bill that already has a generated provision
    // delta (its own isolated read-only route, not under the bills router).
    deltas: (signal?: AbortSignal) =>
      j<DeltaIndexEntry[]>("/api/provision-deltas", { signal }),
    upload: (raw: unknown) =>
      j<{ bill: Bill; email: EmailResult }>("/api/bills/upload", {
        method: "POST",
        body: JSON.stringify(raw),
      }),
    // Live-refresh the current session: pull LEGISinfo, add new bills (with text)
    // and update changed ones, persisting to the store + Blob. Slow-ish (network).
    refresh: (session = "45-1") =>
      j<{
        session: string;
        added: string[];
        updated: string[];
        withText: string[];
        total: number;
        errors: string[];
      }>(`/api/bills/refresh?session=${encodeURIComponent(session)}`, { method: "POST" }),
    // Remove a bill from the store (testing aid for Refresh). Persists to Blob too.
    remove: (id: string) =>
      j<{ ok: boolean; id: string; billNumber: string; total: number }>(
        `/api/bills/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    extractDelta: (id: string, signal?: AbortSignal) =>
      j<{ lawVersions: LawVersion[]; errors: string[] }>(
        `/api/bills/${id}/extract-delta`,
        { method: "POST", signal },
      ),
    lawVersions: (id: string) =>
      j<LawVersion[]>(`/api/bills/${id}/law-versions`),
    // Grounded provision-level delta for registered Acts (AI-interpreted,
    // verified against the structured Act). Pass refresh to re-run the AI.
    provisionDelta: (id: string, refresh = false, signal?: AbortSignal) =>
      j<ProvisionDeltaResult>(
        `/api/bills/${id}/provision-delta${refresh ? "?refresh=1" : ""}`,
        { method: "POST", signal },
      ),
    // Streaming recompute: the server emits one NDJSON {type:"log"} per server log
    // line as the AI works (so the Inspect panel fills live), then a final
    // {type:"result"}. onLog is called for each line as it arrives.
    provisionDeltaStream: async (
      id: string,
      onLog: (line: string) => void,
      signal?: AbortSignal,
    ): Promise<ProvisionDeltaResult> => {
      const res = await fetch(`/api/bills/${id}/provision-delta?refresh=1&stream=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let result: ProvisionDeltaResult | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let msg: { type?: string; line?: string; data?: ProvisionDeltaResult };
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.type === "log" && typeof msg.line === "string") onLog(msg.line);
          else if (msg.type === "result" && msg.data) result = msg.data;
        }
      }
      if (!result) throw new Error("stream ended without a result");
      return result;
    },
    // Per-amendment approvals (the phase-2 gate). Keys are "<actSlug>#<opIndex>".
    approvals: {
      get: (id: string, signal?: AbortSignal) =>
        j<{ keys: string[] }>(`/api/bills/${id}/approvals`, { signal }),
      set: (id: string, body: { key?: string; keys?: string[]; approved: boolean }) =>
        j<{ keys: string[] }>(`/api/bills/${id}/approvals`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
    },
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
    // Stage-3 scanner entry point: notify:true so the ONE "Client Impact Ready"
    // email is sent here, when a brief is generated from the scan. Stage-4's
    // analyzeWithGuidance omits notify, so it never re-sends on a later regen.
    analyze: (clientId: string, billId: string) =>
      j<{ analysis: ClientImpactAnalysis; email: EmailResult }>(
        "/api/client-impact/analyze",
        {
          method: "POST",
          body: JSON.stringify({ clientId, billId, notify: true }),
        },
      ),
    // The brief is keyed by (client, bill); returns the latest one or 404.
    byPair: (clientId: string, billId: string) =>
      j<ClientImpactAnalysis>(
        `/api/client-impact/by-pair?clientId=${encodeURIComponent(clientId)}&billId=${encodeURIComponent(billId)}`,
      ),
    get: (id: string) => j<ClientImpactAnalysis>(`/api/client-impact/${id}`),
    // `analysis` is sent so the server can recover the brief if the request
    // lands on a different serverless instance than the one /analyze wrote to
    // (per-instance /tmp). Harmless when the instance already has it.
    save: (id: string, analysis?: ClientImpactAnalysis) =>
      j<ClientImpactAnalysis>(`/api/client-impact/${id}/save`, {
        method: "POST",
        body: JSON.stringify(analysis ? { analysis } : {}),
      }),
    // Send the approved, client-facing draft to the client (stage 4). The
    // counsel notification is a separate, earlier email (stage-3 scan).
    emailClient: (id: string, analysis?: ClientImpactAnalysis) =>
      j<{ email: EmailResult }>(`/api/client-impact/${id}/email-client`, {
        method: "POST",
        body: JSON.stringify(analysis ? { analysis } : {}),
      }),
  },
};
