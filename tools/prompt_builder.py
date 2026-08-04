#!/usr/bin/env python3
"""Build a run prompt from the canonical Tier 0 markdown and current memory."""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPT_PATH = ROOT / "prompts" / "tier0-weekly-scan.md"
DNR_PATH = ROOT / "rolodex" / "do-not-resurface.md"
TASTE_PATH = ROOT / "rolodex" / "taste-log.md"
TASTE_INJECT_LIMIT = 8
TUNING_FIELDS = {
    "beat": "Beat / theme focus right now",
    "hardNos": "Hard nos",
    "moreOf": "More of",
}


def dnr_table(markdown: str) -> str:
    """Extract the canonical rolodex table exactly as the browser app exports it."""
    rows = [line.strip() for line in markdown.splitlines() if line.strip().startswith("|")]
    if len(rows) < 2:
        return markdown.strip()
    kept = rows[:2]
    for row in rows[2:]:
        cells = [cell.strip() for cell in row.strip("|").split("|")]
        if len(cells) < 2:
            continue
        if all(cell.lower().startswith("_example:") for cell in cells[:2]):
            continue
        kept.append(row)
    return "\n".join(kept)


def inject_tuning(template: str, values: dict | None) -> str:
    out = template
    for key, label in TUNING_FIELDS.items():
        value = " ".join(str((values or {}).get(key) or "").split())
        if not value:
            continue
        pattern = rf"^- \*\*{re.escape(label)}:\*\*.*$"
        replacement = f"- **{label}:** {value}"
        out = re.sub(
            pattern,
            lambda _match, text=replacement: text,
            out,
            count=1,
            flags=re.MULTILINE,
        )
    return out


def recent_taste_lines(markdown: str, limit: int = TASTE_INJECT_LIMIT) -> list[str]:
    lines = [
        line.strip()
        for line in markdown.splitlines()
        if re.match(r"^-\s+_Week of .+?:_", line.strip()) and "____" not in line
    ]
    return lines[-limit:]


def inject_taste_log(template: str, taste_markdown: str) -> str:
    lines = recent_taste_lines(taste_markdown)
    if not lines:
        return template
    replacement = "\n".join(lines)
    return re.sub(
        r"^- _Week of ____:_$",
        lambda _match: replacement,
        template,
        count=1,
        flags=re.MULTILINE,
    )


def build_prompt(
    *,
    prompt_path: Path = PROMPT_PATH,
    dnr_path: Path = DNR_PATH,
    taste_path: Path = TASTE_PATH,
    tuning: dict | None = None,
) -> str:
    template = prompt_path.read_text(encoding="utf-8")
    return build_prompt_from_text(
        template=template,
        dnr_markdown=dnr_path.read_text(encoding="utf-8"),
        taste_markdown=taste_path.read_text(encoding="utf-8"),
        tuning=tuning,
    )


def build_prompt_from_text(
    *,
    template: str,
    dnr_markdown: str,
    taste_markdown: str,
    tuning: dict | None = None,
) -> str:
    """Build the canonical prompt from immutable database-backed snapshots."""
    table = dnr_table(dnr_markdown)
    out = template.replace("<!-- paste here -->", table, 1)
    out = inject_tuning(out, tuning)
    return inject_taste_log(out, taste_markdown)


def build_prompt_from_snapshots(
    *,
    template: str,
    do_not_resurface: list[dict],
    taste_log: list[dict],
    tuning: dict | None = None,
) -> str:
    """Build from the same database snapshot shapes stored on Tier 2 scans."""
    dnr_lines = ["| Name / handle | Project |", "|---|---|"]
    for row in do_not_resurface:
        name = str(row.get("name") or "").replace("|", "\\|")
        handle = str(row.get("handle") or "").replace("|", "\\|")
        project = str(row.get("project") or "").replace("|", "\\|")
        if name:
            dnr_lines.append(f"| {name} | {project} |")
        if handle and handle.lower().lstrip("@") != name.lower().lstrip("@"):
            dnr_lines.append(f"| {handle} | {project} |")
    taste_markdown = "\n".join(
        f"- _Week of {row['weekOf']}:_ {' '.join(str(row['note']).split())}"
        for row in reversed(taste_log)
    )
    tuning_snapshot = tuning or {}
    normalized_tuning = {
        "beat": tuning_snapshot.get("beat", ""),
        "hardNos": "; ".join(tuning_snapshot.get("hardNos") or []),
        "moreOf": "; ".join(tuning_snapshot.get("moreOf") or []),
    }
    return build_prompt_from_text(
        template=template,
        dnr_markdown="\n".join(dnr_lines) + "\n",
        taste_markdown=taste_markdown,
        tuning=normalized_tuning,
    )


def tuning_from_environment() -> dict:
    return {
        "beat": os.environ.get("CASTING_TUNING_BEAT", ""),
        "hardNos": os.environ.get("CASTING_TUNING_HARD_NOS", ""),
        "moreOf": os.environ.get("CASTING_TUNING_MORE_OF", ""),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the Tier 1 screening prompt.")
    parser.add_argument("--output", type=Path, help="Write the prompt to this path instead of stdout.")
    parser.add_argument("--tuning", type=Path, help="Optional JSON file with beat, hardNos, and moreOf.")
    args = parser.parse_args()
    tuning = tuning_from_environment()
    if args.tuning:
        tuning.update(json.loads(args.tuning.read_text(encoding="utf-8")))
    prompt = build_prompt(tuning=tuning)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(prompt, encoding="utf-8")
    else:
        print(prompt, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
