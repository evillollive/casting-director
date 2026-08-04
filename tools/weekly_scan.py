#!/usr/bin/env python3
"""Run the complete Tier 1 scheduled scan pipeline."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import casting_eval
from dedupe import SeenStore, dedupe_candidates
from prompt_builder import DNR_PATH, build_prompt, tuning_from_environment
from render_report import render_report, select_shortlist
from screen import CastingBrief, LlmClient, ScreenConfigurationError, screen_candidates
from sources import collect_sources, default_sources

ROOT = Path(__file__).resolve().parent.parent


class PipelineError(RuntimeError):
    pass


def load_seen_store(seen_path: Path, legacy_seen_path: Path | None = None) -> SeenStore:
    store = SeenStore(seen_path).load()
    if store.was_empty and legacy_seen_path and legacy_seen_path.exists():
        legacy = SeenStore(legacy_seen_path).load()
        if not legacy.is_empty():
            store.data = legacy.data
            store.was_empty = False
    return store


def remember_screening_results(store: SeenStore, briefs: list[CastingBrief], run_date: date) -> None:
    """Keep final cuts permanent while letting "not this week" candidates return."""
    shortlist_ids = {brief.candidate.fingerprint for brief in select_shortlist(briefs)}
    permanent = []
    parked = []
    for brief in briefs:
        hard_excluded = brief.not_for_surfacing or (not brief.gate_passed and not brief.parked_reason)
        if brief.candidate.fingerprint in shortlist_ids or hard_excluded:
            permanent.append(brief.candidate)
        else:
            parked.append(brief.candidate)
    store.record_permanent(permanent, seen_on=run_date.isoformat())
    store.record_parked(parked, parked_on=run_date.isoformat())


def run_pipeline(
    *,
    run_date: date,
    seen_path: Path,
    output_path: Path,
    max_candidates: int = 60,
    tuning: dict | None = None,
    llm_client=None,
    source_connectors=None,
    legacy_seen_path: Path | None = None,
) -> tuple[str, list[str]]:
    since = datetime.combine(run_date, time.min, tzinfo=timezone.utc) - timedelta(days=7)
    fetched = collect_sources(source_connectors or default_sources(), since)
    dnr_markdown = DNR_PATH.read_text(encoding="utf-8")
    store = load_seen_store(seen_path, legacy_seen_path)
    deduped = dedupe_candidates(
        fetched.candidates,
        dnr_markdown=dnr_markdown,
        seen_store=store,
        as_of=run_date,
    )
    survivors = deduped.survivors[:max_candidates]
    if not survivors:
        # Empty reports cannot pass casting_eval's NO_ENTRIES guard, and treating
        # collection or memory loss as a quiet week would create a false success.
        raise PipelineError("no unseen candidates survived source collection and dedupe")

    prompt = build_prompt(tuning=tuning or {})
    client = llm_client or LlmClient.from_environment()
    briefs = screen_candidates(survivors, run_prompt=prompt, client=client)
    sources_scanned = sorted({candidate.source for candidate in fetched.candidates})
    warnings = []
    if store.was_empty and briefs:
        warnings.append(
            "persisted seen state was empty before this run; review the shortlist for resurfaced candidates."
        )
    report = render_report(
        briefs,
        reviewed_count=len(survivors),
        sources_scanned=sources_scanned,
        warnings=warnings,
    )

    dnr_names = casting_eval.parse_dnr_names(dnr_markdown)
    violations = casting_eval.evaluate(report, dnr_names=dnr_names, as_of=run_date)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report, encoding="utf-8")
    if casting_eval.has_errors(violations):
        raise PipelineError(casting_eval.format_report(violations))

    remember_screening_results(store, briefs, run_date)
    store.save()
    return report, fetched.errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Tier 1 weekly casting scan.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seen", type=Path, default=ROOT / "rolodex" / "seen.json")
    parser.add_argument("--legacy-seen", type=Path, default=ROOT / ".casting" / "seen.json")
    parser.add_argument("--run-date", type=date.fromisoformat, default=date.today())
    parser.add_argument("--max-candidates", type=int, default=60)
    parser.add_argument("--tuning", type=Path, help="Optional JSON tuning file.")
    args = parser.parse_args()

    tuning = tuning_from_environment()
    if args.tuning:
        tuning.update(json.loads(args.tuning.read_text(encoding="utf-8")))
    try:
        _, errors = run_pipeline(
            run_date=args.run_date,
            seen_path=args.seen,
            output_path=args.output,
            max_candidates=args.max_candidates,
            tuning=tuning,
            legacy_seen_path=args.legacy_seen,
        )
    except (PipelineError, ScreenConfigurationError, OSError, ValueError) as exc:
        print(f"weekly scan failed: {exc}", file=sys.stderr)
        return 1
    for error in errors:
        print(f"source warning: {error}", file=sys.stderr)
    print(f"Wrote evaluated report to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
