# casting-director

An agentic AI skill that casts GitHub stories. It doesn't hand you "40 trending repos." It hands you a short ranked list of **people worth a conversation**: the hook for each, why they'd be good on camera, and how to reach them.

Think of it as a casting director's workflow, run as a pipeline.

## The four stages

1. **Sourcing**: cast a wide net across many feeds (Hacker News, GitHub, Reddit, and more).
2. **Screening**: score each candidate against a casting rubric you author. This is the product.
3. **The shortlist**: a ranked report where every entry is a short casting brief, not a link dump.
4. **The rolodex**: persistent memory, so nobody gets re-surfaced and "great but not now" people get parked for later.

The wide net is the easy part. What this skill is really for is **taste and judgment**: turning a feed of launches into a handful of castable human stories.

## What's in here

There's one executable artifact and a few reference files. The prompt is what you actually run; everything else exists to support and evolve it.

| Path | What it is |
|------|------------|
| [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md) | **The runtime artifact.** Self-contained and canonical for a run: sources, the compact rubric, the gates, verification rules, exclusions, and the exact output format. Paste it in and run it weekly. |
| [`rubric.md`](rubric.md) | The expanded rubric: scoring guide, gate logic, false-positive patterns, list-level diversity, and a worked example. The deeper companion to the compact rubric in the prompt. |
| [`SKILL.md`](SKILL.md) | A thin agent-skill wrapper (frontmatter + when-to-use + non-negotiables) that points at the prompt and rubric rather than duplicating them. |
| [`sources.md`](sources.md) | The source list with its 2026 access realities (what's free, what's blocked, what costs money). |
| [`rolodex/`](rolodex/) | Persistent memory: the do-not-resurface list and the taste log that teach the tool your eye over time. |
| [`roadmap.md`](roadmap.md) | The three-tier build path, so the prompt can grow into a scheduled pipeline later. |
| [`tools/casting_eval.py`](tools/casting_eval.py) | A linter for an actual run's output: catches hallucinated candidates, missing sources, undated "why now", gate violations, and resurfaced names. |
| [`web/`](web/) | A static browser app: prep this week's prompt with your rolodex baked in, then lint a run's shortlist with an in-browser port of the evaluator. No account, no API key, nothing uploaded. Deployed to GitHub Pages. |
| [`tests/`](tests/) | The test suite: spec-conformance checks plus adversarial output fixtures. See [`tests/README.md`](tests/README.md). |

## How to use it this week

You're at **Tier 0**: prompt-as-product, zero infrastructure.

1. Paste the current contents of [`rolodex/do-not-resurface.md`](rolodex/do-not-resurface.md) into the prompt's DO-NOT-RESURFACE block, and update its TUNING block.
2. Paste [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md) into an AI assistant with live web search on, or a browsing agent that can reach the sources.
3. Read the shortlist. After each run, append a line to the prompt's TASTE LOG based on what it nailed and what it missed.

Want to see what a finished shortlist looks like first? [`tests/fixtures/run_good.md`](tests/fixtures/run_good.md) is a clean sample run that passes every check.

Those edits are the real work. They calibrate the tool's taste. **Don't write a line of pipeline code until the rubric is stable** (see [`roadmap.md`](roadmap.md)). The single source of truth for a run is the prompt; `rubric.md` is where stable lessons graduate, and the two stay in sync with a one-line update when something changes.

## Use it in your browser

There's a static browser front end for the Tier 0 loop in [`web/`](web/). It doesn't run the scan (that's still an AI job that needs live web search and judgment); it removes the copy-paste bookkeeping around it and runs entirely on your device, with no account and no API key:

- **Prep a run** builds this week's prompt with your do-not-resurface list injected, ready to copy into an AI assistant with web search on.
- **Evaluate a run** lints the shortlist that assistant returns. It's a faithful in-browser port of `tools/casting_eval.py`, so the gates, required fields, dated "why now", resurfaced-name, and monotone-source checks all run offline.
- **Rolodex** manages your do-not-resurface list in the browser's local storage and exports markdown that's drop-in compatible with [`rolodex/do-not-resurface.md`](rolodex/do-not-resurface.md).

Open the hosted app:

```text
https://evillollive.github.io/casting-director/
```

Or run it locally:

```bash
cd web
python3 -m http.server 8000
# open http://localhost:8000
```

The app fetches the real prompt, rubric, and sources from `web/content/`, which is a byte-for-byte mirror of the canonical files. Regenerate it with `python tools/sync_web_content.py` after editing any of them; a test fails if the copies drift.

## The build path, in one breath

- **Tier 0**: one rich prompt, run manually each week, to calibrate taste.
- **Tier 1**: once the rubric is stable, codify it: a script pulls feeds, dedupes against the rolodex, sends survivors to an LLM API with your rubric, emits a markdown report on a GitHub Actions cron.
- **Tier 2**: a small app with a real rolodex DB (status, tags, notes) and a dashboard, only if it earns its keep.

Do them in order. The rolodex is the part that compounds.

## Testing

Even though the skill is a spec plus a prompt, it's tested. Run `pip install -r requirements-dev.txt` then `pytest tests/ -q`. The suite has three layers: spec-conformance checks (the prompt stays self-contained and in sync with `rubric.md`, no em dashes or vendor names, links resolve), an output evaluator (`tools/casting_eval.py`) that lints a real run's output against the hard rules, and parity checks that the browser app's `web/content/` mirror is in sync and its JavaScript evaluator agrees with the Python one on every fixture (the parity test is skipped if Node isn't installed). You can run the evaluator on any output by hand: `python tools/casting_eval.py run.md --dnr rolodex/do-not-resurface.md`. See [`tests/README.md`](tests/README.md).

## Deploy

The browser app deploys to GitHub Pages from `main` via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). On each push it computes a semantic version from Conventional Commits, tags a GitHub Release, re-syncs `web/content/`, stamps `web/version.js`, and publishes `web/`. The first successful run enables Pages automatically.

## Contributing and license

Most contributing here is teaching the tool your taste, not writing code. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the weekly loop and the one rule that matters (graduating TASTE LOG patterns into the rubric and prompt together). Licensed under AGPL-3.0; see [`LICENSE`](LICENSE).
