// Turns a LEGISinfo bill detail record into the compact, ordered legislative
// path a lawyer reads: each stage with its chamber, state, date, committee,
// sittings, and any recorded divisions (with vote counts). Pure functions over
// the raw JSON shape so the snapshot builder, the server normalizer, and the
// client can all share one source of truth.

export type StageState = "completed" | "in_progress" | "not_reached";
export type StageChamber = "House" | "Senate" | "Royal Assent";

export interface BillDivision {
  chamber: StageChamber;
  stageName: string;
  motionTitle?: string;
  result?: string; // "Agreed To" | "Negatived" | "Tied"
  method?: string; // "On recorded division" | "On division"
  divisionNumber?: number;
  yeas?: number;
  nays?: number;
  paired?: number;
  date?: string;
  sittingNumber?: string;
  agreedTo?: boolean;
}

export interface StageSitting {
  name: string;
  number?: string;
  date?: string;
}

export interface StageEvent {
  name: string;
  date?: string;
  isDefeated?: boolean;
  isCompletion?: boolean;
}

export interface StageCommittee {
  name: string;
  acronym?: string;
  isJoint?: boolean;
}

export interface BillStageEntry {
  id: string;
  chamber: StageChamber;
  name: string;
  state: StageState;
  date?: string;
  committee?: StageCommittee;
  meetingCount?: number;
  sittings?: StageSitting[];
  events?: StageEvent[];
  divisions?: BillDivision[];
}

export interface LegislativeSponsor {
  name: string;
  honorific?: string;
  title?: string;
  role?: string;
  constituency?: string;
  party?: string;
}

export interface ParsedBillDetail {
  numberCode?: string;
  longTitle?: string;
  shortTitle?: string;
  status?: string;
  billType?: string;
  billForm?: string;
  isGovernmentBill?: boolean;
  isProForma?: boolean;
  originatingChamber?: string;
  sponsor?: LegislativeSponsor;
  statuteCitation?: string;
  introducedDate?: string;
  royalAssentDate?: string;
  latestEvent?: { name?: string; date?: string; chamber?: string };
  summaryText?: string;
  path: BillStageEntry[];
  divisions: BillDivision[];
}

const HOUSE = 1;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function chamberFor(id: unknown): StageChamber {
  return id === HOUSE ? "House" : "Senate";
}

// Strip the LEGISinfo executive-summary HTML down to readable text, preserving
// paragraph breaks (it uses <br/><br/> between items and lettered sub-points).
export function htmlToText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    // Drop the Library of Parliament boilerplate lead-in so only the real
    // executive summary remains.
    .replace(
      /A (?:full )?legislative summary is (?:currently )?being prepared[\s\S]*?(?:executive summary is available|summary is available)\.?/i,
      "",
    )
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&rsquo;/gi, "’")
    .replace(/&lsquo;/gi, "‘")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || undefined;
}

function divisionsFrom(
  decisions: unknown,
  chamber: StageChamber,
  stageName: string,
): BillDivision[] {
  if (!Array.isArray(decisions)) return [];
  return decisions.map((d: any) => ({
    chamber,
    stageName,
    motionTitle: str(d?.DecisionMotionTitleEn) ?? str(d?.DecisionMotionTitle),
    result: str(d?.DecisionResultNameEn) ?? str(d?.DecisionResultName),
    method: str(d?.DecisionMethodNameEn) ?? str(d?.DecisionMethodName),
    divisionNumber: num(d?.DivisionNumber),
    yeas: num(d?.DivisionVotesYeas),
    nays: num(d?.DivisionVotesNays),
    paired: num(d?.DivisionVotePaired),
    date: str(d?.DecisionSittingDate),
    sittingNumber: str(d?.DecisionSittingNumber),
    agreedTo: /agreed/i.test(String(d?.DecisionResultNameEn ?? "")),
  }));
}

function lastEventDate(events: any[]): string | undefined {
  const dated = events
    .map((e) => str(e?.EventDateTime))
    .filter((d): d is string => Boolean(d));
  return dated.length ? dated[dated.length - 1] : undefined;
}

function stageState(raw: any, date: string | undefined): StageState {
  const name = String(raw?.StateNameEn ?? "").toLowerCase();
  if (name.includes("complete")) return "completed";
  if (name.includes("progress")) return "in_progress";
  // Royal assent uses a null state but only appears once it has happened.
  if (Array.isArray(raw?.SignificantEvents) && raw.SignificantEvents.length && date) {
    return "completed";
  }
  return "not_reached";
}

function normalizeStage(
  raw: any,
  index: number,
  forcedChamber?: StageChamber,
): BillStageEntry {
  const chamber = forcedChamber ?? chamberFor(raw?.ChamberOrganizationId);
  const events: StageEvent[] = Array.isArray(raw?.SignificantEvents)
    ? raw.SignificantEvents.map((e: any) => ({
        name: str(e?.EventNameEn) ?? str(e?.EventName) ?? "Event",
        date: str(e?.EventDateTime),
        isDefeated: Boolean(e?.IsDefeatedEvent),
        isCompletion: Boolean(e?.IsCompletionOfBillStage),
      }))
    : [];

  const date =
    str(raw?.StateAsOfDate) ??
    str(raw?.EndOfStageEvent?.EventEndDateTime) ??
    lastEventDate(events) ??
    (Array.isArray(raw?.Sittings)
      ? str(raw.Sittings[raw.Sittings.length - 1]?.Date)
      : undefined);

  const name = str(raw?.BillStageNameEn) ?? str(raw?.BillStageName) ?? "Stage";
  const divisions = divisionsFrom(raw?.Decisions, chamber, name);

  const sittings: StageSitting[] = Array.isArray(raw?.Sittings)
    ? raw.Sittings.map((s: any) => ({
        name: str(s?.NameEn) ?? str(s?.Name) ?? "Sitting",
        number: str(s?.Number),
        date: str(s?.Date),
      }))
    : [];

  const committee = raw?.Committee
    ? {
        name:
          str(raw.Committee?.CommitteeNameEn) ??
          str(raw.Committee?.CommitteeName) ??
          "Committee",
        acronym: str(raw.Committee?.CommitteeAcronym),
        isJoint: Boolean(raw.Committee?.IsJointCommittee),
      }
    : undefined;

  return {
    id: `${chamber}-${raw?.BillStageId ?? index}`,
    chamber,
    name,
    state: stageState(raw, date),
    date,
    committee,
    meetingCount: Array.isArray(raw?.CommitteeMeetings)
      ? raw.CommitteeMeetings.length
      : undefined,
    sittings: sittings.length ? sittings : undefined,
    events: events.length ? events : undefined,
    divisions: divisions.length ? divisions : undefined,
  };
}

