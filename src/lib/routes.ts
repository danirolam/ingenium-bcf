// Single source of truth for the URL ↔ screen mapping. The app uses real,
// clean paths (History API) so the browser back/forward arrows move between
// workflow stages and every stage is deep-linkable.
//
// `parsePath` turns the current location into the screen + params to render;
// `buildPath` is the inverse, turning a screen + params into the URL to push.
// App.tsx is the only consumer - pages keep using the unchanged `Nav` object.
import type { PageId } from "../App";

export type Surface = "landing" | "app";

export interface Route {
  surface: Surface;
  page: PageId;
  params: Record<string, string>;
}

const PAGES: PageId[] = [
  "overview",
  "monitor",
  "bill",
  "delta",
  "scanner",
  "impact",
  "watch",
  "consolidated",
];

function isPageId(value: string): value is PageId {
  return (PAGES as string[]).includes(value);
}

/**
 * Resolve a pathname (+ query string) into the screen to show and its params.
 *
 * Route table:
 *   /                                  → landing
 *   /overview                          → overview
 *   /bills                             → monitor      (?session=&practice=)
 *   /bills/:billId                     → bill
 *   /bills/:billId/delta               → delta        (?law= → lawVersionId)
 *   /delta                             → delta        (bill-chooser, no billId)
 *   /clients                           → scanner
 *   /clients/:clientId/bills/:billId   → impact       (the brief)
 *   /clients/:clientId/package         → consolidated  (all approved bills, one email)
 *   /brief                             → impact       (empty state)
 *   /watch                             → watch        (client-first: client picker)
 *   /watch/:clientId                   → watch        (client-first: exposure board)
 *   (anything else)                    → overview
 */
export function parsePath(pathname: string, search = ""): Route {
  const query = new URLSearchParams(search);
  const segments = pathname.split("/").filter(Boolean);

  // Landing is the only thing that lives at the root.
  if (segments.length === 0) {
    return { surface: "landing", page: "overview", params: {} };
  }

  const params: Record<string, string> = {};
  const app = (page: PageId): Route => ({ surface: "app", page, params });

  switch (segments[0]) {
    case "overview":
      return app("overview");

    case "bills": {
      // /bills, /bills/:billId, /bills/:billId/delta
      const billId = segments[1];
      if (!billId) {
        const session = query.get("session");
        const practice = query.get("practice");
        if (session) params.session = session;
        if (practice) params.practice = practice;
        return app("monitor");
      }
      params.billId = billId;
      if (segments[2] === "delta") {
        const law = query.get("law");
        if (law) params.lawVersionId = law;
        // Single review surface - approve cards then export inline (no phase axis).
        return app("delta");
      }
      return app("bill");
    }

    case "delta":
      // Bare delta = the bill-chooser; DeltaWorkspace renders a picker.
      return app("delta");

    case "clients": {
      // /clients, /clients?bill=, /clients/:clientId/bills/:billId,
      // /clients/:clientId/package (the consolidated client briefing)
      if (segments[1] && segments[2] === "bills" && segments[3]) {
        params.clientId = segments[1];
        params.billId = segments[3];
        return app("impact");
      }
      if (segments[1] && segments[2] === "package") {
        params.clientId = segments[1];
        return app("consolidated");
      }
      const bill = query.get("bill");
      if (bill) params.billId = bill; // preselect a bill (handoff from the delta)
      return app("scanner");
    }

    case "brief":
      return app("impact");

    case "watch": {
      // /watch, /watch/:clientId, the client-first exposure board.
      if (segments[1]) params.clientId = segments[1];
      return app("watch");
    }

    default:
      // Unknown path - fall back to the workspace overview rather than 404.
      return app("overview");
  }
}

/** Inverse of `parsePath`: the URL to push for a given screen + params. */
export function buildPath(page: PageId, params: Record<string, string> = {}): string {
  switch (page) {
    case "overview":
      return "/overview";

    case "monitor": {
      const query = new URLSearchParams();
      if (params.session) query.set("session", params.session);
      if (params.practice) query.set("practice", params.practice);
      const qs = query.toString();
      return qs ? `/bills?${qs}` : "/bills";
    }

    case "bill":
      return params.billId ? `/bills/${params.billId}` : "/bills";

    case "delta": {
      if (!params.billId) return "/delta";
      const base = `/bills/${params.billId}/delta`;
      return params.lawVersionId ? `${base}?law=${params.lawVersionId}` : base;
    }

    case "scanner":
      return params.billId
        ? `/clients?bill=${encodeURIComponent(params.billId)}`
        : "/clients";

    case "impact":
      return params.clientId && params.billId
        ? `/clients/${params.clientId}/bills/${params.billId}`
        : "/brief";

    case "watch":
      return params.clientId ? `/watch/${params.clientId}` : "/watch";

    case "consolidated":
      return params.clientId ? `/clients/${params.clientId}/package` : "/watch";

    default:
      return "/overview";
  }
}

export { isPageId };
