# Tournament Rules snapshot (2026-11-13)

Dated record. It describes the corpus and the assistant as of 2026-11-13; for present
behaviour read the code and tests.

## Why

The chat assistant answered from one rules document, the Comprehensive Rules, which
say how the game is played and nothing about how an event is run. Eight of the 40
questions in Cody's quiz (`data/gold/quiz_mc_2026-11-12.jsonl`: 02, 07, 16, 18, 20,
21, 27, 38) turn wholly or partly on event policy: decklist contents, match length,
dice checks, card languages, Pre-Release kits, the constructed copy limit, card
legality and gameplay rewinds. Prompt `assistant-chat-v3` told the model that policy
was "not in the snapshot". The official answer is a second document, which this
change adds as its own, separately versioned source.

## Source

| | |
| --- | --- |
| Page | https://cyberpunktcg.com/tournament-rules (named by Cody on 2026-11-13; a client-rendered SPA) |
| API endpoint | `https://api.netdeck.gg/api/cyberpunk/tournament-rules` |
| Shape | the same as the comprehensive rules: `{game, updated_at, items: [...]}`, flat typed nodes with parent links |
| `updated_at` | `2026-10-28T19:55:57.636Z` |
| Fetched | 2026-11-13, by `scripts/fetch_tournament_rules.py` |
| Nodes | 87: 52 `rule`, 35 `section` (about 98k characters of body text) |
| Raw file | `data/raw/tournament_rules.json` |
| Ingested | `data/processed/tournament_rules.jsonl`, 87 rows (`scripts/ingest.py`) |
| Version constant | `TOURNAMENT_RULES_VERSION = "2026-10-28"` in `games/cyberpunk/prompts.py` |

Use of the netdeck.gg API is in line with the comprehensive rules and card fetches;
the cease-and-desist concerned only the simulator site.

## Id scheme

Display numbers collide with the comprehensive rules (23 of them, such as `1.3`, `2.2`
and `3.4.1`, exist in both) and use appendix letters (`A.1.2`, `C.2.2`, `E.2.2`). Every
ingested id is therefore prefixed `TR `:

- numbered nodes: `TR 3.4.2`, `TR A.1.2`, `TR B` (the ban list is a section with a body);
- the one unnumbered node, the document's introduction: `TR rule-<uuid>`;
- parents and refs carry the same prefix; refs come only from in-document anchor links
  (a `{7.6}` number reference could mean either document; none occur in this snapshot);
- each row carries `"doc": "tournament"`; `rules.jsonl` rows are unchanged and carry
  no `doc` field.

`get_rule` takes `TR ...` ids; a bare number is always the comprehensive rule (`3.4.2`
exists only in the Tournament Rules, so `get_rule("3.4.2")` is `not_found`, nearest
`3.4`). `search_rules` searches both documents plus errata unless its new optional
`doc` argument (`comprehensive`, which keeps errata, or `tournament`) names one; each
passage carries `doc`. Keyword glossary lookups (`term_rules`, `card_interactions`)
still read only the comprehensive rules.

In the rule-level index a Tournament Rules row's heading path starts with "Tournament
Rules", and a section with a body counts as content rather than a heading. The
document fingerprint therefore changed: an existing `corpus_index.npz` is reported
stale and `search_rules` falls back to lexical until the index is rebuilt on the Mac
(`python scripts/build_rules_index.py`, which embeds both documents; not yet run).

## What was and was not refreshed

- **Refreshed:** nothing. This adds a document; it does not refresh one.
- **Not refreshed: the Comprehensive Rules.** On 2026-11-13 their endpoint reported
  `updated_at` 2026-10-29 with 733 items, newer than the committed 2026-09-01 snapshot
  (713 rows). `RULES_VERSION` stays `2026-09-01`; refreshing it is a separate change
  nobody has asked for yet.
- Cards, errata, decks, `rules.jsonl`, `rule_sections.jsonl` and the legacy chunk
  corpus are untouched (`ingest.py` rewrites `rules.jsonl` byte for byte).

## Assistant changes

- Prompt `assistant-chat-v4`: tournament procedure, penalties, deck registration and
  event policy are answered from the Tournament Rules and cited (`TR 3.4.2`); anything
  in neither document is "not covered". The prompt states both snapshot dates.
- Every tool result, the scorer header (`scripts/eval_assistant.py`), the retrieval
  report and the page's snapshot badge carry `tournament_rules_version` beside
  `rules_version`.
- Prompt overhead (`scripts/prompt_budget.py`, characters): 9,253 before (8,138 specs
  + 1,115 prompt), 9,619 after (8,389 + 1,230).

## Retrieval measurement (Linux, no embedding index, `lexical-bm25-rules`)

`eval/sets/quiz_mc_expected_rules_draft.jsonl` (still an unreviewed Claude draft) now
lists Tournament Rules ids for the eight policy questions; 18 and 21 keep their
comprehensive ids beside the new ones. 36 questions are scored, 4 card-only ones are
skipped.

| question set | R@1 | R@5 | R@10 | chars@10 |
| --- | --- | --- | --- | --- |
| the 30 previously scored, their old expected ids, before | 0.533 | 0.767 | 0.767 | 1,475 |
| the same 30 and ids, after | 0.467 | 0.767 | 0.800 | 2,689 |
| the same 30, 18 and 21 also crediting their TR ids, after | 0.500 | 0.767 | 0.800 | 2,689 |
| the 8 policy questions, TR ids only, before | 0 | 0 | 0 | (no such rows) |
| the 8 policy questions, TR ids only, after | 0.750 | 0.875 | 1.000 | 7,698 |
| all 36 scored, after | 0.556 | 0.778 | 0.833 | 3,670 |

On the old 30 the two rank-1 losses are 18 and 21, where a Tournament Rules row (TR
2.4.4, TR 1.3.1) now ranks first; quiz 04 moves from no hit in the top 10 to rank 9.
Text in the top 10 grows because some Tournament Rules rows are long (TR A.2.2, the
infraction list, is about 15k characters). `data/gold/` and `eval/runs/` did not
change.
