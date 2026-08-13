#!/usr/bin/env python3
"""sync_skill_bundle: mirror the canonical Tier 0 artifacts into the installable skill.

skill/casting-director/ is a self-contained, portable agent skill (Claude-style
.claude/skills and Copilot both understand the SKILL.md + bundled-files layout).
When it is installed it lives on its own, away from this repo, so it has to carry
its own copies of the runtime prompt, the rubric, the sources, a seed rolodex,
and the offline evaluator.

To keep a single source of truth, those canonical files stay where they always
have and this script mirrors the exact bytes into the bundle. Run it after
editing any mirrored file:

    python tools/sync_skill_bundle.py

tests/test_skill_bundle_sync.py fails if the copies drift, so CI catches a
forgotten sync. The bundle-only files (SKILL.md, INSTALL.md, rolodex/README.md)
have no canonical upstream and are edited in place inside the bundle.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

BUNDLE = ROOT / "skill" / "casting-director"

# canonical source (repo-relative) -> destination (bundle-relative)
MIRRORS = {
    "prompts/tier0-weekly-scan.md": "references/weekly-scan.md",
    "rubric.md": "references/rubric.md",
    "sources.md": "references/sources.md",
    "tests/fixtures/run_good.md": "references/sample-run.md",
    "rolodex/do-not-resurface.md": "rolodex/do-not-resurface.seed.md",
    "rolodex/taste-log.md": "rolodex/taste-log.seed.md",
    "tools/casting_eval.py": "scripts/casting_eval.py",
    "tools/normalize_dnr_identity.py": "scripts/normalize_dnr_identity.py",
}


def sync(check: bool = False) -> int:
    drift = []
    for src_rel, dest_rel in MIRRORS.items():
        src = ROOT / src_rel
        dest = BUNDLE / dest_rel
        want = src.read_bytes()
        have = dest.read_bytes() if dest.exists() else None
        if have != want:
            drift.append(dest_rel)
            if not check:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(want)
    if check:
        if drift:
            print(
                "Skill bundle out of sync (run tools/sync_skill_bundle.py): "
                + ", ".join(drift)
            )
            return 1
        print("skill/casting-director is in sync.")
        return 0
    print(f"Synced {len(MIRRORS)} file(s) into skill/casting-director/.")
    return 0


if __name__ == "__main__":
    sys.exit(sync(check="--check" in sys.argv))
