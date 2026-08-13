"""The installable skill bundle stays byte-identical to the canonical docs.

skill/casting-director/ is a self-contained, portable agent skill. Everything
under references/, rolodex/*.seed.md, and scripts/ is a generated mirror of the
canonical Tier 0 artifacts. This test fails if a canonical file changed without
re-running tools/sync_skill_bundle.py, so the shipped skill never drifts from the
repo's source of truth.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_sync_module():
    spec = importlib.util.spec_from_file_location(
        "sync_skill_bundle", ROOT / "tools" / "sync_skill_bundle.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SYNC = _load_sync_module()


def test_skill_bundle_mirrors_exist_and_match():
    drift = []
    for src_rel, dest_rel in SYNC.MIRRORS.items():
        src = ROOT / src_rel
        dest = SYNC.BUNDLE / dest_rel
        assert dest.exists(), f"missing mirror skill/casting-director/{dest_rel}"
        if src.read_bytes() != dest.read_bytes():
            drift.append(dest_rel)
    assert not drift, (
        "skill bundle out of sync (run `python tools/sync_skill_bundle.py`): "
        + ", ".join(drift)
    )


def test_sync_check_reports_clean():
    assert SYNC.sync(check=True) == 0


def test_bundle_only_files_present():
    # These have no canonical upstream; they must ship with the bundle.
    for rel in ("SKILL.md", "INSTALL.md", "rolodex/README.md"):
        assert (SYNC.BUNDLE / rel).exists(), f"missing bundle file {rel}"
