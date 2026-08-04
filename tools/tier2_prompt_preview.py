#!/usr/bin/env python3
"""Render the Tier 2 prompt preview through the canonical prompt builder."""
from __future__ import annotations

import json
import sys

from prompt_builder import build_prompt_from_snapshots


def main() -> int:
    request = json.load(sys.stdin)
    prompt = build_prompt_from_snapshots(
        template=request["template"],
        do_not_resurface=request.get("doNotResurface", []),
        taste_log=request.get("tasteLog", []),
        tuning=request.get("tuning", {}),
    )
    json.dump({"prompt": prompt}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
