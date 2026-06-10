# Contributing

The point of this skill is **taste**, and taste lives in two places: the prompt and the rubric. Almost all the useful contributing you'll do is teaching the tool your eye, not writing code.

## The one rule that matters

When a pattern shows up repeatedly in the [TASTE LOG](rolodex/taste-log.md), graduate it:

1. Fold it into [`rubric.md`](rubric.md) (the expanded reference), and
2. Mirror the compact version into [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md) (the runtime artifact).

The prompt is the single source of truth for a run. `rubric.md` is where stable lessons live in full. They have to stay in sync, and the test suite checks that they do, so don't edit one without the other.

## The weekly loop

1. Before a run, paste the current [`rolodex/do-not-resurface.md`](rolodex/do-not-resurface.md) into the prompt's DO-NOT-RESURFACE block and update TUNING.
2. Run the prompt, read the shortlist.
3. After the run, append a line to the TASTE LOG: what it nailed, what you cut, why.
4. When a line of the TASTE LOG becomes a pattern, graduate it (see above).

## House rules

- **No em dashes anywhere.** Use commas, periods, colons, parentheses, or ellipses. There's a regression test for this.
- **No vendor names** in the docs (no naming a specific assistant or browsing tool). Keep it capability-based ("an AI assistant with web search"). Also tested.
- **Run the suite before you push:** `pip install -r requirements-dev.txt && pytest tests/ -q`.
- If you change the output format, update the evaluator in [`tools/casting_eval.py`](tools/casting_eval.py) and its fixtures so the linter still matches reality.

## What good looks like

See [`tests/fixtures/run_good.md`](tests/fixtures/run_good.md) for a clean run that passes every check, and the adversarial fixtures next to it (`run_hallucinated.md`, `run_gate_violation.md`, and so on) for the failure modes the evaluator is built to catch.
