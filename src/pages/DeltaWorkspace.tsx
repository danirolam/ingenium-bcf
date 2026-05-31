import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faCircleCheck,
  faFileLines,
  faScaleBalanced,
  faShieldHalved,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import type { Nav } from "../App";
import { MomentumBadge, ReviewBadge } from "../components/badges";
import {
  buildDiffBlocks,
  countMaterialChanges,
  DiffViewer,
} from "../components/DiffViewer";
import { InfoHint } from "../components/InfoHint";
import { Tooltip } from "../components/Tooltip";
import { LegislativeJourney } from "../components/LegislativeJourney";
import { PageHeader } from "../components/PageHeader";
import { ProvisionDeltaView } from "../components/ProvisionDeltaView";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from "../components/ui/alert-1";
import { api } from "../lib/api";
import type { Bill, LawVersion, ProvisionDelta } from "../types";

function isStub(lv: LawVersion): boolean {
  return lv.baseLawId.startsWith("unregistered:") || lv.oldText.trim() === "";
}

function actDisplayName(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "");
}

// Always give counsel a route to the Act as it stands today, even when its
// consolidated text isn't loaded into the comparator — a search scoped to the
// official Justice Laws Canada consolidation lands on the current Act.
function justiceLawsUrl(actTitle: string): string {
  const act = actDisplayName(actTitle).trim();
  return `https://www.google.com/search?q=${encodeURIComponent(
    `${act} site:laws-lois.justice.gc.ca`,
  )}`;
}

