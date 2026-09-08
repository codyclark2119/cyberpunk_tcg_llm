import { validateSearchState } from "./search-state";
import { validateSetupState } from "./setup-state";
import { paymentSources, paymentValue, paymentCandidates } from "./payment";
import { z } from "zod";
import { GameStateSchema, ContentBundleSchema, ReplayStateHashSchema, PositionHashSchema, hashCanonical, canonicalSerialize, failure, success, type Result, type GameState, type ContentBundle, type PlayerId, type DeepReadonly, CardInstanceIdSchema } from "@tcg/domain";
export type EngineContext = {
    readonly content: DeepReadonly<ContentBundle>;
};
export function freeze<T>(value: T): DeepReadonly<T> {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value as DeepReadonly<T>; // Recursive runtime freeze matches mapped readonly type.
}
export function validateState(input: unknown, context: EngineContext): Result<GameState> {
    const parsed = GameStateSchema.safeParse(input);
    if (!parsed.success)
        return failure("INVALID_STATE", parsed.error.message);
    const bundle = ContentBundleSchema.safeParse(context.content);
    if (!bundle.success)
        return failure("INVALID_CONTENT", bundle.error.message);
    const s = parsed.data, b = bundle.data;
    if (s.match.rulesetId !== b.ruleset.id || s.match.rulesetVersion !== b.ruleset.version || s.match.rulesetHash !== b.manifest.ruleset.hash || s.match.contentManifestHash !== b.manifestHash || s.match.engineArtifactHash !== b.manifest.engine.artifactHash || s.match.engineVersion !== b.manifest.engine.version)
        return failure("CONTEXT_MISMATCH", "Exact engine, ruleset and content pins are required");
    const ids = s.match.playerOrder;
    if (new Set(ids).size !== ids.length || ids.length !== Object.keys(s.players).length || ids.some((id, seat) => s.players[id]?.id !== id || s.players[id].seat !== seat) || !ids.includes(s.timing.activePlayer) || !ids.includes(s.timing.actingPlayer))
        return failure("INVALID_PLAYERS", "Player keys, seats and timing references must agree");
    const pins = b.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision }));
    if (canonicalSerialize(s.match.cards) !== canonicalSerialize(pins))
        return failure("CONTENT_MISMATCH", "Match must retain the bundle revision pins in canonical order");
    const seen = new Set<string>();
    for (const player of Object.values(s.players)) {
        for (const [zone, refs] of Object.entries(player.zones))
            for (const id of refs) {
                const c = s.objects.cards[id];
                if (!Object.hasOwn(s.objects.cards, id) || !c || seen.has(id) || c.zone.zone !== zone || c.zone.playerId !== player.id)
                    return failure("INVALID_LOCATION", "Each card must resolve to exactly one matching zone");
                seen.add(id);
            }
    }
    if (seen.size !== Object.keys(s.objects.cards).length)
        return failure("ORPHAN_CARD", "Every card must have a zone reference");
    const attached = new Set<string>();
    for (const [id, c] of Object.entries(s.objects.cards)) {
        const content = b.cards.find(p => p.id === c.cardId && p.revision === c.revision);
        if (id !== c.id || !ids.includes(c.ownerId) || !ids.includes(c.controllerId) || !content)
            return failure("INVALID_CARD", "Card identity, owner, controller or content pin is invalid");
        if (c.zone.zone === "EDDIES" && (c.face !== "DOWN" || content.type === "LEGEND" || !content.sellProfile.allowed))
            return failure("INVALID_EDDIE", "Eddies must be face-down sellable card instances");
        if (c.zone.zone === "LEGENDS" && content.type !== "LEGEND")
            return failure("INVALID_LEGEND", "Only Legends belong in the Legend zone");
        if (c.statuses.includes("GO_SOLO") && (content.type !== "LEGEND" || !content.mechanics.keywords.includes("GO_SOLO") || c.zone.zone !== "BATTLEFIELD"))
            return failure("INVALID_GO_SOLO", "Go Solo requires a printed Legend with the keyword on the battlefield");
        for (const target of c.attachments) {
            if (target === id || attached.has(target) || !Object.hasOwn(s.objects.cards, target) || s.objects.cards[target].zone.zone !== "BATTLEFIELD" || (c.zone.zone !== "BATTLEFIELD" && !(c.zone.zone === "LEGENDS" && c.face === "UP")))
                return failure("INVALID_ATTACHMENT", "Attachment references must be unique battlefield objects");
            attached.add(target);
        }
        const visit = (key: string, path: Set<string>): boolean => {
            if (path.has(key))
                return false;
            return (s.objects.cards[CardInstanceIdSchema.parse(key)]?.attachments ?? []).every(next => visit(next, new Set([...path, key])));
        };
        if (!visit(id, new Set()))
            return failure("ATTACHMENT_CYCLE", "Attachments cannot form cycles");
    }
    seen.clear();
    for (const p of Object.values(s.players))
        for (const [zone, refs] of Object.entries(p.gigs))
            for (const id of refs) {
                const g = s.objects.gigs[id];
                if (!Object.hasOwn(s.objects.gigs, id) || !g || seen.has(id) || g.location.playerId !== p.id || g.location.zone !== zone)
                    return failure("INVALID_GIG_LOCATION", "Each Gig must resolve to exactly one matching location");
                seen.add(id);
            }
    if (seen.size !== Object.keys(s.objects.gigs).length)
        return failure("ORPHAN_GIG", "Every Gig requires a location reference");
    for (const [id, g] of Object.entries(s.objects.gigs))
        if (id !== g.id || !ids.includes(g.ownerId) || !ids.includes(g.controllerId) || g.location.playerId !== g.controllerId || (g.location.zone === "GIGS" && g.roll.kind !== "ROLLED"))
            return failure("INVALID_GIG", "Gig identity/control/location/roll mismatch");
    const bounds = b.ruleset.gameplay?.gigValueBounds;
    if (bounds && bounds !== "UNSUPPORTED" && Object.values(s.objects.gigs).some(g => g.roll.kind === "ROLLED" && (g.roll.currentValue < bounds.min || g.roll.currentValue > bounds.max)))
        return failure("INVALID_GIG_VALUE", "Current Gig value violates pinned bounds");
    const effects = [...s.resolution.pending, ...s.resolution.discovered, ...(s.resolution.current ? [s.resolution.current] : [])];
    if (new Set(effects.map(e => e.id)).size !== effects.length || effects.some(e => !ids.includes(e.controllerId) || (e.sourceId !== null && !Object.hasOwn(s.objects.cards, e.sourceId)) || e.causedBySequence > s.match.eventSequence))
        return failure("INVALID_PENDING_EFFECT", "Pending effects must have unique identities and valid references");
    const choice = s.resolution.choice;
    if ((s.resolution.stage === "CHOICE") !== (choice !== null) || (choice && (!ids.includes(choice.actorId) || choice.actorId !== s.timing.actingPlayer)))
        return failure("INVALID_CHOICE", "Choice stage and actor must agree");
    if (choice)
        for (const option of choice.options) {
            if ((option.kind === "CARD" && !Object.hasOwn(s.objects.cards, option.cardInstanceId)) || (option.kind === "GIG" && !Object.hasOwn(s.objects.gigs, option.gigInstanceId)) || (option.kind === "PAYMENT" && !Object.hasOwn(s.objects.cards, option.source.cardInstanceId)) || (option.kind === "EFFECT" && !effects.some(e => e.id === option.effectId)))
                return failure("INVALID_CHOICE_REFERENCE", "Choice contains an unresolved object reference");
        }
    if (s.resolution.stage === "DECISION" && (effects.length || choice || s.timing.window === "RESOLVING"))
        return failure("UNSTABLE_DECISION", "Decision state cannot contain unresolved work");
    if (s.timing.combat.stage !== "NONE" && [s.timing.combat.attackerId, s.timing.combat.targetId, s.timing.combat.blockerId].some(id => id !== null && !Object.hasOwn(s.objects.cards, id)))
        return failure("INVALID_COMBAT_REFERENCE", "Combat objects must resolve");
    const slice = b.ruleset.gameplay?.turnSlice;
    if (s.setup || s.timing.window === "SETUP") {
        const validSetup = validateSetupState(s, context);
        if (!validSetup.ok) return validSetup;
    }
    if (slice && !s.setup) {
        const step = s.timing.step;
        if (ids.length !== 2 || !s.timing.firstPlayer || !ids.includes(s.timing.firstPlayer) || !step || s.timing.actingPlayer !== s.timing.activePlayer)
            return failure("INVALID_TURN_STATE", "Turn slice requires two players, first player and an active decision actor");
        if (s.timing.turn < 1 || s.timing.activePlayer !== ids[(s.players[s.timing.firstPlayer].seat + s.timing.turn - 1) % ids.length])
            return failure("INVALID_TURN_ORDER", "Active player must follow first-player and turn order");
        const boundary = ["MAIN", "CHOOSE_GIG", "PAYMENT_SELECTION", "TARGET_SELECTION", "FINISHED"].includes(step);
        if ((boundary && s.timing.window !== step) || (!boundary && s.timing.window !== "RESOLVING"))
            return failure("INVALID_TURN_TIMING", "Step and window disagree");
        if (Object.values(s.players).some(p => p.economy.usageTurn !== s.timing.turn || p.economy.callsThisTurn === undefined || p.economy.callsThisTurn > slice.callLimitPerTurn || p.economy.sellsThisTurn > b.ruleset.gameplay!.sellLimitPerTurn))
            return failure("INVALID_TURN_USAGE", "Usage must belong to this turn and respect limits");
        for (const id of ids) {
            const original = Object.values(s.objects.gigs).filter(g => g.ownerId === id);
            if (original.length !== 6 || new Set(original.map(g => g.dieType)).size !== 6)
                return failure("INVALID_FIXER_ORIGIN", "Original pool must retain one of each die");
            if (original.some(g => g.location.zone === "FIXER" && g.roll.kind !== "UNROLLED"))
                return failure("INVALID_GIG_LOCATION", "Rolled dice must leave Fixer in this slice");
            const d20 = original.find(g => g.dieType === "D20")!;
            if (d20.roll.kind === "ROLLED" && original.some(g => g.dieType !== "D20" && g.roll.kind !== "ROLLED"))
                return failure("INVALID_D20_ROLL", "Other original dice must have rolled first");
        }
        if ((step === "FINISHED") !== Boolean(s.match.outcome))
            return failure("INVALID_OUTCOME", "Finished state requires an outcome");
        if (s.match.outcome && (!ids.includes(s.match.outcome.winnerId) || !ids.includes(s.match.outcome.loserId) || s.match.outcome.winnerId === s.match.outcome.loserId))
            return failure("INVALID_OUTCOME", "Outcome players invalid");
        const continuation = s.resolution.callContinuation;
        if ((step === "PAYMENT_SELECTION") !== Boolean(continuation) || Boolean(continuation) !== Boolean(choice && step === "PAYMENT_SELECTION"))
            return failure("INVALID_PAYMENT_STATE", "Payment step, choice and continuation must agree");
        if (continuation) {
            const legend = s.objects.cards[continuation.legendId], available = paymentSources(s, continuation.actorId, context);
            if (!Object.hasOwn(s.objects.cards, continuation.legendId) || !legend || legend.zone.zone !== "LEGENDS" || legend.face !== "DOWN" || legend.controllerId !== continuation.actorId || continuation.actorId !== s.timing.activePlayer || s.players[continuation.actorId].economy.callsThisTurn! >= slice.callLimitPerTurn)
                return failure("INVALID_CALL_CONTINUATION", "CALL target/actor/usage invalid");
            const selected = continuation.selectedSources;
            if (new Set(selected.map(p => p.cardInstanceId)).size !== selected.length || selected.some(p => !available.some(a => canonicalSerialize(a) === canonicalSerialize(p))) || selected.reduce((sum, p) => sum + paymentValue(s, context, p), 0) + continuation.remainingCost !== slice.callCost || continuation.remainingCost <= 0)
                return failure("INVALID_PAYMENT_SOURCES", "Payment selections or remaining cost invalid");
            const options = paymentCandidates(s, continuation.actorId, context, continuation.remainingCost, selected).map(source => ({ kind: "PAYMENT", source }));
            if (!options.length || choice?.kind !== "PAYMENT" || choice.min !== 1 || choice.max !== 1 || choice.ordered || choice.continuationId !== "call-payment@1" || canonicalSerialize(choice.options) !== canonicalSerialize(options))
                return failure("INVALID_PAYMENT_OPTIONS", "Choice options must exactly match eligible payment continuations");
        }
    }
    const search = validateSearchState(s, context);
    if (!search.ok) return search;
    return success(freeze(s));
}
export function hashReplayState(state: GameState) { return ReplayStateHashSchema.parse(hashCanonical(state)); }
/** v2 semantic projection excludes transport identity/counters and effect event provenance. Seat-local instance IDs are retained.
 * This is conservative equivalence, not arbitrary graph-isomorphism equivalence. */
