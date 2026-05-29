import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";

// A small "ⓘ" affordance for section headers and controls. Hover or focus it to
// read what the thing does — the per-control help the workspace was missing.
export function InfoHint({
  title,
  body,
  placement = "bottom",
}: {
  title?: string;
  body: ReactNode;
  placement?: "top" | "bottom";
}) {
  return (
    <Tooltip title={title} body={body} placement={placement} className="info-hint-wrap">
      <button
        type="button"
        className="info-hint"
        aria-label={title ? `About ${title}` : "More information"}
      >
        <FontAwesomeIcon icon={faCircleInfo} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
