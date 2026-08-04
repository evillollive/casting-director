"""Public source connectors for the Tier 1 scan."""
from __future__ import annotations

from .base import HttpClient, RawCandidate, SourceFetch, collect_sources
from .github import GitHubSource
from .hackaday import HackadaySource
from .hacker_news import HackerNewsSource
from .itch import ItchSource
from .reddit import RedditSource


def default_sources(client: HttpClient | None = None):
    """Return the feeds used by the scheduled scan."""
    http = client or HttpClient()
    return [
        HackerNewsSource(http),
        GitHubSource(http),
        RedditSource(http),
        HackadaySource(http),
        ItchSource(http),
    ]


__all__ = [
    "GitHubSource",
    "HackadaySource",
    "HackerNewsSource",
    "HttpClient",
    "ItchSource",
    "RawCandidate",
    "RedditSource",
    "SourceFetch",
    "collect_sources",
    "default_sources",
]
