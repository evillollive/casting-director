"""GitHub repository search connector."""
from __future__ import annotations

import os
from datetime import datetime

from .base import HttpClient, RawCandidate, SourceFetch


class GitHubSource:
    name = "GitHub"
    endpoint = "https://api.github.com/search/repositories"

    def __init__(self, client: HttpClient, token: str | None = None):
        self.client = client
        self.token = token if token is not None else os.environ.get("GITHUB_TOKEN", "")

    @property
    def headers(self) -> dict:
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def fetch(self, since: datetime) -> SourceFetch:
        data = self.client.get_json(
            self.endpoint,
            params={
                "q": f"created:>{since.date().isoformat()} stars:>20",
                "sort": "stars",
                "order": "desc",
                "per_page": 50,
            },
            headers=self.headers,
        )
        candidates = []
        for item in data.get("items", []):
            full_name = str(item.get("full_name") or "").strip()
            owner = item.get("owner") or {}
            handle = str(owner.get("login") or "").strip()
            project_url = str(item.get("html_url") or "").strip()
            if not full_name or not handle or not project_url:
                continue
            readme = self._readme_excerpt(full_name)
            description = str(item.get("description") or "").strip()
            context = "\n\n".join(part for part in (description, readme) if part)[:5000]
            candidates.append(
                RawCandidate(
                    name=handle,
                    handle=handle,
                    project=full_name,
                    project_url=project_url,
                    source=self.name,
                    source_family="github",
                    source_url=project_url,
                    fingerprint=f"github:{item.get('id') or full_name.lower()}",
                    context=context,
                )
            )
        return SourceFetch(candidates=candidates)

    def _readme_excerpt(self, full_name: str) -> str:
        try:
            return self.client.get_text(
                f"https://api.github.com/repos/{full_name}/readme",
                headers={**self.headers, "Accept": "application/vnd.github.raw+json"},
            )[:4000]
        except Exception:
            return ""
