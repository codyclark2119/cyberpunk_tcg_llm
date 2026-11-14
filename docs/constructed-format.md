# Constructed games on the reviewed cards (2026-11-14)

Plan section 6 ("Expand the engine to every current card"), scope 2. A dated record.

## Finding: the engine already plays CONSTRUCTED

Scope 2 was planned as an engine change: a full-card constructed format, with the
"exactly 29 Demo pins" assumptions lifted. Probing the engine showed that change is not
needed. Under the reviewed turn-slice ruleset (`demoStarterContext()`):

- `createGameWithEvents` already accepts `format: "CONSTRUCTED"` and checks each deck with
  `validateDeck` (40-50 main cards, exactly 3 Legends with unique names, at most 3 copies,
  RAM from the Legends; rules 7.3-7.3.4, TR 2.1.3).
- `validateDemoState` applies its Demo checks (the 29 reference revisions, the fixed
  manifest pair, the literal d20 rolls) only when `match.format` is `DEMO_STARTER_V1`; a
  CONSTRUCTED state is held to the deck rules instead.
- Engine setup picks the deciding seat with one seeded two-way draw instead of Demo's
  opposed d20. Rule 7.5.1 lets players agree on any random method (the d20 is only a
  tip), so this is rules-compliant.
- Every card in a CONSTRUCTED game must still have a reviewed `SUPPORTED` revision; the
  per-card admission gates in `initialization.ts` are unchanged.

So this scope changes no engine source and does not move the engine identity; no replay
or baseline needed regenerating.

## What was added

- `tests/fixtures/constructed-reference-decks.v1.json`: two legal 40-card decks built
  only from the 29 reviewed revisions (Legends Jackie Welles + Yorinobu Arasaka + Saburo
  Arasaka, and Viktor Vektor + V: Corporate Exile + Goro Takemura: Hands Unclean). They
  are test fixtures, filled in catalog order up to the deck rules, not strategy decks.
  12 of the 20 possible three-Legend sets from the reviewed Legends admit a legal
  40-card deck from the reviewed pool; a single Demo faction cannot (Arasaka has 11
  distinct main cards, at most 33 copies).
- `tests/constructed-format-fixture.ts`: deck-file schema (`{"decks": [two {legends, main}]}`,
  `main` as slugs or `{cardId, quantity}`), `constructedContext()` and `constructedInput()`.
- `scripts/local-match-setup.ts --decks <file>`: prints a CONSTRUCTED setup for two decks.
  With no flags its output is byte-identical to before (the Demo setup).
- `games/cyberpunk/local_match.load_setup_file` accepts a deck file as well as a
  content-and-initialization file, so `run_local_matches.py`, `eval_local_strength.py`,
  `audit_match_records.py` and the play UI's Play, Bot vs bot and Audit tabs all take a deck
  file in their setup field.
- Tests: `tests/constructed-format.test.ts` (8: deck legality, initialization, three seeds
  played to an outcome choosing the first and the last offered action, determinism, deck
  rule failures, a constructed deck refused as Demo) and one test in
  `scripts/test_local_match.py` (20 tests): a baseline game from the deck file to an engine
  outcome.

## Limits

- Only the 29 reviewed cards can appear; public decks from `data/raw/decks/` need cards
  admitted in later scopes. No sideboard (TR 3.4.4) and no legality list (TR B) are
  modelled; every card in the snapshot is marked legal.
- The ruleset is the reviewed Demo turn-slice ruleset (`beta` / `demo-overtime-1`); a
  CONSTRUCTED game records no `match.format`.
