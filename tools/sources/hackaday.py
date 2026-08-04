"""Hackaday RSS connector."""
from __future__ import annotations

from datetime import datetime

from .base import HttpClient, SourceFetch
from .feed import parse_rss


class HackadaySource:
    name = "Hackaday"
    endpoint = "https://hackaday.com/blog/feed/"

    def __init__(self, client: HttpClient):
        self.client = client

    def fetch(self, since: datetime) -> SourceFetch:
        text = self.client.get_text(
            self.endpoint,
            headers={"Accept": "application/rss+xml, application/xml"},
            retry=True,
        )
        return SourceFetch(
            candidates=parse_rss(
                text,
                since=since,
                source=self.name,
                source_family="hackaday",
            )
        )
