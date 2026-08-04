#!/usr/bin/env python3
"""Machine-readable Tier 2 boundary around the canonical Tier 1 engine."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
from dataclasses import asdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from dedupe import SeenStore, dedupe_candidates
from prompt_builder import build_prompt_from_text
from render_report import render_report, select_shortlist
from screen import LlmClient, ScreenConfigurationError, ScreenResponseError, screen_candidates
from sources import RawCandidate, collect_sources, sources_by_key
from weekly_scan import PipelineError, select_for_screening

ROOT = Path(__file__).resolve().parent.parent
PROTOCOL_VERSION = 1


class SourceOutageError(PipelineError):
    pass


class EvaluatorExecutionError(PipelineError):
    pass


def emit(event: dict) -> None:
    print(json.dumps(event, separators=(",", ":")), flush=True)


def _memory_store(rows: list[dict], run_date: date) -> SeenStore:
    store = SeenStore(Path(os.devnull))
    for row in rows:
        candidate = RawCandidate(
            name=str(row.get("name") or ""),
            handle=str(row.get("handle") or ""),
            project=str(row.get("project") or ""),
            project_url=str(row.get("project_url") or ""),
            source="database",
            source_family="database",
            source_url="",
            fingerprint=str(row["fingerprint"]),
            context="",
        )
        if row.get("state") == "parked":
            store.record_parked(
                [candidate],
                parked_on=str(row.get("seen_on") or run_date.isoformat()),
            )
        else:
            store.record_permanent(
                [candidate],
                seen_on=str(row.get("seen_on") or run_date.isoformat()),
            )
    store.was_empty = store.is_empty()
    return store


def _dnr_markdown(rows: list[dict]) -> str:
    lines = ["| Name / handle | Project |", "|---|---|"]
    for row in rows:
        name = str(row.get("name") or "").replace("|", "\\|")
        handle = str(row.get("handle") or "").replace("|", "\\|")
        project = str(row.get("project") or "").replace("|", "\\|")
        if name:
            lines.append(f"| {name} | {project} |")
        if handle and handle.lower().lstrip("@") != name.lower().lstrip("@"):
            lines.append(f"| {handle} | {project} |")
    return "\n".join(lines) + "\n"


def _taste_markdown(rows: list[dict]) -> str:
    return "\n".join(
        f"- _Week of {row['weekOf']}:_ {row['note']}" for row in reversed(rows)
    )


def _tuning(snapshot: dict) -> dict:
    return {
        "beat": snapshot.get("beat", ""),
        "hardNos": "; ".join(snapshot.get("hardNos") or []),
        "moreOf": "; ".join(snapshot.get("moreOf") or []),
    }


def _evaluate(report: str, dnr: str, run_date: date) -> list[dict]:
    with tempfile.TemporaryDirectory(prefix="casting-eval-") as directory:
        root = Path(directory)
        report_path = root / "report.md"
        dnr_path = root / "dnr.md"
        report_path.write_text(report, encoding="utf-8")
        dnr_path.write_text(dnr, encoding="utf-8")
        process = subprocess.run(
            [
                sys.executable,
                str(ROOT / "tools" / "casting_eval.py"),
                str(report_path),
                "--dnr",
                str(dnr_path),
                "--asof",
                run_date.isoformat(),
                "--json",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
    if process.returncode not in (0, 1):
        raise EvaluatorExecutionError(
            f"canonical evaluator failed with exit {process.returncode}: "
            f"{process.stderr.strip() or 'no diagnostic output'}"
        )
    try:
        values = json.loads(process.stdout)
    except json.JSONDecodeError as exc:
        raise EvaluatorExecutionError("canonical evaluator returned invalid JSON") from exc
    return [
        {
            "code": value["code"],
            "severity": "ERROR" if value["severity"] == "error" else "WARNING",
            "message": value["message"],
            "candidate_reference": value.get("entry"),
        }
        for value in values
    ]


def _candidate_result(brief, placement: str, rank: int | None) -> dict:
    value = asdict(brief)
    value["gate_passed"] = brief.gate_passed
    value["placement"] = placement
    value["rank"] = rank
    return value


def execute(request: dict, event_sink=emit, *, connectors=None, client=None) -> dict:
    if request.get("version") != PROTOCOL_VERSION:
        raise ValueError(f"unsupported protocol version: {request.get('version')}")
    run_date = date.fromisoformat(request["run_date"])
    source_keys = request["source_keys"]
    registry = sources_by_key()
    unknown = [key for key in source_keys if key not in registry]
    if unknown:
        raise ValueError(f"unknown source keys: {', '.join(unknown)}")
    selected = connectors or [registry[key] for key in source_keys]
    source_names = {
        connector.name: key for key, connector in zip(source_keys, selected)
    }
    successful_sources = set()

    def source_progress(name, status, error, fetched_count=0):
        if status == "completed":
            successful_sources.add(name)
        event_sink(
            {
                "type": "source",
                "source_key": source_names.get(name, name),
                "status": status,
                "fetched_count": fetched_count,
                "error_code": "SOURCE_ERROR" if error else None,
                "error_message": error,
            }
        )

    since = datetime.combine(run_date, time.min, tzinfo=timezone.utc) - timedelta(days=7)
    fetched = collect_sources(selected, since, on_progress=source_progress)
    event_sink(
        {
            "type": "progress",
            "candidates_fetched": len(fetched.candidates),
        }
    )
    if not successful_sources and not fetched.candidates:
        raise SourceOutageError("complete source outage: no configured source returned data")

    dnr = _dnr_markdown(request.get("do_not_resurface", []))
    store = _memory_store(request.get("memory", []), run_date)
    deduped = dedupe_candidates(
        fetched.candidates,
        dnr_markdown=dnr,
        seen_store=store,
        as_of=run_date,
    )
    survivors = select_for_screening(
        deduped.survivors,
        int(request.get("max_candidates", 60)),
    )
    event_sink(
        {
            "type": "progress",
            "candidates_deduped": len(survivors),
        }
    )
    if not survivors:
        raise PipelineError("no unseen candidates survived source collection and dedupe")

    prompt = build_prompt_from_text(
        template=request["prompt_template"],
        dnr_markdown=dnr,
        taste_markdown=_taste_markdown(request.get("taste_log", [])),
        tuning=_tuning(request.get("tuning", {})),
    )
    event_sink(
        {
            "type": "prompt",
            "prompt": prompt,
            "prompt_hash": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        }
    )
    model = request["model"]
    llm = client or LlmClient(
        api_key=os.environ.get("CASTING_LLM_API_KEY", ""),
        api_url=str(model.get("endpointUrl") or ""),
        model=str(model.get("model") or ""),
        timeout=int(model.get("timeoutSeconds") or 120),
    )
    briefs = screen_candidates(
        survivors,
        run_prompt=prompt,
        client=llm,
        on_screened=lambda _brief, count, total: event_sink(
            {
                "type": "progress",
                "candidates_screened": count,
                "candidates_to_screen": total,
            }
        ),
    )
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
    violations = _evaluate(report, dnr, run_date)
    shortlist = select_shortlist(briefs)
    shortlist_ids = {
        brief.candidate.fingerprint: index
        for index, brief in enumerate(shortlist, start=1)
    }
    candidates = []
    for brief in briefs:
        fingerprint = brief.candidate.fingerprint
        if fingerprint in shortlist_ids:
            placement = "SHORTLIST"
            rank = shortlist_ids[fingerprint]
        elif (
            brief.parked_reason
            or brief.gate_passed
        ) and not brief.not_for_surfacing:
            placement = "PARKING_LOT"
            rank = None
        else:
            placement = "HARD_EXCLUDED"
            rank = None
        candidates.append(_candidate_result(brief, placement, rank))
    has_errors = any(item["severity"] == "ERROR" for item in violations)
    return {
        "type": "result",
        "status": "failed" if has_errors else "completed",
        "error": "canonical evaluator reported ERROR violations" if has_errors else None,
        "eval_passed": not has_errors,
        "report_markdown": report,
        "violations": violations,
        "candidates": candidates,
        "source_messages": fetched.messages(),
        "counts": {
            "candidates_fetched": len(fetched.candidates),
            "candidates_deduped": len(survivors),
            "candidates_screened": len(briefs),
            "shortlist_count": len(shortlist),
            "parking_count": sum(
                1 for item in candidates if item["placement"] == "PARKING_LOT"
            ),
        },
    }


def main() -> int:
    try:
        request = json.load(sys.stdin)
        result = execute(request)
        emit(result)
        return 0 if result["status"] == "completed" else 1
    except (
        KeyError,
        TypeError,
        ValueError,
        PipelineError,
        ScreenConfigurationError,
        ScreenResponseError,
        urllib.error.URLError,
    ) as exc:
        if isinstance(exc, (KeyError, TypeError, ValueError, ScreenConfigurationError)):
            code, retryable = "CONFIGURATION_ERROR", False
        elif isinstance(exc, SourceOutageError):
            code, retryable = "SOURCE_OUTAGE", True
        elif isinstance(exc, EvaluatorExecutionError):
            code, retryable = "EVALUATOR_ERROR", False
        elif isinstance(exc, ScreenResponseError):
            code, retryable = "MODEL_RESPONSE_ERROR", True
        elif isinstance(exc, urllib.error.URLError):
            code, retryable = "MODEL_ENDPOINT_ERROR", True
        else:
            code, retryable = "SCAN_EXECUTION_ERROR", True
        emit(
            {
                "type": "fatal",
                "code": code,
                "message": str(exc),
                "retryable": retryable,
            }
        )
        return 2
    except Exception as exc:
        emit(
            {
                "type": "fatal",
                "code": "UNEXPECTED_WORKER_ERROR",
                "message": str(exc),
                "retryable": True,
            }
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
