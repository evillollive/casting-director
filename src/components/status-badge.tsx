import type { CSSProperties } from "react";

const statusLabels = {
  NEW: "New",
  CONTACTED: "Contacted",
  PASSED: "Passed",
  CAST: "Cast",
  MAYBE_LATER: "Maybe later",
} as const;

const statusColors: Record<keyof typeof statusLabels, CSSProperties> = {
  NEW: { "--badge-color": "#76a9ff" } as CSSProperties,
  CONTACTED: { "--badge-color": "#b997ff" } as CSSProperties,
  PASSED: { "--badge-color": "#9ba3b3" } as CSSProperties,
  CAST: { "--badge-color": "#54d6a1" } as CSSProperties,
  MAYBE_LATER: { "--badge-color": "#f4b85d" } as CSSProperties,
};

export const candidateStatuses = Object.keys(
  statusLabels,
) as (keyof typeof statusLabels)[];

export function StatusBadge({
  status,
}: {
  status: keyof typeof statusLabels;
}) {
  return (
    <span className="status-badge" style={statusColors[status]}>
      {statusLabels[status]}
    </span>
  );
}
