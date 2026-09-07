import { Pool, type PoolClient } from "pg";
import { StoredDeckSchema, GameStateSchema, failure, success, type StoredDeck, type DeckRepository, type MatchRepository, type GameState, type GameStateVersion, type DeckId, type PlayerId, type MatchId } from "@tcg/domain";
export function createPostgresPool(url: string | undefined): Pool {
  if (!url) throw new Error("DATABASE_URL is not configured");
  return new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
}
async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  const client = await pool.connect();
  try { await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export class PostgresDeckRepository implements DeckRepository {
  constructor(private readonly pool: Pool) {}
  async create(deck: StoredDeck) {
    if (deck.version !== 0) return failure("INVALID_VERSION", "Initial deck version must be zero");
    return transaction(this.pool, async (client) => {
      const inserted = await client.query("INSERT INTO decks(id,user_id,name,ruleset_id,ruleset_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id", [deck.id, deck.ownerId, deck.name, deck.rulesetId, deck.rulesetVersion]);
      if (!inserted.rowCount) return failure("DECK_EXISTS", "Deck already exists");
      await this.writeEntries(client, deck);
      return success(deck);
    });
  }
  private async writeEntries(client: PoolClient, deck: StoredDeck) {
    let slot = 0;
    for (const entry of deck.entries) {
      if (entry.zone === "MAIN") await client.query("INSERT INTO deck_cards(deck_id,card_id,card_revision,quantity) VALUES($1,$2,$3,$4)", [deck.id, entry.cardId, entry.revision, entry.quantity]);
      else await client.query("INSERT INTO deck_legends(deck_id,card_id,card_revision,slot) VALUES($1,$2,$3,$4)", [deck.id, entry.cardId, entry.revision, ++slot]);
    }
  }
  async find(id: DeckId, owner: PlayerId) {
    return transaction(this.pool, async (client) => {
      const result = await client.query(`SELECT id, user_id AS "ownerId", name, state_version AS version, ruleset_id AS "rulesetId", ruleset_version AS "rulesetVersion" FROM decks WHERE id=$1 AND user_id=$2`, [id, owner]);
      if (!result.rows[0]) return null;
      const entries = await client.query(`SELECT card_id AS "cardId", card_revision AS revision, quantity::integer, 'MAIN' AS zone FROM deck_cards WHERE deck_id=$1 UNION ALL SELECT card_id, card_revision, 1, 'LEGEND' FROM deck_legends WHERE deck_id=$1`, [id]);
      return StoredDeckSchema.parse({ ...result.rows[0], entries: entries.rows });
    }, true);
  }
  async save(deck: StoredDeck, expectedVersion: GameStateVersion) {
    if (deck.version !== expectedVersion + 1) return failure("INVALID_VERSION", "Next deck version must increment by one");
    return transaction(this.pool, async (client) => {
      const updated = await client.query("UPDATE decks SET name=$3,ruleset_id=$4,ruleset_version=$5,state_version=state_version+1,updated_at=now() WHERE id=$1 AND user_id=$2 AND state_version=$6 RETURNING id", [deck.id, deck.ownerId, deck.name, deck.rulesetId, deck.rulesetVersion, expectedVersion]);
      if (updated.rowCount !== 1) return failure("STALE_OR_MISSING_DECK", "Deck is missing, not owned by actor, or stale");
      await client.query("DELETE FROM deck_cards WHERE deck_id=$1", [deck.id]);
      await client.query("DELETE FROM deck_legends WHERE deck_id=$1", [deck.id]);
      await this.writeEntries(client, deck);
      return success(deck);
    });
  }
}
export class PostgresMatchRepository implements MatchRepository {
  constructor(private readonly pool: Pool) {}
  async find(id: MatchId) {
    const result = await this.pool.query("SELECT state FROM matches WHERE id=$1", [id]);
    return result.rows[0]?.state ? GameStateSchema.parse(result.rows[0].state) : null;
  }
  async create(state: GameState) {
    if (state.version !== 0 || state.eventSequence !== 0) return failure("INVALID_VERSION", "Initial state counters must be zero");
    return transaction(this.pool, async (client) => {
      const inserted = await client.query("INSERT INTO matches(id,game_version,ruleset_id,ruleset_version,state) VALUES($1,'phase1',$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id", [state.matchId, state.rulesetId, state.rulesetVersion, JSON.stringify(state)]);
      if (!inserted.rowCount) return failure("MATCH_EXISTS", "Match already exists");
      for (const player of state.players) await client.query("INSERT INTO match_players(match_id,user_id) VALUES($1,$2)", [state.matchId, player]);
      for (const card of state.cards) await client.query("INSERT INTO match_content_revisions(match_id,content_type,content_id,revision) VALUES($1,'CARD',$2,$3)", [state.matchId, card.cardId, String(card.revision)]);
      return success(state);
    });
  }
  async save(state: GameState, expectedVersion: GameStateVersion) {
    if (state.version !== expectedVersion + 1) return failure("INVALID_VERSION", "Next state version must increment by one");
    const updated = await this.pool.query(`UPDATE matches SET state=$3::jsonb,state_version=state_version+1 WHERE id=$1 AND state_version=$2 AND ruleset_id=$4 AND ruleset_version=$5 AND state->'cards'=$3::jsonb->'cards' AND state->'players'=$3::jsonb->'players' RETURNING id`, [state.matchId, expectedVersion, JSON.stringify(state), state.rulesetId, state.rulesetVersion]);
    return updated.rowCount === 1 ? success(state) : failure("STALE_OR_INCOMPATIBLE_STATE", "Match is missing, stale, or pinned content/players changed");
  }
}
