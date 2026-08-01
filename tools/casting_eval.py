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
from datetime import date, timedelta
from functools import lru_cache
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
    "sensitivity": ["sensitivity"],
    "score": ["score"],
    "source": ["source link", "source"],
}

URL_RE = re.compile(r"https?://[^\s)>\]]+")
ISO_DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
# "4.5/5" must not read as an overall of 5, so refuse a preceding digit or dot.
OVERALL_RE = re.compile(r"(?<![\d.])([0-5])\s*/\s*5\b")
DIMS = ["p", "hook", "now", "voice", "arc", "reach"]

# How far past the ~7 day window a dated "why now" can sit before it stops
# being a reason to tell the story *this* week.
STALE_DAYS = 14

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

# Acknowledging a cluster means naming it. Generic praise ("good spread across
# sources") is exactly the boilerplate the check exists to catch, so only words
# that admit clustering count, plus naming the clustered source itself.
DIVERSITY_ACK = ["cluster", "all from", "same source", "monotone", "skew", "swap", "over-index"]

# A source URL's host tells you where the candidate was found. A repo host does
# not: almost every candidate links a repo, so counting raw domains would call
# any list "varied". These are folded into feeds, and repo hosts are generic.
FEEDS = {
    "news.ycombinator.com": "Hacker News",
    "hn.algolia.com": "Hacker News",
    "reddit.com": "Reddit",
    "redd.it": "Reddit",
    "producthunt.com": "Product Hunt",
    "lobste.rs": "Lobsters",
    "dev.to": "Dev.to",
    "indiehackers.com": "Indie Hackers",
    "hackaday.com": "Hackaday",
    "hackaday.io": "Hackaday",
    "itch.io": "itch.io",
    "devpost.com": "Devpost",
    "kickstarter.com": "Kickstarter",
    "tindie.com": "Tindie",
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "twitch.tv": "Twitch",
    "bsky.app": "Bluesky",
    "mastodon.social": "Mastodon",
    "fosstodon.org": "Mastodon",
    "x.com": "X",
    "twitter.com": "X",
    "github.com": "GitHub",
    "gist.github.com": "GitHub",
    "github.blog": "GitHub",
    "gitlab.com": "GitLab",
    "codeberg.org": "Codeberg",
    "sourcehut.org": "sourcehut",
}
# Code hosts: where the work lives, not where you found the person.
GENERIC_FEEDS = {"GitHub", "GitLab", "Codeberg", "sourcehut"}
# The rubric flags a cluster at three or more entries from one source.
CLUSTER_MIN = 3

# Surfacing a minor is a different decision from surfacing an adult, so it has
# to be named in the brief rather than discovered during outreach.
MINOR_RE = re.compile(
    r"\b(?:1[0-7]\s*[- ]?\s*year[- ]?old|high[- ]school(?:er)?|teenager|teenage|"
    r"under\s*18|underage|schoolkid|middle[- ]school)\b",
    re.IGNORECASE,
)
MINOR_ACK = ["minor", "age", "guardian", "parent", "consent", "under 18", "school"]

# Contact paths must be public and non-invasive.
INVASIVE_SIGNALS = [
    "phone number",
    "home address",
    "personal phone",
    "cell number",
    "mobile number",
    "employer email",
    "work email",
    "home email",
    "family member",
    "school address",
]
PHONE_RE = re.compile(
    r"(?<![\w])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)\s*|\d{2,4}[\s.-])\d{2,4}[\s.-]?\d{2,4}(?![\w])"
)

# Field bullets look like: - **Label:** value
FIELD_LINE_RE = re.compile(r"^\s*[-*]\s*\*\*(?P<label>[^*]+?):?\*\*\s*(?P<value>.*)$")
HEADER_RE = re.compile(r"^\s*#{1,6}\s")
PARKING_HEADER_RE = re.compile(r"^\s*#{1,6}\s*parking\b", re.IGNORECASE)
# "Shortlist check" is a report section, not more candidates, so it must be
# tested before the plain "Shortlist" header.
CHECK_HEADER_RE = re.compile(
    r"^\s*#{1,6}\s*(?:shortlist check|list check|notes|taste log|tuning)\b", re.IGNORECASE
)
SHORTLIST_HEADER_RE = re.compile(r"^\s*#{1,6}\s*shortlist\b", re.IGNORECASE)


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


def split_sections(text: str) -> dict:
    """Split a run into 'shortlist', 'parking' and 'other' line groups.

    Without this, a parking lot written with the same bold-label template parses
    as extra shortlist entries: false missing-field errors and a false size
    violation for names that were never shortlisted.
    """
    out = {"shortlist": [], "parking": [], "other": []}
    section = "shortlist"
    for line in text.splitlines():
        if HEADER_RE.match(line):
            if PARKING_HEADER_RE.match(line):
                section = "parking"
            elif CHECK_HEADER_RE.match(line):
                section = "other"
            elif SHORTLIST_HEADER_RE.match(line):
                section = "shortlist"
        out[section].append(line)
    return out


