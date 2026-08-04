# Sources (expanded reference)

The compact, runnable source list lives in [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md). This file is the deeper companion: each source's 2026 access reality and the query patterns Tier 1 will codify. Weight the first three most heavily.

## Start here

- **Hacker News**: the single best casting source. The Algolia API is free and needs no auth. "Show HN" posts are literally people showing what they built. Front-page and Show HN search: `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=created_at_i>UNIX_TS`.
- **GitHub**: no official trending API, but the Search API covers most of it. The Tier 1 connector uses `q=created:>YYYY-MM-DD stars:>20`, sorted by stars, then requests a raw README excerpt when available. Anonymous requests work at a low rate limit; `GITHUB_TOKEN` raises that limit. Look for a human behind the repo, not a faceless org or a pure utility library. (Since this skill produces for GitHub, their DevRel/social team and internal trending data are a source the public can't see; this tool complements those people rather than replacing them.)
- **Reddit**: public reads currently work through `/r/{subreddit}/new.json` with a descriptive user agent and no account. Cloud runners can still be rate-limited or blocked, so the connector reports a failed subreddit and continues. Mine `r/coolgithubprojects`, `r/SideProject`, `r/opensource`, `r/webdev`, `r/programming`, `r/selfhosted`, `r/homelab`, and `r/raspberry_pi`.

## Easy adds

- **Product Hunt, Lobsters, Dev.to, Indie Hackers, newsletters**: mostly RSS/Atom or simple APIs. Easy to bolt on once the core three are stable.

## The wider net (why the core three are not enough)

The core three are a launch detector. They over-represent English-speaking, US-centric, HN-fluent developers shipping software with a launch post. Everything below exists to correct a specific blind spot, and it is worth rotating through two or three each week rather than trying to cover them all.

- **Makers and hardware**: [Hackaday](https://hackaday.com) exposes a generous RSS feed at `https://hackaday.com/blog/feed/`; Hackaday.io project pages, [Tindie](https://www.tindie.com), and Kickstarter can widen this family later. Blind spot: physical builds, which film better than anything on a screen and rarely reach Show HN.
- **Games and jams**: [itch.io](https://itch.io) exposes its newest-games RSS feed at `https://itch.io/games/newest.xml`; Ludum Dare, Devpost and other hackathon writeups are useful rotations. Blind spot: work with a built-in deadline, an arc, and a playable demo.
- **Video and streams**: YouTube devlogs (RSS per channel, free), Twitch coding streams, conference talk uploads. Blind spot: on-camera evidence. This is the only source family that lets you audition someone before you contact them, which is worth more than any README.
- **Open social**: Mastodon (public timelines and per-instance RSS, no auth) and Bluesky (a free, well-documented public API). Blind spot: the build-in-public crowd that left the platform in "The painful one" below, at a fraction of the cost.
- **Beyond English**: developer communities writing in Chinese, Japanese, Portuguese, Spanish, Hindi, Bahasa and more, including regional aggregators and local GitHub scenes. Translate rather than skip. Blind spot: the largest one on this page, and the one most likely to hand you a story nobody else has.
- **Science, civic and accessibility**: research code released alongside a paper, civic-tech volunteer projects, accessibility tooling built by the people who need it. Blind spot: slow work with strong arcs and real stakes, which never trends.
- **Self-hosted and homelab**: r/selfhosted, r/homelab, r/raspberry_pi. Blind spot: people whose projects live in a rack in a spare room, which is a set.

## The painful one

- **X**: the free tier is discontinued and the old flat $200 Basic / $5,000 Pro tiers are closed to new signups. New developers get pay-per-use at $0.005 per read, capped at 2 million reads/month. For an internal tool, either skip the X API, eyeball it through a browsing agent, or route through a third-party read API (around $0.15 per 1,000 tweets). Don't burn effort here if it's blocked.

## A note on access and privacy

Every source here is public by design. Keep it that way: pull only public posts and profiles, respect each platform's rate limits and terms, and never route anything sensitive through a third-party tool. For public-web casting that's not much of a constraint, but the rule still holds because the output is about real people. The judgment half of that, who should not be surfaced at all and what counts as a non-invasive contact path, lives in the "Consent and care" section of [`rubric.md`](rubric.md), with the guardrail summarised in [`SKILL.md`](SKILL.md).
