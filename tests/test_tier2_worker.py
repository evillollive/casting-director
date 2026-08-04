"""Tier 2 machine boundary behavior without network or database dependencies."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import tier2_scan_worker as worker
from casting_eval import dnr_matches, parse_dnr_names
from sources import SourceFetch
from test_pipeline import mapping, raw


class SuccessfulSource:
    name = "Hacker News"

    def fetch(self, since):
        return SourceFetch(
            candidates=[raw(1), raw(2)],
            successful_requests=1,
        )


class FailedSource:
    name = "Reddit"

    def fetch(self, since):
        raise RuntimeError("blocked from this runner IP")


class EmptySuccessfulSource:
    name = "GitHub"

    def fetch(self, since):
        return SourceFetch()


class Client:
    def complete_json(self, system_prompt, user_prompt):
        index = 2 if "Builder 2" in user_prompt else 1
        return mapping(index)


def request() -> dict:
    return {
        "version": 1,
        "scan_id": "scan-1",
        "run_date": "2026-08-04",
        "source_keys": ["reddit", "hacker-news"],
        "max_candidates": 60,
        "prompt_template": (
            Path("prompts/tier0-weekly-scan.md").read_text(encoding="utf-8")
        ),
        "model": {
            "endpointUrl": "https://example.test/v1",
            "model": "test-model",
            "timeoutSeconds": 30,
        },
        "tuning": {
            "beat": "Visible independent craft",
            "hardNos": ["No corporate announcements"],
            "moreOf": ["Public iteration"],
        },
        "taste_log": [
            {"weekOf": "2026-08-03", "note": "Prefer visible transformations."}
        ],
        "memory": [],
        "do_not_resurface": [],
    }


def test_boundary_isolates_source_failure_and_persists_progress(monkeypatch):
    monkeypatch.setattr(worker, "_evaluate", lambda report, dnr, run_date: [])
    events = []

    result = worker.execute(
        request(),
        events.append,
        connectors=[FailedSource(), SuccessfulSource()],
        client=Client(),
    )

    failed = next(event for event in events if event.get("status") == "failed")
    assert failed["source_key"] == "reddit"
    assert "blocked" in failed["error_message"]
    assert result["status"] == "completed"
    assert result["counts"]["candidates_fetched"] == 2
    assert result["counts"]["candidates_screened"] == 2
    assert any(event["type"] == "prompt" for event in events)


def test_boundary_uses_only_the_two_canonical_shortlist_gates(monkeypatch):
    class GateClient(Client):
        def complete_json(self, system_prompt, user_prompt):
            value = super().complete_json(system_prompt, user_prompt)
            if "Builder 1" in user_prompt:
                value.update(
                    overall=5,
                    protagonist=2,
                    visible_hook=5,
                    why_now_score=5,
                    voice_score=5,
                    arc_score=5,
                    reach_score=5,
                )
            else:
                value.update(
                    overall=1,
                    protagonist=3,
                    visible_hook=3,
                    why_now_score=1,
                    voice_score=1,
                    arc_score=1,
                    reach_score=1,
                )
            return value

    monkeypatch.setattr(worker, "_evaluate", lambda report, dnr, run_date: [])
    value = request()
    value["source_keys"] = ["hacker-news"]
    result = worker.execute(
        value,
        lambda event: None,
        connectors=[SuccessfulSource()],
        client=GateClient(),
    )

    placements = {
        item["candidate"]["fingerprint"]: item["placement"]
        for item in result["candidates"]
    }
    assert placements["test:1"] == "HARD_EXCLUDED"
    assert placements["test:2"] == "SHORTLIST"


def test_evaluator_error_keeps_diagnostics_but_fails_result(monkeypatch):
    monkeypatch.setattr(
        worker,
        "_evaluate",
        lambda report, dnr, run_date: [
            {
                "code": "GATE_PROTAGONIST",
                "severity": "ERROR",
                "message": "Gate failed.",
                "candidate_reference": "Builder 1",
            }
        ],
    )
    value = request()
    value["source_keys"] = ["hacker-news"]
    result = worker.execute(
        value,
        lambda event: None,
        connectors=[SuccessfulSource()],
        client=Client(),
    )

    assert result["status"] == "failed"
    assert result["eval_passed"] is False
    assert result["report_markdown"].startswith("Summary:")
    assert result["violations"][0]["severity"] == "ERROR"


def test_cli_rejects_an_unknown_protocol_with_structured_fatal_event():
    process = subprocess.run(
        [sys.executable, "tools/tier2_scan_worker.py"],
        input=json.dumps({"version": 999}),
        text=True,
        capture_output=True,
        check=False,
    )

    event = json.loads(process.stdout)
    assert process.returncode == 2
    assert event == {
        "type": "fatal",
        "code": "CONFIGURATION_ERROR",
        "message": "unsupported protocol version: 999",
        "retryable": False,
    }


def test_boundary_invokes_canonical_evaluator_with_run_date():
    report = Path("tests/fixtures/run_good.md").read_text(encoding="utf-8")
    dnr = Path("tests/fixtures/dnr_sample.md").read_text(encoding="utf-8")

    violations = worker._evaluate(report, dnr, worker.date(2026, 8, 3))

    assert all(item["severity"] != "ERROR" for item in violations)
    assert any(item["code"] == "STALE_WHY_NOW" for item in violations)


def test_complete_source_outage_is_distinct_from_one_failed_source():
    value = request()
    value["source_keys"] = ["reddit"]

    try:
        worker.execute(
            value,
            lambda event: None,
            connectors=[FailedSource()],
            client=Client(),
        )
    except worker.SourceOutageError as exc:
        assert "complete source outage" in str(exc)
    else:
        raise AssertionError("a complete outage must fail the scan")


def test_successful_empty_source_is_not_mislabeled_as_an_outage():
    value = request()
    value["source_keys"] = ["github"]

    try:
        worker.execute(
            value,
            lambda event: None,
            connectors=[EmptySuccessfulSource()],
            client=Client(),
        )
    except worker.SourceOutageError:
        raise AssertionError("a completed empty feed is not a source outage")
    except worker.PipelineError as exc:
        assert "no unseen candidates" in str(exc)
    else:
        raise AssertionError("an empty run must not complete")


def test_parking_display_cap_does_not_make_overflow_permanent(monkeypatch):
    class WideSource:
        name = "Hacker News"

        def fetch(self, since):
            return SourceFetch(
                candidates=[raw(index) for index in range(1, 11)],
                successful_requests=1,
            )

    class WideClient:
        def complete_json(self, system_prompt, user_prompt):
            for index in range(1, 11):
                if f"Builder {index}" in user_prompt:
                    return mapping(index)
            raise AssertionError("candidate index missing")

    monkeypatch.setattr(worker, "_evaluate", lambda report, dnr, run_date: [])
    value = request()
    value["source_keys"] = ["hacker-news"]
    result = worker.execute(
        value,
        lambda event: None,
        connectors=[WideSource()],
        client=WideClient(),
    )

    assert result["counts"]["shortlist_count"] == 8
    assert result["counts"]["parking_count"] == 2
    assert [item["placement"] for item in result["candidates"]].count(
        "PARKING_LOT"
    ) == 2


def test_database_dnr_snapshot_preserves_name_and_handle_aliases():
    markdown = worker._dnr_markdown(
        [
            {
                "name": "Jane Doe",
                "handle": "@janed",
                "project": "Project X",
            }
        ]
    )
    names = parse_dnr_names(markdown)

    assert dnr_matches("Jane Doe Other Project", names)
    assert dnr_matches("@janed Another Project", names)
