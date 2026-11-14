"use strict";
// pure:start  (no DOM; scripts/test_assistant_ui.py runs this part under node)
const ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"};
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}
// Citation links: a turn's cited card slugs and rule ids, and only those, become buttons in its
// answer (so a word that merely looks like a slug or a number is never linked). Ids are matched in
// already-escaped text and must look like an id (letters, digits, space, dot, dash), so nothing a
// model or tool wrote can reach an attribute.
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9 .-]{0,79}$/;
const MAX_CITATIONS = 64;
let activeCitations = null;  // set by withCitations while one answer renders
function citationLinks(sources) {
  const s = sources || {};
  const safe = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && SAFE_ID_RE.test(id)))]
    .slice(0, MAX_CITATIONS);
  return {cards: safe(s.card_slugs), rules: safe(s.rule_ids)};
}
function withCitations(sources, render) {
  activeCitations = citationLinks(sources);
  try { return render(); } finally { activeCitations = null; }
}
function linkCitations(safe, links) {
  if (!links) return safe;
  const kind = new Map();
  for (const id of links.rules || []) kind.set(id, "rule");
  for (const id of links.cards || []) kind.set(id, "card");
  if (!kind.size) return safe;
  const alternation = [...kind.keys()].sort((a, b) => b.length - a.length)
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  // Not inside a longer id or number: "9.2" never links inside "19.2" or "9.2.1", a slug never
  // inside a longer slug, and an entity's digits (&#39;) never link.
  const re = new RegExp("(?<![A-Za-z0-9_.#-])(" + alternation + ")(?![A-Za-z0-9_-]|\\.[0-9])", "g");
  return safe.replace(re, (id) => '<button type="button" class="cite" data-' + kind.get(id) + '="' + id + '">' + id + "</button>");
}
// Inline markdown on one line: `code` and **bold** only, plus citation links. Every piece is escaped
// before a tag is added, and the only tags added are fixed literals.
function inlineMd(raw, links) {
  const parts = String(raw).split("`");
  return parts.map((part, i) => {
    const safe = linkCitations(escapeHtml(part), links);
    if (i % 2 === 1 && i < parts.length - 1) return "<code>" + safe + "</code>";
    const text = i % 2 === 1 ? "`" + safe : safe;  // an unmatched backtick stays literal
    return text.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  }).join("");
}
const UL_RE = /^\s*[-*]\s+/, OL_RE = /^\s*\d+[.)]\s+/;
// Model text to HTML: paragraphs, bulleted and numbered lists, bold, inline code and the turn's
// citation links. Nothing else.
function mdToHtml(text, links = activeCitations) {
  const out = [];
  const inline = (t) => inlineMd(t, links);
  for (const block of String(text ?? "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/)) {
    let kind = null, items = [];
    const flush = () => {
      if (!items.length) return;
      if (kind === "p") out.push("<p>" + items.map(inline).join("<br>") + "</p>");
      else out.push("<" + kind + ">" + items.map((t) => "<li>" + inline(t) + "</li>").join("") + "</" + kind + ">");
      items = [];
    };
    for (const line of block.split("\n")) {
      if (!line.trim()) continue;
      const k = UL_RE.test(line) ? "ul" : OL_RE.test(line) ? "ol" : "p";
      if (k !== kind) { flush(); kind = k; }
      items.push(k === "ul" ? line.replace(UL_RE, "") : k === "ol" ? line.replace(OL_RE, "") : line);
    }
    flush();
  }
  return out.join("");
}
// A tile's text segments back to the card's plain text (keywords, triggers and symbols in [brackets]).
function segmentsText(segments) {
  return (segments || []).map((s) => s.kind === "keyword" || s.kind === "trigger" || s.kind === "symbol" ?
    "[" + s.value + "]" : s.value).join("");
}
function ms(value) { return Math.round(value || 0) + " ms"; }
// One line per trace step (shown with textContent).
function stepLine(step) {
  if (step.kind === "context") {
    if (!step.ok) return "context · full · about " + (step.estimatedTokens ?? "?") + " tokens, limit " + (step.limit ?? "?");
    if (step.action === "kept") return "context · over the estimate, nothing to drop; the worker decides · about " +
      (step.estimatedTokens ?? "?") + " tokens, limit " + (step.limit ?? "?");
    return "context · dropped " + (step.dropped || []).length + " earlier tool result(s) · about " +
      (step.estimatedTokens ?? "?") + " -> " + (step.estimatedTokensAfter ?? "?") + " tokens, limit " + (step.limit ?? "?");
  }
  if (step.kind === "model") {
    if (!step.ok) return "model · error · " + (step.error || "failed");
    return "model · " + (step.finishReason === "length" ? "token limit" : "ok") + " · " +
      (step.generationTokens ?? "?") + " tokens · " +
      (step.toolCallsRequested ? "asked for " + step.toolCallsRequested + " tool call(s)" : "answered") + " · " + ms(step.elapsedMs);
  }
  const auto = step.auto ? (step.link ? "linked \u201c" + step.link.span + "\u201d · " : "") +
    (step.implied ? "implied (" + step.implied.via + " of " + step.implied.of + ") · " : "") +
    (step.sent ? "sent " + (step.contextChars || 0) + " chars · " : "not sent · ") : "";
  return (step.tool || "(no tool)") + " · " + (step.ok ? "ok" : (step.errorKind || "error")) + " · " + auto +
    (step.summary || "") + " · " + ms(step.elapsedMs);
}
// Flags for an answer that did not end normally.
// Progress of an eval job from its log lines: the last "[k/N]" line the scorer printed.
function jobProgress(lines) {
  let done = 0, total = 0;
  for (const line of lines || []) {
    const m = /^\[(\d+)\/(\d+)\]/.exec(String(line));
    if (m) { done = Number(m[1]); total = Number(m[2]); }
  }
  return {done, total};
}
// A run file's rows split into header, items and summary.
function splitRun(rows) {
  const out = {header: null, items: [], summary: null};
  for (const row of rows || []) {
    if (row.kind === "header") out.header = row;
    else if (row.kind === "item") out.items.push(row);
    else if (row.kind === "summary") out.summary = row;
  }
  return out;
}
function scoreText(summary) {
  if (!summary) return "no summary";
  const pct = summary.score === null || summary.score === undefined ? "n/a" : (summary.score * 100).toFixed(1) + "%";
  return summary.correct + "/" + summary.scored + " correct (" + pct + ") · " + summary.unanswered + " unanswered · " +
    summary.unscored + " unscored · tools used on " + summary.tool_use + "/" + summary.items;
}
// An item's linked cards (the set's "cards" slugs), or "" for an item without that field.
function linkedCardsText(item) {
  if (!item || !Array.isArray(item.cards)) return "";
  return "linked cards: " + (item.cards.length ? item.cards.join(", ") : "none");
}
// "PASS (35/40 needed)" for a finished run with a pass mark, else "".
function passText(summary, passMark) {
  if (!summary || passMark === null || passMark === undefined) return "";
  return (summary.correct >= passMark ? "PASS" : "FAIL") + " (" + passMark + "/" + summary.items + " needed)";
}
function answerFlags(data, maxToolCalls) {
  const flags = [];
  if (data.stopReason === "tool_cap") flags.push("hit the tool-call cap (" + maxToolCalls + " calls)");
  if (data.stopReason === "length" || (data.trace || []).some((s) => s.kind === "model" && s.finishReason === "length"))
    flags.push("hit the token limit");
  if (data.stopReason === "model_error") flags.push("model error");
  if (data.stopReason === "empty") flags.push("no answer text");
  if (data.stopReason === "context_full") flags.push("ran out of model context");
  return flags;
}
// Rows of the retrieval table: one per method of one report, recall as percentages or why it did not run.
function retrievalRows(report) {
  const pct = (v) => v === null || v === undefined ? "n/a" : (v * 100).toFixed(1) + "%";
  const rows = [];
  for (const [method, m] of Object.entries((report && report.methods) || {})) {
    if (!m.available) { rows.push({method, cells: ["unavailable: " + (m.reason || "unknown reason")]}); continue; }
    rows.push({method, cells: [pct(m["recall@1"]), pct(m["recall@5"]), pct(m["recall@10"]),
      m["chars@10"] === null || m["chars@10"] === undefined ? "n/a" : String(Math.round(m["chars@10"]))]});
  }
  return rows;
}
// pure:end

const state = {tools: [], current: null, decks: [], lastDeck: null, maxToolCalls: 6, busy: false};
// Arguments the schema types do not fully describe get their own control.
const LONG_TEXT = 1000;
const $ = (id) => document.getElementById(id);

function el(tag, attrs, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

async function postJson(url, body) {
  const response = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body)});
  let data;
  try { data = await response.json(); } catch (err) { data = {ok: false, error: "HTTP " + response.status}; }
  return [response, data];
}

