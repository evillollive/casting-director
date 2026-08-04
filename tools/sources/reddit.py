"""Public Reddit new-post connector."""
from __future__ import annotations

from datetime import datetime

from .base import HttpClient, RawCandidate, SourceFetch, USER_AGENT

SUBREDDITS = [
    "coolgithubprojects",
    "SideProject",
    "opensource",
    "webdev",
    "programming",
    "selfhosted",
    "homelab",
    "raspberry_pi",
]


class RedditSource:
    name = "Reddit"

    def __init__(self, client: HttpClient, subreddits: list[str] | None = None):
        self.client = client
        self.subreddits = subreddits or SUBREDDITS

    def fetch(self, since: datetime) -> SourceFetch:
        result = SourceFetch()
        for subreddit in self.subreddits:
            try:
                data = self.client.get_json(
                    f"https://www.reddit.com/r/{subreddit}/new.json",
                    params={"limit": 100, "raw_json": 1},
                    headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                )
            except Exception as exc:
                result.errors.append(f"Reddit r/{subreddit}: {exc}")
                continue
            result.successful_requests += 1
            for child in data.get("data", {}).get("children", []):
                post = child.get("data") or {}
                if float(post.get("created_utc") or 0) <= since.timestamp():
                    continue
                post_id = str(post.get("id") or "").strip()
                title = str(post.get("title") or "").strip()
                author = str(post.get("author") or "").strip()
                permalink = str(post.get("permalink") or "").strip()
                if not post_id or not title or not author or not permalink:
                    continue
                source_url = f"https://www.reddit.com{permalink}"
                result.candidates.append(
                    RawCandidate(
                        name=author,
                        handle=f"u/{author}",
                        project=title,
                        project_url=str(post.get("url_overridden_by_dest") or source_url),
                        source=f"Reddit r/{subreddit}",
                        source_family="reddit",
                        source_url=source_url,
                        fingerprint=f"reddit:{post_id}",
                        context=str(post.get("selftext") or title)[:4000],
                    )
                )
        return result
