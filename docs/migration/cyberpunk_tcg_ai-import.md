# cyberpunk_tcg_ai monorepo import

- Source repository: `codyclark2119/cyberpunk_tcg_ai`
- Source commit: `af9e0e1dd93b7eb77db5883bdd18809c8446d856`
- Source tree: `43c1bcdc47ea4a143c7701e0534833dafeb08e3a`
- Target first parent: `817b3655945ab02784d319f37e467c3187e7b78b`
- Source tracked files: `510`
- Import method: unrelated-history merge; the migration commit has both repositories as parents.

## Path mapping

The source snapshot remains path-compatible wherever possible:

- `data/` -> `data/`
- `games/` -> `games/`
- `harness/` -> `harness/`
- `eval/` -> `eval/`
- `configs/` -> `configs/`
- `models/` -> `models/`
- `scripts/*.py` -> existing `scripts/`
- `requirements.txt` -> `requirements.txt`
- source `README.md`, `CLAUDE.md`, and `docs/` -> `docs/ai-source/`

The target repository keeps its own root README, root Git configuration,
TypeScript packages, applications, tests, CI, and deterministic engine history.

## Authority boundary

Repository consolidation does not merge AI authority into gameplay authority.
The TypeScript engine remains authoritative for rules, legality, hidden state,
RNG, legal actions, and state transitions. The Python harness may consume only
public model input and return an engine-offered `actionId`.

The repository commit identifies the complete monorepo snapshot.
`engineArtifactHash` continues to identify only deterministic engine inputs;
AI/training-only changes must not change it unless an engine-hashed input also
changes.

## Retirement

Keep the source repository readable until this migration PR is merged and the
combined CI passes. After that, archive the old repository rather than deleting
it so existing links and commit references remain resolvable.
