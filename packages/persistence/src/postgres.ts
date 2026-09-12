import { Pool, type PoolClient } from "pg";
import { StoredDeckSchema, GameStateSchema, GameEventSchema, type GameEvent, failure, success, type StoredDeck, type DeckRepository, type MatchRepository, type GameState, type GameStateVersion, type DeckId, type PlayerId, type MatchId } from "@tcg/domain";
export function createPostgresPool(url: string | undefined): Pool {
    if (!url)
        throw new Error("DATABASE_URL is not configured");
    return new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
}
async function transaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
export class PostgresDeckRepository implements DeckRepository {
    constructor(private readonly pool: Pool) { }
    async create(deck: StoredDeck) {
        if (deck.version !== 0)
            return failure("INVALID_VERSION", "Initial deck version must be zero");
        return transaction(this.pool, async (client) => {
            const inserted = await client.query("INSERT INTO decks(id,user_id,name,ruleset_id,ruleset_version) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id", [deck.id, deck.ownerId, deck.name, deck.rulesetId, deck.rulesetVersion]);
            if (!inserted.rowCount)
                return failure("DECK_EXISTS", "Deck already exists");
            await this.writeEntries(client, deck);
            return success(deck);
        });
    }
    private async writeEntries(client: PoolClient, deck: StoredDeck) {
        let slot = 0;
        for (const entry of deck.entries) {
            if (entry.zone === "MAIN")
                await client.query("INSERT INTO deck_cards(deck_id,card_id,card_revision,quantity) VALUES($1,$2,$3,$4)", [deck.id, entry.cardId, entry.revision, entry.quantity]);
            else
                await client.query("INSERT INTO deck_legends(deck_id,card_id,card_revision,slot) VALUES($1,$2,$3,$4)", [deck.id, entry.cardId, entry.revision, ++slot]);
        }
    }
    async find(id: DeckId, owner: PlayerId) {
        return transaction(this.pool, async (client) => {
            const result = await client.query(`SELECT id, user_id AS "ownerId", name, state_version AS version, ruleset_id AS "rulesetId", ruleset_version AS "rulesetVersion" FROM decks WHERE id=$1 AND user_id=$2`, [id, owner]);
            if (!result.rows[0])
                return null;
            const entries = await client.query(`SELECT card_id AS "cardId", card_revision AS revision, quantity::integer, 'MAIN' AS zone FROM deck_cards WHERE deck_id=$1 UNION ALL SELECT card_id, card_revision, 1, 'LEGEND' FROM deck_legends WHERE deck_id=$1`, [id]);
            return StoredDeckSchema.parse({ ...result.rows[0], entries: entries.rows });
        }, true);
    }
    async save(deck: StoredDeck, expectedVersion: GameStateVersion) {
        if (deck.version !== expectedVersion + 1)
            return failure("INVALID_VERSION", "Next deck version must increment by one");
        return transaction(this.pool, async (client) => {
            const updated = await client.query("UPDATE decks SET name=$3,ruleset_id=$4,ruleset_version=$5,state_version=state_version+1,updated_at=now() WHERE id=$1 AND user_id=$2 AND state_version=$6 RETURNING id", [deck.id, deck.ownerId, deck.name, deck.rulesetId, deck.rulesetVersion, expectedVersion]);
            if (updated.rowCount !== 1)
                return failure("STALE_OR_MISSING_DECK", "Deck is missing, not owned by actor, or stale");
            await client.query("DELETE FROM deck_cards WHERE deck_id=$1", [deck.id]);
            await client.query("DELETE FROM deck_legends WHERE deck_id=$1", [deck.id]);
            await this.writeEntries(client, deck);
            return success(deck);
        });
    }
}
export class PostgresMatchRepository implements MatchRepository {
    constructor(private readonly pool: Pool) { }
    async find(id: MatchId) {
        const result = await this.pool.query("SELECT state FROM matches WHERE id=$1", [id]);
        if (result.rows[0]?.state?.schemaVersion === 1)
            throw new Error("LEGACY_STATE_UNSUPPORTED: Phase 1 placeholder retained; explicit reinitialization required");
        return result.rows[0]?.state ? GameStateSchema.parse(result.rows[0].state) : null;
    }
    async history(id: MatchId) {
        return transaction(this.pool, async client => {
            const result = await client.query("SELECT state FROM matches WHERE id=$1", [id]);
            if (!result.rows[0]) return [];
            const state = GameStateSchema.parse(result.rows[0].state);
            const events = await this.readEvents(client, id);
            if (!this.completeBatch(events, 0, state.match.eventSequence))
                throw new Error("INCOMPLETE_MATCH_HISTORY: Stored event history does not cover the authoritative state");
            return events;
        }, true);
    }
    private completeBatch(events: readonly GameEvent[], previous: number, next: number) {
        return next >= previous && events.length === next - previous && events.every((event, i) => GameEventSchema.safeParse(event).success && event.sequence === previous + i + 1);
    }
    /** Entry is an audited transition, not a replaceable JSONB flag. Engine validation owns gameplay legality. */
    private overtimeBatch(previous: GameState | undefined, next: GameState, events: readonly GameEvent[]) {
        const before = previous?.match.overtime, after = next.match.overtime;
        const entries = events.filter(e => e.payload.kind === "OVERTIME_STARTED");
        if (before) return after?.startedAfterTurn === before.startedAfterTurn && entries.length === 0;
        if (!after) return entries.length === 0;
        if (!previous || previous.match.outcome || previous.timing.emptyFixerStarts !== 2 ||
            after.startedAfterTurn !== previous.timing.turn || entries.length !== 1) return false;
        const entry = entries[0];
        return entry.payload.kind === "OVERTIME_STARTED" && entry.payload.turn === after.startedAfterTurn &&
            events.some(e => e.sequence < entry.sequence && e.payload.kind === "TURN_ENDED" && e.payload.turn === after.startedAfterTurn);
    }
    private async readEvents(client: PoolClient, id: MatchId): Promise<GameEvent[]> {
        const result = await client.query("SELECT sequence,payload FROM match_events WHERE match_id=$1 ORDER BY sequence", [id]);
        return result.rows.map(row => GameEventSchema.parse(row));
    }
    private async appendEvents(client: PoolClient, state: GameState, events: readonly GameEvent[]) {
        for (const event of events)
            await client.query("INSERT INTO match_events(match_id,sequence,event_type,payload) VALUES($1,$2,$3,$4::jsonb)", [state.match.id, event.sequence, event.payload.kind, JSON.stringify(event.payload)]);
    }
    async create(state: GameState, events: readonly GameEvent[] = []) {
        state = GameStateSchema.parse(state);
        if (!this.completeBatch(events, 0, state.match.eventSequence))
            return failure("INCOMPLETE_EVENT_BATCH", "Creation requires all initialization events starting at sequence one");
        if (!this.overtimeBatch(undefined, state, events))
            return failure("INVALID_OVERTIME_EVENT_BATCH", "New matches cannot start in overtime or claim an entry event");
        if (state.match.version !== 0)
            return failure("INVALID_VERSION", "Initial state version must be zero; setup may already have emitted events");
        return transaction(this.pool, async (client) => {
            const inserted = await client.query("INSERT INTO matches(id,game_version,ruleset_id,ruleset_version,state) VALUES($1,'phase1',$2,$3,$4::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id", [state.match.id, state.match.rulesetId, state.match.rulesetVersion, JSON.stringify(state)]);
            if (!inserted.rowCount)
                return failure("MATCH_EXISTS", "Match already exists");
            for (const player of state.match.playerOrder)
                await client.query("INSERT INTO match_players(match_id,user_id) VALUES($1,$2)", [state.match.id, player]);
            for (const card of state.match.cards)
                await client.query("INSERT INTO match_content_revisions(match_id,content_type,content_id,revision) VALUES($1,'CARD',$2,$3)", [state.match.id, card.cardId, String(card.revision)]);
            await this.appendEvents(client, state, events);
            return success(state);
        });
    }
    async save(state: GameState, expectedVersion: GameStateVersion, events: readonly GameEvent[] = []) {
        state = GameStateSchema.parse(state);
        if (state.match.version !== expectedVersion + 1)
            return failure("INVALID_VERSION", "Next state version must increment by one");
        return transaction(this.pool, async client => {
            const found = await client.query("SELECT state FROM matches WHERE id=$1 FOR UPDATE", [state.match.id]);
            if (!found.rows[0]) return failure("STALE_OR_INCOMPATIBLE_STATE", "Match is missing");
            const previous = GameStateSchema.parse(found.rows[0].state);
            if (previous.match.version !== expectedVersion) return failure("STALE_OR_INCOMPATIBLE_STATE", "Match version is stale");
            const history = await this.readEvents(client, state.match.id);
            if (!this.completeBatch(history, 0, previous.match.eventSequence))
                return failure("INCOMPLETE_MATCH_HISTORY", "Existing setup/gameplay history is incomplete; explicit recovery required");
            if (!this.completeBatch(events, previous.match.eventSequence, state.match.eventSequence))
                return failure("INCOMPLETE_EVENT_BATCH", "Save requires the exact contiguous new event batch");
            if (!this.overtimeBatch(previous, state, events))
                return failure("INVALID_OVERTIME_EVENT_BATCH", "Overtime entry must match the completed qualifying turn; an active entry cannot change or disappear");
            const updated = await client.query(`UPDATE matches SET state=$3::jsonb,state_version=state_version+1 WHERE id=$1 AND state_version=$2 AND ruleset_id=$4 AND ruleset_version=$5 AND state->'match'->'cards'=$3::jsonb->'match'->'cards' AND state->'match'->'playerOrder'=$3::jsonb->'match'->'playerOrder' AND state->'match'->'rulesetHash'=$3::jsonb->'match'->'rulesetHash' AND state->'match'->'engineVersion'=$3::jsonb->'match'->'engineVersion' AND state->'match'->'contentManifestHash'=$3::jsonb->'match'->'contentManifestHash' AND state->'match'->'engineArtifactHash'=$3::jsonb->'match'->'engineArtifactHash' AND state->'match'->'format' IS NOT DISTINCT FROM $3::jsonb->'match'->'format' AND state->'firstPlayerRolls' IS NOT DISTINCT FROM $3::jsonb->'firstPlayerRolls' RETURNING id`, [state.match.id, expectedVersion, JSON.stringify(state), state.match.rulesetId, state.match.rulesetVersion]);
            if (updated.rowCount !== 1) return failure("STALE_OR_INCOMPATIBLE_STATE", "Match is stale or pinned content/players changed");
            await this.appendEvents(client, state, events);
            return success(state);
        });
    }
}
