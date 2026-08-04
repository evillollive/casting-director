"""Candidate dedupe against canonical memory and a persisted seen list."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, timedelta
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
        self.data = {
            "version": 2,
            "permanent": {"fingerprints": {}, "identities": {}},
            "parked": {"fingerprints": {}, "identities": {}},
        }
        self.was_empty = True

    def load(self) -> "SeenStore":
        if self.path.exists():
            loaded = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                if loaded.get("version") == 1:
                    for kind in ("fingerprints", "identities"):
                        migrated = {
                            key: {"seen_on": stamp}
                            for key, stamp in (loaded.get(kind) or {}).items()
                        }
                        self.data["permanent"][kind].update(migrated)
                else:
                    for state in ("permanent", "parked"):
                        section = loaded.get(state) or {}
                        self.data[state]["fingerprints"].update(section.get("fingerprints") or {})
                        self.data[state]["identities"].update(section.get("identities") or {})
        self.was_empty = self.is_empty()
        return self

    def is_empty(self) -> bool:
        return not any(
            self.data[state][kind]
            for state in ("permanent", "parked")
            for kind in ("fingerprints", "identities")
        )

    def contains(self, candidate: RawCandidate, *, as_of: date | None = None) -> bool:
        if candidate.fingerprint in self.data["permanent"]["fingerprints"]:
            return True
        tokens = identity_tokens(candidate)
        if any(token in self.data["permanent"]["identities"] for token in tokens):
            return True

        today = as_of or date.today()
        parked = self.data["parked"]
        records = [parked["fingerprints"].get(candidate.fingerprint)]
        records.extend(parked["identities"].get(token) for token in tokens)
        return any(record and today < date.fromisoformat(record["eligible_after"]) for record in records)

    def record_permanent(self, candidates: list[RawCandidate], seen_on: str | None = None) -> None:
        stamp = seen_on or date.today().isoformat()
        for candidate in candidates:
            record = {"seen_on": stamp}
            self.data["permanent"]["fingerprints"][candidate.fingerprint] = record
            self.data["parked"]["fingerprints"].pop(candidate.fingerprint, None)
            for token in identity_tokens(candidate):
                self.data["permanent"]["identities"][token] = record
                self.data["parked"]["identities"].pop(token, None)

    def record_parked(
        self,
        candidates: list[RawCandidate],
        *,
        parked_on: str | None = None,
        cooldown_weeks: int = 8,
    ) -> None:
        stamp = date.fromisoformat(parked_on) if parked_on else date.today()
        record = {
            "parked_on": stamp.isoformat(),
            "eligible_after": (stamp + timedelta(weeks=cooldown_weeks)).isoformat(),
        }
        for candidate in candidates:
            if candidate.fingerprint in self.data["permanent"]["fingerprints"]:
                continue
            self.data["parked"]["fingerprints"][candidate.fingerprint] = record
            for token in identity_tokens(candidate):
                if token not in self.data["permanent"]["identities"]:
                    self.data["parked"]["identities"][token] = record

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
    as_of: date | None = None,
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
            or seen_store.contains(candidate, as_of=as_of)
        ):
            result.seen.append(candidate)
            continue
        result.survivors.append(candidate)
        run_fingerprints.add(candidate.fingerprint)
        run_identities.update(tokens)
    return result
