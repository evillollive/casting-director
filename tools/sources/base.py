"""Shared source models and HTTP plumbing."""
from __future__ import annotations

import hashlib
import json
import re
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
    expected_failures: list[str] = field(default_factory=list)
    notices: list[str] = field(default_factory=list)
    successful_requests: int = 0

    def messages(self) -> list[str]:
        return (
            [f"EXPECTED FAILURE: {message}" for message in self.expected_failures]
            + [f"NOTICE: {message}" for message in self.notices]
            + [f"ERROR: {message}" for message in self.errors]
        )


@dataclass(frozen=True)
class HttpResponse:
    body: bytes
    headers: dict[str, str]
    status: int


class Source(Protocol):
    name: str

    def fetch(self, since: datetime) -> SourceFetch: ...


@dataclass(frozen=True)
class ExpectedFailure:
    reason: str
    status_codes: tuple[int, ...]

    def matches(self, error) -> bool:
        code = getattr(error, "code", None)
        if code is None:
            match = re.search(r"\bHTTP(?: Error)?\s+(\d{3})\b", str(error))
            code = int(match.group(1)) if match else None
        return code in self.status_codes


@dataclass(frozen=True)
class SourceRegistration:
    connector: Source
    expected_failure: ExpectedFailure | None = None


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
        return self.get_response(
            url,
            params=params,
            headers=headers,
            timeout=timeout,
            retry=retry,
        ).body

    def get_response(
        self,
        url: str,
        *,
        params: dict | None = None,
        headers: dict | None = None,
        timeout: int = 20,
        retry: bool = False,
    ) -> HttpResponse:
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
                    response_headers = {
                        str(key).lower(): str(value)
                        for key, value in response.headers.items()
                    }
                    return HttpResponse(
                        body=response.read(),
                        headers=response_headers,
                        status=int(getattr(response, "status", 200)),
                    )
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


def collect_sources(sources: Iterable[Source | SourceRegistration], since: datetime) -> SourceFetch:
    """Collect every source without letting one failed feed end the run."""
    combined = SourceFetch()
    for item in sources:
        registration = item if isinstance(item, SourceRegistration) else SourceRegistration(item)
        source = registration.connector
        expected = registration.expected_failure
        try:
            result = source.fetch(since)
        except Exception as exc:  # Network and schema failures are isolated by feed.
            if expected and expected.matches(exc):
                combined.expected_failures.append(
                    f"{source.name}: expected failure ({expected.reason}): {exc}"
                )
            else:
                combined.errors.append(f"{source.name}: {exc}")
            continue
        combined.candidates.extend(result.candidates)
        combined.expected_failures.extend(result.expected_failures)
        combined.notices.extend(result.notices)
        combined.successful_requests += result.successful_requests
        for error in result.errors:
            if expected and expected.matches(error):
                combined.expected_failures.append(
                    f"{source.name}: expected failure ({expected.reason}): {error}"
                )
            else:
                combined.errors.append(error)
        if expected and (
            result.candidates
            or result.successful_requests
            or (not result.errors and not result.expected_failures)
        ):
            combined.notices.append(
                f"{source.name}: UNEXPECTED SUCCESS for a source marked expected-to-fail "
                f"({expected.reason}); clear the registry flag if access is reliable."
            )
    return combined