def _parse_entry_lines(lines: list[str]) -> list["Entry"]:
    entries: list[Entry] = []
    current: Optional[Entry] = None
    for line in lines:
        m = FIELD_LINE_RE.match(line)
        if not m:
            # Stop an entry when we hit a section header after it started.
            if current is not None and HEADER_RE.match(line):
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


def parse_entries(text: str) -> list["Entry"]:
    """Parse the shortlist entries only, keyed on the Name / handle line."""
    return _parse_entry_lines(split_sections(text)["shortlist"])


def narrative_text(text: str) -> str:
    """The prose of a run, with candidate field bullets removed.

    Refusal detection reads this rather than the raw text. A brief for an
    offline-first project ("works without internet access") otherwise trips the
    refusal regex and voids the entire run.
    """
    return "\n".join(line for line in text.splitlines() if not FIELD_LINE_RE.match(line))


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


def normalize_dnr_name(name: str) -> str:
    """Reduce a rolodex cell to a comparable token.

    '@octocat', 'https://github.com/octocat' and 'octocat' are the same person,
    and the table is hand-typed, so whitespace is collapsed too.
    """
    n = (name or "").strip().lower()
    n = re.sub(r"^https?://", "", n)
    n = re.sub(r"^(?:www\.)?(?:github|gitlab|codeberg)\.com/", "", n)
    n = n.lstrip("@").strip().strip("/")
    return re.sub(r"\s+", " ", n)


@lru_cache(maxsize=4096)
def _dnr_pattern(raw: str):
    """The compiled bounded matcher for one rolodex cell, or None if unusable.

    dnr_matches runs once per shortlist entry, so without this the same handful
    of names is re-normalized and re-escaped into a fresh pattern for every
    entry: the dominant cost of a run once a rolodex has a few hundred rows.
    """
    needle = normalize_dnr_name(raw)
    if len(needle) < 3:
        return None
    return re.compile(r"(?<![a-z0-9])" + re.escape(needle) + r"(?![a-z0-9])")


def dnr_matches(haystack: str, dnr_names: list[str]) -> list[str]:
    """Which do-not-resurface entries genuinely appear in this text.

    Matching is bounded, not substring: a rolodex entry for 'ai' must not veto
    'Aisha', and very short tokens are ignored entirely because they cannot be
    identifying.
    """
    hay = re.sub(r"\s+", " ", (haystack or "").lower())
    hits: list[str] = []
    for raw in dnr_names:
        pattern = _dnr_pattern(raw)
        if pattern is not None and pattern.search(hay):
            hits.append(raw)
    return hits


def _domain(url: str) -> str:
    m = re.match(r"https?://([^/]+)/?", url)
    return m.group(1).lower().replace("www.", "") if m else url.lower()


def _feed(url: str) -> str:
    """Map a URL to the feed it represents, falling back to its domain."""
    domain = _domain(url)
    for host, name in FEEDS.items():
        if domain == host or domain.endswith("." + host):
            return name
    return domain


def entry_feed(urls: list[str]) -> Optional[str]:
    """The feed an entry was sourced from: the first non-repo host if there is
    one, since a repo link says where the code lives, not where you found them."""
    feeds = [_feed(u) for u in urls]
    for f in feeds:
        if f not in GENERIC_FEEDS:
            return f
    return feeds[0] if feeds else None


def iso_dates(value: str) -> list[date]:
    out: list[date] = []
    for m in ISO_DATE_RE.findall(value or ""):
        try:
            out.append(date.fromisoformat(m))
        except ValueError:
            continue
    return out


def _coerce_date(value) -> Optional[date]:
    if value is None or isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def is_refusal(text: str) -> bool:
    narrative = narrative_text(text)
    low = narrative.lower()
    if any(sig in low for sig in REFUSAL_SIGNALS):
        return True
    return bool(REFUSAL_RE.search(narrative))


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


