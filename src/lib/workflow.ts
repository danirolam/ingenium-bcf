// Single source of truth for the four-stage workflow. The top rail, the hover
// tooltips, and the "?" help guide all read from here so the explanation of
// "how it works" stays consistent everywhere it appears.
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBinoculars,
  faCodeCompare,
  faMagnifyingGlassChart,
  faFileSignature,
} from "@fortawesome/free-solid-svg-icons";

export type StepId = "monitor" | "delta" | "scanner" | "impact";

export interface WorkflowStep {
  id: StepId;
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

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: "monitor",
    num: "01",
    label: "Monitor",
    purpose: "Track every federal bill",
    detail:
      "The starting point. Browse every federal bill the firm is tracking, filter by practice group and momentum, and open any bill to read its full path through Parliament.",
    produces: "Hands a chosen bill to the legal-delta review.",
    icon: faBinoculars,
  },
  {
    id: "delta",
    num: "02",
    label: "Legal delta",
    purpose: "See what each bill changes",
    detail:
      "Compare a bill against the consolidated Acts it amends — added, repealed, and replaced sections shown side by side — then approve the delta so it can inform client work.",
    produces: "Hands a counsel-approved change to the client scan.",
    icon: faCodeCompare,
  },
  {
    id: "scanner",
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
    num: "04",
    label: "Client brief",
    purpose: "Draft the exposure memo",
    detail:
      "Turn a client's exposure into a clear, counsel-approved memo with recommended actions and the supporting statutory text, ready to send.",
    produces: "Produces the client-ready memo.",
    icon: faFileSignature,
  },
];

// A bill-detail view is part of the Monitor stage, so it keeps step 01 lit.
export function activeStepId(page: string): StepId {
  if (page === "bill" || page === "monitor") return "monitor";
  if (page === "delta" || page === "scanner" || page === "impact") return page;
  return "monitor";
}

export function activeStepIndex(page: string): number {
  // The overview is the workspace home, not a pipeline stage, so nothing lights.
  if (page === "overview") return -1;
  const id = activeStepId(page);
  return WORKFLOW_STEPS.findIndex((s) => s.id === id);
}
