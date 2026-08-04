"""Render structured casting briefs in the canonical Tier 0 output format."""
from __future__ import annotations

from collections import Counter

from screen import CastingBrief

SHORTLIST_CAP = 8
PARKING_CAP = 8


def select_shortlist(briefs: list[CastingBrief]) -> list[CastingBrief]:
    eligible = [brief for brief in briefs if brief.gate_passed and not brief.not_for_surfacing]
    return sorted(eligible, key=lambda brief: brief.overall, reverse=True)[:SHORTLIST_CAP]


def select_parking(briefs: list[CastingBrief], shortlist: list[CastingBrief]) -> list[CastingBrief]:
    shortlist_ids = {brief.candidate.fingerprint for brief in shortlist}
    parked = [
        brief
        for brief in briefs
        if brief.candidate.fingerprint not in shortlist_ids
        and (brief.parked_reason or brief.not_for_surfacing or brief.gate_passed)
    ]
    return sorted(parked, key=lambda brief: brief.overall, reverse=True)[:PARKING_CAP]


def _brief_lines(brief: CastingBrief) -> list[str]:
    why_now = brief.why_now
    if brief.is_evergreen and "evergreen" not in why_now.lower():
        why_now = f"evergreen: {why_now}"
    score = (
        f"{brief.overall}/5 (P{brief.protagonist} / Hook{brief.visible_hook} / "
        f"Now{brief.why_now_score} / Voice{brief.voice_score} / "
        f"Arc{brief.arc_score} / Reach{brief.reach_score}). {brief.rationale}"
    )
    links = list(dict.fromkeys([brief.candidate.source_url, brief.candidate.project_url]))
    lines = [
        f"- **Name / handle:** {brief.name}" + (f" ({brief.handle})" if brief.handle else ""),
        f"- **Project (one line):** {brief.project}",
        f"- **The hook (why it films):** {brief.hook}",
        f'- **Why now (with date, or "evergreen"):** {why_now}',
        f"- **Voice (link to their writing/talk):** {brief.voice}",
        f"- **Arc / stakes:** {brief.arc}",
        f"- **Reach (contact path):** {brief.reach}",
        f"- **Caveat (if any):** {brief.caveat or 'none'}",
    ]
    if brief.sensitivity:
        lines.append(f"- **Sensitivity (if any):** {brief.sensitivity}")
    lines.extend(
        [
            f"- **Score:** {score}",
            f"- **Source link(s):** {' '.join(links)}",
        ]
    )
    return lines


def _cluster_line(shortlist: list[CastingBrief]) -> str:
    clusters = []
    dimensions = {
        "source": [brief.candidate.source_family for brief in shortlist],
        "category": [brief.category for brief in shortlist],
        "region": [brief.region for brief in shortlist if brief.region.lower() != "unknown"],
    }
    for label, values in dimensions.items():
        for value, count in sorted(Counter(values).items()):
            if value and count >= 3:
                clusters.append(f"{count} entries share {label} {value}")
    if clusters:
        return "Cluster flagged: " + "; ".join(clusters) + ". Review the skew before outreach."
    return "No cluster of 3 or more entries from one source, category, or region."


def render_report(
    briefs: list[CastingBrief],
    *,
    reviewed_count: int,
    sources_scanned: list[str] | None = None,
    warnings: list[str] | None = None,
) -> str:
    shortlist = select_shortlist(briefs)
    parking = select_parking(briefs, shortlist)
    sources = ", ".join(sources_scanned or sorted({brief.candidate.source for brief in briefs}))
    quiet = f" Quiet week: only {len(shortlist)} credible shortlist entries." if len(shortlist) < 5 else ""
    warning = " " + " ".join(f"WARNING: {item}" for item in (warnings or [])) if warnings else ""
    lines = [
        f"Summary: Scanned {sources or 'the configured feeds'}; reviewed {reviewed_count} candidates.{quiet}{warning}",
        "",
    ]
    lines.extend(["### Shortlist", ""])
    for brief in shortlist:
        lines.extend(_brief_lines(brief))
        lines.append("")
    lines.extend(["### Parking lot", ""])
    if parking:
        for brief in parking:
            reason = brief.parked_reason or (
                "not for surfacing" if brief.not_for_surfacing else "credible, below this week's cap"
            )
            lines.append(f"- **{brief.name}:** {brief.project} - {reason}")
    else:
        lines.append("- None this week.")
    lines.extend(["", "### Shortlist check", "", _cluster_line(shortlist), ""])
    return "\n".join(lines)
