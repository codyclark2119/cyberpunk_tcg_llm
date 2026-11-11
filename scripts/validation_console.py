#!/usr/bin/env python3
"""Local web console for running this repo's validation suite.

    python scripts/validation_console.py            # http://127.0.0.1:8766
    npm run validate:ui

Why a console at all: `scripts/run_tests.sh` is the one entry point that runs
every validation check, but its output is long and a full run takes many
minutes. Running it from a browser tab keeps the log scrollable, cancellable
and next to the code being changed, without a terminal held open for it.

Why it reuses `harness.core.webui` instead of growing its own server: that
package already owns the security model -- the client names an action **id**,
the command line is assembled server-side from the allowlist below, and free
text never reaches a shell. The only thing this file contributes is data (the
ACTIONS list) and one adaptation: `Runner.build_cmd` launches every action
with the Python interpreter, and `run_tests.sh` is a bash script, so the
first argv entry is swapped for `bash`. Everything after it is exactly what
`Runner` built from the allowlist. Because `monitor.serve` builds its own
`Runner`, `serve` here mirrors it line for line (same loopback default, same
`--lan` token, same `--no-auth` warning) while passing the adapted runner to
`monitor.build_app`.

The "Single step" choices come from `run_tests.sh --list` at startup, so the
console never offers a step the script does not have. If the script is
missing or its listing fails, a fixed fallback list is offered instead and a
warning is printed; a step the script then rejects fails visibly in the log.
"""

import argparse
import re
import secrets
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from harness.core.webui.runner import Runner, lan_ip  # noqa: E402

RUN_TESTS = "scripts/run_tests.sh"
TITLE = "Validation"
DEFAULT_PORT = 8766  # one above monitor.serve's default, so both can run

# Used only when `run_tests.sh --list` cannot be read. Mirrors
# run_tests.sh's step names as of 2026-11-11.
FALLBACK_STEPS = [
    "guard-tests", "typecheck", "lint", "validate-cards", "unit", "build",
    "diff-check", "py-deps", "py-compile", "py-cyberpunk", "py-harness-core",
    "py-engine-candidates", "py-policy-bot", "py-policy-mlx", "py-engine-adapter",
    "py-local-match", "py-validation-console", "py-play-app",
    "deck-rules", "integration",
]

_STEP_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")


def parse_step_list(text: str) -> list[str]:
    """Step names from `--list` output: the first token of each line.

    Blank lines, `#` comments and header lines ending in `:` are skipped, as
    is any token that is not a plain step name, so a decorative listing
    cannot smuggle odd strings into the choice allowlist.
    """
    steps: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.endswith(":"):
            continue
        token = line.split()[0]
        if _STEP_RE.match(token) and not token.endswith(":") and token not in steps:
            steps.append(token)
    return steps


def discover_steps(repo_root: Path = REPO_ROOT, timeout: float = 20.0) -> tuple[list[str], str]:
    """(steps, source): steps from `run_tests.sh --list`, else the fallback."""
    script = repo_root / RUN_TESTS
    if not script.is_file():
        return list(FALLBACK_STEPS), f"fallback ({RUN_TESTS} not found)"
    try:
        proc = subprocess.run(["bash", RUN_TESTS, "--list"], cwd=repo_root,
                              capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return list(FALLBACK_STEPS), f"fallback ({RUN_TESTS} --list failed: {e})"
    steps = parse_step_list(proc.stdout) if proc.returncode == 0 else []
    if not steps:
        return list(FALLBACK_STEPS), (f"fallback ({RUN_TESTS} --list exited "
                                      f"{proc.returncode} with no steps)")
    return steps, f"{RUN_TESTS} --list"


def build_actions(steps: list[str]) -> list[dict]:
    """The allowlist. Nothing outside it can run."""
    def fixed(*argv):
        return [{"type": "fixed", "value": list(argv)}] if argv else []

    actions = [
        {"id": "quick", "group": "Validation", "label": "Quick check",
         "cmd": RUN_TESTS, "args": fixed("--quick"),
         "desc": "The fast subset of run_tests.sh.", "eta": "a few minutes"},
        {"id": "full", "group": "Validation", "label": "Full check",
         "cmd": RUN_TESTS, "args": fixed(),
         "desc": "Everything run_tests.sh runs, including the Docker-backed "
                 "integration tests.", "eta": "longest"},
        {"id": "full-no-infra", "group": "Validation", "label": "Full, no Docker",
         "cmd": RUN_TESTS, "args": fixed("--no-infra"),
         "desc": "The full run without steps that need Docker services."},
    ]
    if steps:
        actions.append(
            {"id": "step", "group": "Validation", "label": "Single step",
             "cmd": RUN_TESTS,
             "args": [{"name": "--only", "type": "choice", "label": "Step",
                       "choices": list(steps), "default": steps[0]}],
             "desc": "One step of run_tests.sh."})
    return actions


class ShellScriptRunner(Runner):
    """`Runner` with `bash` in place of the Python interpreter.

    Only argv[0] changes; the script path and every argument still come from
    `Runner.build_cmd`, so choice validation and the no-shell rule are the
    shared implementation, not a copy.
    """

    def build_cmd(self, action: dict, values: dict) -> list[str]:
        cmd = super().build_cmd(action, values)
        return ["bash", *cmd[1:]]


def build_console(actions: list[dict], repo_root: Path = REPO_ROOT, token: str | None = None):
    """The FastAPI app, without serving it (tests use this)."""
    from harness.core.webui.monitor import build_app
    runner = ShellScriptRunner({a["id"]: a for a in actions}, repo_root)
    return build_app(actions, repo_root, title=TITLE, token=token, runner=runner)


def serve(actions: list[dict], repo_root: Path = REPO_ROOT, host: str = "127.0.0.1",
          port: int = DEFAULT_PORT, lan: bool = False, no_auth: bool = False) -> None:
    """`monitor.serve`, with the bash runner. Keep the two in step."""
    import uvicorn

    bind = "0.0.0.0" if lan else host
    token = None if (no_auth or not lan) else secrets.token_urlsafe(12)
    app = build_console(actions, repo_root, token=token)

    shown = f"http://{lan_ip()}:{port}" if lan else f"http://{host}:{port}"
    print(f"{TITLE} console -> {shown}" + (f"/?t={token}" if token else ""), flush=True)
    if lan and not token:
        print("  WARNING: bound to all interfaces with --no-auth. Anything on "
              "this network can run the allowlisted scripts.")
    print(f"  {len(actions)} action(s); jobs run one at a time.", flush=True)
    uvicorn.run(app, host=bind, port=port, log_level="warning")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--host", default="127.0.0.1",
                    help="loopback by default; use --lan to expose it")
    ap.add_argument("--lan", action="store_true",
                    help="bind all interfaces; a token is required unless --no-auth")
    ap.add_argument("--no-auth", action="store_true",
                    help="with --lan, skip the token (trusted network only)")
    args = ap.parse_args()

    steps, source = discover_steps()
    if source.startswith("fallback"):
        print(f"WARNING: single-step choices use a {source}.", file=sys.stderr)
    serve(build_actions(steps), REPO_ROOT, host=args.host, port=args.port,
          lan=args.lan, no_auth=args.no_auth)


if __name__ == "__main__":
    main()
