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
        joined = " ".join(cells[:2]).lower()
        if "example" in joined or "_" in joined:
            continue
        kept.append(row)
    return "\n".join(kept)


def inject_tuning(template: str, values: dict | None) -> str:
    out = template
    for key, label in TUNING_FIELDS.items():
        value = str((values or {}).get(key) or "").strip()
        if not value:
            continue
        pattern = rf"^- \*\*{re.escape(label)}:\*\*.*$"
        out = re.sub(pattern, f"- **{label}:** {value}", out, count=1, flags=re.MULTILINE)
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
    return re.sub(r"^- _Week of ____:_$", "\n".join(lines), template, count=1, flags=re.MULTILINE)


def build_prompt(
    *,
    prompt_path: Path = PROMPT_PATH,
    dnr_path: Path = DNR_PATH,
    taste_path: Path = TASTE_PATH,
    tuning: dict | None = None,
) -> str:
    template = prompt_path.read_text(encoding="utf-8")
    table = dnr_table(dnr_path.read_text(encoding="utf-8"))
    out = template.replace("<!-- paste here -->", table, 1)
    out = inject_tuning(out, tuning)
    return inject_taste_log(out, taste_path.read_text(encoding="utf-8"))


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
