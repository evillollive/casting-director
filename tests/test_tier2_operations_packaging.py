from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def run_script(name: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(ROOT / "scripts" / name), *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_operations_shell_scripts_parse() -> None:
    for name in (
        "backup-postgres.sh",
        "restore-postgres.sh",
        "container-entrypoint.sh",
    ):
        subprocess.run(
            ["bash", "-n", str(ROOT / "scripts" / name)],
            check=True,
            cwd=ROOT,
        )


def test_backup_dry_run_is_explicit_and_non_destructive() -> None:
    destination = ROOT / ".operations-test-backup-must-not-exist"
    assert not destination.exists()
    result = run_script(
        "backup-postgres.sh",
        "--database-url",
        "postgresql://unused.invalid/casting",
        "--output",
        str(destination),
        "--dry-run",
    )
    assert result.returncode == 0
    assert "Would create backup" in result.stdout
    assert not destination.exists()


def test_restore_requires_a_bundle_and_defaults_to_inspection() -> None:
    result = run_script("restore-postgres.sh")
    assert result.returncode != 0
    assert "--backup is required" in result.stderr
    source = (ROOT / "scripts" / "restore-postgres.sh").read_text()
    assert 'if [[ "$APPLY" == false' in source
    assert "--confirm-db NAME is required for --apply" in source


def test_runtime_packaging_copies_canonical_tools_once() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text()
    next_config = (ROOT / "next.config.ts").read_text()
    assert 'output: "standalone"' in next_config
    assert dockerfile.count("COPY --chown=casting:casting tools ./tools") == 1
    assert "test -f ./tools/casting_eval.py" in dockerfile
    assert "/workspace/runtime ./runtime" in dockerfile
    assert "USER casting" in dockerfile
    assert "COPY --from=build --chown=casting:casting /workspace/public" not in dockerfile
