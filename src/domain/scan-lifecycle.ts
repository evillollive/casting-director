import { passesShortlistGates } from "./editorial-contract";

export const scanStatuses = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
] as const;

export type ScanStatus = (typeof scanStatuses)[number];

const allowedTransitions: Record<ScanStatus, readonly ScanStatus[]> = {
  PENDING: ["RUNNING", "FAILED"],
  RUNNING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
};

export type EvaluatorViolation = {
  code: string;
  severity: "ERROR" | "WARNING";
  message: string;
  candidateReference?: string;
};

export class InvalidScanTransitionError extends Error {
  constructor(from: ScanStatus, to: ScanStatus) {
    super(`Scan cannot transition from ${from} to ${to}.`);
    this.name = "InvalidScanTransitionError";
  }
}

export function assertScanTransition(from: ScanStatus, to: ScanStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidScanTransitionError(from, to);
  }
}

export function assertScanCanComplete(input: {
  evalPassed: boolean;
  violations: readonly EvaluatorViolation[];
}): void {
  const errorCount = input.violations.filter(
    (violation) => violation.severity === "ERROR",
  ).length;

  if (!input.evalPassed || errorCount > 0) {
    throw new InvalidScanTransitionError("RUNNING", "COMPLETED");
  }
}

export function deriveGatePassed(input: {
  protagonistScore: number;
  visibleHookScore: number;
}): boolean {
  return passesShortlistGates(input);
}
