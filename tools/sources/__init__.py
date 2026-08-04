"""Public source connectors for the Tier 1 scan."""
from __future__ import annotations

from .base import (
    ExpectedFailure,
    HttpClient,
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
        SourceRegistration(
            RedditSource(http),
            expected_failure=ExpectedFailure(
                reason="anonymous JSON is blocked without OAuth",
                status_codes=(401, 403),
            ),
        ),
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
    "ExpectedFailure",
    "SourceFetch",
    "SourceRegistration",
    "collect_sources",
    "default_sources",
]
