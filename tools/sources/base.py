"""Shared source models and HTTP plumbing."""
from __future__ import annotations

import hashlib
import json
import time
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Protocol

USER_AGENT = "casting-director/1.0 (+https://github.com/evillollive/casting-director)"


@dataclass(frozen=True)
class RawCandidate:
    name: str
    handle: str
    project: str
    project_url: str
    source: str
    source_family: str
    source_url: str
    fingerprint: str
    context: str


@dataclass
class SourceFetch:
    candidates: list[RawCandidate] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class Source(Protocol):
    name: str

    def fetch(self, since: datetime) -> SourceFetch: ...


class HttpClient:
    """Small injectable HTTP client used by every connector."""

    def __init__(
        self,
        *,
        max_retries: int = 2,
        backoff_seconds: float = 1.0,
        opener=None,
        sleeper=None,
    ):
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds
        self.opener = opener or urllib.request.urlopen
        self.sleeper = sleeper or time.sleep

    def get_bytes(
        self,
        url: str,
        *,
        params: dict | None = None,
        headers: dict | None = None,
        timeout: int = 20,
        retry: bool = False,
    ) -> bytes:
        if params:
            query = urllib.parse.urlencode(params)
            url = f"{url}{'&' if '?' in url else '?'}{query}"
        request_headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
        request_headers.update(headers or {})
        request = urllib.request.Request(url, headers=request_headers)
        retries = self.max_retries if retry else 0
        for attempt in range(retries + 1):
            try:
                with self.opener(request, timeout=timeout) as response:
                    return response.read()
            except urllib.error.HTTPError as exc:
                retryable = exc.code == 429 or 500 <= exc.code < 600
                if not retryable or attempt >= retries:
                    raise
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                try:
                    delay = min(float(retry_after), 30.0) if retry_after else None
                except ValueError:
                    delay = None
                self.sleeper(delay if delay is not None else self.backoff_seconds * (2**attempt))

    def get_text(self, url: str, **kwargs) -> str:
        return self.get_bytes(url, **kwargs).decode("utf-8", errors="replace")

    def get_json(self, url: str, **kwargs):
        return json.loads(self.get_text(url, **kwargs))


def stable_fingerprint(source: str, value: str) -> str:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]
    return f"{source}:{digest}"


def utc_datetime(value: str | int | float | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)


def collect_sources(sources: Iterable[Source], since: datetime) -> SourceFetch:
    """Collect every source without letting one failed feed end the run."""
    combined = SourceFetch()
    for source in sources:
        try:
            result = source.fetch(since)
        except Exception as exc:  # Network and schema failures are isolated by feed.
            combined.errors.append(f"{source.name}: {exc}")
            continue
        combined.candidates.extend(result.candidates)
        combined.errors.extend(result.errors)
    return combined
