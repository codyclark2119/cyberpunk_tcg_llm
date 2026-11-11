# Compact local gameplay prompt (local-choice-v3)

2026-11-11. Scope: `games/cyberpunk/sim_prompt.py` (`PROMPT_VERSION` moves from
`local-choice-v2` to `local-choice-v3`), `scripts/measure_prompt_size.py` (new),
`scripts/test_local_prompt.py` (new suite, pinned as `py-local-prompt` in
`scripts/run_tests.sh`), `scripts/test_sim_mlx.py`. No engine, data or model
change. The output contract is unchanged: `{"choice": i}` selects the i-th
offered action, mapped to its `actionId` by `sim_mlx.MLXPolicy`.

## Why

On the first Mac run (M3 Max, Qwen3-8B-4bit) a decision's answer is about 6
tokens, so decision time is almost all prompt prefill: prompts of 935–1,718
tokens took 1.3–2.4 s, and prompts of 1,950–3,364 tokens took 2.6–5.1 s.
Late-game v2 prompts reached about 10,000 characters. The 10 s default budget
([local-time-budget.md](local-time-budget.md)) already covers them, so this
change is about speed and headroom under the worker's 4,096 prompt-token cap.

## Where v2's characters went

v2 sent one JSON object: the engine's public observation (`ModelInputV2`), the
Decision's copies of parts of it, and the offered action descriptors. In a
late-game position about 80% of it was encoding, not facts:

- every card spelled out all 12–16 keys in JSON, including defaults
  (`"damage":0`, `"counters":{}`, `"attachments":[]`, `"restrictions":[]`,
  `"effectiveKeywords":[]`, owner and controller equal to the seat) and the
  `{"cardId":…,"revision":1}` wrapper;
- each face-down Eddie and Legend was a full object named `seat:0:EDDIES:2`;
- the `choice` object appeared twice (`snapshot.choice` and `pending`), the turn
  fields twice, the format twice, along with a 64-hex choice id, trigger ids and
  the acting player's UUID, none of which any other field refers to;
- each action repeated `"schemaVersion":2`, `"kind":"CHOOSE"` and a
  `choiceKind` equal to the pending choice's kind.

v2 contained **no card rules text, costs or printed stats**: a card is its slug
(for example `goro-takemura-hands-unclean`) plus its live state (power,
keywords, types, readiness and so on). So there was no repeated card text to
de-duplicate; the slug stays as each card's key, and copies of a card are
distinct instances with their own state.

## What v3 sends

The same facts as compact text, one line per zone, and a numbered action list:

```text
You are s0. Turn 11, active s0, acting s0. Window MAIN, resolution DECISION. Format DEMO_STARTER_V1.
Overtime {qualifyingTurnStarts=0 status=NORMAL}. First-player rolls [[9, 12]]. Selected seat s1.
Choice: none
gigSteals: [{attackerId=p0-c3 count=2}]
turnAttacks arasakaUnitAttacks: s0=1 s1=0
turnPlays blueUnitOrGearPlays: s0=0 s1=0
s0 (you): street cred 39
 DECK(13) hidden
 HAND(6): p0-c23 field-operator; p0-c20 emergency-atlus; p0-c24 field-operator; ...
 BATTLEFIELD(2): p0-c26 goro-takemura-losing-his-way ready pow=4; p0-c3 minotaur spent pow=9
 EDDIES(4): #0 ready; #1 ready; #2 ready; #3 ready
 LEGENDS(3): ...; p0-c0 goro-takemura-hands-unclean ready pow=7 kw=BLOCKER,GO_SOLO type=LEGEND
 GIGS dice: p0-D10=4; p0-D12=8; p0-D20=18; p0-D4=4; p0-D6=1; p0-D8=2; p1-D4=2 owner=s1
s1 (rival): street cred 20
 HAND(1) hidden
 ...
Actions:
0: Play Emergency Atlus [PLAY_CARD p0-c20]
1: Attack with Goro Takemura: Losing His Way [DECLARE_ATTACK p0-c26]
7: END_TURN
```

The system prompt keeps v2's instructions and adds a short notation legend
(defaults that are not printed, `#N` slots, `hidden`, `(rolled N)`, `@rN`
revisions).

