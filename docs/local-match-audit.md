# Local match record audit

Date: 2026-11-14. Engine identity at writing: `0.4.2-lag-order` (`ec495480…308c`).
No engine, wire or worker file was touched. Follows the
[local match runner](local-match-runner.md), [match records v3](local-match-records-v3.md)
and the [local play UI](local-play-ui.md).

## Why

Every number reported about local play (win rates, fallbacks, baseline agreement,
model choices) comes from match records under `local/matches/` or a strength run.
A record holds ids, labels and hashes. Nothing checked them against the engine after
they were written. A record from an older engine build, a hand-edited row, or a
fallback relabelled as a model choice all looked the same as an honest record.

## What it checks

`games/cyberpunk/match_audit.py` replays each record from its seed on the running
engine worker. It makes no decisions of its own. Every expected value comes from the
worker (`createGame`, `modelInput`, `applyAction`) or from the same functions the
runner used to write the row (`decision_row`, `result_row`, `baseline_action_id`,
`parse_choice`).

| Check | Problem code |
| --- | --- |
| Header `engine` (version, artifactHash) is the running worker's (`scripts/print-engine-identity.ts`) | `stale_engine`: verdict **stale**, not replayed |
| Content manifest hash, format, players, decks, seats and matchId match the audit setup | `setup_mismatch` |
| `initialStateHash` matches the engine's created game | `initial_state_hash` |
| Each `actionId` is one the engine offers the acting player at that point | `action_not_offered` (replay stops) |
| Engine-derived row fields (turn, step, seat, player, policy, offered, chosen index, label, baseline pick, agreement) match what `decision_row` writes | `row_mismatch` |
| Each `stateHash` matches the engine's transition. Replay continues from the engine's state, so a wrong hash is reported once | `state_hash_mismatch` |
| `baseline` rows come from a baseline seat playing the baseline's pick, `human` rows from a human seat, and `policy`/`*_fallback` rows from a policy seat | `reason_not_for_policy`, `baseline_not_baseline_pick`, `unknown_reason` |
| A fallback has an error code and plays the baseline's pick; no other row has an error code | `fallback_without_error`, `fallback_not_baseline_pick`, `error_without_fallback` |
| A `policy` row on a seat whose header names a model has a `rawOutput` that `parse_choice` reads as the played index | `model_choice_unsupported` |
| `finished` exactly when the engine reports an outcome | `status_mismatch` |
| The result row equals `result_row` over the recorded rows and the replayed final state (winner, reason, turns, counts, agreement, `finalStateHash`) | `result_mismatch` |

The model-choice check tests consistency, not authenticity. A relabelled fallback
whose raw output is missing, unparseable or names another action is caught. A forged
raw output that names the played index cannot be told apart from a real one. The
same applies to a policy seat whose header names no model (a v2 record, or a custom
Python policy): its `policy` rows are counted but cannot be checked against an answer.

Counts cover replayed decisions only, so a stale record contributes none. They are
kept per seat and pooled per policy name: decisions, model choices, fallbacks, every
selection reason and error code, and agreement with the baseline's pick on the
engine's offered list.

## Use

```bash
python scripts/audit_match_records.py                        # every record in local/matches/
python scripts/audit_match_records.py local/strength/RUN/matches local/matches/demo-0.jsonl
python scripts/audit_match_records.py --setup my-setup.json  # records played with --setup
python scripts/audit_match_records.py --json                 # full report as JSON
```

The output has one line per record (`CLEAN`, `STALE`, `MISMATCH` or `UNREADABLE`),
one line per problem, one line per policy, and a total line. The exit status is 0
only when every record is clean.

The play UI (`scripts/play_local.py`) has an **Audit** tab. It lists the records
with their engine version, audits the selected records or all of them through
`POST /api/audit` (`{"names": [...], "setup": "optional.json"}`, at most 200 per
request, one audit at a time), and shows the verdicts, problems and per-policy
counts.

A full 78-decision baseline game replays in about 12 s on the container used for
this change.

## Tests

`scripts/test_audit_match_records.py` (`PASS match record audit: 12/12`, about two
minutes) plays a full baseline game, a 20-decision baseline game and a 40-decision
game with the real `MLXPolicy` on one seat. That seat talks to
`test_local_match.py`'s fake MLX worker, which gives valid choices, invalid text and
prompt-too-large errors. All three games audit clean, and the fallback counts match
the rows. Each tamper changes only the field it names, with the result counters
fixed wherever the tamper would otherwise show up there first. The auditor must
report that exact problem at that decision and nothing else:

- an `actionId` the engine does not offer at that point (the test checks this
  against the engine itself), and a different action that was offered, which the
  replayed hash catches;
- a `stateHash` replaced by a real hash from another decision, which is reported
  once while the replay continues to the end; also forged initial and final hashes
  and a forged `finished` status;
- a forged engine artifact hash or version, which is reported stale with zero
  decisions replayed;
- a fallback (invalid output, or prompt too large) relabelled as a model choice,
  which is caught only by the raw-output check; also a raw output that names
  another index, a human reason on a baseline seat, a fallback with no error code,
  and a model choice that has one.

Each check in the auditor was mutation-tested by disabling it and confirming that a
test fails.

The suite also checks the CLI's lines, totals, `--json` output and exit status, and
the play UI's `/api/audit` route, including its refusals. It is wired into
`scripts/run_tests.sh` as the `py-match-audit` step.
