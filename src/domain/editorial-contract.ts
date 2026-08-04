export const CANONICAL_EDITORIAL_ARTIFACTS = {
  prompt: "prompts/tier0-weekly-scan.md",
  rubric: "rubric.md",
  evaluator: "tools/casting_eval.py",
} as const;

export const SHORTLIST_GATES = {
  protagonistScore: 3,
  visibleHookScore: 3,
} as const;

export const TASTE_LOG_INJECT_LIMIT = 8;

export function passesShortlistGates(input: {
  protagonistScore: number;
  visibleHookScore: number;
}): boolean {
  return (
    input.protagonistScore >= SHORTLIST_GATES.protagonistScore &&
    input.visibleHookScore >= SHORTLIST_GATES.visibleHookScore
  );
}
