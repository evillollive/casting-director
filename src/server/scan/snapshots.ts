import { createHash } from "node:crypto";

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashSnapshot(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
