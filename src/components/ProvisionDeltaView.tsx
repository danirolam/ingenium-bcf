import { Fragment, useRef, useState, type ReactNode } from "react";
import { PageHeader } from "./PageHeader";
import type { ActProvision, Bill, BillAmendmentOp, ProvisionDelta, ProvisionDiffRow } from "../types";

// Where this delta came from: cache, deterministic bill-XML parse, or AI-assisted.
function sourceBadge(cached: boolean, deltas: ProvisionDelta[]): { label: string; cls: string } {
  if (cached) return { label: "⚡ Cached", cls: "is-cached" };
  const usedAi = deltas.some((d) => d.source === "ai" || d.source === "ai-assisted");
  return usedAi
    ? { label: "✨ AI-assisted", cls: "is-ai" }
    : { label: "📄 From bill text", cls: "is-parsed" };
}

function actDisplayName(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "");
}

const keyOf = (slug: string, i: number) => `${slug}#${i}`;

// One provision, formatted readably: marginal note as a heading, then body text
// prefixed by only its OWN label segment (the parent ids are implied by the
// indentation). Colour alone signals add/remove/change — no +/−/~ needed.
export function ProvBlock({
  prov,
  variant,
}: {
  prov: ActProvision;
  variant: "added" | "repealed" | "changed" | "plain";
}) {
  const depth = Math.max(0, (prov.path?.length ?? 1) - 1);
  // Show only the leaf: "30.002(b)(i)" → "(i)"; a top-level section stays whole.
  const leaf = prov.label.match(/\([^)]*\)$/)?.[0] ?? prov.label;
  return (
    <div className={`lawdiff-row v-${variant}`} style={{ paddingLeft: 16 + depth * 22 }} title={prov.label}>
      {prov.marginalNote && <div className="lawdiff-mn">{prov.marginalNote}</div>}
      <div className="lawdiff-text">
        <span className="lawdiff-label">{leaf}</span> {prov.text}
      </div>
    </div>
  );
}

const CTX_STEP = 3; // provisions revealed per expander click

// GitHub-style provision diff: added (green), repealed (red), changed (whole
// paragraph yellow), unchanged collapsed — expanding reveals a few provisions of
// context at a time (from either end), not the whole run.
function LawDiff({ rows }: { rows: ProvisionDiffRow[] }) {
  // Per collapsed-run reveal state: how many shown from the top / bottom.
  const [rev, setRev] = useState<Record<number, { top: number; bot: number }>>({});
  const bump = (id: number, end: "top" | "bot", n: number) =>
    setRev((r) => {
      const cur = r[id] ?? { top: 0, bot: 0 };
      return { ...r, [id]: { ...cur, [end]: cur[end] + n } };
    });

  const blocks: (
    | { type: "ctx"; rows: ProvisionDiffRow[]; id: number }
    | { type: "chg"; row: ProvisionDiffRow; id: number }
  )[] = [];
  let run: ProvisionDiffRow[] = [];
  let id = 0;
  const flush = () => {
    if (run.length) { blocks.push({ type: "ctx", rows: run, id: id++ }); run = []; }
  };
  for (const r of rows) {
    if (r.status === "unchanged") run.push(r);
    else { flush(); blocks.push({ type: "chg", row: r, id: id++ }); }
  }
  flush();

  const plain = (r: ProvisionDiffRow, k: string) => (
    <ProvBlock key={k} prov={(r.after ?? r.before)!} variant="plain" />
  );

  return (
    <div className="lawdiff">
      {blocks.map((b) => {
        if (b.type === "ctx") {
          const total = b.rows.length;
          const st = rev[b.id] ?? { top: 0, bot: 0 };
          const top = Math.min(st.top, total);
          const bot = Math.min(st.bot, total - top);
          const hidden = total - top - bot;
          return (
            <Fragment key={b.id}>
              {b.rows.slice(0, top).map((r, i) => plain(r, `${b.id}-t${i}`))}
              {hidden > 0 && (
                <div className="lawdiff-fold">
                  <div className="lawdiff-fold-btns">
                    <button
                      className="lawdiff-fold-btn"
                      title="Show provisions above"
                      onClick={() => bump(b.id, "bot", Math.min(CTX_STEP, hidden))}
                    >
                      ↑
                    </button>
                    <button
                      className="lawdiff-fold-btn"
                      title="Show provisions below"
                      onClick={() => bump(b.id, "top", Math.min(CTX_STEP, hidden))}
                    >
                      ↓
                    </button>
                  </div>
                  <span className="lawdiff-fold-count">{hidden} unchanged</span>
                </div>
              )}
              {bot > 0 && b.rows.slice(total - bot).map((r, i) => plain(r, `${b.id}-b${i}`))}
            </Fragment>
          );
        }
        const r = b.row;
        if (r.status === "added" && r.after) return <ProvBlock key={b.id} prov={r.after} variant="added" />;
        if (r.status === "repealed" && r.before) return <ProvBlock key={b.id} prov={r.before} variant="repealed" />;
        if (r.status === "changed" && r.after) return <ProvBlock key={b.id} prov={r.after} variant="changed" />;
        return null;
      })}
    </div>
  );
}