def evaluate(
    text: str,
    dnr_names: Optional[list[str]] = None,
    live: bool = False,
    as_of=None,
) -> list[Violation]:
    """Lint a run. Pass as_of (a date or YYYY-MM-DD) to also check recency."""
    dnr_names = dnr_names or []
    as_of_date = _coerce_date(as_of)
    violations: list[Violation] = []
    sections = split_sections(text)
    entries = _parse_entry_lines(sections["shortlist"])

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

    seen_names: set[str] = set()
    for e in entries:
        key = re.sub(r"\s+", " ", e.name.strip().lower())
        if key and key in seen_names:
            violations.append(
                Violation("DUPLICATE_ENTRY", ERROR, "This candidate appears more than once in the shortlist.", e.name)
            )
        seen_names.add(key)

    feeds: list[str] = []
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
        feed = entry_feed(src_urls)
        if feed:
            feeds.append(feed)

        # Why now: dated within reason, or explicitly evergreen.
        why = e.get("why_now").lower()
        if why and not (ISO_DATE_RE.search(e.get("why_now")) or "evergreen" in why):
            violations.append(
                Violation("UNDATED_WHY_NOW", ERROR, "'Why now' has no date and is not labeled evergreen.", label)
            )
        if as_of_date is not None:
            dates = iso_dates(e.get("why_now"))
            if dates:
                newest = max(dates)
                if newest > as_of_date:
                    violations.append(
                        Violation("FUTURE_WHY_NOW", WARN, f"'Why now' is dated {newest.isoformat()}, after the run date.", label)
                    )
                elif newest < as_of_date - timedelta(days=STALE_DAYS):
                    violations.append(
                        Violation(
                            "STALE_WHY_NOW",
                            WARN,
                            f"'Why now' is dated {newest.isoformat()}, outside the ~7 day window. It is a reason, but not a reason this week.",
                            label,
                        )
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
        hay = f"{e.get('name')} {e.get('project')}"
        for bad in dnr_matches(hay, dnr_names):
            violations.append(Violation("RESURFACED", ERROR, f"Matches do-not-resurface entry '{bad}'.", label))

        # Corporate / VC false positive not acknowledged in a caveat.
        blob = e.raw.lower()
        caveat = f"{e.get('caveat')} {e.get('sensitivity')}".lower()
        hit = next((s for s in CORPORATE_SIGNALS if s in blob), None)
        if hit and hit not in caveat and "corporate" not in caveat and "vc" not in caveat and "funded" not in caveat:
            violations.append(
                Violation("CORPORATE_FALSE_POSITIVE", WARN, f"Looks funded/corporate ('{hit.strip()}') with no caveat.", label)
            )

        # Consent surface: a likely minor, and invasive contact paths.
        if MINOR_RE.search(e.raw) and not any(a in caveat for a in MINOR_ACK):
            violations.append(
                Violation(
                    "MINOR_SUBJECT",
                    WARN,
                    "Reads as a minor with no caveat. Filming a minor needs a guardian, so say so in the brief.",
                    label,
                )
            )
        reach_prose = ISO_DATE_RE.sub(" ", URL_RE.sub(" ", e.get("reach")))
        invasive = next((s for s in INVASIVE_SIGNALS if s in reach_prose.lower()), None)
        if invasive or PHONE_RE.search(reach_prose):
            violations.append(
                Violation(
                    "INVASIVE_CONTACT",
                    WARN,
                    f"Contact path looks invasive ({invasive or 'a phone number'}). Use public, non-invasive paths only.",
                    label,
                )
            )

    # Diversity: a clustered shortlist must be acknowledged in the check line.
    if feeds:
        counts: dict[str, int] = {}
        for f in feeds:
            counts[f] = counts.get(f, 0) + 1
        top = max(counts, key=lambda k: (counts[k], k))
        if counts[top] >= CLUSTER_MIN:
            check = _shortlist_check_text(text)
            if not (any(w in check for w in DIVERSITY_ACK) or top.lower() in check):
                violations.append(
                    Violation(
                        "MONOTONE_SHORTLIST",
                        WARN,
                        f"{counts[top]} of {len(entries)} entries come from one source ({top}) and the shortlist check doesn't flag it.",
                    )
                )

    # The do-not-resurface list is an exclusion, so parking someone still breaks it.
    parking = "\n".join(sections["parking"])
    for bad in dnr_matches(parking, dnr_names):
        violations.append(
            Violation("RESURFACED_PARKING", WARN, f"Parking lot names do-not-resurface entry '{bad}'.")
        )

    if live:
        violations.extend(_check_live_urls(entries))

    return violations


def _check_live_urls(entries: list[Entry]) -> list[Violation]:
    import urllib.request

    out: list[Violation] = []
    for e in entries:
        for url in URL_RE.findall(e.get("source")):
            if not _resolves(urllib.request, url, "HEAD") and not _resolves(urllib.request, url, "GET"):
                out.append(Violation("DEAD_SOURCE_URL", ERROR, f"Source URL did not resolve: {url}.", e.name))
    return out


def _resolves(urllib_request, url: str, method: str) -> bool:
    """Try one request. Many sources reject HEAD or a bot user agent, so a
    failed HEAD is retried as a GET before a URL is called dead."""
    req = urllib_request.Request(
        url,
        method=method,
        headers={"User-Agent": "Mozilla/5.0 (compatible; casting-eval/1.0)", "Accept": "*/*"},
    )
    try:
        urllib_request.urlopen(req, timeout=10)
        return True
    except Exception:  # noqa: BLE001 - network is best-effort
        return False


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
    ap.add_argument(
        "--asof",
        default=None,
        help="Run date (YYYY-MM-DD) for the recency check. Defaults to today; use --no-recency to skip.",
    )
    ap.add_argument("--no-recency", action="store_true", help="Skip the 'why now' recency check.")
    args = ap.parse_args(argv)

    text = open(args.run, encoding="utf-8").read()
    dnr_names = parse_dnr_names(open(args.dnr, encoding="utf-8").read()) if args.dnr else []
    live = args.live or os.environ.get("CASTING_EVAL_LIVE") == "1"
    as_of = None if args.no_recency else (args.asof or date.today())

    violations = evaluate(text, dnr_names=dnr_names, live=live, as_of=as_of)
    if args.json:
        print(json.dumps([asdict(v) for v in violations], indent=2))
    else:
        print(format_report(violations))
    return 1 if has_errors(violations) else 0


if __name__ == "__main__":
    sys.exit(main())
