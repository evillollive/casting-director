# Sources

The feasibility differs a lot by platform, so this list carries each source's 2026 access reality. Weight the first three most heavily.

## Start here

- **Hacker News**: start here. The Algolia API is free, no auth, and "Show HN" is literally people showing off things they built. It's the single best casting source for this.
- **GitHub**: no official trending API, but the Search API gives you most-starred-this-week (`created:>YYYY-MM-DD sort:stars`) and recent-activity sorting, plus Explore and the GitHub blog. Free and generous. Since this skill produces for GitHub, their DevRel/social team and internal trending data are a source the public can't see; this tool complements those people rather than replacing them.
- **Reddit**: the free tier is 100 queries/minute with OAuth, non-commercial use, which is fine for modest internal pulls via PRAW. Mine `r/coolgithubprojects`, `r/SideProject`, `r/opensource`, `r/webdev`, `r/programming`.

## Easy adds

- **Product Hunt, Lobsters, Dev.to, Indie Hackers, newsletters**: mostly RSS/Atom or simple APIs. Easy to add.

## The painful one

- **X**: the free tier is discontinued and the old flat $200 Basic / $5,000 Pro tiers are closed to new signups. New developers get pay-per-use at $0.005 per read, capped at 2 million reads/month. For an internal tool, either skip the X API, use a browsing agent to eyeball it, or route through a third-party read API (around $0.15 per 1,000 tweets). Don't burn effort here if it's blocked.

## A note on tooling for Tier 0

A clean split for the manual phase: let a browsing agent (e.g. Manus, which can run scheduled tasks and use a cloud browser for sources like X that are hard to hit via API) do the sourcing and browsing, then hand candidates to Claude for the judgment and brief-writing, where you want consistent taste.

Two cautions on credit-metered browsing agents: they can drain credits fast (a single wide research run can be expensive), and you should keep anything sensitive out of third-party tools. For public-web casting that's not really an issue.