export function DeltaWorkspace({ nav }: { nav: Nav }) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [lvs, setLvs] = useState<LawVersion[]>([]);
  const [pdeltas, setPdeltas] = useState<ProvisionDelta[] | null>(null);
  const [pcached, setPcached] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [techOpen, setTechOpen] = useState(false);
  const [pickList, setPickList] = useState<Bill[]>([]);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const activeLv = lvs.find((lv) => lv.id === activeId) ?? lvs[0] ?? null;

  useEffect(() => {
    const lawVersionId = nav.params.lawVersionId;
    api.bills.list().then(setPickList).catch(() => {});

    // Legacy deep-link by a specific LawVersion (rare) — keep the old path.
    if (lawVersionId) {
      api.lawVersions
        .get(lawVersionId)
        .then(async (lv) => {
          setLvs([lv]);
          setActiveId(lv.id);
          const bills = await api.bills.list();
          setBill(bills.find((b) => b.id === lv.sourceBillId) ?? null);
        })
        .catch((err) => {
          console.error(err);
          nav.toast(`Failed to load law version: ${err.message ?? err}`);
        });
      return;
    }

    // Unified loader: grounded provision delta first, old string-diff as the
    // fallback only for bills that don't map to a registered Act.
    (async () => {
      let resolved: string | null = nav.params.billId ?? null;
      if (!resolved) {
        // No bill chosen → open a sensible demo (C-273 amends 5 registered Acts).
        const bills = await api.bills.list();
        resolved =
          (bills.find((b) => b.billNumber === "C-273") ??
            bills.find((b) => /\bamend/i.test(b.title)))?.id ?? null;
      }
      if (!resolved) {
        setPdeltas([]);
        return;
      }
      const billId: string = resolved;

      const b = await api.bills.get(billId).catch(() => null);
      setBill(b);

      const res = await api.bills
        .provisionDelta(billId)
        .catch(() => ({ deltas: [], errors: [] as string[], cached: false }));
      if (res.deltas?.length) {
        setPdeltas(res.deltas);
        setPcached(Boolean(res.cached));
        if (res.errors?.length) nav.toast(res.errors[0]);
        return;
      }

      setPdeltas([]);
      const dres = await api.bills.extractDelta(billId).catch(() => null);
      const list = (dres?.lawVersions ?? []).filter((lv) => lv.sourceBillId === billId);
      setLvs(list);
      setActiveId(list[0]?.id ?? null);
      if (list.length === 0 && dres?.errors?.length) nav.toast(dres.errors[0]);
    })().catch((err) => {
      console.error(err);
      nav.toast(`Failed to load delta workspace: ${err.message ?? err}`);
    });
  }, [nav.params.billId, nav.params.lawVersionId]);

  useEffect(() => {
    if (lvs.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const id = visible[0]?.target.getAttribute("data-lv-id");
        if (id) setActiveId(id);
      },
      { rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const lv of lvs) {
      const el = sectionRefs.current[lv.id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [lvs]);

  async function approve(id: string) {
    const lv = lvs.find((x) => x.id === id);
    if (!lv) return;
    setBusy(id);
    try {
      const updated = await api.lawVersions.approve(lv);
      setLvs((arr) => arr.map((x) => (x.id === id ? updated : x)));
      nav.toast(`Approved: ${updated.baseLawTitle}`);
    } catch (err: any) {
      nav.toast(`Could not approve: ${err?.message ?? err}`);
    } finally {
      setBusy(null);
    }
  }

  async function flag(id: string) {
    const lv = lvs.find((x) => x.id === id);
    if (!lv) return;
    setBusy(id);
    try {
      const updated = await api.lawVersions.needsReview(
        lv,
        "Flagged for manual review by counsel.",
      );
      setLvs((arr) => arr.map((x) => (x.id === id ? updated : x)));
      nav.toast(`Flagged: ${updated.baseLawTitle}`);
    } catch (err: any) {
      nav.toast(`Could not flag: ${err?.message ?? err}`);
    } finally {
      setBusy(null);
    }
  }

  // Grounded provision delta available → render the clean view.
  if (pdeltas && pdeltas.length > 0) {
    const refreshDelta = async () => {
      if (!bill) return;
      setRefreshing(true);
      try {
        const res = await api.bills.provisionDelta(bill.id, true);
        if (res.deltas?.length) {
          setPdeltas(res.deltas);
          setPcached(false);
          nav.toast("Re-interpreted by AI.");
        }
      } catch (err: any) {
        nav.toast(`Could not re-run: ${err?.message ?? err}`);
      } finally {
        setRefreshing(false);
      }
    };
    return (
      <ProvisionDeltaView
        bill={bill}
        deltas={pdeltas}
        cached={pcached}
        refreshing={refreshing}
        onRefresh={refreshDelta}
      />
    );
  }

  // Still interpreting the bill against the Act — don't flash the chooser.
  if (pdeltas === null && lvs.length === 0 && !nav.params.lawVersionId) {
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Legal delta", bill?.billNumber ?? "Bill"]}
          title={`Legal delta — ${bill?.billNumber ?? ""}`}
          sub={bill?.title}
        />
        <div className="body">
          <div className="card" style={{ padding: "22px 24px" }}>
            <div className="rd-empty">Interpreting the bill against the Act…</div>
          </div>
        </div>
      </>
    );
  }

  if (lvs.length === 0) {
    const candidates = pickList
      .filter((b) => /\bamend/i.test(b.title))
      .slice(0, 24);
    const noDeltaForBill = Boolean(nav.params.billId && bill);
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Legal delta"]}
          title="Legal delta"
          hint={{
            title: "Legal delta",
            body: "Pick a bill to see exactly which sections of which Acts it changes. Bills that amend an existing Act produce a delta; bills that create a brand-new Act have nothing to diff yet.",
          }}
          sub="Choose a bill to review the changes it makes to existing law."
        />
        <div className="body">
          <div className="card" style={{ padding: "22px 24px" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700 }}>
              {noDeltaForBill
                ? `${bill?.billNumber} has no comparable Act to diff yet`
                : "Pick a bill to review"}
            </h3>
            <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
              {noDeltaForBill
                ? "This bill creates a new Act (or doesn't amend a tracked one), so there's no side-by-side delta. Open one of the amending bills below — they change existing law."
                : "Select a bill that amends an existing Act to see its legal delta."}
            </p>
            {candidates.length === 0 ? (
              <div className="rd-empty">Loading bills…</div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(258px, 1fr))",
                  gap: 10,
                }}
              >
                {candidates.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => nav.go("delta", { billId: b.id })}
                    className="dx-pick"
                    style={{
                      textAlign: "left",
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--panel)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        className="tnum"
                        style={{ color: "var(--accent-warm)", fontWeight: 600, fontFamily: "var(--mono)" }}
                      >
                        {b.billNumber}
                      </span>
                      <MomentumBadge value={b.legislativeMomentum} />
                    </span>
                    <span
                      style={{
                        fontSize: 12.5,
                        color: "var(--ink-2)",
                        lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {b.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  const billNumber = bill?.billNumber ?? activeLv?.sourceBillNumber ?? "Bill";
  const billTitle = bill?.title ?? activeLv?.sourceBillTitle ?? "Selected bill";

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Delta Workspace", billNumber]}
        title={`Delta Workspace — ${billNumber}`}
        sub={`${billTitle} · ${lvs.length} Act${lvs.length === 1 ? "" : "s"} affected`}
      />
      <div className="body delta-body">
        <div className="delta-shell-layout">
          <FilesChangedRail
            lvs={lvs}
            activeId={activeId}
            onSelect={(id) => {
              setActiveId(id);
              sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />

          <div className="delta-stack">
            {lvs.map((lv) => (
              <DeltaSection
                key={lv.id}
                lv={lv}
                busy={busy === lv.id}
                onApprove={() => approve(lv.id)}
                onFlag={() => flag(lv.id)}
                refSet={(el) => {
                  sectionRefs.current[lv.id] = el;
                }}
              />
            ))}
          </div>

          <DeltaRightRail
            bill={bill}
            activeLv={activeLv}
            lvs={lvs}
            techOpen={techOpen}
            onToggleTech={() => setTechOpen((v) => !v)}
          />
        </div>
      </div>
    </>
  );
}

function FilesChangedRail({
  lvs,
  activeId,
  onSelect,
}: {
  lvs: LawVersion[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="card files-rail">
      <div className="card-h">
        <div className="card-title-row">
          <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
          <div className="card-title">Acts changed</div>
          <InfoHint
            title="Acts this bill changes"
            body="One row per Act the bill amends. The coloured dot is the review status — green approved, red needs review, amber in review. The counts are the sections this bill adds (+), removes (−), and changes (~). Click a row to compare it on the right; the highlighted row is the one shown."
          />
        </div>
        <span className="badge outline dim">{lvs.length}</span>
      </div>
      <div className="files-legend">
        <span className="add">+ added</span>
        <span className="del">− removed</span>
        <span className="chg">~ changed</span>
        <span className="files-legend-unit">sections</span>
      </div>
      <div className="files-list">
        {lvs.map((lv) => (
          <FileRow
            key={lv.id}
            lv={lv}
            active={activeId === lv.id}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function FileRow({
  lv,
  active,
  onSelect,
}: {
  lv: LawVersion;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const counts = useMemo(
    () => countMaterialChanges(buildDiffBlocks(lv.oldText, lv.updatedText)),
    [lv.oldText, lv.updatedText],
  );
  const stub = isStub(lv);

  return (
    <button
      type="button"
      className={`file-row ${active ? "active" : ""}`}
      aria-current={active ? "true" : undefined}
      onClick={() => onSelect(lv.id)}
    >
      <span className="file-row-name">{actDisplayName(lv.baseLawTitle)}</span>
      <span className="file-row-meta">
        <ReviewBadge required={lv.humanReviewRequired} approved={lv.humanApproved} />
      </span>
      <span className="file-row-stats">
        <span className="add" title="Sections added">+{counts.added}</span>
        <span className="del" title="Sections removed">-{counts.removed}</span>
        <span className="chg" title="Sections changed">~{counts.changed}</span>
        {stub && (
          <span
            className="stub"
            title="The current consolidated text of this Act isn't registered yet, so only the proposed wording is shown."
          >
            stub
          </span>
        )}
      </span>
    </button>
  );
}

function DeltaSection({
  lv,
  busy,
  onApprove,
  onFlag,
  refSet,
}: {
  lv: LawVersion;
  busy: boolean;
  onApprove: () => void;
  onFlag: () => void;
  refSet: (el: HTMLDivElement | null) => void;
}) {
  const stub = isStub(lv);

  return (
    <section className="delta-section" ref={refSet} data-lv-id={lv.id} id={lv.id}>
      <div className="sec-head">
        <div className="sec-title-wrap">
          <div className="sec-title">{actDisplayName(lv.baseLawTitle)}</div>
          <div className="sec-sub">
            {(lv.affectedSections?.length ?? 0) > 0
              ? (lv.affectedSections ?? []).join(", ")
              : `sourced from ${lv.sourceBillNumber}`}
          </div>
        </div>
        <div className="sec-actions">
          <ReviewBadge required={lv.humanReviewRequired} approved={lv.humanApproved} />
          {stub && <span className="badge outline dim">unregistered Act</span>}
          <Tooltip
            title="Needs review"
            body="Flag this Act for a closer look. It stays out of the client scan until a lawyer signs off on the change."
            placement="top"
          >
            <button className="btn sm review-action" disabled={busy} onClick={onFlag}>
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
              Needs review
            </button>
          </Tooltip>
          <Tooltip
            title="Approve"
            body="Confirm a lawyer has checked this bill's change against the Act. Approving marks it reviewed and makes it available to the client scan and the client brief."
            placement="top"
          >
            <button
              className="btn sm primary delta-section-approve"
              disabled={busy || lv.humanApproved}
              onClick={onApprove}
            >
              <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
              {lv.humanApproved ? "Approved" : "Approve"}
            </button>
          </Tooltip>
        </div>
      </div>

      {stub && (
        <Alert variant="warning" appearance="light" className="dw-alert delta-section-alert">
          <AlertIcon>
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>Current consolidated text not loaded for this Act</AlertTitle>
            <AlertDescription>
              This shows only the bill's proposed wording — the current
              consolidated text of the {actDisplayName(lv.baseLawTitle)} isn't in
              the side-by-side comparator yet. Read the Act as it stands today on{" "}
              <a
                href={justiceLawsUrl(lv.baseLawTitle)}
                target="_blank"
                rel="noreferrer"
                style={{ color: "inherit", textDecoration: "underline", fontWeight: 600 }}
              >
                Justice Laws Canada
              </a>
              .
            </AlertDescription>
          </AlertContent>
        </Alert>
      )}

      {lv.humanReviewRequired && !stub && (
        <Alert variant="warning" appearance="light" className="dw-alert delta-section-alert">
          <AlertIcon>
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>Human review required</AlertTitle>
            <AlertDescription>
              {lv.humanReviewReason ?? "Lawyer verification needed before distribution."}
            </AlertDescription>
          </AlertContent>
        </Alert>
      )}

      <DiffViewer
        actName={actDisplayName(lv.baseLawTitle)}
        actCitation={
          lv.affectedSections.length > 0
            ? lv.affectedSections.join(", ")
            : `sourced from ${lv.sourceBillNumber}`
        }
        oldText={lv.oldText || "(no current text on file)"}
        newText={lv.updatedText}
        versionALabel={`Current — ${actDisplayName(lv.baseLawTitle)}`}
        versionBLabel={`Proposed by ${lv.sourceBillNumber}`}
      />

      <div className="sec-foot">
        <div className="delta-summary-text">{lv.deltaSummary}</div>
      </div>
    </section>
  );
}

function DeltaRightRail({
  bill,
  activeLv,
  lvs,
  techOpen,
  onToggleTech,
}: {
  bill: Bill | null;
  activeLv: LawVersion | null;
  lvs: LawVersion[];
  techOpen: boolean;
  onToggleTech: () => void;
}) {
  return (
    <div className="right-panel delta-right-panel">
      <div className="card">
        <div className="card-h">
          <div className="card-title-row">
            <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
            <div className="card-title">Bill summary</div>
          </div>
          {activeLv && (
            <ReviewBadge
              required={activeLv.humanReviewRequired}
              approved={activeLv.humanApproved}
            />
          )}
        </div>
        <div className="kv">
          <div className="k">Bill</div>
          <div className="v">
            {bill?.billNumber ?? activeLv?.sourceBillNumber} — {bill?.title ?? activeLv?.sourceBillTitle}
          </div>
          <div className="k">Status</div>
          <div className="v">{bill?.status ?? activeLv?.sourceBillStatus ?? "—"}</div>
          <div className="k">Momentum</div>
          <div className="v">
            {bill ? (
              <MomentumBadge value={bill.legislativeMomentum} />
            ) : activeLv ? (
              <MomentumBadge value={activeLv.legislativeMomentum} />
            ) : (
              "—"
            )}
          </div>
          <div className="k">Acts</div>
          <div className="v">{lvs.length}</div>
          {bill?.session && (
            <>
              <div className="k">Session</div>
              <div className="v">{bill.session}</div>
            </>
          )}
          <div className="k">Latest</div>
          <div className="v">{bill?.latestActivity ?? activeLv?.sourceBillStatus ?? "—"}</div>
        </div>
        {activeLv && (
          <>
            <div className="hr card-rule" />
            <div className="dw-journey-h">Legislative journey</div>
            <div className="dw-journey-wrap compact">
              <LegislativeJourney
                momentum={activeLv.legislativeMomentum}
                status={activeLv.sourceBillStatus}
                effectiveDate={activeLv.effectiveDate}
                comingIntoForceText={activeLv.comingIntoForceText}
              />
            </div>
          </>
        )}
      </div>

      {activeLv && (
        <div className="card">
          <div className="card-h">
            <div className="card-title-row">
              <FontAwesomeIcon icon={faScaleBalanced} aria-hidden="true" />
              <div className="card-title">Active legal delta</div>
            </div>
          </div>
          <div className="delta-card-body">
            <div className="delta-summary-text">{activeLv.deltaSummary}</div>
            <div className="delta-chip-row">
              {(activeLv.affectedSections ?? []).map((s) => (
                <span key={s} className="badge outline">
                  {s}
                </span>
              ))}
            </div>
            <div className="delta-chip-row">
              {(activeLv.changeTypes ?? []).map((t) => (
                <span key={t} className="badge outline dim">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <button
          type="button"
          className="dw-tech-toggle"
          onClick={onToggleTech}
          aria-expanded={techOpen}
        >
          <span className="card-title-row">
            <FontAwesomeIcon icon={faShieldHalved} aria-hidden="true" />
            <span>Technical details</span>
          </span>
          <span className={`dw-tech-caret ${techOpen ? "open" : ""}`}>
            {techOpen ? "Collapse" : "Expand"}
            <FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
          </span>
        </button>
        {techOpen && (
          <div className="dw-tech-body">
            <div className="dw-detail-text">
              Bill clauses: {bill?.clauses?.length ?? "—"}. Distinct target Acts: {lvs.length}.
              {bill?.sourceUrl && (
                <>
                  {" "}
                  <a href={bill.sourceUrl} target="_blank" rel="noreferrer">
                    Source bill
                  </a>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
