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
