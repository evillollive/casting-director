"""The browser evaluator (web/js/casting-eval.js) matches the Python evaluator.

casting_eval.py and its JS port must agree exactly, or the hosted app would
lint runs differently than the repo's tool. This drives the JS port over every
fixture through Node and compares its violations to the Python evaluator's.

Skipped when Node is not installed (the JS port still ships; parity is simply
unverified in that environment). CI installs Node so the check runs there.
"""
import glob
import json
import os
import shutil
import subprocess
from dataclasses import asdict
from pathlib import Path

import pytest

import casting_eval as ce

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures"
EVAL_JS = ROOT / "web" / "js" / "casting-eval.js"

NODE = shutil.which("node")

HARNESS = r"""
const fs = require("fs");
const CE = require(process.argv[1]);
const dnr = CE.parseDnrNames(fs.readFileSync(process.argv[2], "utf8"));
const out = {};
for (let i = 3; i < process.argv.length; i++) {
  const p = process.argv[i];
  const name = p.split("/").pop();
  out[name] = CE.evaluate(fs.readFileSync(p, "utf8"), dnr, false);
}
process.stdout.write(JSON.stringify(out));
"""


def _python_results(dnr_names):
    out = {}
    for f in sorted(glob.glob(str(FIXTURES / "run_*.md"))):
        text = Path(f).read_text(encoding="utf-8")
        violations = ce.evaluate(text, dnr_names=dnr_names, live=False)
        out[os.path.basename(f)] = [asdict(v) for v in violations]
    return out


@pytest.mark.skipif(NODE is None, reason="Node.js not available")
def test_js_port_matches_python():
    dnr_text = (FIXTURES / "dnr_sample.md").read_text(encoding="utf-8")
    dnr_names = ce.parse_dnr_names(dnr_text)
    expected = _python_results(dnr_names)

    fixtures = sorted(glob.glob(str(FIXTURES / "run_*.md")))
    proc = subprocess.run(
        [NODE, "-e", HARNESS, str(EVAL_JS), str(FIXTURES / "dnr_sample.md"), *fixtures],
        capture_output=True,
        text=True,
        check=True,
    )
    actual = json.loads(proc.stdout)

    assert set(actual) == set(expected)
    for name in expected:
        assert actual[name] == expected[name], f"mismatch on {name}"