// Tabs ------------------------------------------------------------------------------
function showTab(name) {
  for (const tab of ["Chat", "Tools", "Eval"]) {
    $("tab" + tab).hidden = tab !== name;
    $("tabBtn" + tab).classList.toggle("on", tab === name);
  }
  if (name === "Eval" && !evalState.loaded) loadEval().catch((err) => { $("evalSetStatus").textContent = "Could not load: " + err; });
}
for (const b of document.querySelectorAll("nav button")) b.addEventListener("click", () => showTab(b.dataset.tab));

// Status badges ---------------------------------------------------------------------
const MODEL_TEXT = {none: "no model configured", idle: "model idle (loads on first question)", loading: "model loading …",
  ready: "model ready", error: "model error"};
let statusTimer = null;
async function loadStatus() {
  const response = await fetch("/api/status");
  if (!response.ok) return;
  const data = await response.json();
  state.maxToolCalls = data.maxToolCalls;
  $("snapshot").textContent = "snapshot " + data.rulesVersion + " · tournament rules " + data.tournamentRulesVersion +
    " · " + data.cardCount + " cards";
  const m = data.model;
  const badge = $("modelBadge");
  badge.className = "badge " + m.state;
  badge.textContent = (m.label ? m.label + ": " : "") + (MODEL_TEXT[m.state] || m.state) + (m.busy && m.state === "ready" ? " (answering)" : "");
  badge.title = m.lastError ? "last error: " + m.lastError : "prompt " + data.promptVersion;
  if (!state.statusLoaded) {
    $("thinkToggle").checked = !!m.thinkingDefault;
    $("preloadToggle").checked = m.preloadDefault !== false;
    state.statusLoaded = true;
  }
}

// Chat ------------------------------------------------------------------------------
function newSession() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
const chatSession = newSession();

function jsonPre(label, value) {
  const wrap = el("div");
  wrap.appendChild(el("div", {class: "muted"}, label));
  wrap.appendChild(el("pre", {}, JSON.stringify(value ?? null, null, 2)));
  return wrap;
}

function traceRow(step) {
  const d = el("details", {class: (step.ok ? "step" : "step bad") + (step.auto ? " auto" : "")});
  d.appendChild(el("summary", {}, stepLine(step)));
  if (step.kind === "context") {
    d.appendChild(jsonPre("prompt guard", {reason: step.reason, dropped: step.dropped, estimatedTokens: step.estimatedTokens,
      estimatedTokensAfter: step.estimatedTokensAfter, limit: step.limit}));
  } else if (step.kind === "model") {
    d.appendChild(jsonPre("model step", {finishReason: step.finishReason, promptTokens: step.promptTokens,
      generationTokens: step.generationTokens, elapsedMs: step.elapsedMs, error: step.error}));
    if (step.thinking) d.appendChild(jsonPre("thinking", step.thinking));
  } else {
    d.appendChild(jsonPre("arguments", step.arguments ?? {}));
    if (step.auto) d.appendChild(jsonPre("automatic step (run before the model spoke)", {link: step.link ?? null,
      implied: step.implied ?? null,
      sentToModel: !!step.sent, contextChars: step.contextChars, note: step.contextNote ?? null}));
    d.appendChild(step.ok ? jsonPre("result", step.result) : jsonPre("error", {errorKind: step.errorKind, error: step.error}));
  }
  return d;
}

function sourceButtons(sources) {
  const box = el("div", {class: "sources"});
  const s = sources || {};
  const slugs = s.card_slugs || [], rules = s.rule_ids || [], errata = s.errata_ids || [];
  if (!slugs.length && !rules.length && !errata.length) return null;
  box.appendChild(el("span", {class: "muted"}, "Sources:"));
  // Cited cards: a slug placeholder each, replaced by a compact tile once the batch route answers.
  if (slugs.length) {
    const cards = el("div", {class: "srccards"});
    for (const slug of slugs) cards.appendChild(tileButton(slug));
    box.appendChild(cards);
  }
  for (const id of rules) {
    const b = el("button", {type: "button", title: "rule from get_rule"}, "rule " + id);
    b.addEventListener("click", () => showSource("get_rule", {rule_id: id}, "rule " + id));
    box.appendChild(b);
  }
  if (errata.length) box.appendChild(el("span", {class: "muted"}, errata.length + " erratum/errata applied"));
  return box;
}

function showTurn(question, data) {
  $("chatLog").appendChild(el("div", {class: "msg q"}, question));
  const answer = el("div", {class: "msg a"});
  for (const flag of answerFlags(data, state.maxToolCalls)) answer.appendChild(el("div", {class: "flag"}, flag));
  const body = el("div", {class: data.ok ? "" : "err"});
  // The one HTML sink on the page: mdToHtml escapes everything before adding its few fixed tags,
  // and links only this turn's cited ids (citationLinks).
  withCitations(data.sources, () => {
    body.innerHTML = mdToHtml(data.answer || data.error || "No answer.");
  });
  answer.appendChild(body);
  const src = sourceButtons(data.sources);
  if (src) answer.appendChild(src);
  if (data.trace && data.trace.length) {
    const d = el("details", {class: "trace"});
    d.appendChild(el("summary", {}, "Trace: " + (data.autoToolCalls ? data.autoToolCalls + " auto step(s), " : "") +
      (data.toolCalls || 0) + " tool call(s), " + ms(data.elapsedMs) +
      (data.thinking ? ", thinking on" : "") + (data.preload ? "" : ", preload off") + (data.deckInContext ? ", deck in context" : "") +
      " · prompt " + data.promptVersion + " · snapshot " + data.rulesVersion));
    for (const step of data.trace) d.appendChild(traceRow(step));
    answer.appendChild(d);
  }
  $("chatLog").appendChild(answer);
  answer.scrollIntoView({block: "nearest"});
}

