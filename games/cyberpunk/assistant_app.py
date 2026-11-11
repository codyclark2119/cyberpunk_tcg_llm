"""The local assistant's loopback page: for now, a Tools tab that runs any assistant tool by hand.

Every tool in this project gets a UI, and the card and rules tools in
``games/cyberpunk/assistant/tools.py`` are no exception: this page lists the
registry, builds a form from each tool's JSON schema, runs the tool on the
server and shows the JSON result exactly as a model would receive it. No model
is involved; the chat pane arrives in a later change and reuses these routes.

It is the harness monitor's ``build_app`` (token middleware) with the generic
console page replaced by this one, served on loopback by
``scripts/assistant_local.py``. One self-contained page: inline CSS and JS, no
CDN, works offline.

DNS rebinding: a page on another site can resolve its own hostname to
127.0.0.1 and then talk to this server from the victim's browser. Loopback
needs no token, so the guard here is the Host header: unless the app was
started for the LAN, a request whose Host is not a loopback name is refused, as
is any cross-site Origin. Off loopback the monitor's token applies instead.
"""

# No `from __future__ import annotations` here: FastAPI resolves the route handlers' `Request`
# annotation at runtime, and it is imported inside `build_assistant_app`.
import ipaddress
import secrets
from urllib.parse import urlsplit

from games.cyberpunk.assistant.tools import TOOLS, call_tool
from games.cyberpunk.config import REPO_ROOT
from games.cyberpunk.prompts import RULES_VERSION
from harness.core.webui.monitor import build_app
from harness.core.webui.runner import lan_ip

__all__ = ["build_assistant_app", "serve_assistant", "ASSISTANT_HTML", "is_loopback", "host_allowed"]

DEFAULT_PORT = 8767
TITLE = "Cyberpunk TCG assistant"


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _hostname(value: str) -> str | None:
    """The host part of a Host header or Origin, without port or IPv6 brackets."""
    if not value:
        return None
    try:
        parsed = urlsplit(value if "//" in value else f"//{value}")
        return (parsed.hostname or "").casefold() or None
    except ValueError:
        return None


def host_allowed(host_header: str | None, origin: str | None, *, lan: bool) -> bool:
    """Loopback mode accepts only a loopback Host and, when sent, a loopback Origin."""
    if lan:
        return True
    host = _hostname(host_header or "")
    if host is None or not is_loopback(host):
        return False
    if origin and origin != "null":
        origin_host = _hostname(origin)
        if origin_host is None or not is_loopback(origin_host):
            return False
    return True


def registry_view() -> dict:
    return {"rulesVersion": RULES_VERSION,
            "tools": [{"name": t.name, "description": t.description, "parameters": t.parameters}
                      for t in TOOLS.values()]}


def build_assistant_app(*, token: str | None = None, lan: bool = False):
    """The FastAPI app: the monitor's app (token) plus the tool routes and a Host/Origin guard."""
    from fastapi import Request
    from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
    from fastapi.routing import APIRoute

    def routes(app):
        app.router.routes[:] = [r for r in app.router.routes
                                if not (isinstance(r, APIRoute) and r.path == "/")]

        # Registered after the monitor's token middleware, so it runs first:
        # a rebinding attempt is refused before anything else looks at it.
        @app.middleware("http")
        async def host_guard(request: Request, call_next):
            if not host_allowed(request.headers.get("host"), request.headers.get("origin"), lan=lan):
                return PlainTextResponse("Refused: this server answers only to a loopback Host and Origin.", 403)
            return await call_next(request)

        @app.get("/", response_class=HTMLResponse)
        def index():
            return ASSISTANT_HTML

        @app.get("/api/tools")
        def list_tools():
            return registry_view()

        @app.post("/api/tools/{name}")
        async def run_tool(name: str, request: Request):
            if name not in TOOLS:
                return JSONResponse(call_tool(name, {}), status_code=404)
            try:
                payload = await request.json()
            except ValueError:
                payload = None
            if not isinstance(payload, dict):
                return JSONResponse({"ok": False, "tool": name, "error": "Send the arguments as a JSON object.",
                                     "error_kind": "invalid_arguments", "rules_version": RULES_VERSION},
                                    status_code=400)
            result = call_tool(name, payload)
            if result["ok"]:
                return result
            return JSONResponse(result, status_code=404 if result.get("error_kind") == "not_found" else 400)

    return build_app([], REPO_ROOT, title=TITLE, token=token, extra_routes=routes)


