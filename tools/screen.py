"""Structured LLM screening with the canonical prompt and real shortlist gates."""
from __future__ import annotations

import json
import os
import re
import urllib.request
from dataclasses import dataclass

from sources import RawCandidate


class ScreenConfigurationError(RuntimeError):
    pass


class ScreenResponseError(RuntimeError):
    pass


@dataclass(frozen=True)
class CastingBrief:
    candidate: RawCandidate
    name: str
    handle: str
    project: str
    hook: str
    why_now: str
    voice: str
    arc: str
    reach: str
    caveat: str
    sensitivity: str
    overall: int
    protagonist: int
    visible_hook: int
    why_now_score: int
    voice_score: int
    arc_score: int
    reach_score: int
    rationale: str
    is_evergreen: bool
    category: str
    region: str
    not_for_surfacing: bool
    parked_reason: str

    @property
    def gate_passed(self) -> bool:
        return self.protagonist >= 3 and self.visible_hook >= 3


REQUIRED_TEXT = ["name", "project", "hook", "why_now", "voice", "arc", "reach", "rationale"]
SCORE_FIELDS = [
    "overall",
    "protagonist",
    "visible_hook",
    "why_now_score",
    "voice_score",
    "arc_score",
    "reach_score",
]


def brief_from_mapping(candidate: RawCandidate, value: dict) -> CastingBrief:
    missing = [key for key in REQUIRED_TEXT if not str(value.get(key) or "").strip()]
    if missing:
        raise ScreenResponseError(f"screening response missing fields: {', '.join(missing)}")
    scores = {}
    for key in SCORE_FIELDS:
        try:
            score = int(value[key])
        except (KeyError, TypeError, ValueError) as exc:
            raise ScreenResponseError(f"screening response has no valid {key} score") from exc
        if score < 1 or score > 5:
            raise ScreenResponseError(f"screening response {key} score must be 1 through 5")
        scores[key] = score
    return CastingBrief(
        candidate=candidate,
        name=str(value["name"]).strip(),
        handle=str(value.get("handle") or candidate.handle).strip(),
        project=str(value["project"]).strip(),
        hook=str(value["hook"]).strip(),
        why_now=str(value["why_now"]).strip(),
        voice=str(value["voice"]).strip(),
        arc=str(value["arc"]).strip(),
        reach=str(value["reach"]).strip(),
        caveat=str(value.get("caveat") or "none").strip(),
        sensitivity=str(value.get("sensitivity") or "").strip(),
        rationale=str(value["rationale"]).strip(),
        is_evergreen=bool(value.get("is_evergreen")),
        category=str(value.get("category") or "uncategorized").strip(),
        region=str(value.get("region") or "unknown").strip(),
        not_for_surfacing=bool(value.get("not_for_surfacing")),
        parked_reason=str(value.get("parked_reason") or "").strip(),
        **scores,
    )


def extract_json_object(text: str) -> dict:
    stripped = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", stripped, re.DOTALL | re.IGNORECASE)
    if fenced:
        stripped = fenced.group(1)
    else:
        start, end = stripped.find("{"), stripped.rfind("}")
        if start >= 0 and end > start:
            stripped = stripped[start : end + 1]
    try:
        value = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise ScreenResponseError(f"screening response was not valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ScreenResponseError("screening response must be one JSON object")
    return value


class LlmClient:
    """Configurable chat-compatible HTTP client with no provider-specific SDK."""

    def __init__(self, *, api_key: str, api_url: str, model: str, timeout: int = 60):
        if not api_key:
            raise ScreenConfigurationError("CASTING_LLM_API_KEY is required")
        if not api_url:
            raise ScreenConfigurationError("CASTING_LLM_API_URL is required")
        if not model:
            raise ScreenConfigurationError("CASTING_LLM_MODEL is required")
        self.api_key = api_key
        self.api_url = api_url
        self.model = model
        self.timeout = timeout

    @classmethod
    def from_environment(cls) -> "LlmClient":
        return cls(
            api_key=os.environ.get("CASTING_LLM_API_KEY", ""),
            api_url=os.environ.get("CASTING_LLM_API_URL", ""),
            model=os.environ.get("CASTING_LLM_MODEL", ""),
        )

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict:
        payload = {
            "model": self.model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        request = urllib.request.Request(
            self.api_url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
        return extract_json_object(_response_text(body))


def _response_text(body: dict) -> str:
    choices = body.get("choices") or []
    if choices:
        content = (choices[0].get("message") or {}).get("content")
        if isinstance(content, str):
            return content
    if isinstance(body.get("output_text"), str):
        return body["output_text"]
    content = body.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = [part.get("text", "") for part in content if isinstance(part, dict)]
        if any(texts):
            return "\n".join(texts)
    raise ScreenResponseError("screening API response did not contain text")


def candidate_prompt(candidate: RawCandidate) -> str:
    schema = {
        "name": "public name",
        "handle": "public handle",
        "project": "one factual line",
        "hook": "why it films",
        "why_now": "dated reason or evergreen explanation",
        "voice": "verified writing or talk URL and evidence",
        "arc": "stakes",
        "reach": "public non-invasive contact path",
        "caveat": "caveat or none",
        "sensitivity": "minor, pseudonymous, at risk, memorial, or empty",
        "overall": "integer 1-5, a judgment rather than an average",
        "protagonist": "integer 1-5",
        "visible_hook": "integer 1-5",
        "why_now_score": "integer 1-5",
        "voice_score": "integer 1-5",
        "arc_score": "integer 1-5",
        "reach_score": "integer 1-5",
        "rationale": "one sentence",
        "is_evergreen": "boolean",
        "category": "short project category",
        "region": "verified region or unknown",
        "not_for_surfacing": "boolean required by consent and care",
        "parked_reason": "reason to revisit, or empty",
    }
    candidate_data = {
        "name": candidate.name,
        "handle": candidate.handle,
        "project": candidate.project,
        "project_url": candidate.project_url,
        "source": candidate.source,
        "source_family": candidate.source_family,
        "source_url": candidate.source_url,
        "context": candidate.context,
    }
    return (
        "Screen this one candidate using the canonical instructions. Return only one JSON object. "
        "Do not invent facts, links, dates, contact paths, regions, or sensitivity details.\n\n"
        f"Required schema:\n{json.dumps(schema, indent=2)}\n\n"
        f"Candidate:\n{json.dumps(candidate_data, indent=2)}"
    )


def screen_candidates(
    candidates: list[RawCandidate],
    *,
    run_prompt: str,
    client: LlmClient,
) -> list[CastingBrief]:
    return [
        brief_from_mapping(candidate, client.complete_json(run_prompt, candidate_prompt(candidate)))
        for candidate in candidates
    ]