export function hashPosition(state: GameState) {
    const semanticEffect = (effect: NonNullable<GameState["resolution"]["current"]>) => {
        const { causedBySequence, ...semantic } = effect;
        void causedBySequence;
        return semantic;
    };
    const value = { ...state, resolution: { ...state.resolution, current: state.resolution.current ? semanticEffect(state.resolution.current) : null, pending: state.resolution.pending.map(semanticEffect), discovered: state.resolution.discovered.map(semanticEffect) }, match: Object.fromEntries(Object.entries(state.match).filter(([key]) => !["id", "version", "eventSequence"].includes(key))) };
    // Player UUIDs are transport identities. Replace exact values and record keys with seat identifiers.
    const seats = new Map<string, string>(state.match.playerOrder.map((id, seat) => [id, `seat:${seat}`]));
    const normalize = (x: unknown): unknown => typeof x === "string" ? seats.get(x) ?? x : Array.isArray(x) ? x.map(normalize) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [seats.get(k) ?? k, normalize(v)])) : x;
    return PositionHashSchema.parse(hashCanonical({ projection: "POSITION_V2", state: normalize(value) }));
}
export const CreateGameInputSchema = z.strictObject({ matchId: z.uuid(), players: z.array(z.uuid()).min(1), seed: z.string().min(1), setup: z.strictObject({ firstPlayerSeat: z.number().int().nonnegative(), mulligans: z.literal("DECLINED"), cuts: z.literal("DECLINED") }).optional(), format: z.enum(["CONSTRUCTED", "SEALED_LIMITED"]).optional(), decks: z.array(z.strictObject({ legends: z.array(z.string()), main: z.array(z.string()) })) });
export function buildInitialState(input: z.input<typeof CreateGameInputSchema>, context: EngineContext, dealOpeningHand = true): Result<GameState> {
    const parsed = CreateGameInputSchema.safeParse(input);
    if (!parsed.success)
        return failure("INVALID_INITIALIZATION", parsed.error.message);
    const bundle = ContentBundleSchema.safeParse(context.content);
    if (!bundle.success)
        return failure("INVALID_CONTENT", bundle.error.message);
    const b = bundle.data, policy = b.ruleset.gameplay;
    if (policy?.initialization !== "ORDERED_FIXTURE" && policy?.initialization !== "TURN_SLICE_V1")
        return failure("UNSUPPORTED_INITIALIZATION", "Official shuffle, first-player and setup policies require reviewed implementation; ORDERED_FIXTURE is test-only");
    const { players, decks, seed, matchId } = parsed.data;
    if (players.length !== decks.length || new Set(players).size !== players.length)
        return failure("INVALID_PLAYERS", "Each unique player requires a deck");
    const playerMap: Record<string, unknown> = {}, cards: Record<string, unknown> = {}, gigs: Record<string, unknown> = {};
    for (const [seat, id] of players.entries()) {
        const zones: Record<string, string[]> = { DECK: [], HAND: [], BATTLEFIELD: [], TRASH: [], EDDIES: [], LEGENDS: [], REMOVED: [] };
        let n = 0;
        for (const [zone, refs] of [["LEGENDS", decks[seat].legends], ["DECK", decks[seat].main]] as const)
            for (const ref of refs) {
                const c = b.cards.find(c => c.id === ref);
                if (!c || (zone === "LEGENDS") !== (c.type === "LEGEND"))
                    return failure("INVALID_DECK", "Initialization deck has missing content or invalid zone type");
                const instanceId = `p${seat}-c${n++}`;
                cards[instanceId] = { id: instanceId, cardId: c.id, revision: c.revision, ownerId: id, controllerId: id, zone: { playerId: id, zone }, face: "DOWN", readiness: zone === "LEGENDS" && seat === 0 && zones.LEGENDS.length < policy.firstPlayerSpentLegends ? "SPENT" : "READY", damage: 0, counters: {}, statuses: [], attachments: [] };
                zones[zone].push(instanceId);
            }
        // Ordered fixtures deliberately have no hidden shuffle semantics.
        for (let i = 0; dealOpeningHand && i < policy.openingHand && zones.DECK.length; i++) {
            const cid = zones.DECK.shift()!;
            zones.HAND.push(cid);
            const card = cards[cid] as {
                zone: {
                    zone: string;
                };
            };
            card.zone.zone = "HAND";
        }
        const fixer: string[] = [];
        for (const dieType of ["D4", "D6", "D8", "D10", "D12", "D20"]) {
            const gid = `p${seat}-${dieType}`;
            fixer.push(gid);
            gigs[gid] = { id: gid, ownerId: id, controllerId: id, location: { playerId: id, zone: "FIXER" }, dieType, roll: { kind: "UNROLLED" } };
        }
        playerMap[id] = { id, seat, zones, economy: { sellsThisTurn: 0 }, gigs: { FIXER: fixer, GIGS: [] }, statuses: [] };
    }
    const initial = { schemaVersion: 2, match: { id: matchId, version: 0, eventSequence: 0, rulesetId: b.ruleset.id, rulesetVersion: b.ruleset.version, rulesetHash: b.manifest.ruleset.hash, contentManifestHash: b.manifestHash, engineVersion: b.manifest.engine.version, engineArtifactHash: b.manifest.engine.artifactHash, cards: b.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision })), playerOrder: players }, timing: { turn: 1, activePlayer: players[0], actingPlayer: players[0], window: "MAIN", combat: { stage: "NONE" } }, players: playerMap, objects: { cards, gigs }, resolution: { stage: "DECISION", current: null, pending: [], discovered: [], choice: null }, rng: { algorithm: "SHA256_COUNTER_V1", seed, counter: 0 } };
    return dealOpeningHand ? validateState(initial, context) : success(GameStateSchema.parse(initial));
}
export function requirePlayer(state: GameState, actor: PlayerId): boolean { return Boolean(state.players[actor]); }
