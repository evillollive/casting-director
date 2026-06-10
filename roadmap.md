# Roadmap

Build the three tiers in order. Don't skip ahead. The rubric has to be stable before any pipeline code gets written, and the rolodex is the part that compounds.

## Tier 0: prompt-as-product (now)

Zero infrastructure. One rich prompt that names your sources and your rubric, run by hand. This is where you calibrate taste.

- Run [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md) weekly for a few weeks.
- Each time, update TUNING and append to the TASTE LOG based on what it nailed and what it missed.
- When a pattern keeps showing up in the log, graduate it into [`rubric.md`](rubric.md), then mirror it as a one-line change in the prompt's compact rubric. **Don't write a line of pipeline code until the rubric is stable.**

**How to run it well.** A clean split for the manual phase: let a browsing agent (one that can run scheduled tasks and reach a live browser for sources like X that are hard to hit via API) do the sourcing, then hand candidates to a strong reasoning model for the judgment and brief-writing, where you want consistent taste. Two cautions on credit-metered browsing agents: they can drain credits fast (a single wide research run can be expensive), and you should keep anything sensitive out of third-party tools (see [`sources.md`](sources.md)).

## Tier 1: scheduled pipeline (the sweet spot)

Once the rubric is stable, codify it. This fits a GitHub-native workflow well:

- A script pulls candidates from the cheap/free feeds using the query patterns in [`sources.md`](sources.md).
- Dedupes against the canonical "seen" list in [`rolodex/do-not-resurface.md`](rolodex/do-not-resurface.md), and assembles the run prompt by injecting that list plus the current TUNING automatically (no more hand-pasting).
- Sends survivors to an LLM API with the rubric, getting back scores and casting briefs.
- Gates every generated report through [`tools/casting_eval.py`](tools/casting_eval.py) before it goes out, so a hallucinated link or a gate violation never reaches the inbox.
- Emits a markdown report to email, Slack, a committed file, or a GitHub Issue, on a GitHub Actions cron: free, scheduled, and already where you live.

## Tier 2: small app with a real rolodex

Only if it earns its keep. A lightweight DB where every candidate ever surfaced has a status (new / contacted / passed / cast / maybe-later), tags, and notes, plus a simple dashboard the team can open.

This is the part that compounds. Six months in, the rolodex is more valuable than the weekly scan.
