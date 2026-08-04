const secretPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,;]+/gi,
  /:\/\/[^/\s:@]+:[^/\s@]+@/g,
];

export function redactLogText(value: string): string {
  return secretPatterns.reduce(
    (redacted, pattern) => redacted.replace(pattern, "[REDACTED]"),
    value,
  );
}

export function errorLogMessage(error: unknown): string {
  return redactLogText(error instanceof Error ? error.message : String(error));
}
