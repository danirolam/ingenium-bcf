import { useEffect, useMemo, useRef, useState } from "react";
import type { Nav } from "../App";
import { MomentumBadge, ReviewBadge } from "../components/badges";
import { ConfidenceMeter } from "../components/ConfidenceMeter";
import {
  buildDiffBlocks,
  countMaterialChanges,
  DiffViewer,
} from "../components/DiffViewer";
import { PageHeader } from "../components/PageHeader";
import { api } from "../lib/api";
import type { Bill, LawVersion } from "../types";

function isStub(lv: LawVersion): boolean {
  return lv.baseLawId.startsWith("unregistered:") || lv.oldText === "";
}

export function DeltaWorkspace({ nav }: { nav: Nav }) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [lvs, setLvs] = useState<LawVersion[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const billId = nav.params.billId;

  useEffect(() => {
    if (!billId) return;
    Promise.all([api.bills.get(billId), api.bills.lawVersions(billId)])
      .then(([b, ls]) => {
        setBill(b);
        setLvs(ls);
        if (ls.length > 0) setActiveId(ls[0].id);
      })
      .catch((err) => {
        console.error(err);
        nav.toast(`Failed to load delta workspace: ${err.message ?? err}`);
      });
  }, [billId]);

  // Scroll-spy: highlight rail row whose section is most in-view.
  useEffect(() => {
    if (lvs.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) {
          const id = visible[0].target.getAttribute("data-lv-id");
          if (id) setActiveId(id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const lv of lvs) {
      const el = sectionRefs.current[lv.id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [lvs]);

  if (!billId || !bill) {
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Delta Workspace"]}
          title="Delta Workspace"
          sub="Open a bill from Bill Monitor to start reviewing the proposed legal delta."
        />
        <div className="body">
          <div className="rd-empty">
            No bill selected. Go to Bill Monitor and click <b>Open Delta</b> on a bill.
          </div>
        </div>
      </>
    );
  }

  const onApprove = async (id: string) => {
    setBusy(id);
    try {
      const updated = await api.lawVersions.approve(id);
      setLvs((arr) => arr.map((x) => (x.id === id ? updated : x)));
      nav.toast(`Approved: ${updated.baseLawTitle}`);
    } finally {
      setBusy(null);
    }
  };

  const onFlag = async (id: string) => {
    setBusy(id);
    try {
      const updated = await api.lawVersions.needsReview(
        id,
        "Flagged for manual review by counsel.",
      );
      setLvs((arr) => arr.map((x) => (x.id === id ? updated : x)));
      nav.toast(`Flagged: ${updated.baseLawTitle}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        crumbs={["Workspace", "Delta Workspace", bill.billNumber]}
        title={`Delta Workspace — ${bill.billNumber}`}
        sub={
          <>
            <span style={{ fontFamily: "var(--serif)" }}>{bill.title}</span>
            <span className="muted"> · {lvs.length} Act{lvs.length === 1 ? "" : "s"} affected</span>
          </>
        }
      />
      <div className="body">
        <div className="delta-shell">
          {/* Files changed rail */}
          <FilesChangedRail
            lvs={lvs}
            activeId={activeId}
            onSelect={(id) => {
              setActiveId(id);
              const el = sectionRefs.current[id];
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />

          {/* Stacked diff sections */}
          <div className="delta-stack">
            {lvs.length === 0 && (
              <div className="rd-empty">
                No Acts could be extracted from this bill. Confirm that the bill clauses carry <code>targetActs</code> in the source data.
              </div>
            )}
            {lvs.map((lv) => (
              <DeltaSection
                key={lv.id}
                lv={lv}
                busy={busy === lv.id}
                onApprove={() => onApprove(lv.id)}
                onFlag={() => onFlag(lv.id)}
                refSet={(el) => {
                  sectionRefs.current[lv.id] = el;
                }}
              />
            ))}
          </div>

          {/* Right rail — bill summary */}
          <div className="right-panel">
            <div className="card">
              <div className="card-h">
                <div className="card-title">Bill summary</div>
              </div>
              <div className="kv">
                <div className="k">Bill</div>
                <div className="v">
                  {bill.billNumber} — {bill.title}
                </div>
                <div className="k">Status</div>
                <div className="v">{bill.status}</div>
                <div className="k">Momentum</div>
                <div className="v">
                  <MomentumBadge value={bill.legislativeMomentum} />
                </div>
                {bill.session && (
                  <>
                    <div className="k">Session</div>
                    <div className="v">{bill.session}</div>
                  </>
                )}
                {bill.latestActivity && (
                  <>
                    <div className="k">Latest</div>
                    <div className="v">{bill.latestActivity}</div>
                  </>
                )}
              </div>
            </div>

            <details className="card" style={{ padding: 0 }}>
              <summary
                style={{
                  cursor: "pointer",
                  padding: "14px 18px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--ink)",
                }}
              >
                <span>Technical details</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  expand
                </span>
              </summary>
              <div
                style={{
                  padding: "10px 16px 16px",
                  borderTop: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {lvs.map((lv) => (
                  <div key={lv.id}>
                    <div
                      className="k"
                      style={{
                        fontSize: 11,
                        color: "var(--ink-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        marginBottom: 4,
                      }}
                    >
                      {lv.baseLawTitle}
                    </div>
                    <ConfidenceMeter
                      value={lv.confidence}
                      label="Extraction confidence"
                    />
                  </div>
                ))}
                <div
                  className="muted"
                  style={{
                    fontSize: 11.5,
                    lineHeight: 1.5,
                    borderTop: "1px solid var(--border-3)",
                    paddingTop: 10,
                  }}
                >
                  Bill clauses: {bill.clauses.length}. Distinct target Acts:{" "}
                  {lvs.length}. {bill.sourceUrl && <a href={bill.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
                </div>
              </div>
            </details>
          </div>
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
        <div className="card-title">Files changed</div>
        <span className="badge outline dim">{lvs.length}</span>
      </div>
      <div>
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
  return (
    <div
      className={`file-row ${active ? "active" : ""}`}
      onClick={() => onSelect(lv.id)}
    >
      <div className="nm">{lv.baseLawTitle}</div>
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <ReviewBadge
          required={lv.humanReviewRequired}
          approved={lv.humanApproved}
        />
      </div>
      <div className="stats">
        <span className="add">+{counts.added}</span>
        <span className="del">−{counts.removed}</span>
        <span className="chg">~{counts.changed}</span>
        {isStub(lv) && (
          <span className="muted" style={{ marginLeft: 4 }}>
            stub
          </span>
        )}
      </div>
    </div>
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
    <section
      className="delta-section"
      ref={refSet}
      data-lv-id={lv.id}
      id={lv.id}
    >
      <div className="sec-head">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div className="sec-title">{lv.baseLawTitle}</div>
          <ReviewBadge
            required={lv.humanReviewRequired}
            approved={lv.humanApproved}
          />
          {stub && (
            <span className="badge outline dim">unregistered Act</span>
          )}
        </div>
        <div className="sec-actions">
          <button
            className="btn sm"
            disabled={busy}
            onClick={onFlag}
            title="Flag this Act's delta for manual review"
          >
            Needs review
          </button>
          <button
            className="btn sm primary"
            disabled={busy || lv.humanApproved}
            onClick={onApprove}
          >
            {lv.humanApproved ? "Approved ✓" : "Approve"}
          </button>
        </div>
      </div>

      {stub && (
        <div className="stub-banner">
          <b>Current text not yet ingested for {lv.baseLawTitle}.</b> Showing
          only the proposed amending clauses from the bill — the diff renders
          as all-added. Add this Act to <code>data/laws/registry.json</code>{" "}
          and re-run <code>scripts/retrieve-law.mjs</code> to enable a full diff.
        </div>
      )}

      {lv.humanReviewRequired && !stub && (
        <div className="stub-banner">
          <b>Human review required:</b> {lv.humanReviewReason ?? "Lawyer verification needed before distribution."}
        </div>
      )}

      <DiffViewer
        actName={lv.baseLawTitle}
        actCitation={
          lv.affectedSections.length > 0
            ? lv.affectedSections.join(", ")
            : `sourced from ${lv.sourceBillNumber}`
        }
        oldText={lv.oldText || "(no current text on file)"}
        newText={lv.updatedText}
        versionALabel={`Current — ${lv.baseLawTitle}`}
        versionBLabel={`Proposed by ${lv.sourceBillNumber}`}
      />
    </section>
  );
}