function setBusy(busy) {
  state.busy = busy;
  for (const id of ["chatSend", "chatNew", "deckLoadText", "deckLoadPick", "deckClear"]) $(id).disabled = busy;
  $("chatInput").readOnly = busy;
  clearInterval(statusTimer);
  if (busy) statusTimer = setInterval(() => loadStatus().catch(() => {}), 2000);
}

async function sendChat() {
  const question = $("chatInput").value.trim();
  if (!question || state.busy) return;
  setBusy(true);
  $("chatStatus").textContent = "Working … (the first question also loads the model)";
  loadStatus().catch(() => {});
  try {
    const [response, data] = await postJson("/api/chat", {session: chatSession, message: question,
      thinking: $("thinkToggle").checked, preload: $("preloadToggle").checked});
    showTurn(question, data);
    $("chatStatus").textContent = data.ok ? "" : "Refused (" + (data.error_kind || data.stopReason || response.status) + ")";
    if (data.ok) $("chatInput").value = "";
  } catch (err) {
    $("chatStatus").textContent = "Request failed: " + err;
  } finally {
    setBusy(false);
    loadStatus().catch(() => {});
  }
}

async function newChat() {
  const [, data] = await postJson("/api/chat/reset", {session: chatSession});
  $("chatLog").textContent = "";
  $("chatStatus").textContent = data.ok ? "New chat: history cleared" + (data.deck ? "; the loaded deck stays until you clear it." : ".") :
    "Could not reset: " + data.error;
}

// Source side panel -------------------------------------------------------------------
function factsList(obj) {
  const dl = el("dl", {class: "facts"});
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === null || value === undefined || (Array.isArray(value) && !value.length)) continue;
    dl.appendChild(el("dt", {}, key));
    const shown = Array.isArray(value) && value.every((v) => typeof v !== "object") ? value.join(", ") :
      typeof value === "object" ? JSON.stringify(value, null, 1) : String(value);
    dl.appendChild(el("dd", {}, shown));
  }
  return dl;
}

async function showSource(tool, args, label) {
  $("sideTitle").textContent = label;
  const body = $("sideBody");
  body.className = "muted";
  body.textContent = "Loading " + tool + " …";
  const [, data] = await postJson("/api/tools/" + encodeURIComponent(tool), args);
  body.textContent = "";
  if (!data.ok) { body.className = "err"; body.textContent = (data.error_kind || "error") + ": " + data.error; return; }
  body.className = "";
  const result = data.result || {};
  const main = result.card || result.rule;
  if (main) body.appendChild(factsList(main));
  const rest = Object.fromEntries(Object.entries(result).filter(([k]) => k !== "card" && k !== "rule"));
  if (Object.keys(rest).length) body.appendChild(factsList(rest));
  body.appendChild(el("div", {class: "muted", style: "font-size:11px"}, tool + " · snapshot " + data.rules_version +
    " · tournament rules " + data.tournament_rules_version));
}

// Card tiles ------------------------------------------------------------------------
// Text tiles from /api/card(s) (card_view.py): name, cost, type line, stats, keyword and trigger
// chips, the card text with its keywords marked, errata. Built with createElement/textContent only.
// The accent comes from the card's own colour value through data-color; the stylesheet maps the
// colours in the data to tokens and falls back to a neutral one for any other value.
const TILE_BATCH = 24;
const tileCache = new Map(), tileWaiting = new Map();
let tileQueue = [];
// Tiles asked for in the same tick go out together, TILE_BATCH slugs per /api/cards request.
function requestTile(slug) {
  if (tileCache.has(slug)) return Promise.resolve(tileCache.get(slug));
  if (tileWaiting.has(slug)) return tileWaiting.get(slug);
  const promise = new Promise((resolve) => {
    tileQueue.push([slug, resolve]);
    if (tileQueue.length === 1) setTimeout(flushTiles, 0);
  });
  tileWaiting.set(slug, promise);
  return promise;
}
async function flushTiles() {
  const queue = tileQueue;
  tileQueue = [];
  for (let i = 0; i < queue.length; i += TILE_BATCH) {
    const chunk = queue.slice(i, i + TILE_BATCH);
    try {
      const [, data] = await getJson("/api/cards?slugs=" + encodeURIComponent(chunk.map(([slug]) => slug).join(",")));
      for (const card of (data && data.cards) || []) tileCache.set(card.slug, card);
    } catch (err) { /* a slug stays a slug button */ }
    for (const [slug, resolve] of chunk) { tileWaiting.delete(slug); resolve(tileCache.get(slug) || null); }
  }
}
async function fetchTiles(slugs) {
  return (await Promise.all(slugs.map(requestTile))).filter(Boolean);
}

