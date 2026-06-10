"""Shared pytest fixtures and path setup for the casting-director suite."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"

# Make tools/ importable.
sys.path.insert(0, str(ROOT / "tools"))


def repo_root() -> Path:
    return ROOT


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")
