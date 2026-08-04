# Tests

Four layers cover the canonical spec, generated reports, the Tier 1 pipeline, and the browser port.

## 1. Spec conformance (`test_spec_conformance.py`)

Deterministic checks that the repo stays internally consistent and policy-clean:

- every required file exists and internal links resolve;
- the prompt is self-contained (has Role, Sources, Rubric, Gates, Verification rules, Exclusions, Output format, TUNING, a DO-NOT-RESURFACE paste block, and TASTE LOG);
- the rubric dimensions and the explicit gates appear in the prompt;
- `rubric.md` stays in sync with the prompt and keeps the diversity bug fixed (diversity is a list-level rule, not a per-candidate score);
- `SKILL.md` stays a thin wrapper instead of re-embedding the output template;
- no em dashes and no vendor names anywhere (the user's hard rules, encoded as regression guards).

## 2. Output evaluation (`test_output_evaluator.py` + `tools/casting_eval.py`)

`tools/casting_eval.py` is a reusable linter for an actual run's output. It encodes the skill's hard rules and flags the failure modes that matter:

| Code | Severity | What it catches |
|------|----------|-----------------|
| `NO_ENTRIES` | error | Output is neither a refusal nor a shortlist. |
| `REFUSAL_WITH_CANDIDATES` | error | Claims no web access but still lists candidates (the core hallucination trap). |
| `MISSING_FIELD` | error | A required brief field is absent. |
| `NO_SOURCE_URL` | error | A candidate has no live source link. |
| `UNDATED_WHY_NOW` | error | "Why now" has no date and is not labeled evergreen. |
| `BAD_SCORE` / `BAD_SCORE_TUPLE` | error | Missing overall score or per-dimension tuple. |
| `GATE_PROTAGONIST` / `GATE_HOOK` | error | Shortlisted despite failing a gate (score < 3). |
| `RESURFACED` | error | A candidate is on the do-not-resurface list. |
| `SHORTLIST_SIZE` | error/warn | More than 8, or fewer than 5 without a "quiet week" note. |
| `MONOTONE_SHORTLIST` | warn | 3 or more entries from one feed, unacknowledged. |
| `DUPLICATE_ENTRY` | error | The same person or project appears twice on one shortlist. |
| `STALE_WHY_NOW` / `FUTURE_WHY_NOW` | warn | The "why now" date is outside the ~7 day window, or in the future. |
| `MINOR_SUBJECT` | warn | The brief describes a minor with no `Sensitivity` note. |
| `INVASIVE_CONTACT` | warn | The reach field carries a phone number, home address, or personal email. |
| `RESURFACED_PARKING` | warn | A do-not-resurface name reappears in the parking lot. |
| `CORPORATE_FALSE_POSITIVE` | warn | Looks funded/corporate with no caveat. |
| `DEAD_SOURCE_URL` | error | (Live mode only) a source URL didn't resolve. |

The recency checks are opt-in in the library (`evaluate(text, as_of=...)`) so the
fixtures stay deterministic; the CLI and the browser app both pass today's date.

The fixtures in `fixtures/` are simulated run outputs, each engineered to trigger one category (or none, for `run_good.md` and `run_offline_project.md`). The tests assert the evaluator flags exactly what it should.

| Fixture | What it exercises |
|---------|-------------------|
| `run_good.md` | A clean run: passes every check. |
| `run_offline_project.md` | A candidate whose *project* works offline. Must not read as the assistant refusing for lack of web access. |
| `run_cluster.md` | Three entries from one feed, with a boilerplate diversity line that must not count as acknowledgment. |
| `run_parking_lot.md` | A parking lot using the same template as the shortlist. Must not parse as extra candidates, but is still checked against the do-not-resurface list. |
| `run_sensitive.md` | A minor and a private phone number, plus a third entry whose `Sensitivity` line correctly clears it. |
| `run_duplicate.md` | The same person listed twice. |
| `run_stale.md` | Clean without `as_of`; stale and future-dated with it. |

## 3. Tier 1 pipeline (`test_prompt_builder.py`, `test_sources.py`, `test_pipeline.py`)

These tests use stubbed HTTP responses only. They cover paginated Hacker News collection; the exact public request shapes for GitHub and Reddit; source-balanced, time-spread screening selection; RSS identity parsing and bounded backoff for Hackaday and itch.io; per-source failure tolerance; status-specific expected failures, unexpected success, and off-pattern errors; prompt assembly from canonical markdown; permanent and cooldown-based dedupe; empty-state warnings; provider configuration errors; real gate behavior without an average threshold; and an end-to-end rendered report that must pass `casting_eval.py`.

## 4. Browser parity (`test_web_content_sync.py`, `test_web_eval_parity.py`)

The static app's mirrored markdown must remain byte-identical to the canonical files. When Node is available, every evaluator fixture is also checked against both the Python and JavaScript implementations.

## Running

```bash
pip install -r requirements-dev.txt
pytest tests/ -q
```

Lint a real run's output with the standalone tool:

```bash
python tools/casting_eval.py path/to/run.md --dnr rolodex/do-not-resurface.md
```

Add network URL resolution (skipped by default so the suite is deterministic):

```bash
CASTING_EVAL_LIVE=1 python tools/casting_eval.py path/to/run.md
```

## Adding a fixture

Add a markdown run output to `fixtures/`, then assert its expected violation codes in `test_output_evaluator.py`. Keep each fixture focused on one failure category so a regression points at one cause.