// tile:start  (only createElement, createTextNode, setAttribute, appendChild and textContent)
function tileNode(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.setAttribute("class", cls);
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function cardTile(card, expanded) {
  const part = expanded ? "div" : "span";
  const tile = tileNode(expanded ? "article" : "span", "tile " + (expanded ? "expanded" : "compact"));
  tile.setAttribute("data-color", String(card.color ?? ""));
  const head = tileNode(part, "tile-head");
  head.appendChild(tileNode("span", "tile-name", card.display_name || card.slug));
  if (card.has_errata) {
    const badge = tileNode("span", "tile-errata", "errata");
    badge.setAttribute("title", "Errata supersede the printed text");
    head.appendChild(badge);
  }
  if (card.cost !== null && card.cost !== undefined) {
    const cost = tileNode("span", "tile-cost", card.cost);
    cost.setAttribute("title", "cost " + card.cost);
    head.appendChild(cost);
  }
  tile.appendChild(head);
  tile.appendChild(tileNode(part, "tile-type", [card.card_type, card.color].concat(card.classifications || [])
    .filter((v) => v !== null && v !== undefined && v !== "").join(" · ")));
  const stats = [["Power", card.power], ["RAM", card.ram]].filter(([, v]) => v !== null && v !== undefined);
  if (stats.length) {
    const row = tileNode(part, "tile-stats");
    for (const [label, value] of stats) {
      const stat = tileNode("span", "tile-stat", label + " ");
      stat.appendChild(tileNode("b", "", value));
      row.appendChild(stat);
    }
    tile.appendChild(row);
  }
  const chips = [...(card.keywords || []).map((k) => ["keyword", k]), ...(card.timing_triggers || []).map((t) => ["trigger", t])];
  if (chips.length) {
    const row = tileNode(part, "tile-chips");
    for (const [kind, value] of chips) row.appendChild(tileNode("span", "chip chip-" + kind, value));
    tile.appendChild(row);
  }
  if (!expanded) return tile;
  const text = tileNode("div", "tile-text");
  for (const seg of card.segments || []) {
    if (seg.kind === "text") text.appendChild(document.createTextNode(seg.value));
    else text.appendChild(tileNode("span", "chip chip-" + (["keyword", "trigger", "symbol", "rule"].includes(seg.kind) ? seg.kind : "text"), seg.value));
  }
  if ((card.segments || []).length) tile.appendChild(text);
  if ((card.errata || []).length) {
    const box = tileNode("div", "tile-errlist");
    box.appendChild(tileNode("div", "tile-errhead", card.errata_note || "Errata"));
    for (const e of card.errata) {
      const item = tileNode("div", "tile-erratum");
      item.appendChild(tileNode("div", "tile-errtitle", e.heading + (e.variant ? " (" + e.variant + ")" : "")));
      item.appendChild(tileNode("div", "", e.text));
      box.appendChild(item);
    }
    tile.appendChild(box);
  }
  tile.appendChild(tileNode("div", "tile-foot", [card.rarity, card.set, card.slug].filter(Boolean).join(" · ")));
  return tile;
}
// tile:end

// A button that opens the card in the side panel: the slug until its tile arrives, then the tile.
function tileButton(slug) {
  const b = el("button", {type: "button", class: "tilebtn pending", "data-card": slug, title: "card " + slug}, slug);
  b.addEventListener("click", () => showCard(slug).catch((err) => { $("sideBody").textContent = "Could not load: " + err; }));
  fetchTiles([slug]).then(([card]) => {
    if (!card) return;
    b.textContent = "";
    b.classList.remove("pending");
    b.setAttribute("title", card.display_name + " (" + slug + ")");
    b.appendChild(cardTile(card, false));
  }).catch(() => {});
  return b;
}

async function showCard(slug) {
  $("sideTitle").textContent = slug;
  const body = $("sideBody");
  let card = tileCache.get(slug);
  if (!card) {
    body.className = "muted";
    body.textContent = "Loading " + slug + " …";
    const [, data] = await getJson("/api/card/" + encodeURIComponent(slug));
    if (!data.ok) {
      body.className = "err";
      body.textContent = (data.error || "error") + ": " + slug + ((data.did_you_mean || []).length ?
        " · did you mean " + data.did_you_mean.join(", ") : "");
      return;
    }
    card = data.card;
    tileCache.set(slug, card);
  }
  $("sideTitle").textContent = card.display_name;
  body.className = "";
  body.textContent = "";
  body.appendChild(cardTile(card, true));
  const row = el("div", {class: "row"});
  const raw = el("button", {type: "button", class: "small"}, "Raw facts (get_card)");
  raw.addEventListener("click", () => showSource("get_card", {slug}, slug));
  row.appendChild(raw);
  body.appendChild(row);
}

// Hovering or focusing a cited slug in an answer shows its compact tile, once it is loaded.
const tilePop = el("div", {id: "tilePop", role: "tooltip"});
tilePop.hidden = true;
document.body.appendChild(tilePop);
function showPop(target) {
  const card = tileCache.get(target.dataset.card);
  if (!card) return;
  tilePop.textContent = "";
  tilePop.appendChild(cardTile(card, false));
  tilePop.hidden = false;
  const r = target.getBoundingClientRect();
  const top = r.bottom + 6 + tilePop.offsetHeight > window.innerHeight ? r.top - 6 - tilePop.offsetHeight : r.bottom + 6;
  tilePop.style.top = Math.max(4, top) + "px";
  tilePop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - tilePop.offsetWidth - 4)) + "px";
}
function citeTarget(event) {
  return event.target && event.target.closest ? event.target.closest("button.cite[data-card]") : null;
}
for (const type of ["mouseover", "focusin"]) document.addEventListener(type, (e) => { const t = citeTarget(e); if (t) showPop(t); });
for (const type of ["mouseout", "focusout"]) document.addEventListener(type, (e) => { if (citeTarget(e)) tilePop.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") tilePop.hidden = true; });

// Deck panel ------------------------------------------------------------------------
function showHeldDeck(brief) {
  const note = $("deckNote");
  note.textContent = "";
  if (!brief) { note.appendChild(el("span", {class: "muted"}, "No deck loaded.")); return; }
  note.appendChild(el("span", {}, "Deck in context: " + (brief.name || "(unnamed)") + " · " + brief.legends +
    " Legends + " + brief.deck + " cards" + (brief.format ? " · " + brief.format : "") + " · " + brief.source));
  const clear = el("button", {type: "button", class: "small"}, "Clear");
  clear.addEventListener("click", clearDeck);
  note.appendChild(clear);
}

function slugButton(slug, text) {
  const b = el("button", {type: "button", class: "small"}, text || slug);
  b.addEventListener("click", () => showSource("get_card", {slug}, slug));
  return b;
}

function renderDeck(data) {
  const out = $("deckResult");
  out.textContent = "";
  if (!data.ok) {
    $("deckStatus").className = "status err";
    $("deckStatus").textContent = "Refused (" + (data.error_kind || "error") + "): " + data.error;
    return;
  }
  const parsed = data.parse.result;
  $("deckStatus").className = "status " + (data.loaded ? "good" : "err");
  $("deckStatus").textContent = data.loaded ? "Loaded: the model sees this deck with every question." :
    "Not loaded: " + parsed.unresolved.length + " line(s) did not resolve to one card." +
    (data.deck ? " The previous deck stays in context." : "");
  if (parsed.unresolved.length) {
    out.appendChild(el("h3", {}, "Unresolved lines"));
    const ul = el("ul", {class: "plain"});
    for (const u of parsed.unresolved) {
      const li = el("li", {}, "line " + u.line + ": " + u.text + " (" + u.status + ")");
      for (const c of u.candidates || []) {
        li.appendChild(document.createTextNode(" "));
        li.appendChild(slugButton(c.slug, c.display_name + " · " + c.card_type + " · " + c.color));
      }
      ul.appendChild(li);
    }
    out.appendChild(ul);
  }
  for (const note of parsed.notes || []) out.appendChild(el("p", {class: "muted", style: "font-size:12px"}, note));
  if (data.check && data.check.ok) {
    const c = data.check.result;
    out.appendChild(el("h3", {class: c.legal ? "good" : "err"}, c.legal ? "Legal (construction rules)" : "Not legal"));
    if (c.violations.length) {
      const ul = el("ul", {class: "plain"});
      for (const v of c.violations) ul.appendChild(el("li", {}, v.rule + ": " + v.detail));
      out.appendChild(ul);
    }
  }
  if (data.profile && data.profile.ok) {
    const p = data.profile.result;
    out.appendChild(el("h3", {}, "Profile"));
    const ram = Object.entries(p.ram || {}).map(([colour, r]) => colour + " " + r.usage + "/" + r.budget).join(", ");
    out.appendChild(factsList({
      cards: p.counts.legends + " Legends + " + p.counts.deck + " (" + p.counts.distinct_deck_cards + " distinct)",
      curve: Object.entries(p.cost_curve || {}).map(([cost, n]) => cost + ":" + n).join("  "),
      "average cost": p.average_cost,
      colours: Object.entries(p.colour_split || {}).map(([k, n]) => k + " " + n).join(", "),
      types: Object.entries(p.type_split || {}).map(([k, n]) => k + " " + n).join(", "),
      "RAM used/budget": ram,
      keywords: Object.entries(p.keywords_printed || {}).map(([k, n]) => k + " " + n).join(", "),
    }));
    const legends = el("div", {class: "row"});
    for (const l of p.legends || []) legends.appendChild(slugButton(l.slug, l.display_name));
    out.appendChild(legends);
  }
  showHeldDeck(data.deck);
}

async function loadDeck(args) {
  setBusy(true);
  $("deckStatus").className = "status";
  $("deckStatus").textContent = "Running parse_deck …";
  try {
    const [, data] = await postJson("/api/deck", {session: chatSession, ...args});
    renderDeck(data);
  } catch (err) {
    $("deckStatus").textContent = "Request failed: " + err;
  } finally {
    setBusy(false);
  }
}

async function clearDeck() {
  const [, data] = await postJson("/api/deck/clear", {session: chatSession});
  $("deckResult").textContent = "";
  $("deckStatus").className = "status";
  $("deckStatus").textContent = data.ok ? "Deck cleared: later questions do not include it." : "Could not clear: " + data.error;
  showHeldDeck(null);
}

function fillDeckPick() {
  const select = $("deckPick");
  select.textContent = "";
  select.appendChild(el("option", {value: ""}, "(pick a public deck)"));
  for (const d of state.decks) {
    select.appendChild(el("option", {value: d.id}, (d.name || "(unnamed)") + " · " + (d.colours || []).join("/") + " · " + d.card_count + " cards"));
  }
}

// Tools tab -------------------------------------------------------------------------
async function loadDecks() {
  const response = await fetch("/api/decks");
  if (!response.ok) return;
  state.decks = (await response.json()).decks;
  fillDeckPick();
  if (state.current) pick(state.current.name);
}

function deckPicker() {
  const input = el("select");
  input.appendChild(el("option", {value: ""}, "(no public deck)"));
  for (const d of state.decks) {
    const label = (d.name || "(unnamed)") + " · " + (d.colours || []).join("/") + " · " + d.card_count + " cards";
    input.appendChild(el("option", {value: d.id}, label));
  }
  return input;
}

async function loadTools() {
  const response = await fetch("/api/tools");
  if (!response.ok) { $("status").textContent = "Could not load tools: HTTP " + response.status; return; }
  const data = await response.json();
  state.tools = data.tools;
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
  if (state.tools.some((t) => t.name === wanted)) { showTab("Tools"); pick(wanted); } else pick(state.tools[0].name, true);
}

function pick(name, quiet) {
  const tool = state.tools.find((t) => t.name === name);
  state.current = tool;
  if (!quiet) history.replaceState(null, "", "#" + name);
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
    let wide = false;
    if (field === "deck_id") {
      input = deckPicker();
      wide = true;
    } else if (spec.type === "object") {
      input = el("textarea", {class: "x", spellcheck: "false"});
      input.placeholder = '{"zones": [{"zone_code": "legends", "cards": [{"card_slug": "...", "quantity": 1}]}, ' +
        '{"zone_code": "deck", "cards": []}]}';
      wide = true;
    } else if (spec.type === "string" && (spec.maxLength || 0) >= LONG_TEXT) {
      input = el("textarea", {class: "x", spellcheck: "false"});
      input.placeholder = "Legends\n1 V: Streetkid\n...\nDeck\n3 Kiroshi Optics\n...";
      wide = true;
    } else if (spec.enum) {
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
    if (!input.placeholder) input.placeholder = spec.description || "";
    label.appendChild(input);
    if (wide) label.classList.add("wide");
    if (spec.type === "object" && field === "deck") {
      const use = el("button", {type: "button", class: "small"}, "Insert last parsed deck");
      use.disabled = !state.lastDeck;
      use.addEventListener("click", () => { input.value = JSON.stringify(state.lastDeck, null, 1); });
      label.appendChild(use);
    }
    form.appendChild(label);
  }
  $("runBtn").disabled = false;
  $("status").textContent = "";
}

function collectArgs() {
  const args = {};
  for (const input of $("toolForm").querySelectorAll("input,select,textarea")) {
    const raw = input.value.trim();
    if (raw === "") continue;
    if (input.dataset.type === "object") {
      try { args[input.name] = JSON.parse(raw); } catch (err) { throw new Error(input.name + " is not valid JSON: " + err.message); }
    } else if (input.dataset.type === "integer") {
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
  let args;
  try { args = collectArgs(); } catch (err) { $("status").textContent = err.message; return; }
  $("runBtn").disabled = true;
  $("status").textContent = "Running " + tool.name + " …";
  try {
    const response = await fetch("/api/tools/" + encodeURIComponent(tool.name), {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(args)});
    const data = await response.json();
    $("output").className = data.ok ? "" : "err";
    $("output").textContent = JSON.stringify(data, null, 2);
    showToolTiles(tool.name, data);
    if (data.ok) {
      const s = data.sources || {};
      const bits = [];
      if (s.card_slugs && s.card_slugs.length) bits.push(s.card_slugs.length + " card(s)");
      if (s.rule_ids && s.rule_ids.length) bits.push(s.rule_ids.length + " rule(s)");
      if (s.errata_ids && s.errata_ids.length) bits.push(s.errata_ids.length + " erratum/errata");
      if (s.deck_ids && s.deck_ids.length) bits.push(s.deck_ids.length + " public deck(s)");
      if (data.result && typeof data.result.method === "string" && data.result.method.length < 40) bits.push("method " + data.result.method);
      if (data.result && data.result.deck) {
        state.lastDeck = data.result.deck;
        bits.push("deck kept for 'Insert last parsed deck'");
      }
      if (data.result && data.result.resolved === false) bits.push(data.result.unresolved.length + " line(s) unresolved");
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

// The cards a tool result names, as tiles above its JSON: one expanded tile for get_card, else compact.
function showToolTiles(name, data) {
  const box = $("toolTiles");
  box.textContent = "";
  const slugs = (data.ok && data.sources && data.sources.card_slugs) || [];
  box.hidden = !slugs.length;
  if (!slugs.length) return;
  if (name === "get_card" && slugs.length === 1) {
    fetchTiles(slugs).then(([card]) => { if (card) box.appendChild(cardTile(card, true)); }).catch(() => {});
    return;
  }
  const row = el("div", {class: "srccards"});
  for (const slug of slugs.slice(0, TILE_BATCH)) row.appendChild(tileButton(slug));
  box.appendChild(row);
  if (slugs.length > TILE_BATCH) box.appendChild(el("div", {class: "muted", style: "font-size:12px"}, "and " + (slugs.length - TILE_BATCH) + " more in the JSON below"));
}

// Eval tab --------------------------------------------------------------------------
const evalState = {loaded: false, config: null, set: null, job: null, jobLines: 0, timer: null};

async function getJson(url) {
  const response = await fetch(url);
  let data;
  try { data = await response.json(); } catch (err) { data = {ok: false, error: "HTTP " + response.status}; }
  return [response, data];
}

async function loadEval() {
  const [, config] = await getJson("/api/eval/config");
  evalState.config = config;
  evalState.loaded = true;
  const pick = $("evalSetPick");
  pick.textContent = "";
  for (const s of config.sets || []) pick.appendChild(el("option", {value: s.name}, s.name + " · " + s.items + " items, " + s.scored + " keyed"));
  $("evalModel").textContent = config.model ? "Model: " + config.model + (config.adapter ? " + " + config.adapter : "") :
    "No model configured: restart with --model to run an eval. Sets and runs still show.";
  $("evalRunBtn").disabled = !config.model;
  $("evalMaxTokens").value = config.maxTokens ?? "";
  $("evalMaxTokens").placeholder = "default: 2048 thinking, 1024 not";
  $("evalMaxTokens").max = String(config.maxTokensLimit || 16384);
  $("evalMaxToolCalls").value = "";
  $("evalMaxToolCalls").placeholder = "default: " + (config.maxToolCalls ?? 6);
  $("evalMaxToolCalls").max = String(config.maxToolCallsLimit || 16);
  $("evalThinking").checked = !!config.thinkingDefault;
  $("evalPreload").checked = config.preloadDefault !== false;
  if (config.active) watchJob(config.active);
  if ((config.sets || []).length) await loadSet(pick.value); else $("evalSetStatus").textContent = "No multiple-choice sets in data/gold.";
  await loadRuns();
  await loadRetr();
}

async function loadSet(name) {
  $("evalSetStatus").textContent = "Loading " + name + " …";
  const [, data] = await getJson("/api/eval/sets/" + encodeURIComponent(name));
  const body = $("evalSetBody");
  body.textContent = "";
  if (data.ok === false) { $("evalSetStatus").textContent = "Refused: " + data.error; return; }
  evalState.set = data;
  const keyed = data.items.filter((i) => i.correct !== null && i.correct !== undefined).length;
  $("evalSetStatus").textContent = data.items.length + " questions, " + keyed + " keyed · sha256 " + data.sha256.slice(0, 12) + "…";
  for (const item of data.items) {
    const box = el("div", {class: "qitem"});
    box.appendChild(el("div", {class: "muted", style: "font-size:12px"}, item.id + " · key " + (item.correct || "none (unscored)") +
      (item.answer_key_by ? " · keyed by " + item.answer_key_by : "") + (item.source ? " · " + item.source : "")));
    box.appendChild(el("div", {class: "qtext"}, item.question));
    const linked = linkedCardsText(item);
    if (linked && item.cards.length) {
      // Compact tiles; the text line stays for screen readers and as the fallback.
      const line = el("div", {class: "linked"});
      line.appendChild(el("div", {class: "muted", style: "font-size:12px"}, linked));
      const tiles = el("div", {class: "srccards"});
      for (const slug of item.cards) tiles.appendChild(tileButton(slug));
      line.appendChild(tiles);
      box.appendChild(line);
    } else if (linked) box.appendChild(el("div", {class: "muted linked", style: "font-size:12px"}, linked));
    const ul = el("ul", {class: "choices"});
    for (const c of item.choices) {
      const cls = c.letter === item.correct ? "key" : (item.known_incorrect || []).includes(c.letter) ? "known" : "";
      ul.appendChild(el("li", cls ? {class: cls} : {}, c.letter + ". " + c.text));
    }
    box.appendChild(ul);
    const note = el("textarea", {placeholder: "Review note (saved to eval/notes, not to the set)"});
    note.value = (data.notes || {})[item.id] || "";
    const row = el("div", {class: "row"});
    const save = el("button", {type: "button", class: "small"}, "Save note");
    const status = el("span", {class: "muted", style: "font-size:12px"});
    save.addEventListener("click", () => saveNote(data.name, item.id, note, status));
    row.appendChild(save);
    row.appendChild(status);
    box.appendChild(note);
    box.appendChild(row);
    body.appendChild(box);
  }
}

async function saveNote(setName, id, textarea, status) {
  status.textContent = "Saving …";
  try {
    const [, data] = await postJson("/api/eval/notes", {set: setName, id, note: textarea.value});
    status.textContent = data.ok ? "Saved to " + data.notesFile : "Refused: " + data.error;
  } catch (err) {
    status.textContent = "Request failed: " + err;
  }
}

async function startEval() {
  const config = evalState.config;
  if (!config) return;
  const set = (config.sets || []).find((s) => s.name === $("evalSetPick").value);
  const values = {set: set ? set.path : "", name: $("evalName").value.trim(), thinking: $("evalThinking").checked,
    preload: $("evalPreload").checked, force: $("evalForce").checked, resume: $("evalResume").checked,
    ids: $("evalIds").value.trim()};
  const rawMax = $("evalMaxTokens").value.trim(), rawCalls = $("evalMaxToolCalls").value.trim();
  const maxTokens = rawMax === "" ? null : Number(rawMax), limit = Number($("evalLimit").value || 0);
  const maxToolCalls = rawCalls === "" ? null : Number(rawCalls);
  const optional = {sample: $("evalSample").value.trim(), seed: $("evalSeed").value.trim(), pass_mark: $("evalPassMark").value.trim()};
  if ((maxTokens !== null && !Number.isInteger(maxTokens)) || (maxToolCalls !== null && !Number.isInteger(maxToolCalls)) ||
      !Number.isInteger(limit) || Object.values(optional).some((raw) => raw !== "" && !Number.isInteger(Number(raw)))) {
    $("evalRunStatus").textContent = "Max tokens, max tool calls, First N, sample, seed and pass mark must be whole numbers."; return;
  }
  if (maxTokens !== null) values.max_tokens = maxTokens;
  if (maxToolCalls !== null) values.max_tool_calls = maxToolCalls;
  for (const [key, raw] of Object.entries(optional)) if (raw !== "") values[key] = Number(raw);
  values.limit = limit;
  $("evalRunBtn").disabled = true;
  $("evalRunStatus").textContent = "Starting …";
  try {
    const [response, data] = await postJson("/api/run/" + encodeURIComponent(config.actionId), {values});
    if (!data.ok) {
      $("evalRunStatus").textContent = "Refused (" + response.status + "): " + data.error;
      $("evalRunBtn").disabled = false;
      return;
    }
    watchJob(data.job);
  } catch (err) {
    $("evalRunStatus").textContent = "Request failed: " + err;
    $("evalRunBtn").disabled = false;
  }
}

function watchJob(id) {
  evalState.job = id;
  evalState.jobLines = 0;
  $("evalLog").textContent = "";
  $("evalLog").hidden = false;
  $("evalRunBtn").disabled = true;
  clearInterval(evalState.timer);
  evalState.timer = setInterval(() => pollJob().catch(() => {}), 1500);
  pollJob().catch(() => {});
}

async function pollJob() {
  const [response, job] = await getJson("/api/job/" + encodeURIComponent(evalState.job) + "?since=" + evalState.jobLines);
  if (!response.ok) return;
  const log = $("evalLog");
  if (job.lines.length) log.textContent += job.lines.join("\n") + "\n";
  evalState.allLines = (evalState.allLines || []).concat(job.lines);
  evalState.jobLines = job.total_lines;
  log.scrollTop = log.scrollHeight;
  const p = jobProgress(evalState.allLines);
  $("evalRunStatus").textContent = job.status + (p.total ? " · " + p.done + "/" + p.total + " questions" : "") + " · " + job.cmd;
  if (job.status !== "running") {
    clearInterval(evalState.timer);
    evalState.allLines = [];
    $("evalRunBtn").disabled = !(evalState.config && evalState.config.model);
    loadRuns().catch(() => {});
  }
}

async function loadRuns() {
  const [, data] = await getJson("/api/eval/runs");
  const box = $("evalRuns");
  box.textContent = "";
  box.className = "";
  if (!data.runs || !data.runs.length) { box.className = "muted"; box.textContent = "No runs in " + data.dir + " yet."; return; }
  const table = el("table", {class: "runs"});
  const head = el("tr");
  for (const h of ["run", "model", "thinking", "preload", "prompt", "score"]) head.appendChild(el("th", {}, h));
  table.appendChild(head);
  for (const run of data.runs) {
    const tr = el("tr", {class: "pick"});
    tr.appendChild(el("td", {}, run.name + (run.incomplete ? " (incomplete)" : "")));
    if (run.error) { tr.appendChild(el("td", {colspan: "5", class: "err"}, run.error)); table.appendChild(tr); continue; }
    tr.appendChild(el("td", {}, (run.model || "") + (run.adapter ? " + " + run.adapter : "")));
    tr.appendChild(el("td", {}, run.thinking ? "on" : "off"));
    tr.appendChild(el("td", {}, run.preload ? "on" : "off"));
    tr.appendChild(el("td", {}, (run.eval_prompt_version || "") + " / " + (run.assistant_prompt_version || "")));
    const sampled = run.sample !== undefined ? "sample " + run.sample + " · seed " + run.seed + " · " : "";
    const verdict = run.passed !== undefined ? " · " + passText(run.summary, run.pass_mark) : "";
    tr.appendChild(el("td", {}, (run.incomplete ? "incomplete: " + ((run.summary || {}).items || 0) + " question(s) so far; " +
      "run it again with resume to finish · " : "") + sampled + scoreText(run.summary) + verdict));
    tr.addEventListener("click", () => showRun(run.name).catch((err) => { $("evalRunBody").textContent = "Could not load: " + err; }));
    table.appendChild(tr);
  }
  box.appendChild(table);
}

async function showRun(name) {
  const body = $("evalRunBody");
  body.textContent = "Loading " + name + " …";
  const [, data] = await getJson("/api/eval/runs/" + encodeURIComponent(name));
  body.textContent = "";
  if (data.ok === false) { body.className = "err"; body.textContent = data.error; return; }
  body.className = "";
  const run = splitRun(data.rows);
  const questions = {};
  if (evalState.set && run.header && run.header.set && run.header.set.endsWith("/" + evalState.set.name))
    for (const item of evalState.set.items) questions[item.id] = item.question;
  const verdict = run.summary && run.summary.pass_mark !== undefined ? " · " + passText(run.summary, run.summary.pass_mark) : "";
  body.appendChild(el("h3", {}, name + ": " + (run.summary ? scoreText(run.summary) + verdict :
    "incomplete, " + run.items.length + " question(s) so far (resume it to finish)")));
  if (run.header) body.appendChild(factsList({set: run.header.set, "set sha256": run.header.set_sha256, model: run.header.model,
    adapter: run.header.adapter, thinking: String(run.header.thinking), "max tokens": run.header.max_tokens,
    "max tool calls": run.header.max_tool_calls,
    ...(run.header.sample !== undefined ? {sample: run.header.sample + " keyed question(s), seed " + run.header.seed} : {}),
    ...(run.header.pass_mark !== undefined ? {"pass mark": run.header.pass_mark} : {}),
    "system prompt": run.header.system_prompt_sha256 ? "not the default (sha256 " + run.header.system_prompt_sha256 + ")" : "default",
    preload: run.header.preload ? "on (k " + run.header.preload_k + ", " + run.header.preload_chars + " chars)" : "off",
    "tool specs sha256": run.header.tool_specs_sha256,
    prompts: run.header.eval_prompt_version + " / " + run.header.assistant_prompt_version, snapshot: run.header.rules_version}));
  for (const item of run.items) {
    const d = el("details", {class: "step" + (item.outcome === "wrong" || item.outcome === "unanswered" ? " bad" : "")});
    const sum = el("summary");
    sum.appendChild(el("span", {class: "oc-" + item.outcome}, item.outcome));
    sum.appendChild(document.createTextNode(" · " + item.id + " · chose " + (item.chosen || "-") + ", key " + (item.correct || "-") +
      (item.known_incorrect_hit ? " · picked a known-incorrect option" : "") + " · tools: " + ((item.tools_called || []).join(", ") || "none") +
      ((item.auto_tools || []).length ? " · auto: " + item.auto_tools.join(", ") : "") +
      (item.hit_tool_cap ? " · hit tool cap" : "") + (item.hit_length ? " · hit token limit" : "")));
    d.appendChild(sum);
    if (questions[item.id]) d.appendChild(el("div", {class: "qtext"}, questions[item.id]));
    d.appendChild(factsList({rules: item.rule_ids, cards: item.card_slugs, errata: item.errata_ids, parse: item.parse, stop: item.stop_reason}));
    d.appendChild(el("pre", {}, item.answer || ""));
    const trace = el("details", {class: "trace"});
    trace.appendChild(el("summary", {}, "Trace: " + (item.trace || []).length + " step(s)"));
    for (const step of item.trace || []) trace.appendChild(traceRow(step));
    d.appendChild(trace);
    body.appendChild(d);
  }
}

// Retrieval panel -------------------------------------------------------------------
const retrState = {data: null, job: null, lines: 0, timer: null};

async function loadRetr() {
  const [, data] = await getJson("/api/eval/retrieval");
  retrState.data = data;
  const idx = data.index || {};
  $("retrIndex").textContent = "Rules index " + idx.path + ": " + (idx.usable ? "in use (" + idx.model_id + ", " +
    idx.documents + " documents), search_rules runs hybrid" : "not in use, search_rules runs lexical: " + (idx.reason || "")) + ".";
  if (data.active && !retrState.job) watchRetrJob(data.active);
  const box = $("retrReports");
  box.textContent = "";
  box.className = "";
  if (!data.reports || !data.reports.length) { box.className = "muted"; box.textContent = "No retrieval reports in " + data.dir + " yet."; return; }
  const table = el("table", {class: "runs"});
  const head = el("tr");
  for (const h of ["report", "method", "R@1", "R@5", "R@10", "chars@10"]) head.appendChild(el("th", {}, h));
  table.appendChild(head);
  for (const report of data.reports) {
    if (report.error) {
      const tr = el("tr");
      tr.appendChild(el("td", {}, report.name));
      tr.appendChild(el("td", {colspan: "5", class: "err"}, report.error));
      table.appendChild(tr);
      continue;
    }
    for (const row of retrievalRows(report)) {
      const tr = el("tr", {class: "pick"});
      tr.appendChild(el("td", {}, report.name));
      tr.appendChild(el("td", {}, row.method));
      if (row.cells.length === 1) tr.appendChild(el("td", {colspan: "4", class: "muted"}, row.cells[0]));
      else for (const cell of row.cells) tr.appendChild(el("td", {}, cell));
      tr.addEventListener("click", () => showRetrReport(report.name, row.method).catch((err) => { $("retrReportBody").textContent = "Could not load: " + err; }));
      table.appendChild(tr);
    }
  }
  box.appendChild(table);
}

async function showRetrReport(name, method) {
  const body = $("retrReportBody");
  body.textContent = "Loading " + name + " …";
  const [, data] = await getJson("/api/eval/retrieval/" + encodeURIComponent(name));
  body.textContent = "";
  if (data.ok === false) { body.className = "err"; body.textContent = data.error; return; }
  body.className = "";
  const report = data.report, m = (report.methods || {})[method];
  body.appendChild(el("h3", {}, name + " · " + method));
  body.appendChild(factsList({"expected set": report.expected_set + " (" + (report.expected_status || []).join(", ") + ")",
    questions: report.questions, query: report.query_form, snapshot: report.rules_version, scored: report.scored,
    skipped: (report.skipped || []).map((s) => s.id).join(", "), "hit rule": report.match_rule}));
  if (!m || !m.available) { body.appendChild(el("div", {class: "muted"}, "Not measured: " + ((m && m.reason) || "no such method"))); return; }
  const table = el("table", {class: "runs"});
  const head = el("tr");
  for (const h of ["question", "expected", "first hit", "top 3"]) head.appendChild(el("th", {}, h));
  table.appendChild(head);
  for (const item of m.items || []) {
    const tr = el("tr");
    tr.appendChild(el("td", {}, item.id));
    tr.appendChild(el("td", {}, (item.expected || []).join(", ")));
    tr.appendChild(el("td", {class: item.first_hit_rank ? "" : "err"}, item.first_hit_rank ? "#" + item.first_hit_rank : "none in top 10"));
    tr.appendChild(el("td", {}, (item.top || []).slice(0, 3).map((t) => t.rule_ids.length ? t.rule_ids.slice(0, 3).join("/") : t.chunk_id).join(" · ")));
    table.appendChild(tr);
  }
  body.appendChild(table);
}

async function startRetrJob(actionId, values) {
  $("retrStatus").textContent = "Starting …";
  try {
    const [response, data] = await postJson("/api/run/" + encodeURIComponent(actionId), {values});
    if (!data.ok) { $("retrStatus").textContent = "Refused (" + response.status + "): " + data.error; return; }
    watchRetrJob(data.job);
  } catch (err) {
    $("retrStatus").textContent = "Request failed: " + err;
  }
}

function watchRetrJob(id) {
  retrState.job = id;
  retrState.lines = 0;
  $("retrLog").textContent = "";
  $("retrLog").hidden = false;
  clearInterval(retrState.timer);
  retrState.timer = setInterval(() => pollRetrJob().catch(() => {}), 1500);
  pollRetrJob().catch(() => {});
}

async function pollRetrJob() {
  const [response, job] = await getJson("/api/job/" + encodeURIComponent(retrState.job) + "?since=" + retrState.lines);
  if (!response.ok) return;
  if (job.lines.length) $("retrLog").textContent += job.lines.join("\n") + "\n";
  retrState.lines = job.total_lines;
  $("retrStatus").textContent = job.status + " · " + job.cmd;
  if (job.status !== "running") {
    clearInterval(retrState.timer);
    retrState.job = null;
    loadRetr().catch(() => {});
  }
}

// Wiring ----------------------------------------------------------------------------
// Example chips only fill the input box; the question goes through the same path as any other.
for (const chip of document.querySelectorAll("#chips button")) {
  chip.addEventListener("click", () => { $("chatInput").value = chip.dataset.example; $("chatInput").focus(); });
}
$("chatSend").addEventListener("click", sendChat);
// A citation link in an answer opens its card tile or rule in the side panel.
$("chatLog").addEventListener("click", (e) => {
  const cite = e.target.closest ? e.target.closest("button.cite") : null;
  if (!cite) return;
  if (cite.dataset.card) showCard(cite.dataset.card).catch((err) => { $("sideBody").textContent = "Could not load: " + err; });
  else if (cite.dataset.rule) showSource("get_rule", {rule_id: cite.dataset.rule}, "rule " + cite.dataset.rule);
});
$("chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(); }
});
$("chatNew").addEventListener("click", () => newChat().catch((err) => { $("chatStatus").textContent = "Request failed: " + err; }));
$("deckLoadText").addEventListener("click", () => {
  const text = $("deckText").value.trim();
  if (text) loadDeck({text}); else $("deckStatus").textContent = "Paste a deck list first.";
});
$("deckLoadPick").addEventListener("click", () => {
  const id = $("deckPick").value;
  if (id) loadDeck({deck_id: id}); else $("deckStatus").textContent = "Pick a public deck first.";
});
$("deckClear").addEventListener("click", () => clearDeck().catch((err) => { $("deckStatus").textContent = "Request failed: " + err; }));
$("runBtn").addEventListener("click", run);
$("toolForm").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") { e.preventDefault(); run(); }
});
$("evalSetPick").addEventListener("change", () => loadSet($("evalSetPick").value).catch((err) => { $("evalSetStatus").textContent = "Could not load: " + err; }));
$("evalRunBtn").addEventListener("click", startEval);
$("evalRunsRefresh").addEventListener("click", () => loadRuns().catch((err) => { $("evalRuns").textContent = "Could not load: " + err; }));
$("retrRefresh").addEventListener("click", () => loadRetr().catch((err) => { $("retrReports").textContent = "Could not load: " + err; }));
$("retrBuildBtn").addEventListener("click", () => startRetrJob(retrState.data ? retrState.data.buildActionId : "build-rules-index", {}));
$("retrMeasureBtn").addEventListener("click", () => startRetrJob(retrState.data ? retrState.data.measureActionId : "eval-retrieval",
  {name: $("retrName").value.trim(), force: $("retrForce").checked}));
showHeldDeck(null);
loadStatus().catch(() => { $("modelBadge").textContent = "status unavailable"; });
loadTools().then(loadDecks).catch((err) => { $("status").textContent = "Could not load tools: " + err; });
// Theme ---------------------------------------------------------------------------------
// Dark by default; light on request. With no stored choice the page follows the system
// setting. The choice is a per-browser convenience, so storage failures are ignored.
const THEME_KEY = "cyberpunk-assistant-theme";
function systemTheme() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function currentTheme() {
  const set = document.documentElement.getAttribute("data-theme");
  return set === "light" || set === "dark" ? set : systemTheme();
}
function showThemeToggle() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  const button = $("themeToggle");
  button.textContent = next === "light" ? "Light" : "Dark";
  button.setAttribute("aria-label", "Switch to the " + next + " theme");
}
(function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch (err) { stored = null; }
  if (stored === "light" || stored === "dark") document.documentElement.setAttribute("data-theme", stored);
  showThemeToggle();
  if (window.matchMedia) {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    if (query.addEventListener) query.addEventListener("change", showThemeToggle);
  }
})();
$("themeToggle").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* private window or blocked storage */ }
  showThemeToggle();
});
