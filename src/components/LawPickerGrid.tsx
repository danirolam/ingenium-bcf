import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRotateLeft, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import type { LawVersion } from "../types";
import { MomentumBadge } from "./badges";

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function LawPickerGrid({
  lawVersions,
  activeId,
  onSelect,
  onRevert,
  onDelete,
}: {
  lawVersions: LawVersion[];
  activeId: string;
  onSelect: (id: string) => void;
  onRevert?: (lv: LawVersion) => void;
  onDelete?: (lv: LawVersion) => void;
}) {
  if (lawVersions.length === 0) {
    return (
      <div className="lpg-empty">
        No approved laws yet — open a bill in the Delta Workspace and approve it.
      </div>
    );
  }

  return (
    <div className="lpg-grid">
      {lawVersions.map((lv) => {
        const isActive = lv.id === activeId;
        return (
          <div
            key={lv.id}
            className={`card lpg-card ${isActive ? "active" : ""}`}
            onClick={() => onSelect(lv.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(lv.id);
              }
            }}
          >
            {isActive && <span className="lpg-selected">✓ Selected</span>}
            <div className="lpg-top">
              <span className="lpg-bill">{lv.sourceBillNumber}</span>
              {!isActive && <MomentumBadge value={lv.legislativeMomentum} />}
            </div>
            <div className="lpg-title">{lv.baseLawTitle}</div>
            {(lv.affectedSections?.length ?? 0) > 0 && (
              <div className="lpg-sections">
                {(lv.affectedSections ?? []).join(", ")}
              </div>
            )}
            <div className="lpg-foot">Approved · {shortDate(lv.createdAt)}</div>
            {(onRevert || onDelete) && (
              <div className="lpg-actions">
                {onRevert && (
                  <button
                    type="button"
                    className="lpg-action"
                    title="Send this back to Needs review"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRevert(lv);
                    }}
                  >
                    <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" />
                    Revert
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    className="lpg-action danger"
                    title="Remove this approved law"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(lv);
                    }}
                  >
                    <FontAwesomeIcon icon={faTrashCan} aria-hidden="true" />
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