// Left navigation: every Act the bill touches, with change counts and a flag
// count. Click to jump to that Act's section.
function ActsRail({ deltas, onJump }: { deltas: ProvisionDelta[]; onJump: (slug: string) => void }) {
  return (
    <div className="card pd-acts-rail">
      <div className="pd-acts-rail-head">Acts affected ({deltas.length})</div>
      {deltas.map((d) => {
        const flagged = (d.operations ?? []).filter((o) => !o.anchorFound).length;
        return (
          <button className="pd-acts-rail-item" key={d.slug} onClick={() => onJump(d.slug)}>
            <span className="pd-acts-rail-name">{actDisplayName(d.title)}</span>
            <span className="pd-acts-rail-counts">
              <span className="add">+{d.summary.added}</span>
              <span className="chg">~{d.summary.changed}</span>
              <span className="del">−{d.summary.repealed}</span>
              {flagged > 0 && <span className="pd-flag-dot" title={`${flagged} need review`}>⚠{flagged}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The PR-review checklist: every amendment this bill makes to this Act, with a
// verified/flagged badge and an approve checkbox.
function AmendmentsReview({
  slug,
  ops,
  approvedKeys,
  onToggle,
  onApproveAll,
}: {
  slug: string;
  ops: BillAmendmentOp[];
  approvedKeys: Set<string>;
  onToggle: (k: string) => void;
  onApproveAll: (slug: string, n: number) => void;
}) {
  const approved = ops.filter((_, i) => approvedKeys.has(keyOf(slug, i))).length;
  return (
    <div className="pd-review">
      <div className="pd-review-head">
        <span className="pd-review-title">
          Amendments — <b>{approved}/{ops.length}</b> approved
        </span>
        <button className="btn ghost sm" onClick={() => onApproveAll(slug, ops.length)}>
          Approve all
        </button>
      </div>
      <div className="pd-review-list">
        {ops.map((op, i) => {
          const k = keyOf(slug, i);
          const ok = approvedKeys.has(k);
          return (
            <label className={`pd-amend ${op.anchorFound ? "" : "is-flagged"} ${ok ? "is-approved" : ""}`} key={i}>
              <input type="checkbox" checked={ok} onChange={() => onToggle(k)} />
              <span className={`pd-amend-op op-${op.op}`}>{op.op}</span>
              <span className="pd-amend-anchor">
                {op.anchorFound ? "" : "⚠ "}
                {op.anchor ?? "new part"}
              </span>
              <span className="pd-amend-note">{op.note}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// The bill's official PDF, proxied through our backend so it embeds.
function BillColumn({ bill }: { bill: Bill | null }) {
  if (!bill) return null;
  return (
    <aside className="pd-bill-col">
      <div className="pd-bill-head">
        <span>{bill.billNumber} — official bill</span>
        {bill.sourceUrl && (
          <a href={bill.sourceUrl} target="_blank" rel="noreferrer" className="pd-bill-ext">
            parl.ca ↗
          </a>
        )}
      </div>
      <iframe className="pd-bill-pdf" src={`/api/bills/${bill.id}/pdf`} title={`${bill.billNumber} PDF`} />
    </aside>
  );
}

export function ProvisionDeltaView({
  bill,
  deltas,
  cached = false,
  incomplete = null,
  refreshing = false,
  onRefresh,
  beforeBody,
}: {
  bill: Bill | null;
  deltas: ProvisionDelta[];
  cached?: boolean;
  /** Set when an AI call was cut short: "rate-limit", "ai-error", or true. */
  incomplete?: "rate-limit" | "ai-error" | true | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Rendered between the page header and the body (e.g. the phase nav). */
  beforeBody?: ReactNode;
}) {
  const [showBill, setShowBill] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const badge = sourceBadge(cached, deltas);

  const toggleCollapse = (slug: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(slug) ? n.delete(slug) : n.add(slug);
      return n;
    });
  const toggleApprove = (k: string) =>
    setApproved((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  const approveAll = (slug: string, n: number) =>
    setApproved((s) => {
      const x = new Set(s);
      for (let i = 0; i < n; i++) x.add(keyOf(slug, i));
      return x;
    });
  const jump = (slug: string) => refs.current[slug]?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Legal delta", bill?.billNumber ?? "Bill"]}
        title={`Legal delta — ${bill?.billNumber ?? ""}`}
        sub={bill?.title}
        actions={
          <div className="pd-source">
            <span className={`pd-source-badge ${badge.cls}`}>{badge.label}</span>
            <button className="btn ghost sm" onClick={() => setShowBill((v) => !v)}>
              {showBill ? "Hide bill" : "Show bill"}
            </button>
            {onRefresh && (
              <button className="btn ghost sm" disabled={refreshing} onClick={onRefresh}>
                {refreshing ? "Recomputing…" : "Recompute"}
              </button>
            )}
          </div>
        }
      />
      {beforeBody}
      {incomplete && (
        <div className="pd-incomplete" role="alert">
          <span className="pd-incomplete-icon">⚠</span>
          <span>
            {incomplete === "rate-limit"
              ? "Analysis incomplete — hit the AI rate limit. Showing the changes computed so far; "
              : "Analysis incomplete — an AI call failed. Showing the changes computed so far; "}
            re-run in a minute for the full delta.
          </span>
          {onRefresh && (
            <button className="btn ghost sm" disabled={refreshing} onClick={onRefresh}>
              {refreshing ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      )}
      <div className={`body pd-layout ${showBill ? "with-bill" : ""}`}>
        <ActsRail deltas={deltas} onJump={jump} />

        <div className="pd-main">
          {deltas.map((d) => {
            const isCollapsed = collapsed.has(d.slug);
            const ops = d.operations ?? [];
            return (
              <div className="card pd-act" key={d.slug} ref={(el) => { refs.current[d.slug] = el; }}>
                <button className="pd-act-head pd-act-toggle" onClick={() => toggleCollapse(d.slug)}>
                  <div className="pd-act-title">
                    <span className="pd-caret">{isCollapsed ? "▸" : "▾"}</span>
                    <b>{actDisplayName(d.title)}</b> <span className="pd-cite">{d.citation}</span>
                  </div>
                  <div className="pd-counts">
                    <span className="add">+{d.summary.added}</span>
                    <span className="chg">~{d.summary.changed}</span>
                    <span className="del">−{d.summary.repealed}</span>
                  </div>
                </button>

                {!isCollapsed && (
                  <>
                    {ops.length > 0 && (
                      <AmendmentsReview
                        slug={d.slug}
                        ops={ops}
                        approvedKeys={approved}
                        onToggle={toggleApprove}
                        onApproveAll={approveAll}
                      />
                    )}
                    {d.rows.length > 0 ? (
                      <LawDiff rows={d.rows} />
                    ) : (
                      <div className="pd-empty">No provision-level changes detected.</div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {showBill && <BillColumn bill={bill} />}
      </div>
    </>
  );
}
