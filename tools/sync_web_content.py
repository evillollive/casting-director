#!/usr/bin/env python3
"""sync_web_content: copy the canonical skill docs into web/content/.

The browser app is a static site: GitHub Pages only serves web/, so the app
cannot fetch files that live at the repo root. To keep a single source of
truth, the canonical markdown lives where it always has, and this script
mirrors the exact bytes into web/content/ for the app to fetch.

Run it after editing any of the mirrored files:

    python tools/sync_web_content.py

tests/test_web_content_sync.py fails if the copies drift, so CI catches a
forgotten sync.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# canonical source -> web/content destination filename
MIRRORS = {
    "prompts/tier0-weekly-scan.md": "tier0-weekly-scan.md",
    "rubric.md": "rubric.md",
    "sources.md": "sources.md",
    "rolodex/do-not-resurface.md": "do-not-resurface.md",
    "tests/fixtures/run_good.md": "sample-run.md",
}

DEST_DIR = ROOT / "web" / "content"


def sync(check: bool = False) -> int:
    DEST_DIR.mkdir(parents=True, exist_ok=True)
    drift = []
    for src_rel, dest_name in MIRRORS.items():
        src = ROOT / src_rel
        dest = DEST_DIR / dest_name
        want = src.read_bytes()
        have = dest.read_bytes() if dest.exists() else None
        if have != want:
            drift.append(dest_name)
            if not check:
                dest.write_bytes(want)
    if check:
        if drift:
            print("Out of sync (run tools/sync_web_content.py): " + ", ".join(drift))
            return 1
        print("web/content is in sync.")
        return 0
    print(f"Synced {len(MIRRORS)} file(s) into web/content/.")
    return 0


if __name__ == "__main__":
    sys.exit(sync(check="--check" in sys.argv))
