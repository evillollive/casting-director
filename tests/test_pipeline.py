"""Tier 1 dedupe, gates, rendering, and evaluator integration."""
from __future__ import annotations

import json
from dataclasses import replace
from datetime import date
from pathlib import Path

import casting_eval as ce
from dedupe import SeenStore, dedupe_candidates, identity_tokens
from render_report import render_report, select_shortlist
from screen import CastingBrief, ScreenConfigurationError, ScreenResponseError, brief_from_mapping
from sources import RawCandidate, SourceFetch
from weekly_scan import load_seen_store, remember_screening_results, run_pipeline, select_for_screening


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
    store.record_permanent([first], seen_on="2026-08-01")
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


def test_degenerate_title_as_name_does_not_create_a_composite_identity():
    candidate = replace(raw(1), name="Same title", project="Same title", handle="")

    assert all(not token.startswith("name-project:") for token in identity_tokens(candidate))
    assert identity_tokens(candidate) == {"project-url:builder1/project"}


def test_screening_selection_balances_sources_and_spreads_each_source_window():
    hn = [raw(index) for index in range(1, 7)]
    github = [
        raw(index, source="GitHub", family="github", source_url=f"https://github.com/b{index}/p")
        for index in range(7, 9)
    ]

    selected = select_for_screening(hn + github, 4)

    assert [candidate.fingerprint for candidate in selected] == [
        "test:1",
        "test:7",
        "test:6",
        "test:8",
    ]


def test_parked_candidate_returns_after_cooldown_but_shortlisted_candidate_does_not(tmp_path: Path):
    shortlisted = raw(1)
    parked = raw(2)
    store_path = tmp_path / "seen.json"
    store = SeenStore(store_path).load()
    store.record_permanent([shortlisted], seen_on="2026-08-03")
    store.record_parked([parked], parked_on="2026-08-03")
    store.save()

    before = dedupe_candidates(
        [shortlisted, parked],
        dnr_markdown="| Name / handle | Project |\n|---|---|\n",
        seen_store=SeenStore(store_path).load(),
        as_of=date.fromisoformat("2026-09-27"),
    )
    after = dedupe_candidates(
        [shortlisted, parked],
        dnr_markdown="| Name / handle | Project |\n|---|---|\n",
        seen_store=SeenStore(store_path).load(),
        as_of=date.fromisoformat("2026-09-28"),
    )

    assert before.survivors == []
    assert before.seen == [shortlisted, parked]
    assert after.survivors == [parked]
    assert after.seen == [shortlisted]


def test_screening_memory_splits_shortlist_parking_and_hard_exclusions(tmp_path: Path):
    shortlisted = brief(1)
    parked = brief(2, protagonist=2, parked_reason="Revisit after the next release.")
    hard_excluded = brief(3, protagonist=2)
    store = SeenStore(tmp_path / "seen.json").load()

    remember_screening_results(store, [shortlisted, parked, hard_excluded], date(2026, 8, 3))

    assert store.contains(shortlisted.candidate, as_of=date(2027, 1, 1))
    assert not store.contains(parked.candidate, as_of=date(2026, 9, 28))
    assert store.contains(hard_excluded.candidate, as_of=date(2027, 1, 1))


def test_v1_seen_store_migrates_to_permanent_memory(tmp_path: Path):
    candidate = raw(1)
    path = tmp_path / "seen.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "fingerprints": {candidate.fingerprint: "2026-07-01"},
                "identities": {},
            }
        ),
        encoding="utf-8",
    )

    store = SeenStore(path).load()

    assert store.contains(candidate, as_of=date(2027, 1, 1))
    assert store.data["permanent"]["fingerprints"][candidate.fingerprint] == {
        "seen_on": "2026-07-01"
    }


def test_empty_tracked_store_imports_legacy_cache_for_rollout(tmp_path: Path):
    candidate = raw(1)
    tracked_path = tmp_path / "rolodex" / "seen.json"
    tracked = SeenStore(tracked_path)
    tracked.save()
    legacy_path = tmp_path / ".casting" / "seen.json"
    legacy_path.parent.mkdir()
    legacy_path.write_text(
        json.dumps(
            {
                "version": 1,
                "fingerprints": {candidate.fingerprint: "2026-07-01"},
                "identities": {},
            }
        ),
        encoding="utf-8",
    )

    store = load_seen_store(tracked_path, legacy_path)

    assert not store.was_empty
    assert store.path == tracked_path
    assert store.contains(candidate, as_of=date(2027, 1, 1))


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


def test_pipeline_warns_when_nonempty_run_starts_with_empty_seen_state(tmp_path: Path):
    candidate = raw(1)

    class Source:
        name = "stub"

        def fetch(self, since):
            return SourceFetch(candidates=[candidate])

    class Client:
        def complete_json(self, system_prompt, user_prompt):
            return mapping(1)

    report, errors = run_pipeline(
        run_date=date(2026, 8, 3),
        seen_path=tmp_path / "seen.json",
        output_path=tmp_path / "report.md",
        llm_client=Client(),
        source_connectors=[Source()],
    )

    assert errors == []
    assert "WARNING: persisted seen state was empty before this run" in report
    assert (tmp_path / "seen.json").exists()
