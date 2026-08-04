"""RSS helpers shared by wider-net connectors."""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from .base import RawCandidate, stable_fingerprint

TAG_RE = re.compile(r"<[^>]+>")


def _text(entry: ET.Element, *names: str) -> str:
    for name in names:
        child = entry.find(name)
        if child is not None and child.text:
            return child.text.strip()
    return ""


def _published(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)


def parse_rss(
    xml_text: str,
    *,
    since: datetime,
    source: str,
    source_family: str,
) -> list[RawCandidate]:
    root = ET.fromstring(xml_text)
    entries = list(root.findall(".//item"))
    if not entries:
        entries = list(root.findall(".//{http://www.w3.org/2005/Atom}entry"))
    out = []
    for entry in entries:
        title = _text(entry, "title", "{http://www.w3.org/2005/Atom}title")
        link = _text(entry, "link")
        if not link:
            atom_link = entry.find("{http://www.w3.org/2005/Atom}link")
            link = str(atom_link.get("href") or "") if atom_link is not None else ""
        guid = _text(entry, "guid", "id", "{http://www.w3.org/2005/Atom}id") or link
        author = _text(
            entry,
            "{http://purl.org/dc/elements/1.1/}creator",
            "author",
            "{http://www.w3.org/2005/Atom}author/{http://www.w3.org/2005/Atom}name",
        )
        published = _published(
            _text(
                entry,
                "pubDate",
                "published",
                "updated",
                "{http://www.w3.org/2005/Atom}published",
                "{http://www.w3.org/2005/Atom}updated",
            )
        )
        if published is not None and published < since:
            continue
        description = _text(
            entry,
            "description",
            "{http://purl.org/rss/1.0/modules/content/}encoded",
            "{http://www.w3.org/2005/Atom}summary",
            "{http://www.w3.org/2005/Atom}content",
        )
        context = html.unescape(TAG_RE.sub(" ", description))
        context = re.sub(r"\s+", " ", context).strip()
        if not title or not link:
            continue
        out.append(
            RawCandidate(
                name=author or title,
                handle=author,
                project=title,
                project_url=link,
                source=source,
                source_family=source_family,
                source_url=link,
                fingerprint=stable_fingerprint(source_family, guid),
                context=context[:4000],
            )
        )
    return out