function sponsorFrom(detail: any): LegislativeSponsor | undefined {
  const name = str(detail?.SponsorPersonName);
  if (!name) return undefined;
  return {
    name,
    honorific: str(detail?.SponsorPersonShortHonorificEn),
    title: str(detail?.SponsorAffiliationTitleEn),
    role: str(detail?.SponsorAffiliationRoleNameEn),
    constituency: str(detail?.SponsorConstituencyNameEn),
    party:
      str(detail?.SponsorCaucusShortNameEn) ??
      str(detail?.CaucusShortNameEn) ??
      str(detail?.SponsorPoliticalPartyNameEn),
  };
}

function statuteCitation(detail: any): string | undefined {
  const year = num(detail?.StatuteYear);
  const chapter = num(detail?.StatuteChapter);
  if (!year || !chapter) return undefined;
  const prefix = detail?.IsSenateBill ? "S.C." : "S.C.";
  return `${prefix} ${year}, c. ${chapter}`;
}

export function parseBillDetail(detail: any): ParsedBillDetail | null {
  if (!detail || typeof detail !== "object") return null;
  const stages = detail.BillStages ?? {};
  const originatingHouse = detail?.OriginatingChamberOrganizationId === HOUSE;

  const house: BillStageEntry[] = Array.isArray(stages.HouseBillStages)
    ? stages.HouseBillStages.map((s: any, i: number) => normalizeStage(s, i, "House"))
    : [];
  const senate: BillStageEntry[] = Array.isArray(stages.SenateBillStages)
    ? stages.SenateBillStages.map((s: any, i: number) => normalizeStage(s, i, "Senate"))
    : [];
  const royal: BillStageEntry[] = Array.isArray(stages.RoyalAssent)
    ? stages.RoyalAssent.map((s: any, i: number) => {
        const stage = normalizeStage(s, i, "Royal Assent");
        stage.name = stage.name || "Royal assent";
        return stage;
      })
    : [];

  // Sequence the path by originating chamber, then the reviewing chamber, then
  // the crown — the order a bill actually travels.
  const ordered = originatingHouse ? [...house, ...senate] : [...senate, ...house];
  const path = [...ordered, ...royal];

  const divisions = path.flatMap((s) => s.divisions ?? []);

  const introducedDate =
    str(detail?.PassedHouseFirstReadingDateTime) ??
    str(detail?.PassedSenateFirstReadingDateTime) ??
    path.find((s) => /first reading/i.test(s.name) && s.date)?.date;

  return {
    numberCode: str(detail?.NumberCode),
    longTitle: str(detail?.LongTitleEn) ?? str(detail?.LongTitle),
    shortTitle: str(detail?.ShortTitleEn) ?? str(detail?.ShortTitle),
    status: str(detail?.StatusNameEn) ?? str(detail?.StatusName),
    billType: str(detail?.BillDocumentTypeNameEn) ?? str(detail?.BillDocumentTypeName),
    billForm: str(detail?.BillFormNameEn) ?? str(detail?.BillFormName),
    isGovernmentBill: Boolean(detail?.IsGovernmentBill),
    isProForma: Boolean(detail?.IsProForma),
    originatingChamber:
      str(detail?.OriginatingChamberNameEn) ?? str(detail?.OriginatingChamberName),
    sponsor: sponsorFrom(detail),
    statuteCitation: statuteCitation(detail),
    introducedDate,
    royalAssentDate: str(detail?.ReceivedRoyalAssentDateTime),
    latestEvent: {
      name: str(detail?.LatestBillEventTypeNameEn),
      date: str(detail?.LatestBillEventDateTime),
      chamber: str(detail?.LatestBillEventChamberNameEn),
    },
    summaryText: htmlToText(detail?.ShortLegislativeSummaryEn),
    path,
    divisions,
  };
}

// Major readings used to render a compact progress indicator on cards/headers.
const MAJOR_STAGE_ORDER = [
  "First reading",
  "Second reading",
  "Consideration in committee",
  "Report stage",
  "Third reading",
  "Royal assent",
];

export function majorStageProgress(path: BillStageEntry[]): {
  completed: number;
  total: number;
  current?: string;
} {
  const reached = path.filter((s) => s.state !== "not_reached");
  const inProgress = [...reached]
    .reverse()
    .find((s) => s.state === "in_progress");
  const current = inProgress?.name ?? reached[reached.length - 1]?.name;
  const completed = path.filter((s) => s.state === "completed").length;
  return { completed, total: Math.max(path.length, MAJOR_STAGE_ORDER.length), current };
}
