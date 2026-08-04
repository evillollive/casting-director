"""Candidate dedupe against canonical memory and a persisted seen list."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from casting_eval import dnr_matches, normalize_dnr_name, parse_dnr_names
from sources import RawCandidate


@dataclass
class DedupeResult:
    survivors: list[RawCandidate] = field(default_factory=list)
    do_not_resurface: list[RawCandidate] = field(default_factory=list)
    seen: list[RawCandidate] = field(default_factory=list)


class SeenStore:
    def __init__(self, path: Path):
        self.path = path
        self.data = {"version": 1, "fingerprints": {}, "identities": {}}

    def load(self) -> "SeenStore":
        if self.path.exists():
            loaded = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                self.data["fingerprints"].update(loaded.get("fingerprints") or {})
                self.data["identities"].update(loaded.get("identities") or {})
        return self

    def contains(self, candidate: RawCandidate) -> bool:
        if candidate.fingerprint in self.data["fingerprints"]:
            return True
        return any(token in self.data["identities"] for token in identity_tokens(candidate))

    def record(self, candidates: list[RawCandidate], seen_on: str | None = None) -> None:
        stamp = seen_on or date.today().isoformat()
        for candidate in candidates:
            self.data["fingerprints"][candidate.fingerprint] = stamp
            for token in identity_tokens(candidate):
                self.data["identities"][token] = stamp

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def identity_tokens(candidate: RawCandidate) -> set[str]:
    name = normalize_dnr_name(candidate.name)
    handle = normalize_dnr_name(candidate.handle)
    project = normalize_dnr_name(candidate.project)
    project_url = normalize_dnr_name(candidate.project_url)
    tokens = set()
    if len(handle) >= 3:
        tokens.add(f"handle:{handle}")
    if len(project_url) >= 3:
        tokens.add(f"project-url:{project_url}")
    if len(name) >= 3 and len(project) >= 3:
        tokens.add(f"name-project:{name}|{project}")
    return tokens


def dedupe_candidates(
    candidates: list[RawCandidate],
    *,
    dnr_markdown: str,
    seen_store: SeenStore,
) -> DedupeResult:
    result = DedupeResult()
    dnr_names = parse_dnr_names(dnr_markdown)
    run_fingerprints: set[str] = set()
    run_identities: set[str] = set()
    for candidate in candidates:
        haystack = " ".join((candidate.name, candidate.handle, candidate.project))
        if dnr_matches(haystack, dnr_names):
            result.do_not_resurface.append(candidate)
            continue
        tokens = identity_tokens(candidate)
        if (
            candidate.fingerprint in run_fingerprints
            or tokens.intersection(run_identities)
            or seen_store.contains(candidate)
        ):
            result.seen.append(candidate)
            continue
        result.survivors.append(candidate)
        run_fingerprints.add(candidate.fingerprint)
        run_identities.update(tokens)
    return result