def serve_assistant(host: str = "127.0.0.1", port: int = DEFAULT_PORT, *, lan: bool = False,
                    no_auth: bool = False) -> None:
    """Serve on loopback by default; any other bind needs the printed token unless ``no_auth``."""
    import uvicorn

    bind = "0.0.0.0" if lan else host
    open_bind = not is_loopback(bind)
    token = None if (no_auth or not open_bind) else secrets.token_urlsafe(12)
    app = build_assistant_app(token=token, lan=open_bind)
    shown = f"http://{lan_ip() if lan else host}:{port}"
    print(f"{TITLE} -> {shown}/" + (f"?t={token}" if token else ""), flush=True)
    if open_bind and not token:
        print("  WARNING: reachable beyond this machine with --no-auth. Anyone on this network can run the "
              "card and rules tools.", flush=True)
    uvicorn.run(app, host=bind, port=port, log_level="warning")


ASSISTANT_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cyberpunk TCG assistant</title>
<style>
:root{--bg:#f6f6f4;--panel:#fff;--ink:#1b1b1f;--muted:#666;--line:#ddd;--accent:#0b6e69;--warn:#a03a00;--sel:#e7f4f2;--card:#fafafa}
@media (prefers-color-scheme: dark){:root{--bg:#141417;--panel:#1d1d22;--ink:#e8e8ea;--muted:#9a9aa2;--line:#33333a;--accent:#4fc1b8;--warn:#ff9a5c;--sel:#183331;--card:#24242a}}
*{box-sizing:border-box}
body{margin:0;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;gap:16px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);flex-wrap:wrap}
header h1{font-size:16px;margin:0}
.badge{font-size:12px;border:1px solid var(--line);border-radius:10px;padding:1px 8px;color:var(--muted)}
nav button{background:none;border:0;border-bottom:2px solid var(--accent);padding:6px 10px;color:var(--ink);font:inherit}
main{padding:16px;max-width:1200px;margin:0 auto;display:grid;grid-template-columns:240px 1fr;gap:12px}
@media (max-width:760px){main{grid-template-columns:1fr}}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:12px;min-width:0}
ul.tools{list-style:none;margin:0;padding:0}
ul.tools li button{width:100%;text-align:left;background:none;border:0;border-radius:6px;padding:6px 8px;color:var(--ink);font:inherit;cursor:pointer}
ul.tools li button.on{background:var(--sel)}
.muted{color:var(--muted)}.err{color:var(--warn);white-space:pre-wrap}
form{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin:10px 0}
label{display:flex;flex-direction:column;font-size:12px;color:var(--muted);gap:2px}
label .req{color:var(--warn)}
input,select{font:inherit;padding:5px 6px;border:1px solid var(--line);border-radius:5px;background:var(--bg);color:var(--ink);min-width:0}
button.go{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button:disabled{opacity:.5;cursor:default}
pre{white-space:pre-wrap;word-break:break-word;font-size:12px;max-height:70vh;overflow:auto;background:var(--card);padding:8px;border-radius:6px;margin:0}
.status{margin:8px 0;font-size:13px}
</style>
</head>
<body>
<header>
  <h1>Cyberpunk TCG assistant</h1>
  <nav><button type="button">Tools</button></nav>
  <span class="badge" id="snapshot">snapshot …</span>
  <span class="muted">Run any card or rules tool by hand. The result is exactly what the model would receive.</span>
</header>
<main>
  <div class="panel"><ul class="tools" id="toolList"></ul></div>
  <div>
    <div class="panel">
      <h2 id="toolName" style="margin:0;font-size:15px">Pick a tool</h2>
      <p id="toolDesc" class="muted"></p>
      <form id="toolForm" autocomplete="off"></form>
      <button class="go" id="runBtn" type="button" disabled>Run</button>
      <div class="status" id="status"></div>
    </div>
    <div class="panel"><pre id="output" class="muted">No result yet.</pre></div>
  </div>
</main>
<script>
"use strict";
const state = {tools: [], current: null};
const $ = (id) => document.getElementById(id);

function el(tag, attrs, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

async function loadTools() {
  const response = await fetch("/api/tools");
  if (!response.ok) { $("status").textContent = "Could not load tools: HTTP " + response.status; return; }
  const data = await response.json();
  state.tools = data.tools;
  $("snapshot").textContent = "rules snapshot " + data.rulesVersion;
  const list = $("toolList");
  list.textContent = "";
  for (const tool of state.tools) {
    const li = el("li");
    const button = el("button", {type: "button", "data-tool": tool.name}, tool.name);
    button.addEventListener("click", () => pick(tool.name));
    li.appendChild(button);
    list.appendChild(li);
  }
  const wanted = location.hash.slice(1);
  pick(state.tools.some((t) => t.name === wanted) ? wanted : state.tools[0].name);
}

function pick(name) {
  const tool = state.tools.find((t) => t.name === name);
  state.current = tool;
  history.replaceState(null, "", "#" + name);
  for (const b of document.querySelectorAll("ul.tools button")) b.classList.toggle("on", b.dataset.tool === name);
  $("toolName").textContent = tool.name;
  $("toolDesc").textContent = tool.description;
  const form = $("toolForm");
  form.textContent = "";
  const props = tool.parameters.properties || {};
  const required = new Set(tool.parameters.required || []);
  for (const [field, spec] of Object.entries(props)) {
    const label = el("label");
    const title = el("span", {}, field);
    if (required.has(field)) title.appendChild(el("span", {class: "req"}, " *"));
    label.appendChild(title);
    let input;
    if (spec.enum) {
      input = el("select");
      input.appendChild(el("option", {value: ""}, required.has(field) ? "(choose)" : "(any)"));
      for (const value of spec.enum) input.appendChild(el("option", {value: String(value)}, String(value)));
    } else if (spec.type === "integer") {
      input = el("input", {type: "number", step: "1"});
      if (spec.minimum !== undefined) input.min = spec.minimum;
      if (spec.maximum !== undefined) input.max = spec.maximum;
    } else {
      input = el("input", {type: "text"});
      if (spec.maxLength) input.maxLength = spec.maxLength;
    }
    input.name = field;
    input.dataset.type = spec.type;
    if (spec.description) input.title = spec.description;
    input.placeholder = spec.description || "";
    label.appendChild(input);
    form.appendChild(label);
  }
  $("runBtn").disabled = false;
  $("status").textContent = "";
}

function collectArgs() {
  const args = {};
  for (const input of $("toolForm").querySelectorAll("input,select")) {
    const raw = input.value.trim();
    if (raw === "") continue;
    if (input.dataset.type === "integer") {
      const n = Number(raw);
      args[input.name] = Number.isInteger(n) ? n : raw;
    } else {
      args[input.name] = raw;
    }
  }
  return args;
}

async function run() {
  const tool = state.current;
  if (!tool) return;
  const args = collectArgs();
  $("runBtn").disabled = true;
  $("status").textContent = "Running " + tool.name + " …";
  try {
    const response = await fetch("/api/tools/" + encodeURIComponent(tool.name), {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(args)});
    const data = await response.json();
    $("output").className = data.ok ? "" : "err";
    $("output").textContent = JSON.stringify(data, null, 2);
    if (data.ok) {
      const s = data.sources || {};
      const bits = [];
      if (s.card_slugs && s.card_slugs.length) bits.push(s.card_slugs.length + " card(s)");
      if (s.rule_ids && s.rule_ids.length) bits.push(s.rule_ids.length + " rule(s)");
      if (s.errata_ids && s.errata_ids.length) bits.push(s.errata_ids.length + " erratum/errata");
      if (data.result && data.result.method) bits.push("method " + data.result.method);
      $("status").textContent = "OK" + (bits.length ? ": " + bits.join(", ") : "");
    } else {
      $("status").textContent = "Refused (" + (data.error_kind || response.status) + "): " + data.error;
    }
  } catch (err) {
    $("status").textContent = "Request failed: " + err;
  } finally {
    $("runBtn").disabled = false;
  }
}

$("runBtn").addEventListener("click", run);
$("toolForm").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); run(); } });
loadTools().catch((err) => { $("status").textContent = "Could not load tools: " + err; });
</script>
</body>
</html>
"""
