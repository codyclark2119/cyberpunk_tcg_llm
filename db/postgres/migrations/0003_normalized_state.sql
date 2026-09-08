-- Preserve historical placeholder JSON verbatim; never fabricate gameplay state from it.
ALTER TABLE matches DROP CONSTRAINT matches_state_identity;
ALTER TABLE matches ADD CONSTRAINT matches_state_identity CHECK (state IS NULL OR COALESCE(
  CASE state->>'schemaVersion'
    WHEN '1' THEN state->>'matchId' = id::text AND (state->>'version')::integer = state_version
      AND state->>'rulesetId' = ruleset_id AND state->>'rulesetVersion' = ruleset_version
    WHEN '2' THEN state->'match'->>'id' = id::text AND (state->'match'->>'version')::integer = state_version
      AND state->'match'->>'rulesetId' = ruleset_id AND state->'match'->>'rulesetVersion' = ruleset_version
    ELSE false
  END, false));
