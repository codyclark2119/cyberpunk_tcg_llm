import { turnSliceAllows, canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { moveCardLocation } from "./card-movement";
import { rivalOf } from "./rival-reveal";

/** Batch V78+: Programs that discard every hand and let each player draw, each pinned whole. Anything not listed is absent. */
const HAND_RESET_SHAPES = [
    // Batch V78: Shattered Memories. "Each player discards their hand and may draw 5. If the total number of discarded cards equals the
    // value of a friendly Gig, draw 2."
    { colors: ["RED"], ram: { RED: 2 }, tags: ["Braindance"], cost: 4, effects: [{ kind: "EACH_PLAYER_DISCARDS_HAND_MAY_DRAW", draw: 5, drawIfTotalMatchesFriendlyGig: 2 }] }
].map(({ effects, ...shape }) => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape,
    abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects }] }));
/** The hand reset routes here first, so no other gate can admit what it does not read. */
export function hasHandResetEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "EACH_PLAYER_DISCARDS_HAND_MAY_DRAW")));
}
export function supportsHandResetProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !HAND_RESET_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_HAND_RESET", "Complete reviewed printed Program with an exact hand reset required");
    return success(null);
}
/** The effect's controller first, then the Rival: the order the discards happen and the draw choices are offered. */
export function handResetOrder(state: GameState, controller: PlayerId): PlayerId[] {
    return [controller, rivalOf(state, controller)];
}
/** Discards both hands (the controller's first), records them, and offers the controller the draw. */
export function resolveHandReset(m: TurnMutation, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.playContinuation;
    if (current.effect.kind !== "EACH_PLAYER_DISCARDS_HAND_MAY_DRAW" || c?.kind !== "PLAY" || !current.sourceId) return failure("INVALID_HAND_RESET", "A hand reset resolves only from its played Program");
    const discarded = [];
    for (const player of handResetOrder(s, current.controllerId))
        for (const id of [...s.players[player].zones.HAND]) {
            moveCardLocation(m, id, "TRASH");
            m.emit({ kind: "CARD_DISCARDED", cardInstanceId: id, playerId: player, sourceId: current.sourceId, effectId: current.id, forced: true });
            discarded.push(id);
        }
    c.discardedIds = discarded;
    s.timing.actingPlayer = current.controllerId;
    return offer(m);
}
/** "If the total number of discarded cards equals the value of a friendly Gig": the controller's own rolled Gigs. */
export function totalMatchesFriendlyGig(state: GameState, controller: PlayerId, total: number) {
    return Object.values(state.objects.gigs).some(g => g.controllerId === controller && g.location.zone === "GIGS" && g.roll.kind === "ROLLED" && g.roll.currentValue === total);
}
/** The acting player's choice. After the controller the Rival chooses; after the Rival the controller may draw 2. `done` is true once
 * the effect has finished (or a draw from an empty deck ended the game). */
export function chooseHandResetDraw(m: TurnMutation, draw: boolean): Result<{ done: boolean }> {
    const s = m.state, current = s.resolution.current!, c = s.resolution.playContinuation, controller = current.controllerId, chooser = s.timing.actingPlayer;
    if (current.effect.kind !== "EACH_PLAYER_DISCARDS_HAND_MAY_DRAW" || !c?.discardedIds || !handResetOrder(s, controller).includes(chooser)) return failure("INVALID_OPTIONAL_DRAW", "Choose whether to draw");
    const effect = current.effect, total = c.discardedIds.length;
    s.resolution.choice = null;
    m.emit({ kind: "OPTIONAL_DRAW_CHOSEN", effectId: current.id, playerId: chooser, draw });
    if (draw) {
        const drawn = m.draw(chooser, effect.draw);
        if (!drawn.ok || s.match.outcome) { s.timing.actingPlayer = s.timing.activePlayer; return drawn.ok ? success({ done: true }) : drawn; }
    }
    if (chooser === controller) { s.timing.actingPlayer = rivalOf(s, controller); return success({ done: false }); }
    s.timing.actingPlayer = controller;
    delete c.discardedIds;
    if (totalMatchesFriendlyGig(s, controller, total)) {
        const drawn = m.draw(controller, effect.drawIfTotalMatchesFriendlyGig);
        if (!drawn.ok) return drawn;
    }
    return success({ done: true });
}
/** Exact pause: recorded discards that are still public in their owners' trash, and an acting player who is the controller or Rival. */
export function validateHandReset(state: GameState, controller: PlayerId) {
    const c = state.resolution.playContinuation, ids = c?.discardedIds;
    if (!ids || new Set(ids).size !== ids.length || ids.some(id => { const card = state.objects.cards[id]; return !card || card.face !== "UP" || card.zone.zone !== "TRASH" || card.zone.playerId !== card.ownerId; })
        || !handResetOrder(state, controller).includes(state.timing.actingPlayer) || state.timing.step !== "TARGET_SELECTION")
        return failure("INVALID_HAND_RESET", "A hand reset pauses only for each player's draw choice over its recorded public discards");
    return success(null);
}
