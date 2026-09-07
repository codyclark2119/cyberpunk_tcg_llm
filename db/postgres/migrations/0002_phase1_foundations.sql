-- Forward-only: retain 0001 exactly as originally applied.
ALTER TABLE deck_legends DROP CONSTRAINT deck_legends_slot_check;
ALTER TABLE deck_legends ADD CONSTRAINT deck_legends_slot_positive CHECK (slot > 0);
ALTER TABLE deck_legends ADD CONSTRAINT deck_legends_revision_positive CHECK (card_revision > 0);
ALTER TABLE deck_cards ADD CONSTRAINT deck_cards_revision_positive CHECK (card_revision > 0);
ALTER TABLE decks ADD COLUMN state_version integer NOT NULL DEFAULT 0 CHECK (state_version >= 0);
ALTER TABLE matches ADD COLUMN state_version integer NOT NULL DEFAULT 0 CHECK (state_version >= 0);
ALTER TABLE matches ADD COLUMN state jsonb;
ALTER TABLE match_events ADD CONSTRAINT match_events_sequence_positive CHECK (sequence > 0);
CREATE TABLE match_players (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY (match_id, user_id)
);
CREATE TABLE commands (
  command_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('STARTED', 'COMPLETED', 'FAILED')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (actor_id, idempotency_key),
  CHECK ((status = 'COMPLETED' AND response IS NOT NULL AND completed_at IS NOT NULL)
    OR (status <> 'COMPLETED' AND response IS NULL AND completed_at IS NULL))
);
CREATE INDEX commands_pending_idx ON commands(created_at) WHERE status = 'STARTED';

-- Serialized state must agree with relational identity/version pins.
ALTER TABLE matches ADD CONSTRAINT matches_state_identity CHECK (state IS NULL OR (
  state->>'matchId' = id::text AND (state->>'version')::integer = state_version
  AND state->>'rulesetId' = ruleset_id AND state->>'rulesetVersion' = ruleset_version
));
