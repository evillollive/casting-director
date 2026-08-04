const labels = {
  PENDING: "Pending",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
} as const;

export function ScanStatusBadge({ status }: { status: keyof typeof labels }) {
  return <span className={`scan-status scan-status-${status.toLowerCase()}`}>{labels[status]}</span>;
}
