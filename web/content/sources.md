# Sources (expanded reference)

The compact, runnable source list lives in [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md). This file is the deeper companion: each source's 2026 access reality and the query patterns Tier 1 will codify. Weight the first three most heavily.

## Start here

- **Hacker News**: the single best casting source. The Algolia API is free and needs no auth. "Show HN" posts are literally people showing what they built. Front-page and Show HN search: `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=created_at_i>UNIX_TS`.
- **GitHub**: no official trending API, but the Search API covers most of it. Most-starred-this-week: `q=created:>YYYY-MM-DD sort:stars`. Also useful: recent-activity sorting, the GitHub blog, and Explore. Free and generous. Look for a human behind the repo, not a faceless org or a pure utility library. (Since this skill produces for GitHub, their DevRel/social team and internal trending data are a source the public can't see; this tool complements those people rather than replacing them.)
- **Reddit**: the free tier is 100 queries/minute with OAuth, non-commercial use, which is fine for modest internal pulls via PRAW. Mine `r/coolgithubprojects`, `r/SideProject`, `r/opensource`, `r/webdev`, `r/programming`.

## Easy adds

- **Product Hunt, Lobsters, Dev.to, Indie Hackers, newsletters**: mostly RSS/Atom or simple APIs. Easy to bolt on once the core three are stable.

## The painful one

- **X**: the free tier is discontinued and the old flat $200 Basic / $5,000 Pro tiers are closed to new signups. New developers get pay-per-use at $0.005 per read, capped at 2 million reads/month. For an internal tool, either skip the X API, eyeball it through a browsing agent, or route through a third-party read API (around $0.15 per 1,000 tweets). Don't burn effort here if it's blocked.

## A note on access and privacy

Every source here is public by design. Keep it that way: pull only public posts and profiles, respect each platform's rate limits and terms, and never route anything sensitive through a third-party tool. For public-web casting that's not much of a constraint, but the rule still holds because the output is about real people. See the consent guardrail in [`SKILL.md`](SKILL.md).
