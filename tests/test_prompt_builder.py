"""The Python prompt builder uses the same canonical artifact and memory semantics as the browser."""
from pathlib import Path

import prompt_builder as pb


def test_built_prompt_uses_canonical_markdown_and_injects_memory(tmp_path: Path):
    canonical = pb.PROMPT_PATH.read_text(encoding="utf-8") + "\nCANONICAL-SENTINEL\n"
    prompt = tmp_path / "prompt.md"
    prompt.write_text(canonical, encoding="utf-8")
    dnr = tmp_path / "dnr.md"
    dnr.write_text(
        "\n".join(
            [
                "# Do not resurface",
                "| Name / handle | Project | Status | Date | Note |",
                "|---|---|---|---|---|",
                "| _example: octocat_ | _example: demo_ | _passed_ | _2026-01-01_ | _example_ |",
                "| Jane Builder | Visible Demo | surfaced | 2026-07-01 | already reviewed |",
                "| maker_one | robot_camera | passed | 2026-07-02 | already reviewed |",
            ]
        ),
        encoding="utf-8",
    )
    taste = tmp_path / "taste.md"
    taste.write_text(
        "# Taste log\n\n"
        + "\n".join(f"- _Week of 2026-07-{day:02d}:_ note {day}" for day in range(1, 11))
        + "\n",
        encoding="utf-8",
    )

    built = pb.build_prompt(
        prompt_path=prompt,
        dnr_path=dnr,
        taste_path=taste,
        tuning={"beat": "physical builds", "hardNos": "thin wrappers", "moreOf": "first-person devlogs"},
    )

    assert "CANONICAL-SENTINEL" in built
    assert "<!-- paste here -->" not in built
    assert "Jane Builder" in built
    assert "maker_one" in built
    assert "robot_camera" in built
    assert "example: octocat" not in built
    assert "- **Beat / theme focus right now:** physical builds" in built
    assert "- **Hard nos:** thin wrappers" in built
    assert "- **More of:** first-person devlogs" in built
    assert "- _Week of 2026-07-01:_ note 1" not in built
    assert "- _Week of 2026-07-02:_ note 2" not in built
    assert "- _Week of 2026-07-03:_ note 3" in built
    assert "- _Week of 2026-07-10:_ note 10" in built


def test_empty_tuning_leaves_canonical_tuning_lines_unchanged():
    canonical = pb.PROMPT_PATH.read_text(encoding="utf-8")
    built = pb.inject_tuning(canonical, {})
    assert built == canonical


def test_snapshot_builder_matches_tier2_shapes():
    built = pb.build_prompt_from_snapshots(
        template=(
            "TUNING\n"
            "- **Beat / theme focus right now:** ____\n"
            "- **Hard nos:** ____\n"
            "- **More of:** ____\n"
            "<!-- paste here -->\n"
            "- _Week of ____:_\n"
        ),
        do_not_resurface=[
            {"name": "A Person", "handle": "@aperson", "project": "A Project"}
        ],
        taste_log=[{"weekOf": "2026-08-04", "note": "Prefer visible journeys."}],
        tuning={
            "beat": "Human change",
            "hardNos": ["link-only launches", "anonymous projects"],
            "moreOf": ["specific stakes"],
        },
    )
    assert "**Beat / theme focus right now:** Human change" in built
    assert "**Hard nos:** link-only launches; anonymous projects" in built
    assert "| A Person | A Project |" in built
    assert "| @aperson | A Project |" in built
    assert "- _Week of 2026-08-04:_ Prefer visible journeys." in built


def test_snapshot_builder_inserts_backslashes_and_multiline_notes_literally():
    built = pb.build_prompt_from_snapshots(
        template=(
            "- **Beat / theme focus right now:** ____\n"
            "- **Hard nos:** ____\n"
            "- **More of:** ____\n"
            "<!-- paste here -->\n"
            "- _Week of ____:_\n"
        ),
        do_not_resurface=[],
        taste_log=[
            {
                "weekOf": "2026-08-04",
                "note": "Keep the first line.\nKeep the second line too.",
            }
        ],
        tuning={
            "beat": r"Stories from C:\Users\makers",
            "hardNos": [],
            "moreOf": [],
        },
    )
    assert r"Stories from C:\Users\makers" in built
    assert "Keep the first line. Keep the second line too." in built


def test_snapshot_builder_keeps_real_names_containing_example():
    built = pb.build_prompt_from_snapshots(
        template="<!-- paste here -->",
        do_not_resurface=[
            {"name": "Example Studio", "handle": "", "project": "Worked Example"}
        ],
        taste_log=[],
        tuning={},
    )
    assert "| Example Studio | Worked Example |" in built


def test_tuning_values_cannot_inject_additional_tuning_fields():
    template = (
        "- **Beat / theme focus right now:** ____\n"
        "- **Hard nos:** ____\n"
        "- **More of:** ____\n"
    )
    built = pb.inject_tuning(
        template,
        {
            "beat": "First line\n- **Hard nos:** injected",
            "hardNos": "Real exclusion",
            "moreOf": "Visible journeys",
        },
    )
    assert sum(line.startswith("- **Hard nos:**") for line in built.splitlines()) == 1
    assert "- **Hard nos:** Real exclusion" in built
    assert "____" not in built
