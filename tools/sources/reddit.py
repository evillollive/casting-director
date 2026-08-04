"""Official Reddit per-subreddit Atom feed connector."""
from __future__ import annotations

import html
import re
import time
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

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
ATOM = "{http://www.w3.org/2005/Atom}"
TAG_RE = re.compile(r"<[^>]+>")
COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


class RedditSource:
    name = "Reddit"

    def __init__(
        self,
        client: HttpClient,
        subreddits: list[str] | None = None,
        sleeper=None,
    ):
        self.client = client
        self.subreddits = subreddits or SUBREDDITS
        self.sleeper = sleeper or getattr(client, "sleeper", time.sleep)

    def fetch(self, since: datetime) -> SourceFetch:
        result = SourceFetch()
        for index, subreddit in enumerate(self.subreddits):
            url = f"https://www.reddit.com/r/{subreddit}/new.rss"
            try:
                response = self.client.get_response(
                    url,
                    headers={
                        "User-Agent": USER_AGENT,
                        "Accept": "application/atom+xml, application/xml",
                    },
                )
            except urllib.error.HTTPError as exc:
                if exc.code == 429:
                    result.errors.append(f"Reddit r/{subreddit}: rate limited (HTTP 429)")
                    self._sleep_for_reset(
                        exc.headers,
                        has_next=index + 1 < len(self.subreddits),
                        fallback=30.0,
                    )
                elif exc.code in (401, 403):
                    result.errors.append(
                        f"Reddit r/{subreddit}: blocked from this runner IP (HTTP {exc.code})"
                    )
                else:
                    result.errors.append(f"Reddit r/{subreddit}: {exc}")
                continue
            except Exception as exc:
                result.errors.append(f"Reddit r/{subreddit}: {exc}")
                continue

            content_type = response.headers.get("content-type", "").lower()
            if content_type and "xml" not in content_type and "atom" not in content_type:
                result.errors.append(
                    f"Reddit r/{subreddit}: unexpected content type {content_type}"
                )
                self._sleep_for_reset(
                    response.headers,
                    has_next=index + 1 < len(self.subreddits),
                )
                continue
            result.successful_requests += 1
            try:
                result.candidates.extend(self._parse_atom(response.body, subreddit, since))
            except (ET.ParseError, ValueError) as exc:
                result.errors.append(f"Reddit r/{subreddit}: invalid Atom response: {exc}")
            self._sleep_for_reset(
                response.headers,
                has_next=index + 1 < len(self.subreddits),
            )
        return result

    def _sleep_for_reset(self, headers, *, has_next: bool, fallback: float | None = None) -> None:
        if not has_next or not headers:
            if has_next and fallback is not None:
                self.sleeper(fallback)
            return
        remaining = _float_header(headers, "x-ratelimit-remaining")
        reset = _float_header(headers, "x-ratelimit-reset")
        if reset is None:
            reset = fallback
        if reset is not None and (remaining is None or remaining <= 0):
            self.sleeper(max(0.0, reset))

    def _parse_atom(
        self,
        body: bytes,
        subreddit: str,
        since: datetime,
    ) -> list[RawCandidate]:
        root = ET.fromstring(body)
        if root.tag != f"{ATOM}feed":
            raise ValueError(f"expected Atom feed, got {root.tag}")
        candidates = []
        for entry in root.findall(f"{ATOM}entry"):
            title = (entry.findtext(f"{ATOM}title") or "").strip()
            updated = _atom_datetime(entry.findtext(f"{ATOM}updated"))
            entry_id = (entry.findtext(f"{ATOM}id") or "").strip()
            link_node = entry.find(f"{ATOM}link")
            link = str(link_node.get("href") or "").strip() if link_node is not None else ""
            author_name = (entry.findtext(f"{ATOM}author/{ATOM}name") or "").strip()
            author_uri = (entry.findtext(f"{ATOM}author/{ATOM}uri") or "").strip()
            handle = re.sub(r"^/u/", "", author_name, flags=re.IGNORECASE).strip()
            content = entry.findtext(f"{ATOM}content") or ""
            if not title or not updated or updated <= since or not entry_id or not link or not handle:
                continue
            context = _clean_html(content)
            if author_uri:
                context = f"Public profile: {author_uri}\n\n{context}".strip()
            candidates.append(
                RawCandidate(
                    name=handle,
                    handle=handle,
                    project=title,
                    project_url=link,
                    source=f"Reddit r/{subreddit}",
                    source_family="reddit",
                    source_url=link,
                    fingerprint=f"reddit:{entry_id}",
                    context=context[:4000],
                )
            )
        return candidates


def _atom_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)


def _clean_html(value: str) -> str:
    unescaped = html.unescape(value)
    without_comments = COMMENT_RE.sub(" ", unescaped)
    return re.sub(r"\s+", " ", TAG_RE.sub(" ", without_comments)).strip()


def _float_header(headers, name: str) -> float | None:
    value = headers.get(name) or headers.get(name.title())
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None
