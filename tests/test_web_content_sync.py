"""The browser app's bundled content stays byte-identical to the canonical docs.

web/content/ is a generated mirror (GitHub Pages only serves web/). This test
fails if a canonical file changed without re-running tools/sync_web_content.py,
so the hosted app never drifts from the repo's source of truth.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_sync_module():
    spec = importlib.util.spec_from_file_location(
        "sync_web_content", ROOT / "tools" / "sync_web_content.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SYNC = _load_sync_module()


def test_web_content_mirrors_exist_and_match():
    drift = []
    for src_rel, dest_name in SYNC.MIRRORS.items():
        src = ROOT / src_rel
        dest = ROOT / "web" / "content" / dest_name
        assert dest.exists(), f"missing mirror web/content/{dest_name}"
        if src.read_bytes() != dest.read_bytes():
            drift.append(dest_name)
    assert not drift, (
        "web/content out of sync (run `python tools/sync_web_content.py`): "
        + ", ".join(drift)
    )


def test_sync_check_reports_clean():
    assert SYNC.sync(check=True) == 0
