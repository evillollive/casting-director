#!/usr/bin/env python3
"""Batch bridge to the canonical casting evaluator identity normalization."""

from __future__ import annotations

import json
import sys

from casting_eval import normalize_dnr_name


def main() -> int:
    values = json.load(sys.stdin)
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        raise ValueError("Expected a JSON array of strings.")
    json.dump([normalize_dnr_name(value) for value in values], sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
