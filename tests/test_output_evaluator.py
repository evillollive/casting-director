"""Behavioral tests: the output evaluator must catch the skill's failure modes.

Each fixture in tests/fixtures/ is a simulated run output engineered to trigger
one category of violation (or none, for the good run). These tests assert the
evaluator flags exactly what it should, which is what protects real runs from
hallucinations, gate violations, and resurfaced names.
"""
from pathlib import Path

import pytest

import casting_eval as ce

FIXTURES = Path(__file__).resolve().parent / "fixtures"
DNR = FIXTURES / "dnr_sample.md"


def run(name: str):
    text = (FIXTURES / name).read_text(encoding="utf-8")
    dnr = ce.parse_dnr_names(DNR.read_text(encoding="utf-8"))
    return ce.evaluate(text, dnr_names=dnr)


def codes(violations):
    return {v.code for v in violations}


def errors(violations):
    return [v for v in violations if v.severity == ce.ERROR]


def test_good_run_is_clean():
    v = run("run_good.md")
    assert v == [], f"expected a clean run, got {ce.format_report(v)}"
    assert not ce.has_errors(v)


def test_hallucinated_run_flags_missing_source_and_undated():
    v = run("run_hallucinated.md")
    assert "NO_SOURCE_URL" in codes(v)
    assert "UNDATED_WHY_NOW" in codes(v)
    assert ce.has_errors(v)


def test_gate_violations_are_caught():
    v = run("run_gate_violation.md")
    assert "GATE_PROTAGONIST" in codes(v)
    assert "GATE_HOOK" in codes(v)
    # The other three entries are valid, so gates are the only errors.
    assert {e.code for e in errors(v)} == {"GATE_PROTAGONIST", "GATE_HOOK"}


def test_resurfaced_name_is_caught():
    v = run("run_resurfaced.md")
    assert "RESURFACED" in codes(v)
    assert ce.has_errors(v)


def test_monotone_shortlist_warns_when_unacknowledged():
    v = run("run_monotone.md")
    assert "MONOTONE_SHORTLIST" in codes(v)
    # Monotony is a warning, not a hard error.
    assert not ce.has_errors(v)


def test_clean_refusal_passes():
    v = run("run_refusal_clean.md")
    assert v == [], f"a clean refusal should pass, got {ce.format_report(v)}"


def test_refusal_with_candidates_is_an_error():
    v = run("run_refusal_dirty.md")
    assert "REFUSAL_WITH_CANDIDATES" in codes(v)
    assert ce.has_errors(v)


def test_broken_format_is_caught():
    v = run("run_format_broken.md")
    c = codes(v)
    assert "SHORTLIST_SIZE" in c  # 9 > 8
    assert "MISSING_FIELD" in c
    assert "BAD_SCORE" in c
    assert ce.has_errors(v)


def test_corporate_false_positive_warns():
    v = run("run_corporate_falsepos.md")
    assert "CORPORATE_FALSE_POSITIVE" in codes(v)
    assert not ce.has_errors(v)


# --- Unit tests on the evaluator's building blocks ---


def test_score_tuple_parsing():
    s = "4/5 (P5 / Hook4 / Now3 / Voice4 / Arc3 / Reach2). Rationale."
    out = ce.parse_score_tuple(s)
    assert out["overall"] == 4
    assert out == {"overall": 4, "p": 5, "hook": 4, "now": 3, "voice": 4, "arc": 3, "reach": 2}


@pytest.mark.parametrize(
    "text",
    [
        "I don't have working web access, so I'm stopping rather than guessing.",
        "I cannot browse the web right now.",
        "Unable to reach the internet this run.",
        "Without web access I can't verify anything, so I'll stop.",
    ],
)
def test_refusal_detection_positive(text):
    assert ce.is_refusal(text)


@pytest.mark.parametrize(
    "text",
    [
        "Scanned Hacker News and GitHub; reviewed 40 candidates.",
        "Here is this week's shortlist of builders worth filming.",
    ],
)
def test_refusal_detection_negative(text):
    assert not ce.is_refusal(text)


def test_dnr_parser_skips_examples_and_headers():
    names = ce.parse_dnr_names(DNR.read_text(encoding="utf-8"))
    assert "jordan blake" in names
    assert "wei chen" in names
    assert all("example" not in n for n in names)


def test_entry_parser_counts_entries():
    text = (FIXTURES / "run_good.md").read_text(encoding="utf-8")
    entries = ce.parse_entries(text)
    assert len(entries) == 5
    assert entries[0].get("name").startswith("Jane Okoro")
    assert "github.com" in entries[1].get("reach")
