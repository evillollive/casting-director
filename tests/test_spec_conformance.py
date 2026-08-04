"""Spec-conformance tests: the repo and the prompt stay internally consistent,
self-contained, in sync, and policy-clean.

These guard the refactor decisions: one runtime artifact (the prompt), rubric.md
as the expanded-but-synced reference, SKILL.md kept thin, the diversity bug
staying fixed, and the user's hard rules (no em dashes, no vendor names).
"""
import re
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PROMPT = (ROOT / "prompts/tier0-weekly-scan.md").read_text(encoding="utf-8")
RUBRIC = (ROOT / "rubric.md").read_text(encoding="utf-8")
SKILL = (ROOT / "SKILL.md").read_text(encoding="utf-8")
WEEKLY_WORKFLOW = (ROOT / ".github/workflows/weekly-scan.yml").read_text(encoding="utf-8")

RUBRIC_DIMS = ["Protagonist", "Visible hook", "Why now", "Voice", "Arc", "Reach"]
OUTPUT_FIELDS = [
    "Name / handle",
    "Project",
    "The hook",
    "Why now",
    "Voice",
    "Arc / stakes",
    "Reach",
    "Caveat",
    "Score:",
    "Source link(s)",
]
REQUIRED_FILES = [
    "README.md",
    "SKILL.md",
    "rubric.md",
    "sources.md",
    "roadmap.md",
    "prompts/tier0-weekly-scan.md",
    "rolodex/do-not-resurface.md",
    "rolodex/seen.json",
    "rolodex/taste-log.md",
    "tools/casting_eval.py",
]


def all_markdown():
    markdown = []
    for directory, child_directories, files in os.walk(ROOT):
        child_directories[:] = [
            name
            for name in child_directories
            if name not in {".git", ".next", "node_modules"}
        ]
        parent = Path(directory)
        if "content" in parent.relative_to(ROOT).parts[:2]:
            continue
        markdown.extend(parent / name for name in files if name.endswith(".md"))
    return markdown


# --- Repo integrity ---


@pytest.mark.parametrize("rel", REQUIRED_FILES)
def test_required_file_exists(rel):
    assert (ROOT / rel).exists(), f"missing {rel}"


def test_internal_links_resolve():
    link_re = re.compile(r"\]\((?!https?://)([^)]+\.md[^)]*)\)")
    broken = []
    for md in all_markdown():
        for raw in link_re.findall(md.read_text(encoding="utf-8")):
            target = raw.split("#")[0]
            if not (md.parent / target).exists():
                broken.append(f"{md.relative_to(ROOT)} -> {raw}")
    assert not broken, f"broken links: {broken}"


# --- User hard rules (regression guards) ---


def test_no_em_dashes_anywhere():
    offenders = [str(p.relative_to(ROOT)) for p in all_markdown() if "\u2014" in p.read_text(encoding="utf-8")]
    assert not offenders, f"em dashes found in: {offenders}"


def test_no_vendor_names():
    pat = re.compile(r"\b(manus|claude|copilot|lindy)\b", re.IGNORECASE)
    offenders = [str(p.relative_to(ROOT)) for p in all_markdown() if pat.search(p.read_text(encoding="utf-8"))]
    assert not offenders, f"vendor names found in: {offenders}"


# --- The prompt is the self-contained runtime artifact ---


@pytest.mark.parametrize(
    "section",
    [
        "## Role",
        "## Mission",
        "## Sources to scan",
        "## Rubric",
        "## Shortlist gates",
        "## Verification rules",
        "## Exclusions",
        "## Output format",
        "## TUNING",
        "## DO-NOT-RESURFACE",
        "## TASTE LOG",
    ],
)
def test_prompt_has_section(section):
    assert section in PROMPT, f"prompt missing section {section!r}"


@pytest.mark.parametrize("field", OUTPUT_FIELDS)
def test_prompt_has_output_field(field):
    assert field in PROMPT, f"prompt output template missing {field!r}"


def test_prompt_has_dnr_paste_block():
    assert "DO-NOT-RESURFACE" in PROMPT
    assert "paste" in PROMPT.lower()
    assert "<!-- paste here -->" in PROMPT


def test_prompt_gates_are_explicit():
    assert "Protagonist >= 3" in PROMPT
    assert "Visible hook >= 3" in PROMPT


def test_prompt_has_verification_rules():
    low = PROMPT.lower()
    assert "live source url" in low
    assert "evergreen" in low
    assert "never invent" in low
    assert "web access" in low


# --- Rubric stays in sync with the prompt ---


@pytest.mark.parametrize("dim", RUBRIC_DIMS)
def test_rubric_dimension_in_both_prompt_and_rubric(dim):
    assert dim in PROMPT, f"{dim} missing from prompt"
    assert dim in RUBRIC, f"{dim} missing from rubric.md"


# --- The diversity bug stays fixed ---


def test_diversity_is_not_a_scored_dimension():
    dims = RUBRIC.split("## Dimensions", 1)[1].split("## Scoring guide", 1)[0]
    reach_line = next(line for line in dims.splitlines() if line.strip().startswith("6."))
    assert "variety" not in reach_line.lower()
    assert "don't all look the same" not in reach_line.lower()


def test_diversity_is_a_list_level_rule():
    assert "## Shortlist assembly" in RUBRIC
    assembly = RUBRIC.split("## Shortlist assembly", 1)[1]
    assert "variety" in assembly.lower() or "spread" in assembly.lower()


# --- SKILL.md stays a thin wrapper, not a third copy ---


def test_skill_points_to_canonical_artifacts():
    assert "prompts/tier0-weekly-scan.md" in SKILL
    assert "rubric.md" in SKILL
    assert "rolodex/do-not-resurface.md" in SKILL


def test_skill_does_not_reembed_output_template():
    # Re-embedding the full per-candidate template would re-introduce the
    # duplication the refactor removed.
    assert 'Why now (with date' not in SKILL


def test_skill_has_consent_guardrail():
    low = SKILL.lower()
    assert "public info" in low
    assert "consent" in low


def test_weekly_schedule_stays_disabled_until_live_screening_is_reviewed():
    assert "# schedule:" in WEEKLY_WORKFLOW
    assert '#   - cron: "17 15 * * 1"' in WEEKLY_WORKFLOW
    assert "\n  schedule:\n" not in WEEKLY_WORKFLOW
    assert "live screening" in WEEKLY_WORKFLOW.lower()


def test_manual_dispatch_defaults_to_artifact_only_dry_run():
    dry_run = WEEKLY_WORKFLOW.split("dry_run:", 1)[1].split("jobs:", 1)[0]
    assert "type: boolean" in dry_run
    assert "default: true" in dry_run
    assert "actions/upload-artifact@v4" in WEEKLY_WORKFLOW
    sourcing = _workflow_step("Run scheduled scan")
    evaluator = _workflow_step("Enforce report gate")
    artifact = _workflow_step("Upload dry-run report")
    issue = _workflow_step("Open report issue")
    persistence = _workflow_step("Persist seen state")
    assert "\n        if:" not in sourcing
    assert "\n        if:" not in evaluator
    assert "if: ${{ inputs.dry_run == true }}" in artifact
    assert "if: ${{ inputs.dry_run == false }}" in issue
    assert "if: ${{ inputs.dry_run == false }}" in persistence


def _workflow_step(name: str) -> str:
    marker = f"      - name: {name}\n"
    assert marker in WEEKLY_WORKFLOW
    return WEEKLY_WORKFLOW.split(marker, 1)[1].split("\n      - name:", 1)[0]
