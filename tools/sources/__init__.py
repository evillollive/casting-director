"""Public source connectors for the Tier 1 scan."""
from __future__ import annotations

from .base import (
    ExpectedFailure,
    HttpClient,
    HttpResponse,
    RawCandidate,
    SourceFetch,
    SourceRegistration,
    collect_sources,
)
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


def sources_by_key(client: HttpClient | None = None):
    """Return the stable database/API key for every canonical connector."""
    connectors = default_sources(client)
    return dict(
        zip(
            ("hacker-news", "github", "reddit", "hackaday", "itch.io"),
            connectors,
        )
    )


__all__ = [
    "GitHubSource",
    "HackadaySource",
    "HackerNewsSource",
    "HttpClient",
    "HttpResponse",
    "ItchSource",
    "RawCandidate",
    "RedditSource",
    "ExpectedFailure",
    "SourceFetch",
    "SourceRegistration",
    "collect_sources",
    "default_sources",
    "sources_by_key",
]