**Cut** (listed in `sim_prompt.DROPPED_FIELDS`): `requestId`, `matchId`,
`sequence`, the acting player's UUID, `schemaVersion` markers, `choice.id`,
`fightPreventions[].id`, `temporaryModifiers[].origin.effectId`, `actionId`;
`pendingTriggers[].id` is replaced by `T1`, `T2`, … (an `EFFECT` option names
its trigger that way); the Decision's `turn`, `pending` and `metadata` copies
when they equal the observation (they are printed when they differ); default
values, which the legend names; JSON quoting, keys and nesting.

**Kept**, for every card and gig the acting seat can see: id, slug and revision,
zone and slot order, readiness, power, keywords, types, restrictions, attached
gear, damage, counters, lag, Go Solo, unusual face, owner and controller,
`knownToSeats`, `rememberedContent`; die type, value, original roll, zone,
owner and controller; every zone count (zones with zero cards are omitted and
the legend says so); street cred; turn, seats, window, step, resolution stage,
format, overtime, first-player rolls, the pending choice, combat, triggers,
inspected cards and every other observation field; each action's label, kind,
source, option and ability id, in the engine's order. Any field the renderer
does not recognize is printed as `key=value`, never dropped.

The renderer reads only the Decision (the acting seat's observation and offered
actions), sorts nothing that carries meaning, ranks no action and implements no
rule. Zone lines use a fixed zone order and unrecognized keys are sorted, so the
text is identical for the same decision whatever the key order of its JSON.

## Sizes

`python scripts/measure_prompt_size.py --matches 10` (baseline games with seeds
`benchmark-0` … `benchmark-9`, all 1,241 decisions, master `2bd9d48`). Characters
are system plus user message; tokens assume 3 characters per token, the ratio
seen on the Mac run for v2.

| Phase (thirds of each game) | v2 median / p95 / max | v3 median / p95 / max | v3 tokens median / max |
| --- | --- | --- | --- |
| early | 6,836 / 8,546 / 9,660 | 2,624 / 3,134 / 3,369 | ~875 / ~1,123 |
| mid | 9,006 / 10,717 / 11,777 | 3,034 / 3,461 / 3,697 | ~1,011 / ~1,232 |
| late | 10,693 / 12,213 / 14,018 | 3,239 / 3,620 / 3,985 | ~1,080 / ~1,328 |
| all (min 2,702 → 1,740) | 8,963 / 11,708 / 14,018 | 3,020 / 3,527 / 3,985 | ~1,007 / ~1,328 |

The largest late-game prompt falls from about 4,670 to about 1,330 estimated
tokens, under the ~2,000 target with no fact removed. What dominates v3 in the
late third of a game (seeds `benchmark-0..2`): the fixed system prompt, 1,252
characters (40%), then the LEGENDS lines (12%), the global header lines (12%),
BATTLEFIELD (9%), actions (6%), HAND (5%) and gig dice (5%). The system prompt is
identical for every decision, so a reused prefix KV cache in the worker would
save its ~420 tokens of prefill each time; the worker deliberately keeps no
state across requests today, so that would be its own change.

## Tests

`scripts/test_local_prompt.py` (`PASS local prompt: 9/9`) plays three baseline
games on the engine worker and, over every decision, decodes the v3 text back
into card, gig, count and street-cred facts and compares them with the v2
prompt's; checks that every other observation value v2 carried appears in v3;
checks action order, labels and references, and that `{"choice": i}` maps to
the same `actionId` for original and reversed action lists through `MLXPolicy`;
checks that every id or slug in v3 comes from the seat's own observation or
actions and that no action id, match id, player id or hash appears; checks
determinism under reversed JSON key order; checks that unrecognized fields are
printed; and guards the size of a fixed late-game position (decision 124 of seed
`test-local-prompt-0`: 12,721 characters in v2, 3,663 in v3; limit 4,200 and
35% of v2). Card fields the games never set (damage, counters, control, memory,
revision 2) are checked on an edited real position.

## For the Mac re-measurement

- Run `benchmark_sim_bot.py` and compare `promptTokens` with the estimates
  above: compact text with slugs and short ids may tokenize at a different
  ratio than JSON did.
- Check whether decisions that previously took 2.6–5.1 s now take about the
  time v2's 935–1,718-token prompts did (1.3–2.4 s).
- Gameplay quality was not measured, and no adapter has been trained on either
  format. Note that neither v2 nor v3 gives the model card rules text or costs,
  only slugs and live state.
