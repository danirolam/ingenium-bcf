import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faArrowRight,
  faBuildingColumns,
  faCalendarDay,
  faCheck,
  faCodeCompare,
  faCrown,
  faFileLines,
  faGavel,
  faLandmark,
  faScaleBalanced,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { Nav } from "../App";
import type {
  Bill,
  BillDivision,
  BillStageEntry,
  StageChamber,
  StageState,
} from "../types";
import { api } from "../lib/api";
import { MomentumBadge } from "../components/badges";
import { InfoHint } from "../components/InfoHint";
import { Tooltip } from "../components/Tooltip";

function fmtDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const CHAMBER_LABEL: Record<StageChamber, string> = {
  House: "House of Commons",
  Senate: "Senate",
  "Royal Assent": "Royal Assent",
};

const CHAMBER_ICON: Record<StageChamber, IconDefinition> = {
  House: faLandmark,
  Senate: faBuildingColumns,
  "Royal Assent": faCrown,
};

const STATE_CLASS: Record<StageState, string> = {
  completed: "is-completed",
  in_progress: "is-progress",
  not_reached: "is-pending",
};

const STATE_LABEL: Record<StageState, string> = {
  completed: "Completed",
  in_progress: "In progress",
  not_reached: "Not reached",
};

// Consecutive stages in the same chamber render under one chamber heading, so
// the reader sees the bill cross from one House to the other and on to assent.
function groupByChamber(path: BillStageEntry[]) {
  const groups: { chamber: StageChamber; stages: BillStageEntry[] }[] = [];
  for (const stage of path) {
    const last = groups[groups.length - 1];
    if (last && last.chamber === stage.chamber) last.stages.push(stage);
    else groups.push({ chamber: stage.chamber, stages: [stage] });
  }
  return groups;
}

function divisionTone(d: BillDivision): string {
  const result = (d.result ?? "").toLowerCase();
  if (d.agreedTo || result.includes("agreed")) return "ok";
  if (result.includes("negat") || result.includes("defeat")) return "crit";
  return "low";
}

