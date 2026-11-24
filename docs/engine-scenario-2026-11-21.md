# Engine scenario op (`composeScenario`), 2026-11-21

Plan section 7 (`/mnt/project-files/plan/sections/7-engine-scenario.md`), PR 1. Cody approved the
plan on 2026-11-21. The assistant's `engine_scenario` tool needs one exact position to ask the
engine about. Until now the worker could only start a game from a seed (`createGame`) or accept a
complete trusted state. Tests built exact positions by hand, with `TurnMutation`,
`moveCardLocation` and `validateState`.

## What it does

`composeScenario(scenario, context)` lives in `packages/engine/src/scenario.ts` and is exposed as
the wire op `composeScenario`. It builds one position at the active seat's MAIN step from a public
description. On success it returns the existing `{kind: "state", state}` value, so
`listLegalActions`, `applyAction`, `observe` and `modelInput` work on the result unchanged. In
Python, `EngineWorker.compose_scenario(content=..., scenario=...)` returns the state.
`EngineProtocolError.errors` now keeps the engine's `{code, message, path}` entries.

```text
scenario = {
  seed, turn? (default 3), activeSeat: 0 | 1,
  players: [seat0, seat1], each {
    field:   [{card, readiness: READY | SPENT, gear?: [slug]}],
    legends: [{card, face: UP | DOWN, readiness, gear?: [slug]}],   // exactly 3
    hand: [slug], trash: [slug], deck: [slug],                      // deck = its top, in order
    gigs: [{die: D4 | D6 | D8 | D10 | D12, value}],                 // others stay in the Fixer
    eddies: {ready, spent}
  }
}
```

- **Nothing is authored.** Every card must be in the content bundle with the right type. Every card
  then passes `admitDeckCards`, the same admission `createGame` runs on each deck card.
  `admitDeckCards` was moved out of `createGameWithEvents` and is otherwise unchanged. The finished
  state passes `validateState`.
- **The composition is a legal CONSTRUCTED deck**, because `validateState` requires this of every
  non-Demo state. That means exactly 3 unique Legends whose RAM covers every owned card, at most 3
  copies of a slug across all zones, and 40 to 50 main cards. Below the described top of the deck,
  the engine completes the deck to the 40-card minimum. It takes vanilla cards before cards with
  abilities, then sorts by slug, within the copy and RAM limits. Eddies are face-down sold cards
  worth their base Eddie value, so each one is a sellable 1-value card chosen the same way. All of
  this is deterministic. The seed only drives later randomness: Gig rolls, d20s and shuffles.
- **Slots follow the description.** `legends[i]` is LEGENDS slot i and `field[i]` is field slot i.
  Attached Gear shares its host's zone (4.12) and follows all hosts. Only a face-up Legend hosts
  Gear in the Legends area.
- **It starts clean.** The turn history is empty: no plays, sells, Calls, steals or first-time
  facts. There is no pending trigger, choice or combat, and no Lag, damage or counters.
  `emptyFixerStarts` is 0, since the d20 is never rolled. The first player follows the turn's
  parity, so odd turns belong to the active seat. Players and the match have fixed ids
  (`SCENARIO_PLAYERS`, `SCENARIO_MATCH_ID`), so a description alone determines the state, its hashes
  and its action ids. "This turn" facts are reached by applying engine-offered actions, never by
  writing history.

## Refusals

| Code | When | Path |
| --- | --- | --- |
| `INVALID_SCENARIO` | the description does not match the schema | the offending field |
| `UNKNOWN_CARD` | a slug is not in the bundle | the entry |
| `WRONG_CARD_TYPE` | e.g. a non-Unit in `field`, a non-Gear in `gear`, a Legend in hand | the entry |
| `INVALID_GIG` | a repeated die, or a value above its faces | the Gig |
| `ILLEGAL_GEAR_HOST` | Gear on a face-down Legend, or any host `validateState` rejects | the Gear list |
| `INVALID_DECK` | Legend count or uniqueness, copies, RAM, size, or too few 1-value cards for the Eddies | `players[i]` |
| `UNADMITTED_CARD` | a card fails `admitDeckCards` (the inner code is in the message) | none |

Any other `validateState` code passes through unchanged, and so does the worker's
`ENGINE_ARTIFACT_MISMATCH`.

## Tests

- `tests/engine-scenario.test.ts`, on the reviewed union content, checks:
  - placement, hosts before Gear, faces and readiness, Gigs and Eddies;
  - the full composition is a legal deck;
  - determinism, and that the seed moves only the RNG;
  - offered actions: the ready Unit may attack, the spent Unit may not, and a face-down Legend may
    be Called;
  - `END_TURN` applies;
  - every refusal and its path, `UNADMITTED_CARD` on a forged unsupported revision, and the wire op.
- `scripts/test_engine_adapter.py` composes a scenario through the real worker, lists its actions
  and checks a structured refusal.

The op moves the engine identity, so it ships in bundle 9 with its regeneration.
