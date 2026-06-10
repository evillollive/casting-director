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

| Path | What it is |
|------|------------|
| [`SKILL.md`](SKILL.md) | The skill itself, framed as an agent skill (role, rubric, sources, output format). |
| [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md) | The runnable Tier 0 prompt. This is the current product: paste it into a browsing AI and run it weekly. |
| [`rubric.md`](rubric.md) | The casting rubric as a standalone, editable spec. The part only you can author. |
| [`sources.md`](sources.md) | The source list with its 2026 access realities (what's free, what's blocked, what costs money). |
| [`rolodex/`](rolodex/) | Persistent memory: the do-not-resurface list and the taste log that teach the tool your eye over time. |
| [`roadmap.md`](roadmap.md) | The three-tier build path, so the prompt can grow into a scheduled pipeline later. |

## How to use it this week

You're at **Tier 0**: prompt-as-product, zero infrastructure.

1. Open [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md).
2. Paste it into Claude (web search on) or Manus (let it browse).
3. Read the shortlist. After each run, edit the TUNING and TASTE LOG sections based on what it nailed and what it missed.

Those edits are the real work. They calibrate the tool's taste. **Don't write a line of pipeline code until the rubric is stable** (see [`roadmap.md`](roadmap.md)).

## The build path, in one breath

- **Tier 0**: one rich prompt, run manually each week, to calibrate taste.
- **Tier 1**: once the rubric is stable, codify it: a script pulls feeds, dedupes against the rolodex, sends survivors to the Claude API with your rubric, emits a markdown report on a GitHub Actions cron.
- **Tier 2**: a small app with a real rolodex DB (status, tags, notes) and a dashboard, only if it earns its keep.

Do them in order. The rolodex is the part that compounds.
