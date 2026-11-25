import { turnSliceAllows, canonicalSerialize, failure, success, type CardInstanceId, type CardRevisionSnapshot, type DeepReadonly, type GameState, type PlayerId, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { moveCardLocation } from "./card-movement";

/** Batch V77+: Programs whose revealed cards a Rival sends to hand or trash, each pinned whole. Anything not listed is absent. */
const RIVAL_REVEAL_SHAPES = [
    // Batch V77: Fool on the Hill. "Reveal the top 2 cards of your deck. A Rival chooses whether you add them to your hand or trash
    // them. If you trash them, draw 2."
    { colors: ["GREEN"], ram: { GREEN: 3 }, tags: ["Merc"], cost: 2, effects: [{ kind: "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH", count: 2, drawIfTrashed: 2 }] }
].map(({ effects, ...shape }) => canonicalSerialize({ type: "PROGRAM", sell: true, power: null, keywords: [], equip: null, modifiers: [], restrictions: [], ...shape,
    abilities: [{ trigger: "WHEN_PLAYED", inherited: null, guard: null, activation: null, conditions: [], abilityCost: { kind: "NONE" }, choose: null, effects }] }));
/** The Rival-choice reveal routes here first, so no other gate can admit what it does not read. */
export function hasRivalRevealEffect(card: DeepReadonly<CardRevisionSnapshot> | undefined) {
    return Boolean(card?.mechanics.abilities.some(a => a.effects.some(e => e.kind === "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH")));
}
export function supportsRivalRevealProgram(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const g = context.content.ruleset.gameplay, m = card?.mechanics;
    if (!turnSliceAllows(g?.turnSlice, "cardPlay") || g?.gigValueBounds !== "DIE_FACES_V1" || !card?.provenance.reviewed || card.execution?.scope !== "NONCOMBAT_PLAY_V1" || card.execution.status !== "SUPPORTED"
        || card.keywords.length || card.printedCost.kind !== "EDDIES" || !m || !RIVAL_REVEAL_SHAPES.includes(canonicalSerialize({ type: card.type, sell: card.sellProfile.allowed, power: card.power ?? null, keywords: m.keywords, equip: m.equip ?? null, modifiers: m.modifiers, restrictions: m.restrictions ?? [],
            colors: card.colors, ram: card.ram, tags: card.tags, cost: card.printedCost.amount,
            abilities: m.abilities.map(a => ({ trigger: a.trigger ?? null, inherited: a.inherited ?? null, guard: a.guard ?? null, activation: a.activation ?? null, conditions: a.conditions, abilityCost: a.cost, choose: a.choose ?? null, effects: a.effects })) })))
        return failure("UNSUPPORTED_RIVAL_REVEAL", "Complete reviewed printed Program with an exact Rival-choice reveal required");
    return success(null);
}
/** The only other player (the engine plays two-player matches). */
export function rivalOf(state: GameState, player: PlayerId): PlayerId {
    return state.match.playerOrder.find(p => p !== player)!;
}
/** While the reveal is current: the controller's top cards it revealed (fewer when the deck is short). They stay on top of the deck,
 * public, until the Rival chooses. */
export function revealedTop(state: GameState, controller: PlayerId): CardInstanceId[] {
    const e = state.resolution.current?.effect;
    return e?.kind === "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH" && state.resolution.playContinuation?.kind === "PLAY" ? state.players[controller].zones.DECK.slice(0, e.count) : [];
}
/** Reveals the top cards and hands the choice to the Rival; an empty deck reveals nothing and there is nothing to choose. */
export function resolveRivalReveal(m: TurnMutation, offer: (m: TurnMutation) => Result<null>): Result<null> {
    const s = m.state, current = s.resolution.current!, cards = revealedTop(s, current.controllerId);
    if (!cards.length) return success(null);
    for (const id of cards) m.emit({ kind: "CARD_REVEALED", cardInstanceId: id });
    s.timing.actingPlayer = rivalOf(s, current.controllerId);
    return offer(m);
}
/** The Rival's choice: the revealed cards go to their owner's hand, or to the trash and the owner draws 2. */
export function chooseRivalReveal(m: TurnMutation, destination: string): Result<null> {
    const s = m.state, current = s.resolution.current!, controller = current.controllerId, cards = revealedTop(s, controller);
    if (current.effect.kind !== "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH" || !cards.length || (destination !== "HAND" && destination !== "TRASH")) return failure("INVALID_DESTINATION", "Choose hand or trash for the revealed cards");
    s.resolution.choice = null;
    m.emit({ kind: "DESTINATION_CHOSEN", effectId: current.id, playerId: rivalOf(s, controller), destination });
    s.timing.actingPlayer = controller;
    for (const id of cards) moveCardLocation(m, id, destination);
    return destination === "TRASH" ? m.draw(controller, current.effect.drawIfTrashed) : success(null);
}
/** Batch V77, V78, V79: the current play effects whose choice another player may hold while the controller's turn continues. */
export function otherPlayerMayChoose(state: GameState) {
    const kind = state.resolution.current?.effect.kind;
    return kind === "REVEAL_TOP_RIVAL_CHOOSES_HAND_OR_TRASH" || kind === "EACH_PLAYER_DISCARDS_HAND_MAY_DRAW" || kind === "FRIENDLY_UNIT_READY_ATTACK_AND_POWER"; // Batch V79.
}
