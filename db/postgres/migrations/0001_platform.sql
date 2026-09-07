CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- PostgreSQL intentionally does not own card/rules definitions.
-- card_id values below are stable content IDs whose source of truth is MongoDB.
-- There are no cross-database foreign keys.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  format text NOT NULL DEFAULT 'STANDARD',
  ruleset_id text NOT NULL DEFAULT 'beta',
  ruleset_version text NOT NULL,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deck_legends (
  deck_id uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id text NOT NULL,
  card_revision integer NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  PRIMARY KEY (deck_id, slot),
  UNIQUE (deck_id, card_id)
);

CREATE TABLE deck_cards (
  deck_id uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id text NOT NULL,
  card_revision integer NOT NULL,
  quantity smallint NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (deck_id, card_id)
);

CREATE INDEX deck_cards_card_id_idx ON deck_cards(card_id);
CREATE INDEX deck_legends_card_id_idx ON deck_legends(card_id);

CREATE TABLE matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'CREATED',
  game_version text NOT NULL,
  ruleset_id text NOT NULL,
  ruleset_version text NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  winner_user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Pins every content revision actually used by a match. This makes old replays
-- deterministic even after beta card errata or rules changes.
CREATE TABLE match_content_revisions (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('CARD', 'RULESET')),
  content_id text NOT NULL,
  revision text NOT NULL,
  PRIMARY KEY (match_id, content_type, content_id)
);

CREATE TABLE match_events (
  id bigserial PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, sequence)
);

CREATE INDEX match_events_match_sequence_idx ON match_events(match_id, sequence);
