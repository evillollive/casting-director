"""itch.io newest-games RSS connector."""
from __future__ import annotations

import re
from datetime import datetime
from urllib.parse import urlparse

from .base import HttpClient, SourceFetch
from .feed import parse_rss


def itch_creator_from_link(link: str) -> str:
    host = (urlparse(link).hostname or "").lower()
    if not host.endswith(".itch.io"):
        return ""
    creator = host.removesuffix(".itch.io")
    if creator in {"", "www"}:
        return ""
    valid = re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", creator)
    return creator if valid else ""


class ItchSource:
    name = "itch.io"
    endpoint = "https://itch.io/games/newest.xml"

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
                source_family="itch.io",
                author_from_link=itch_creator_from_link,
            )
        )
