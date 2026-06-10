# Roadmap

Build the three tiers in order. Don't skip ahead. The rubric has to be stable before any pipeline code gets written, and the rolodex is the part that compounds.

## Tier 0: prompt-as-product (now)

Zero infrastructure. Write one rich prompt that names your sources and your rubric, and run it manually. This is where you calibrate taste.

- Run [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md) weekly for a few weeks.
- Each time, edit the TUNING and TASTE LOG based on what it nailed and what it missed.
- The rubric you converge on becomes the spec for the real tool. **Don't write a line of pipeline code until it's stable.**

This is what a browsing agent like Manus is built for: it browses live, runs multi-step, and its scheduled-tasks feature can run a recurring automation weekly without re-prompting. A clean split is to let the browsing agent do the sourcing, then hand candidates to Claude for the judgment and brief-writing, where you want consistent taste. (See the cautions in [`sources.md`](sources.md) about credit costs and keeping sensitive data out of third-party tools.)

## Tier 1: scheduled pipeline (the sweet spot)

Once the rubric is stable, codify it. This fits a GitHub-native workflow well:

- A script pulls candidates from the cheap/free feeds (see [`sources.md`](sources.md)).
- Dedupes against a stored "seen" list (your starter rolodex in [`rolodex/`](rolodex/)).
- Sends survivors to the Claude API with your rubric, getting back scores and casting briefs.
- Emits a markdown report to email, Slack, a committed file, or a GitHub Issue.
- Runs on a GitHub Actions cron: free, scheduled, and already where you live.

## Tier 2: small app with a real rolodex

Only if it earns its keep. A lightweight DB where every candidate ever surfaced has a status (new / contacted / passed / cast / maybe-later), tags, and notes, plus a simple dashboard the team can open.

This is the part that compounds. Six months in, the rolodex is more valuable than the weekly scan.
