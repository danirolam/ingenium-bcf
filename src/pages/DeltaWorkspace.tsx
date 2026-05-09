import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Scale,
  ShieldCheck,
} from "lucide-react";
import type { Nav } from "../App";
import { MomentumBadge, ReviewBadge } from "../components/badges";
import { ConfidenceMeter } from "../components/ConfidenceMeter";
import {
  buildDiffBlocks,
  countMaterialChanges,
  DiffViewer,
} from "../components/DiffViewer";
import { LegislativeJourney } from "../components/LegislativeJourney";
import { PageHeader } from "../components/PageHeader";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from "../components/ui/alert-1";
import { GlowingButton } from "../components/ui/glowing-button";
import { api } from "../lib/api";
import type { Bill, LawVersion } from "../types";

function isStub(lv: LawVersion): boolean {
  return lv.baseLawId.startsWith("unregistered:") || lv.oldText.trim() === "";
}

function actDisplayName(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, "");
}

export function DeltaWorkspace({ nav }: { nav: Nav }) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [lvs, setLvs] = useState<LawVersion[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [techOpen, setTechOpen] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const activeLv = lvs.find((lv) => lv.id === activeId) ?? lvs[0] ?? null;

  useEffect(() => {
    const billId = nav.params.billId;
    const lawVersionId = nav.params.lawVersionId;

    if (billId) {
      Promise.all([api.bills.get(billId), api.bills.lawVersions(billId)])
        .then(([b, ls]) => {
          setBill(b);
          const list = Array.isArray(ls) ? ls : [];
          setLvs(list);
          setActiveId(list[0]?.id ?? null);
        })
        .catch((err) => {
          console.error(err);
          nav.toast(`Failed to load delta workspace: ${err.message ?? err}`);
        });
      return;
    }

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

    api.lawVersions
      .list()
      .then(async (all) => {
        const demoMatch = all.find((item) => item.sourceBillNumber === "C-273") ??
          all.find((item) => item.sourceBillNumber === "C-27") ??
          all[0];
        if (!demoMatch) return;
        const bills = await api.bills.list();
        const matchedBill = bills.find((b) => b.id === demoMatch.sourceBillId) ?? null;
        setBill(matchedBill);
        const grouped = matchedBill
          ? all.filter((item) => item.sourceBillId === matchedBill.id)
          : [demoMatch];
        setLvs(grouped.length > 0 ? grouped : [demoMatch]);
        setActiveId((grouped[0] ?? demoMatch).id);
      })
      .catch(console.error);
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
    setBusy(id);
    try {
      const updated = await api.lawVersions.approve(id);
      setLvs((arr) => arr.map((x) => (x.id === id ? updated : x)));
      nav.toast(`Approved: ${updated.baseLawTitle}`);
    } finally {
      setBusy(null);
    }
  }

  async function flag(id: string) {
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
  }

  if (lvs.length === 0) {
    return (
      <>
        <PageHeader
          crumbs={["Workspace", "Delta Workspace"]}
          title="Delta Workspace"
          sub="Open a bill from Bill Monitor to start reviewing the proposed legal delta."
        />
        <div className="body">
          <div className="rd-empty">
            No law version selected. Go to Bill Monitor and click <b>Open Delta</b> on a bill.
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
          <FileText size={16} strokeWidth={1.8} aria-hidden="true" />
          <div className="card-title">Acts changed</div>
        </div>
        <span className="badge outline dim">{lvs.length}</span>
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
      onClick={() => onSelect(lv.id)}
    >
      <span className="file-row-name">{actDisplayName(lv.baseLawTitle)}</span>
      <span className="file-row-meta">
        <ReviewBadge required={lv.humanReviewRequired} approved={lv.humanApproved} />
      </span>
      <span className="file-row-stats">
        <span className="add">+{counts.added}</span>
        <span className="del">-{counts.removed}</span>
        <span className="chg">~{counts.changed}</span>
        {stub && <span className="stub">stub</span>}
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
  const confidencePct = Math.round(lv.confidence * 100);

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
          <button className="btn sm review-action" disabled={busy} onClick={onFlag}>
            <AlertTriangle size={14} strokeWidth={1.9} aria-hidden="true" />
            Needs review
          </button>
          <GlowingButton
            className="delta-section-approve"
            disabled={busy || lv.humanApproved}
            onClick={onApprove}
          >
            <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
            {lv.humanApproved ? "Approved" : "Approve"}
          </GlowingButton>
        </div>
      </div>

      {stub && (
        <Alert variant="warning" appearance="light" className="dw-alert delta-section-alert">
          <AlertIcon>
            <AlertTriangle size={18} strokeWidth={2} aria-hidden="true" />
          </AlertIcon>
          <AlertContent>
            <AlertTitle>Current consolidated law not yet registered</AlertTitle>
            <AlertDescription>
              Showing proposed C-273 text for this Act. Add the current Act to{" "}
              <code className="inline-code">data/laws/registry.json</code> and rerun the
              law retrieval script to enable a full before-and-after diff.
            </AlertDescription>
          </AlertContent>
        </Alert>
      )}

      {lv.humanReviewRequired && !stub && (
        <Alert variant="warning" appearance="light" className="dw-alert delta-section-alert">
          <AlertIcon>
            <AlertTriangle size={18} strokeWidth={2} aria-hidden="true" />
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
        <div className="dw-stable">
          Extraction confidence · <span className="tnum">{confidencePct}%</span>
        </div>
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
            <FileText size={16} strokeWidth={1.8} aria-hidden="true" />
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
              <Scale size={16} strokeWidth={1.8} aria-hidden="true" />
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
            <ShieldCheck size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>Technical details</span>
          </span>
          <span className={`dw-tech-caret ${techOpen ? "open" : ""}`}>
            {techOpen ? "Collapse" : "Expand"}
            <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
          </span>
        </button>
        {techOpen && (
          <div className="dw-tech-body">
            {lvs.map((lv) => (
              <div key={lv.id}>
                <div className="dw-detail-label">{actDisplayName(lv.baseLawTitle)}</div>
                <ConfidenceMeter value={lv.confidence} label="Extraction confidence" />
              </div>
            ))}
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
