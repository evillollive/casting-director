"""Hacker News Show HN connector."""
from __future__ import annotations

from datetime import datetime

from .base import HttpClient, RawCandidate, SourceFetch


class HackerNewsSource:
    name = "Hacker News"
    endpoint = "https://hn.algolia.com/api/v1/search_by_date"

    def __init__(self, client: HttpClient, max_results: int = 1000):
        self.client = client
        self.max_results = max_results

    def fetch(self, since: datetime) -> SourceFetch:
        candidates = []
        page = 0
        while len(candidates) < self.max_results:
            data = self.client.get_json(
                self.endpoint,
                params={
                    "tags": "show_hn",
                    "numericFilters": f"created_at_i>{int(since.timestamp())}",
                    "hitsPerPage": 100,
                    "page": page,
                },
            )
            hits = data.get("hits", [])
            if not hits:
                break
            window_exhausted = False
            for hit in hits:
                created_at = int(hit.get("created_at_i") or 0)
                if created_at <= since.timestamp():
                    window_exhausted = True
                    continue
                object_id = str(hit.get("objectID") or "").strip()
                title = str(hit.get("title") or "").strip()
                author = str(hit.get("author") or "").strip()
                if not object_id or not title or not author:
                    continue
                source_url = f"https://news.ycombinator.com/item?id={object_id}"
                project_url = str(hit.get("url") or source_url)
                project = title.removeprefix("Show HN:").strip()
                candidates.append(
                    RawCandidate(
                        name=author,
                        handle=author,
                        project=project,
                        project_url=project_url,
                        source=self.name,
                        source_family="hacker-news",
                        source_url=source_url,
                        fingerprint=f"hn:{object_id}",
                        context=str(hit.get("story_text") or hit.get("comment_text") or title)[:4000],
                    )
                )
                if len(candidates) >= self.max_results:
                    break
            page += 1
            if window_exhausted or page >= int(data.get("nbPages") or 1):
                break
        return SourceFetch(candidates=candidates)
