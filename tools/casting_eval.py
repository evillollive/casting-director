#!/usr/bin/env python3
"""casting_eval: a linter for casting-director run outputs.

It scores an actual scan output against the skill's hard rules, the same rules
the prompt and rubric.md define. It is the offline guardrail against the most
common failure modes: hallucinated candidates, missing sources, undated
"why now", gate violations, resurfaced names, and monotone shortlists.

It checks what can be verified from the text alone. With CASTING_EVAL_LIVE=1 it
additionally tries to resolve each source URL over the network.

Usage:
    python tools/casting_eval.py run.md [--dnr rolodex/do-not-resurface.md] [--json]

Exit code is non-zero if any ERROR-severity violation is found.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field, asdict
from typing import Optional

ERROR = "error"
WARN = "warn"

REQUIRED_FIELDS = ["name", "project", "hook", "why_now", "voice", "arc", "reach", "score", "source"]

# Map a field key to the substrings that can introduce it in the bold label.
FIELD_LABELS = {
    "name": ["name / handle", "name/handle", "name"],
    "project": ["project"],
    "hook": ["the hook", "hook"],
    "why_now": ["why now"],
    "voice": ["voice"],
    "arc": ["arc"],
    "reach": ["reach"],
    "caveat": ["caveat"],
    "score": ["score"],
    "source": ["source link", "source"],
}

URL_RE = re.compile(r"https?://[^\s)>\]]+")
ISO_DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
OVERALL_RE = re.compile(r"\b([0-5])\s*/\s*5\b")
DIMS = ["p", "hook", "now", "voice", "arc", "reach"]

REFUSAL_SIGNALS = [
    "stopping rather than",
    "won't fabricate",
    "will not fabricate",
    "not fabricate",
    "re-run with browsing",
    "rerun with browsing",
]

# A refusal states that web/browsing access is missing. Strong negations may sit
# a few connector words away from the access noun ("unable to reach the internet").
_NEG = r"(?:don'?t have|do not have|without|lack|unable to|can'?t|cannot|no)"
_GAP = r"(?:\s+(?:to|a|the|any|reach|access|use|get|got|connect|browse|load|open|find))*"
_ACCESS = r"\s+(?:working\s+|live\s+)?(?:web access|web|internet|browsing|browser|search)\b"
REFUSAL_RE = re.compile(_NEG + _GAP + _ACCESS, re.IGNORECASE)

# Signals that a candidate is likely a funded company / corporate launch.
CORPORATE_SIGNALS = [
    "series a",
    "series b",
    "series c",
    "raised $",
    "venture",
    "vc-backed",
    "vc backed",
    "backed by",
    "seed round",
    "funding round",
    "our company",
    ", inc.",
    " inc.",
    " gmbh",
]

DIVERSITY_ACK = ["cluster", "all from", "same source", "monotone", "lean", "spread", "skew", "swap"]


@dataclass
class Violation:
    code: str
    severity: str
    message: str
    entry: Optional[str] = None


@dataclass
class Entry:
    name: str = ""
    fields: dict = field(default_factory=dict)
    raw: str = ""

    def get(self, key: str) -> str:
        return self.fields.get(key, "")


def _label_to_key(label: str) -> Optional[str]:
    low = label.strip().lower()
    for key, subs in FIELD_LABELS.items():
        for s in subs:
            if low.startswith(s):
                return key
    return None


def parse_entries(text: str) -> list[Entry]:
    """Split the shortlist into entries, keyed on the Name / handle line."""
    lines = text.splitlines()
    entries: list[Entry] = []
    current: Optional[Entry] = None
    # A field bullet looks like: - **Label:** value   (label may contain notes)
    field_re = re.compile(r"^\s*[-*]\s*\*\*(?P<label>[^*]+?):?\*\*\s*(?P<value>.*)$")
    for line in lines:
        m = field_re.match(line)
        if not m:
            # Stop an entry when we hit a section header after it started.
            if current is not None and re.match(r"^\s*#{1,6}\s", line):
                entries.append(current)
                current = None
            continue
        key = _label_to_key(m.group("label"))
        value = m.group("value").strip()
        if key == "name":
            if current is not None:
                entries.append(current)
            current = Entry(name=value)
            current.fields["name"] = value
            current.raw = line + "\n"
        elif current is not None and key is not None:
            current.fields[key] = value
            current.raw += line + "\n"
    if current is not None:
        entries.append(current)
    return entries


def parse_dnr_names(dnr_text: str) -> list[str]:
    """Pull names/projects from the do-not-resurface markdown table, skipping
    the header, separator, and any example/template rows."""
    names: list[str] = []
    for line in dnr_text.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        first = cells[0].lower()
        if first in ("name / handle", "name/handle", "") or set(first) <= {"-", ":"}:
            continue
        joined = " ".join(cells[:2]).lower()
        if "example" in joined or "_" in joined:
            continue
        for c in cells[:2]:
            c = c.strip().strip("_*")
            if c:
                names.append(c.lower())
    return names


def _domain(url: str) -> str:
    m = re.match(r"https?://([^/]+)/?", url)
    return m.group(1).lower().replace("www.", "") if m else url.lower()


def is_refusal(text: str) -> bool:
    low = text.lower()
    if any(sig in low for sig in REFUSAL_SIGNALS):
        return True
    return bool(REFUSAL_RE.search(text))


def parse_score_tuple(score_text: str) -> dict:
    """Extract overall X/5 and the per-dimension tuple P/Hook/Now/Voice/Arc/Reach."""
    out: dict = {}
    mo = OVERALL_RE.search(score_text)
    if mo:
        out["overall"] = int(mo.group(1))
    for dim in DIMS:
        m = re.search(rf"\b{dim}\s*[:=]?\s*([1-5])\b", score_text, re.IGNORECASE)
        if m:
            out[dim] = int(m.group(1))
    return out


def _shortlist_check_text(text: str) -> str:
    m = re.search(r"#+\s*Shortlist check\b(.*)$", text, re.IGNORECASE | re.DOTALL)
    return m.group(1).lower() if m else ""


def evaluate(text: str, dnr_names: Optional[list[str]] = None, live: bool = False) -> list[Violation]:
    dnr_names = dnr_names or []
    violations: list[Violation] = []
    entries = parse_entries(text)

    if is_refusal(text):
        if entries:
            violations.append(
                Violation(
                    "REFUSAL_WITH_CANDIDATES",
                    ERROR,
                    "Output refuses (no web access) yet still lists candidates. A refusal must contain zero candidates.",
                )
            )
        # A clean refusal needs nothing else.
        return violations

    if not entries:
        violations.append(Violation("NO_ENTRIES", ERROR, "No shortlist entries found and this is not a refusal."))
        return violations

    n = len(entries)
    if n > 8:
        violations.append(Violation("SHORTLIST_SIZE", ERROR, f"Shortlist has {n} entries; the cap is 8."))
    elif n < 5 and not re.search(r"quiet week|thin week|fewer than|only \w+ credible", text, re.IGNORECASE):
        violations.append(
            Violation("SHORTLIST_SIZE", WARN, f"Shortlist has {n} entries (<5) with no 'quiet week' justification.")
        )

    domains: list[str] = []
    for e in entries:
        label = e.name or "(unnamed)"
        for fkey in REQUIRED_FIELDS:
            if not e.get(fkey).strip():
                violations.append(Violation("MISSING_FIELD", ERROR, f"Missing required field '{fkey}'.", label))

        # Source: at least one real URL.
        src_urls = URL_RE.findall(e.get("source"))
        if not src_urls:
            violations.append(
                Violation("NO_SOURCE_URL", ERROR, "No source URL. Every candidate needs a live link opened this run.", label)
            )
        if src_urls:
            domains.append(_domain(src_urls[0]))

        # Why now: dated within reason, or explicitly evergreen.
        why = e.get("why_now").lower()
        if why and not (ISO_DATE_RE.search(e.get("why_now")) or "evergreen" in why):
            violations.append(
                Violation("UNDATED_WHY_NOW", ERROR, "'Why now' has no date and is not labeled evergreen.", label)
            )

        # Score tuple + gates.
        scores = parse_score_tuple(e.get("score"))
        if "overall" not in scores:
            violations.append(Violation("BAD_SCORE", ERROR, "Score is missing an overall X/5.", label))
        missing_dims = [d for d in DIMS if d not in scores]
        if missing_dims:
            violations.append(
                Violation("BAD_SCORE_TUPLE", ERROR, f"Score tuple missing dimensions: {', '.join(missing_dims)}.", label)
            )
        else:
            if scores["p"] < 3:
                violations.append(
                    Violation("GATE_PROTAGONIST", ERROR, f"Shortlisted with Protagonist={scores['p']} (<3 fails the gate).", label)
                )
            if scores["hook"] < 3:
                violations.append(
                    Violation("GATE_HOOK", ERROR, f"Shortlisted with Visible hook={scores['hook']} (<3 fails the gate).", label)
                )

        # Do-not-resurface.
        hay = f"{e.get('name')} {e.get('project')}".lower()
        for bad in dnr_names:
            if bad and bad in hay:
                violations.append(
                    Violation("RESURFACED", ERROR, f"Matches do-not-resurface entry '{bad}'.", label)
                )

        # Corporate / VC false positive not acknowledged in a caveat.
        blob = e.raw.lower()
        caveat = e.get("caveat").lower()
        hit = next((s for s in CORPORATE_SIGNALS if s in blob), None)
        if hit and hit not in caveat and "corporate" not in caveat and "vc" not in caveat and "funded" not in caveat:
            violations.append(
                Violation("CORPORATE_FALSE_POSITIVE", WARN, f"Looks funded/corporate ('{hit.strip()}') with no caveat.", label)
            )

    # Diversity: a one-source shortlist must be acknowledged in the check line.
    uniq = set(d for d in domains if d)
    if len(domains) >= 3 and len(uniq) == 1:
        if not any(w in _shortlist_check_text(text) for w in DIVERSITY_ACK):
            violations.append(
                Violation(
                    "MONOTONE_SHORTLIST",
                    WARN,
                    f"All {len(domains)} entries share one source ({next(iter(uniq))}) and the shortlist check doesn't flag it.",
                )
            )

    if live:
        violations.extend(_check_live_urls(entries))

    return violations


def _check_live_urls(entries: list[Entry]) -> list[Violation]:
    import urllib.request

    out: list[Violation] = []
    for e in entries:
        for url in URL_RE.findall(e.get("source")):
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "casting-eval/1.0"})
            try:
                urllib.request.urlopen(req, timeout=10)
            except Exception as exc:  # noqa: BLE001 - network is best-effort
                out.append(Violation("DEAD_SOURCE_URL", ERROR, f"Source URL did not resolve: {url} ({exc}).", e.name))
    return out


def has_errors(violations: list[Violation]) -> bool:
    return any(v.severity == ERROR for v in violations)


def format_report(violations: list[Violation]) -> str:
    if not violations:
        return "PASS: no violations."
    lines = []
    for v in violations:
        loc = f" [{v.entry}]" if v.entry else ""
        lines.append(f"{v.severity.upper():5} {v.code}{loc}: {v.message}")
    errs = sum(1 for v in violations if v.severity == ERROR)
    warns = sum(1 for v in violations if v.severity == WARN)
    lines.append(f"\n{errs} error(s), {warns} warning(s).")
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Lint a casting-director run output.")
    ap.add_argument("run", help="Path to the run output markdown file.")
    ap.add_argument("--dnr", help="Path to rolodex/do-not-resurface.md", default=None)
    ap.add_argument("--json", action="store_true", help="Emit violations as JSON.")
    ap.add_argument("--live", action="store_true", help="Also resolve source URLs over the network.")
    args = ap.parse_args(argv)

    text = open(args.run, encoding="utf-8").read()
    dnr_names = parse_dnr_names(open(args.dnr, encoding="utf-8").read()) if args.dnr else []
    live = args.live or os.environ.get("CASTING_EVAL_LIVE") == "1"

    violations = evaluate(text, dnr_names=dnr_names, live=live)
    if args.json:
        print(json.dumps([asdict(v) for v in violations], indent=2))
    else:
        print(format_report(violations))
    return 1 if has_errors(violations) else 0


if __name__ == "__main__":
    sys.exit(main())
