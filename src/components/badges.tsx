import type { ReactNode } from "react";
import type {
  ClientImpactAnalysis,
  LegislativeMomentum,
} from "../types";

export function StatusBadge({
  kind = "outline",
  children,
  dot = false,
}: {
  kind?: string;
  children: ReactNode;
  dot?: boolean;
}) {
  return (
    <span className={`badge ${kind}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

const MOMENTUM_LABEL: Record<LegislativeMomentum, string> = {
  early: "Early",
  active: "Active",
  advanced: "Advanced",
  passed: "Passed",
  in_force: "In force",
};

export function MomentumBadge({ value }: { value: LegislativeMomentum }) {
  return (
    <span className={`badge momentum-${value}`}>
      <span className="dot" />
      {MOMENTUM_LABEL[value]}
    </span>
  );
}

export function ImpactBadge({
  level,
}: {
  level: ClientImpactAnalysis["impactLevel"];
}) {
  const tone =
    level === "critical"
      ? "crit"
      : level === "high"
        ? "high"
        : level === "medium"
          ? "med"
          : "low";
  const label =
    level === "critical"
      ? "Critical"
      : level === "high"
        ? "High"
        : level === "medium"
          ? "Medium"
          : "Low";
  return (
    <span className={`badge ${tone}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function UrgencyBadge({
  value,
}: {
  value: ClientImpactAnalysis["urgency"];
}) {
  const label =
    value === "immediate"
      ? "Immediate"
      : value === "high"
        ? "High"
        : value === "medium"
          ? "Medium"
          : "Low";
  return (
    <span className={`badge urgency-${value}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function AffectedBadge({
  value,
}: {
  value: ClientImpactAnalysis["affected"];
}) {
  const label =
    value === "yes" ? "Affected" : value === "no" ? "Not affected" : "Unclear";
  return (
    <span className={`badge affected-${value}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function ReviewBadge({
  required,
  approved,
}: {
  required: boolean;
  approved?: boolean;
}) {
  if (approved) {
    return (
      <span className="review-badge approved">
        <span className="pip" />
        Approved
      </span>
    );
  }
  if (required) {
    return (
      <span className="review-badge needs-review">
        <span className="pip" />
        Needs review
      </span>
    );
  }
  return (
    <span className="review-badge in-review">
      <span className="pip" />
      In review
    </span>
  );
}
