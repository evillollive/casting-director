"""itch.io newest-games RSS connector."""
from __future__ import annotations

from datetime import datetime

from .base import HttpClient, SourceFetch
from .feed import parse_rss


class ItchSource:
    name = "itch.io"
    endpoint = "https://itch.io/games/newest.xml"

    def __init__(self, client: HttpClient):
        self.client = client

    def fetch(self, since: datetime) -> SourceFetch:
        text = self.client.get_text(self.endpoint, headers={"Accept": "application/rss+xml, application/xml"})
        return SourceFetch(
            candidates=parse_rss(
                text,
                since=since,
                source=self.name,
                source_family="itch.io",
            )
        )
