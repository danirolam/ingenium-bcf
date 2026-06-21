// Single source of truth for the workflow. The top rail, the hover tooltips,
// the help guide, and the overview pipe all read from here so the explanation
// of "how it works" stays consistent everywhere it appears.
//
// There are two orientations of the SAME pipeline (see src/lib/viewMode.ts):
//   law-first    Monitor → Legal delta → Client scan → Client brief
//   client-first Client  → Exposure    → Legal delta → Brief & email
// They converge on the shared stages (Legal delta, the brief) — only the entry
// differs — so a step carries both its identity (`id`) and its nav target
// (`page`), which are the same for most steps but differ for the client-first
// entry (two steps that both live on the `watch` page).
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBinoculars,
  faCodeCompare,
  faMagnifyingGlassChart,
  faFileSignature,
  faUsers,
  faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";
import type { PageId } from "../App";
import type { ViewMode } from "./viewMode";

export type StepId =
  | "monitor"
  | "delta"
  | "scanner"
  | "impact"
  | "client"
  | "exposure";

export interface WorkflowStep {
  id: StepId;
  /** The page this step navigates to (a few steps share a page, e.g. the
   *  client-first "client" and "exposure" steps both live on `watch`). */
  page: PageId;
  num: string;
  label: string;
  /** One line, shown under the label in the rail. */
  purpose: string;
  /** Fuller explanation shown in the hover tooltip and the help guide. */
  detail: string;
  /** What this stage hands to the next one. */
  produces: string;
  icon: IconDefinition;
}

// ── Law-first: the classic pipeline (start from a bill) ──────────────────────
export const LAW_FIRST_STEPS: WorkflowStep[] = [
  {
    id: "monitor",
    page: "monitor",
    num: "01",
    label: "Monitor",
    purpose: "Track every Canadian bill",
    detail:
      "The starting point. Browse every Canadian bill the firm is tracking, filter by practice group and momentum, and open any bill to read its full path through Parliament.",
    produces: "Hands a chosen bill to the legal-delta review.",
    icon: faBinoculars,
  },
  {
    id: "delta",
    page: "delta",
    num: "02",
    label: "Legal delta",
    purpose: "See what each bill changes",
    detail:
      "Compare a bill against the consolidated Acts it amends. Added, repealed, and replaced sections are shown side by side, so you can approve the delta and let it inform client work.",
    produces: "Hands a counsel-approved change to the client scan.",
    icon: faCodeCompare,
  },
  {
    id: "scanner",
    page: "scanner",
    num: "03",
    label: "Client scan",
    purpose: "Match changes to clients",
    detail:
      "Run an approved delta against each client's operations, policies, and contracts to find who is exposed, how, and how urgently.",
    produces: "Hands an exposed client to the brief.",
    icon: faMagnifyingGlassChart,
  },
  {
    id: "impact",
    page: "impact",
    num: "04",
    label: "Client brief",
    purpose: "Draft the exposure memo",
    detail:
      "Turn a client's exposure into a clear, counsel-approved memo with recommended actions and the supporting statutory text, ready to send.",
    produces: "Produces the client-ready memo.",
    icon: faFileSignature,
  },
];

// ── Client-first: the same pipeline, entered from a client ───────────────────
export const CLIENT_FIRST_STEPS: WorkflowStep[] = [
  {
    id: "client",
    page: "watch",
    num: "01",
    label: "Client",
    purpose: "Choose a client to protect",
    detail:
      "The starting point. Pick the client you want to protect — its industry, jurisdictions, operations, policies, and contracts are what every bill is measured against.",
    produces: "Hands the chosen client to the exposure scan.",
    icon: faUsers,
  },
  {
    id: "exposure",
    page: "watch",
    num: "02",
    label: "Exposure",
    purpose: "Rank the bills that threaten it",
    detail:
      "Scan every counsel-approved bill against this client and rank them by how dangerous each is — critical to low — with the reason and the Acts each one touches.",
    produces: "Hands a high-exposure bill to the legal-delta review.",
    icon: faShieldHalved,
  },
  {
    id: "delta",
    page: "delta",
    num: "03",
    label: "Legal delta",
    purpose: "See what the bill changes",
    detail:
      "Open the bill that threatens this client and read exactly what it changes — added, repealed, and replaced sections of the Acts it amends, shown side by side.",
    produces: "Hands the change straight to this client's brief.",
    icon: faCodeCompare,
  },
  {
    id: "impact",
    page: "impact",
    num: "04",
    label: "Brief & email",
    purpose: "Advise the client",
    detail:
      "Turn this client's exposure to the bill into a counsel-approved memo, then send the client a tailored email about that specific law.",
    produces: "Produces the memo and the client email.",
    icon: faFileSignature,
  },
];

/** Backwards-compatible default (the overview pipe and any law-first consumer). */
export const WORKFLOW_STEPS = LAW_FIRST_STEPS;

export function workflowSteps(mode: ViewMode): WorkflowStep[] {
  return mode === "client-first" ? CLIENT_FIRST_STEPS : LAW_FIRST_STEPS;
}

/** Where flipping the switch lands you: the start of that orientation. */
export function entryPage(mode: ViewMode): PageId {
  return mode === "client-first" ? "watch" : "monitor";
}

/**
 * A page that only exists in one orientation forces that orientation in the
 * rail, so the steps you see always match the page you're on. The shared pages
 * (Legal delta, the brief, the overview) honor the user's chosen mode.
 */
export function effectiveMode(mode: ViewMode, page: PageId): ViewMode {
  if (page === "monitor" || page === "bill" || page === "scanner") return "law-first";
  if (page === "watch") return "client-first";
  return mode;
}

/**
 * Which step is active for the current page, within the given orientation.
 * Client-first splits its entry page in two: with a client chosen you are on
 * "Exposure", otherwise on "Client". Returns -1 when the page is not a stage
 * (the overview) or belongs to the other orientation.
 */
export function activeStepIndex(
  mode: ViewMode,
  page: string,
  params: Record<string, string> = {},
): number {
  if (page === "overview") return -1;
  const steps = workflowSteps(mode);
  let id: StepId | null = null;
  if (mode === "client-first") {
    if (page === "watch") id = params.clientId ? "exposure" : "client";
    else if (page === "delta") id = "delta";
    else if (page === "impact") id = "impact";
  } else {
    if (page === "bill" || page === "monitor") id = "monitor";
    else if (page === "delta") id = "delta";
    else if (page === "scanner") id = "scanner";
    else if (page === "impact") id = "impact";
  }
  return id ? steps.findIndex((s) => s.id === id) : -1;
}
