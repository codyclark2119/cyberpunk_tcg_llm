import { z } from "zod";
import { DeckSchema, ContentBundleSchema, validateDeck, GameStateSchema, failure, success, type GameState, type Result, type GameEvent } from "@tcg/domain";
import { buildInitialState, CreateGameInputSchema, type EngineContext } from "./state";
import { TurnMutation } from "./turn";
import { drawDeterministicInteger } from "./rng";
import { RulesView } from "./view";
export function createGameWithEvents(input: z.input<typeof CreateGameInputSchema>, context: EngineContext): Result<{
    state: GameState;
    events: GameEvent[];
}> {
    const parsed = CreateGameInputSchema.safeParse(input);
    if (!parsed.success)
        return failure("INVALID_INITIALIZATION", parsed.error.message);
    const bundleCheck = ContentBundleSchema.safeParse(context.content);
    if (!bundleCheck.success)
        return failure("INVALID_CONTENT", bundleCheck.error.message);
    if (context.content.ruleset.gameplay?.initialization !== "TURN_SLICE_V1") {
        const old = buildInitialState(input, context);
        return old.ok ? success({ state: old.value, events: [] }) : old;
    }
    const request = parsed.data, rules = context.content.ruleset.gameplay, policy = rules.turnSlice;
    if (!policy || !request.setup || request.players.length !== 2 || request.setup.firstPlayerSeat >= 2)
        return failure("UNSUPPORTED_SETUP", "Two players and explicit agreed first-player/declined mulligan/cut decisions are required");
    if (request.format && request.format !== "CONSTRUCTED")
        return failure("UNSUPPORTED_SETUP_FORMAT", "This initializer currently supports constructed/catalog decks only");
    for (const deck of request.decks) {
        const d = DeckSchema.safeParse({ name: "Initialization", legends: deck.legends, cards: deck.main.map(cardId => ({ cardId, quantity: 1 })) });
        if (!d.success)
            return failure("INVALID_DECK", d.error.message);
        const bundle = ContentBundleSchema.parse(context.content);
        const valid = validateDeck(d.data, bundle.cards, bundle.ruleset);
        if (!valid.legal)
            return failure("INVALID_DECK", JSON.stringify(valid.issues));
        if (deck.main.length < rules.openingHand)
            return failure("INVALID_DECK", "Deck cannot supply opening hand");
    }
    const built = buildInitialState(request, context, false);
    if (!built.ok)
        return built;
    const s = GameStateSchema.parse(built.value), first = s.match.playerOrder[request.setup.firstPlayerSeat];
    s.timing.firstPlayer = first;
    s.timing.activePlayer = first;
    s.timing.actingPlayer = first;
    s.timing.step = "MAIN";
    for (const p of Object.values(s.players))
        p.economy = { sellsThisTurn: 0, callsThisTurn: 0, usageTurn: 1 };
    const shuffle = <T>(items: T[]) => { for (let i = items.length - 1; i > 0; i--) {
        const r = drawDeterministicInteger(s.rng, i + 1);
        s.rng = r.rng;
        [items[i], items[r.rawValue - 1]] = [items[r.rawValue - 1], items[i]];
    } };
    for (const id of s.match.playerOrder) {
        const p = s.players[id];
        shuffle(p.zones.DECK);
        shuffle(p.zones.LEGENDS);
        for (const [index, cid] of p.zones.LEGENDS.entries())
            s.objects.cards[cid].readiness = id === first && index < rules.firstPlayerSpentLegends ? "SPENT" : "READY";
    }
    // Capability admission is deck-wide, never a hidden-Legend-specific label/filter.
    const view = new RulesView(s, context);
    for (const c of Object.values(s.objects.cards)) {
        const content = view.getRevision(c.id)!;
        if (content.type === "LEGEND") {
            const supported = view.callEffectSupport(c.id);
            if (!supported.ok)
                return supported;
        }
        else if (content.mechanics.abilities.length || content.mechanics.modifiers.length)
            return failure("UNSUPPORTED_CARD_EFFECT", "Turn slice requires cards without unsupported automatic effects");
    }
    const mutation = new TurnMutation(s, context);
    for (const actor of s.match.playerOrder) {
        const dealt = mutation.draw(actor, rules.openingHand);
        if (!dealt.ok)
            return dealt;
    }
    const started = mutation.startTurn();
    if (!started.ok)
        return started;
    return mutation.result(false);
}
export function createGame(input: z.input<typeof CreateGameInputSchema>, context: EngineContext): Result<GameState> {
    const initialized = createGameWithEvents(input, context);
    return initialized.ok ? success(initialized.value.state) : initialized;
}
