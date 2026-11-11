#!/usr/bin/env python3
"""Plain-assert tests for scripts/validation_console.py.

That console can bind beyond loopback, so what matters is what it refuses:
an action id outside the allowlist, a step outside the discovered list, and
any argv other than the allowlisted one. These tests build the app without
serving it and never start `run_tests.sh` itself.

When FastAPI is installed the HTTP checks go through `TestClient`; without
it the same checks run against `monitor._public_action` and the runner
directly, so the pass line is identical either way.

Usage:
    python scripts/test_validation_console.py
"""

import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

_spec = importlib.util.spec_from_file_location(
    "validation_console", REPO_ROOT / "scripts" / "validation_console.py")
vc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vc)

STEPS = ["unit", "lint", "py-harness-core"]
EXPECTED_IDS = ["quick", "full", "full-no-infra", "step"]


def _actions():
    return vc.build_actions(STEPS)


def _runner():
    acts = _actions()
    return vc.ShellScriptRunner({a["id"]: a for a in acts}, REPO_ROOT), {a["id"]: a for a in acts}


def _client():
    """A TestClient, or None when the web stack is not installed."""
    try:
        from fastapi.testclient import TestClient
    except ImportError:
        return None
    return TestClient(vc.build_console(_actions(), REPO_ROOT))


def test_actions_are_the_four_allowlisted_ones():
    acts = _actions()
    assert [a["id"] for a in acts] == EXPECTED_IDS, acts
    assert [a["label"] for a in acts] == [
        "Quick check", "Full check", "Full, no Docker", "Single step"]
    assert all(a["cmd"] == "scripts/run_tests.sh" for a in acts)


def test_argv_is_exactly_the_allowlisted_one():
    r, by_id = _runner()
    base = ["bash", "scripts/run_tests.sh"]
    assert r.build_cmd(by_id["quick"], {}) == base + ["--quick"]
    assert r.build_cmd(by_id["full"], {}) == base
    assert r.build_cmd(by_id["full-no-infra"], {}) == base + ["--no-infra"]
    assert r.build_cmd(by_id["step"], {"--only": "lint"}) == base + ["--only", "lint"]
    # default choice when the client sends nothing
    assert r.build_cmd(by_id["step"], {}) == base + ["--only", "unit"]
    # values for undeclared arguments are ignored, not appended
    assert r.build_cmd(by_id["quick"], {"--evil": "x", "cmd": "rm"}) == base + ["--quick"]


def test_step_outside_the_list_is_refused():
    r, by_id = _runner()
    try:
        r.build_cmd(by_id["step"], {"--only": "lint; rm -rf /"})
    except ValueError as e:
        assert "not an allowed value" in str(e), e
    else:
        raise AssertionError("an out-of-list step was accepted")
    out = r.start("step", {"--only": "nope"})
    assert out["ok"] is False and r.active is None, out


def test_unknown_action_is_refused():
    r, _ = _runner()
    out = r.start("rm-rf", {})
    assert out["ok"] is False and "unknown action" in out["error"], out
    assert r.jobs == {}


def test_api_lists_actions_without_commands():
    client = _client()
    if client is not None:
        resp = client.get("/api/actions")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        listed = [a for g in body["groups"].values() for a in g]
    else:
        from harness.core.webui.monitor import _public_action
        listed = [_public_action(a) for a in _actions()]
        body = {"groups": {"Validation": listed}}
    assert [a["id"] for a in listed] == EXPECTED_IDS, listed
    step = next(a for a in listed if a["id"] == "step")
    assert step["args"][0]["choices"] == STEPS, step
    # the script path and fixed flags are server-side only
    text = json.dumps(body["groups"])
    assert all("cmd" not in a for a in listed), listed
    assert "scripts/run_tests.sh" not in text and "--no-infra" not in text, text


def test_api_rejects_unknown_ids_and_bad_choices():
    client = _client()
    if client is not None:
        resp = client.post("/api/run/does-not-exist", json={"values": {}})
        assert resp.status_code == 400 and "unknown action" in resp.json()["error"], resp.text
        resp = client.post("/api/run/step", json={"values": {"--only": "../../x"}})
        assert resp.status_code == 400 and "not an allowed value" in resp.json()["error"], resp.text
        assert client.get("/api/history").json()["jobs"] == []
    else:
        r, _ = _runner()
        assert "unknown action" in r.start("does-not-exist", {})["error"]
        assert "not an allowed value" in r.start("step", {"--only": "../../x"})["error"]
        assert r.history() == []


def test_parse_step_list_keeps_only_step_names():
    text = "Steps:\n  unit     node unit tests\n# comment\n\nlint\nunit\n$(boom) x\n"
    assert vc.parse_step_list(text) == ["unit", "lint"], vc.parse_step_list(text)


def test_discover_steps_uses_list_and_falls_back():
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        steps, source = vc.discover_steps(root)
        assert steps == vc.FALLBACK_STEPS and source.startswith("fallback"), source
        (root / "scripts").mkdir()
        script = root / "scripts" / "run_tests.sh"
        script.write_text('[ "$1" = --list ] && printf "alpha\\nbeta  desc\\n"\n')
        steps, source = vc.discover_steps(root)
        assert steps == ["alpha", "beta"] and not source.startswith("fallback"), (steps, source)
        script.write_text("exit 3\n")
        steps, source = vc.discover_steps(root)
        assert steps == vc.FALLBACK_STEPS and "exited 3" in source, source


def main():
    argparse.ArgumentParser(description=__doc__,
                            formatter_class=argparse.RawDescriptionHelpFormatter).parse_args()
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"OK  {t.__name__}")
    print(f"\nPASS validation console: {len(tests)}/{len(tests)}")


if __name__ == "__main__":
    main()
