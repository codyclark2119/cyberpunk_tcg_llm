import { failure, success, type CardInstanceId, type GameState, type PendingChoice, type Result } from "@tcg/domain";
import type { EngineContext } from "./state";
import type { TurnMutation } from "./turn";
import { cardRevision } from "./characteristics";
import { legalEquipHosts } from "./attachments";
import { attachPlayedGear, moveCardLocation } from "./card-movement";
import { supportsPlay } from "./play-support";
import { recordCyberwareGearPlay } from "./play-cost-support";
import { supportsQuickActivationCard } from "./quick-activation-support";

type Step = (m: TurnMutation) => Result<null>;
type Option = PendingChoice["options"][number];
const KIND = "REVEAL_TOP_MAY_PLAY_FREE_ELSE_HAND";
/** Batch V95: content holding the reviewed Unit whose activation reveals the top card of its controller's deck to play for free. */
export function deckTopPlayEnabled(context: EngineContext) {
    return context.content.cards.some(r => r.type === "UNIT" && r.mechanics.abilities.some(a => a.effects.some(e => e.kind === KIND)) && supportsQuickActivationCard(r, context).ok);
}
/** The card the current effect revealed: the top card of its controller's deck, while the activation resolves it. */
export function revealedDeckTop(state: GameState): CardInstanceId[] {
    const current = state.resolution.current, c = state.resolution.playContinuation, top = current ? state.players[current.controllerId]?.zones.DECK[0] : undefined;
    return current?.effect.kind === KIND && c?.kind === "ACTIVATE" && top ? [top] : [];
}
/** "You may play it for free": a Unit, Program or Gear the engine can play (a Gear onto a legal host), with a printed Eddie cost. Any
 * other card can only be added to hand (fail-closed). */
export function mayPlayDeckTop(state: GameState, id: CardInstanceId, context: EngineContext) {
    const r = cardRevision(state, id, context);
    return Boolean(r && ["UNIT", "PROGRAM", "GEAR"].includes(r.type) && r.printedCost.kind === "EDDIES" && supportsPlay(r, context).ok && (r.type !== "GEAR" || legalEquipHosts(state, id, context).length > 0));
}
/** The pause's options: add it to hand, or play it (a Gear onto each legal host). */
export function deckTopOptions(state: GameState, context: EngineContext): Option[] {
    const [top] = revealedDeckTop(state);
    if (!top || !mayPlayDeckTop(state, top, context)) return [];
    return cardRevision(state, top, context)?.type === "GEAR" ? [{ kind: "CONFIRM", confirmed: false }, ...legalEquipHosts(state, top, context).map(cardInstanceId => ({ kind: "CARD" as const, cardInstanceId }))]
        : [{ kind: "CONFIRM", confirmed: false }, { kind: "CONFIRM", confirmed: true }];
}
/** An empty deck reveals nothing. A card the engine cannot play goes to hand without a choice; otherwise its controller chooses. */
export function resolveDeckTop(m: TurnMutation, offer: Step): Result<null> {
    const [top] = revealedDeckTop(m.state);
    if (!top) return success(null);
    m.emit({ kind: "CARD_REVEALED", cardInstanceId: top });
    if (!mayPlayDeckTop(m.state, top, m.context)) { moveCardLocation(m, top, "HAND"); return success(null); }
    return offer(m);
}
/** "Otherwise, add it to your hand"; or play it for free (11.20.2): a Gear is equipped to the chosen host, ready, and counted as played,
 * its play batch following the ability; a Unit or Program is played, paying nothing, once the ability has resolved. */
export function chooseDeckTop(m: TurnMutation, option: Option): Result<null> {
    const s = m.state, c = s.resolution.playContinuation!, [top] = revealedDeckTop(s);
    if (!top || !mayPlayDeckTop(s, top, m.context)) return failure("INVALID_DECK_PLAY", "A revealed card that may be played is required");
    s.resolution.choice = null;
    if (option.kind === "CONFIRM" && !option.confirmed) { moveCardLocation(m, top, "HAND"); return success(null); }
    if (cardRevision(s, top, m.context)?.type !== "GEAR") {
        if (option.kind !== "CONFIRM") return failure("INVALID_DECK_PLAY", "Play the revealed card or add it to your hand");
        c.deckPlayId = top;
        return success(null);
    }
    if (option.kind !== "CARD" || !legalEquipHosts(s, top, m.context).includes(option.cardInstanceId)) return failure("INVALID_EQUIP_TARGET", "Add the Gear to your hand or choose a current host");
    const attached = attachPlayedGear(m, top, option.cardInstanceId);
    if (!attached.ok) return attached;
    s.objects.cards[top].readiness = "READY";
    recordCyberwareGearPlay(m, c.actorId, top);
    m.emit({ kind: "CARD_PLAYED", cardInstanceId: top });
    c.playedGearId = top;
    return success(null);
}
/** The activation pauses only over a revealed card that may be played, before either destination is chosen. */
export function validateDeckTopPause(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation!, [top] = revealedDeckTop(state);
    if (!top || !mayPlayDeckTop(state, top, context) || state.timing.step !== "TARGET_SELECTION" || c.deckPlayId || c.playedGearId || state.timing.combat.stage !== "NONE")
        return failure("INVALID_DECK_PLAY", "A deck reveal pauses only over a top card that may be played");
    return success(null);
}
/** A chosen top card never survives to a decision; a free play from the deck is a Unit's or Program's, under the reviewed Unit. */
export function validateDeckTopPlay(state: GameState, context: EngineContext) {
    const c = state.resolution.playContinuation;
    if (c?.deckPlayId) return failure("INVALID_DECK_PLAY", "A chosen top card is played at once");
    if (c?.freeFromDeck && (c.kind !== "PLAY" || !["UNIT", "PROGRAM"].includes(cardRevision(state, c.sourceId, context)?.type ?? "") || !deckTopPlayEnabled(context)))
        return failure("INVALID_DECK_PLAY", "Only a Unit or Program is played for free from the deck, by its reviewed Unit");
    return success(null);
}