function DivisionCard({ d }: { d: BillDivision }) {
  const yeas = d.yeas ?? 0;
  const nays = d.nays ?? 0;
  const total = yeas + nays;
  const yeaPct = total > 0 ? Math.round((yeas / total) * 100) : 0;
  const tone = divisionTone(d);
  const date = fmtDate(d.date);

  const sub = [
    d.method,
    d.divisionNumber != null ? `Division ${d.divisionNumber}` : undefined,
    date,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="bd-division">
      <div className="bd-division-top">
        <div className="bd-division-title">
          {d.motionTitle ?? "Recorded division"}
          {sub && <span className="bd-division-sub">{sub}</span>}
        </div>
        {d.result && (
          <span className={`badge ${tone} bd-division-result`}>
            <span className="dot" />
            {d.result}
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="bd-vote">
          <div
            className="bd-vote-bar"
            role="img"
            aria-label={`${yeas} yeas, ${nays} nays`}
          >
            <span className="bd-vote-yea" style={{ width: `${yeaPct}%` }} />
          </div>
          <div className="bd-vote-nums">
            <span className="bd-vote-num">
              <b className="tnum">{yeas}</b> Yeas
            </span>
            <span className="bd-vote-num bd-vote-nay">
              <b className="tnum">{nays}</b> Nays
            </span>
            {d.paired != null && d.paired > 0 && (
              <span className="bd-vote-num bd-vote-paired">
                <b className="tnum">{d.paired}</b> Paired
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StageRow({ stage }: { stage: BillStageEntry }) {
  const date = fmtDate(stage.date);
  const defeated = (stage.events ?? []).some((e) => e.isDefeated);

  const meta: { icon: IconDefinition; text: string }[] = [];
  if (date) meta.push({ icon: faCalendarDay, text: date });
  if (stage.committee) {
    const name = stage.committee.acronym
      ? `${stage.committee.name} (${stage.committee.acronym})`
      : stage.committee.name;
    meta.push({
      icon: faUsers,
      text: stage.committee.isJoint ? `${name} · Joint committee` : name,
    });
  }
  if (stage.meetingCount && stage.meetingCount > 0) {
    meta.push({
      icon: faGavel,
      text: `${stage.meetingCount} committee ${
        stage.meetingCount === 1 ? "meeting" : "meetings"
      }`,
    });
  }

  return (
    <div className={`bd-stage ${STATE_CLASS[stage.state]}`}>
      <div className="bd-stage-rail" aria-hidden="true">
        <span className="bd-stage-dot">
          {stage.state === "completed" && <FontAwesomeIcon icon={faCheck} />}
        </span>
      </div>
      <div className="bd-stage-body">
        <div className="bd-stage-head">
          <span className="bd-stage-name">{stage.name}</span>
          <span className={`bd-state bd-state-${stage.state}`}>
            {STATE_LABEL[stage.state]}
          </span>
        </div>
        {meta.length > 0 && (
          <div className="bd-stage-meta">
            {meta.map((m, i) => (
              <span className="bd-meta-item" key={i}>
                <FontAwesomeIcon icon={m.icon} aria-hidden="true" />
                {m.text}
              </span>
            ))}
          </div>
        )}
        {defeated && (
          <div className="bd-stage-flag">
            This stage records a defeated motion.
          </div>
        )}
        {(stage.sittings?.length ?? 0) > 0 && (
          <div className="bd-sittings">
            {stage.sittings!.map((s, i) => {
              const sd = fmtDate(s.date);
              const label = s.number ? `Sitting ${s.number}` : s.name;
              return (
                <span className="bd-sitting tnum" key={i}>
                  {label}
                  {sd && <span className="bd-sitting-date">{sd}</span>}
                </span>
              );
            })}
          </div>
        )}
        {(stage.divisions?.length ?? 0) > 0 && (
          <div className="bd-divisions">
            {stage.divisions!.map((d, i) => (
              <DivisionCard d={d} key={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function BillDetail({ nav }: { nav: Nav }) {
  const billId = nav.params.billId;
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!billId) {
      setError("No bill selected.");
      return;
    }
    let cancelled = false;
    api.bills
      .get(billId)
      .then((b) => {
        if (!cancelled) setBill(b);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [billId]);

  async function openDelta() {
    if (!bill) return;
    setBusy(true);
    try {
      const result = await api.bills.extractDelta(bill.id).catch(() => null);
      if (result?.errors?.length) nav.toast(result.errors[0]);
      nav.go("delta", { billId: bill.id });
    } catch (err: any) {
      nav.toast(`Could not open delta: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo(
    () => groupByChamber(bill?.legislativePath ?? []),
    [bill],
  );

  const progress = useMemo(() => {
    const path = bill?.legislativePath ?? [];
    const completed = path.filter((s) => s.state === "completed").length;
    return { completed, total: path.length };
  }, [bill]);

  if (error) {
    return (
      <div className="bd">
        <div className="bd-topbar">
          <button className="btn ghost sm" onClick={() => nav.go("monitor")}>
            <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
            Bill Monitor
          </button>
        </div>
        <div className="body">
          <div className="rd-empty">Could not load this bill: {error}</div>
        </div>
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="bd">
        <div className="bd-topbar">
          <button className="btn ghost sm" onClick={() => nav.go("monitor")}>
            <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
            Bill Monitor
          </button>
        </div>
        <div className="body">
          <div className="bd-loading">Loading bill…</div>
        </div>
      </div>
    );
  }

  const heading = bill.shortTitle || bill.title;
  const longTitleDiffers =
    bill.shortTitle && bill.title && bill.shortTitle !== bill.title;
  const eyebrow = [bill.originatingChamber, bill.billType]
    .filter(Boolean)
    .join(" · ");
  const sponsor = bill.sponsor;
  const sponsorName = sponsor
    ? `${sponsor.honorific ? sponsor.honorific + " " : ""}${sponsor.name}`
    : undefined;
  const sponsorParty = sponsor
    ? [sponsor.party, sponsor.constituency].filter(Boolean).join(" · ")
    : undefined;

  const facts: { label: string; value: string }[] = [];
  if (sponsorName) facts.push({ label: "Sponsor", value: sponsorName });
  if (sponsor?.role || sponsor?.title)
    facts.push({ label: "Role", value: (sponsor.role || sponsor.title)! });
  if (sponsorParty) facts.push({ label: "Affiliation", value: sponsorParty });
  if (bill.billForm) facts.push({ label: "Form", value: bill.billForm });
  if (bill.session) facts.push({ label: "Session", value: bill.session });
  if (bill.introducedDate)
    facts.push({ label: "Introduced", value: fmtDate(bill.introducedDate)! });
  if (bill.royalAssentDate)
    facts.push({
      label: "Royal assent",
      value: fmtDate(bill.royalAssentDate)!,
    });
  if (bill.statuteCitation)
    facts.push({ label: "Statute", value: bill.statuteCitation });

  const summaryParas = bill.summary
    ? bill.summary.split(/\n{2,}/).filter((p) => p.trim())
    : [];

  return (
    <div className="bd">
      <div className="bd-topbar">
        <button className="btn ghost sm" onClick={() => nav.go("monitor")}>
          <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
          Bill Monitor
        </button>
        <Tooltip
          placement="bottom"
          title="Review legal delta"
          body="Stage 2. Extract what this bill changes in current law and open it side by side with the consolidated Acts it amends."
        >
          <button className="btn primary" disabled={busy} onClick={openDelta}>
            <FontAwesomeIcon icon={faCodeCompare} aria-hidden="true" />
            {busy ? "Opening…" : "Review legal delta"}
          </button>
        </Tooltip>
      </div>

      <div className="body bd-body">
        <header className="bd-head">
          <div className="bd-head-main">
            {eyebrow && <div className="bd-eyebrow">{eyebrow}</div>}
            <h1 className="bd-title">
              <span className="bd-number tnum">{bill.billNumber}</span>
              {heading}
            </h1>
            {longTitleDiffers && <p className="bd-longtitle">{bill.title}</p>}
            <div className="bd-badges">
              <MomentumBadge value={bill.legislativeMomentum} />
              <span className="badge outline">{bill.status}</span>
              {bill.isGovernmentBill && (
                <span className="badge dim">Government bill</span>
              )}
              {(bill.practiceAreas ?? []).map((p) => (
                <span key={p} className="badge outline dim">
                  {p}
                </span>
              ))}
            </div>
          </div>

          {facts.length > 0 && (
            <aside className="bd-facts">
              {facts.map((f) => (
                <div className="bd-fact" key={f.label}>
                  <span className="bd-fact-label">{f.label}</span>
                  <span className="bd-fact-value">{f.value}</span>
                </div>
              ))}
            </aside>
          )}
        </header>

        {summaryParas.length > 0 && (
          <section className="bd-section">
            <div className="bd-section-head">
              <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
              <h2>Summary</h2>
            </div>
            <div className="bd-summary">
              {summaryParas.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
        )}

        <section className="bd-section">
          <div className="bd-section-head">
            <FontAwesomeIcon icon={faScaleBalanced} aria-hidden="true" />
            <h2>Legislative path</h2>
            <InfoHint
              title="Legislative path"
              body="The bill's route through Parliament — House of Commons, then Senate, then Royal Assent. A filled dot is a completed stage; blue is in progress. Recorded divisions show the yea / nay vote on a motion."
            />
            {progress.total > 0 && (
              <span className="bd-progress tnum">
                {progress.completed} of {progress.total} stages completed
              </span>
            )}
          </div>

          {groups.length === 0 ? (
            <div className="rd-empty">
              No legislative path is recorded for this bill yet.
            </div>
          ) : (
            <div className="bd-timeline">
              {groups.map((g, gi) => (
                <div className="bd-chamber-group" key={gi}>
                  <div className="bd-chamber-head">
                    <span className="bd-chamber-icon">
                      <FontAwesomeIcon
                        icon={CHAMBER_ICON[g.chamber]}
                        aria-hidden="true"
                      />
                    </span>
                    {CHAMBER_LABEL[g.chamber]}
                  </div>
                  <div className="bd-stages">
                    {g.stages.map((s) => (
                      <StageRow stage={s} key={s.id} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {bill.clauses.length > 0 && (
          <section className="bd-section">
            <div className="bd-section-head">
              <FontAwesomeIcon icon={faFileLines} aria-hidden="true" />
              <h2>Bill text</h2>
              <span className="bd-progress tnum">
                {bill.clauses.length}{" "}
                {bill.clauses.length === 1 ? "clause" : "clauses"}
              </span>
            </div>
            <div className="bd-clauses">
              {bill.clauses.map((c) => (
                <article className="bd-clause" key={c.id}>
                  <div className="bd-clause-head">
                    {c.number && (
                      <span className="bd-clause-num tnum">{c.number}</span>
                    )}
                    {c.heading && (
                      <span className="bd-clause-heading">{c.heading}</span>
                    )}
                  </div>
                  <p className="bd-clause-text">{c.text}</p>
                  {(c.targetActs?.length ?? 0) > 0 && (
                    <div className="bd-clause-acts">
                      {c.targetActs!.map((a) => (
                        <span key={a} className="badge outline dim">
                          {a}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="bd-foot">
          <button className="btn" onClick={() => nav.go("monitor")}>
            <FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />
            Back to all bills
          </button>
          <button className="btn primary" disabled={busy} onClick={openDelta}>
            Review legal delta
            <FontAwesomeIcon icon={faArrowRight} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
