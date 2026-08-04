"""Hacker News Show HN connector."""
from __future__ import annotations

from datetime import datetime

from .base import HttpClient, RawCandidate, SourceFetch


class HackerNewsSource:
    name = "Hacker News"
    endpoint = "https://hn.algolia.com/api/v1/search_by_date"

    def __init__(self, client: HttpClient):
        self.client = client

    def fetch(self, since: datetime) -> SourceFetch:
        data = self.client.get_json(
            self.endpoint,
            params={
                "tags": "show_hn",
                "numericFilters": f"created_at_i>{int(since.timestamp())}",
                "hitsPerPage": 100,
            },
        )
        candidates = []
        for hit in data.get("hits", []):
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
        return SourceFetch(candidates=candidates)
