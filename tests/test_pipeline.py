"""Tier 1 dedupe, gates, rendering, and evaluator integration."""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import casting_eval as ce
from dedupe import SeenStore, dedupe_candidates
from render_report import render_report, select_shortlist
from screen import CastingBrief, ScreenConfigurationError, ScreenResponseError, brief_from_mapping
from sources import RawCandidate


def raw(
    index: int,
    *,
    source="Hacker News",
    family="hacker-news",
    source_url=None,
) -> RawCandidate:
    return RawCandidate(
        name=f"Builder {index}",
        handle=f"builder{index}",
        project=f"Visible project {index}",
        project_url=f"https://github.com/builder{index}/project",
        source=source,
        source_family=family,
        source_url=source_url or f"https://news.ycombinator.com/item?id={index}",
        fingerprint=f"test:{index}",
        context="Public build notes.",
    )


def mapping(index: int, **overrides) -> dict:
    value = {
        "name": f"Builder {index}",
        "handle": f"@builder{index}",
        "project": f"Visible project {index}",
        "hook": "A visible transformation that can be demonstrated on camera.",
        "why_now": "Released on 2026-08-02.",
        "voice": f"https://example.test/builder{index}/notes",
        "arc": "Built through a difficult public iteration.",
        "reach": f"Public profile https://github.com/builder{index}",
        "caveat": "none",
        "sensitivity": "",
        "overall": 4,
        "protagonist": 4,
        "visible_hook": 4,
        "why_now_score": 4,
        "voice_score": 4,
        "arc_score": 4,
        "reach_score": 4,
        "rationale": "Clear protagonist and visible hook.",
        "is_evergreen": False,
        "category": f"category-{index}",
        "region": f"region-{index}",
        "not_for_surfacing": False,
        "parked_reason": "",
    }
    value.update(overrides)
    return value


def brief(index: int, candidate: RawCandidate | None = None, **overrides) -> CastingBrief:
    return brief_from_mapping(candidate or raw(index), mapping(index, **overrides))


def test_dedupe_uses_canonical_normalization_and_persisted_seen_list(tmp_path: Path):
    store_path = tmp_path / "seen.json"
    store = SeenStore(store_path).load()
    first = raw(1)
    store.record([first], seen_on="2026-08-01")
    store.save()
    resurfaced = replace(raw(2), name="Jane Builder", handle="@janeb")
    dnr = (
        "| Name / handle | Project |\n"
        "|---|---|\n"
        "| https://github.com/janeb | Prior project |\n"
    )

    result = dedupe_candidates(
        [first, resurfaced, raw(3)],
        dnr_markdown=dnr,
        seen_store=SeenStore(store_path).load(),
    )

    assert [candidate.fingerprint for candidate in result.seen] == ["test:1"]
    assert [candidate.fingerprint for candidate in result.do_not_resurface] == ["test:2"]
    assert [candidate.fingerprint for candidate in result.survivors] == ["test:3"]


def test_dedupe_does_not_merge_unrelated_people_with_a_common_project_title(tmp_path: Path):
    first = replace(raw(1), name="Alice", handle="alice", project="Calculator")
    second = replace(raw(2), name="Bob", handle="bob", project="Calculator")

    result = dedupe_candidates(
        [first, second],
        dnr_markdown="| Name / handle | Project |\n|---|---|\n",
        seen_store=SeenStore(tmp_path / "seen.json"),
    )

    assert result.survivors == [first, second]
    assert result.seen == []


def test_real_gates_are_used_without_an_average_threshold():
    high_average_gate_failure = brief(
        1,
        overall=5,
        protagonist=2,
        visible_hook=5,
        why_now_score=5,
        voice_score=5,
        arc_score=5,
        reach_score=5,
    )
    low_scores_but_gates_pass = brief(
        2,
        overall=1,
        protagonist=3,
        visible_hook=3,
        why_now_score=1,
        voice_score=1,
        arc_score=1,
        reach_score=1,
    )

    assert select_shortlist([high_average_gate_failure, low_scores_but_gates_pass]) == [
        low_scores_but_gates_pass
    ]


def test_missing_api_key_fails_cleanly():
    from screen import LlmClient

    try:
        LlmClient(api_key="", api_url="https://example.test/v1", model="model")
    except ScreenConfigurationError as exc:
        assert "CASTING_LLM_API_KEY" in str(exc)
    else:
        raise AssertionError("missing key should fail")


def test_structured_brief_requires_sensitivity_and_real_booleans():
    missing_sensitivity = mapping(1)
    del missing_sensitivity["sensitivity"]
    try:
        brief_from_mapping(raw(1), missing_sensitivity)
    except ScreenResponseError as exc:
        assert "sensitivity" in str(exc)
    else:
        raise AssertionError("sensitivity must be present even when empty")

    string_boolean = mapping(1, is_evergreen="false")
    try:
        brief_from_mapping(raw(1), string_boolean)
    except ScreenResponseError as exc:
        assert "is_evergreen must be a boolean" in str(exc)
    else:
        raise AssertionError("string booleans must not be accepted")


def test_rendered_report_passes_casting_eval_end_to_end():
    source_data = [
        ("Hacker News", "hacker-news", "https://news.ycombinator.com/item?id=1"),
        ("Reddit", "reddit", "https://www.reddit.com/r/opensource/comments/abc/demo/"),
        ("Product Hunt", "product-hunt", "https://www.producthunt.com/posts/demo"),
        ("Lobsters", "lobsters", "https://lobste.rs/s/abc/demo"),
        ("Hackaday", "hackaday", "https://hackaday.com/2026/08/02/demo/"),
    ]
    briefs = [
        brief(
            index,
            candidate=raw(index, source=source, family=family, source_url=url),
        )
        for index, (source, family, url) in enumerate(source_data, start=1)
    ]

    report = render_report(briefs, reviewed_count=31, sources_scanned=[item[0] for item in source_data])
    violations = ce.evaluate(report, as_of="2026-08-03")

    assert violations == [], ce.format_report(violations)
    assert report.startswith("Summary: Scanned ")
    assert "### Shortlist\n" in report
    assert "### Parking lot\n" in report
    assert "### Shortlist check\n" in report
