import { validateAttackConditionPowerMetadata } from "./attack-condition-power-support";
import { validateTargetedSpendMetadata } from "./targeted-spend-support";
import { validateTargetedDefeatMetadata } from "./targeted-defeat-support";
import { validateValueConditionMetadata } from "./value-conditions-support";
import { validateAttackingAuraMetadata } from "./attacking-aura-support";
import { validateFirstAttackMetadata } from "./first-attack-support";
import { validateFirstAttackHistory } from "./first-attack-history";
import { validateFieldLegendMetadata } from "./field-legend-support";
import { validateDelayedMetadata } from "./delayed-effect-support";
import { validateDelayedState } from "./delayed-effects";
import { validateEndTurnMetadata } from "./end-turn-support";
import { validateOrderedMetadata } from "./ordered-effects-support";
import { validatePrivateLookMetadata } from "./private-look-support";
import { validateCapabilityMetadata } from "./capability-support";
import { firstAttackHistoryEnabled } from "./first-attack-support";
import { initialFirstAttackHistory } from "./first-attack-history";
import { triggersEnabled } from "./trigger-support";
import { supportsPlay } from "./play-support";
import { beginSetup } from "./setup";
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
    const engineSetup = policy?.setup === "ENGINE_SETUP_V1";
    if (!policy || request.players.length !== 2 || (!engineSetup && (!request.setup || request.setup.firstPlayerSeat >= 2)))
        return failure("UNSUPPORTED_SETUP", "Two players and explicit agreed first-player/declined mulligan/cut decisions are required");
    if (engineSetup && request.setup) return failure("INVALID_SETUP_INPUT", "Engine-owned setup does not accept external first-player, cut or mulligan decisions");
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
    const s = GameStateSchema.parse(built.value), first = s.match.playerOrder[request.setup?.firstPlayerSeat ?? 0];
    s.timing.firstPlayer = first;
    s.timing.activePlayer = first;
    s.timing.actingPlayer = first;
    s.timing.step = "MAIN";
    for (const p of Object.values(s.players))
        p.economy = { sellsThisTurn: 0, callsThisTurn: 0, usageTurn: 1 };
    if (triggersEnabled(context)) s.turnHistory = { ...(firstAttackHistoryEnabled(context) ? { firstArasakaAttacks: initialFirstAttackHistory(s) } : {}), turn: 1, triggeredBatches: 0, blueUnitOrGearPlays: Object.fromEntries(s.match.playerOrder.map(id => [id, 0])) };
    // Capability admission is deck-wide, never a hidden-Legend-specific label/filter.
    const attackPowerMetadata = validateAttackConditionPowerMetadata(s, context); if (!attackPowerMetadata.ok) return attackPowerMetadata;
    const spendMetadata = validateTargetedSpendMetadata(s, context); if (!spendMetadata.ok) return spendMetadata;
    const targetedMetadata = validateTargetedDefeatMetadata(s, context); if (!targetedMetadata.ok) return targetedMetadata;
    const valueMetadata = validateValueConditionMetadata(s, context); if (!valueMetadata.ok) return valueMetadata;
    const auraMetadata = validateAttackingAuraMetadata(s, context); if (!auraMetadata.ok) return auraMetadata;
    const firstMetadata = validateFirstAttackMetadata(s, context); if (!firstMetadata.ok) return firstMetadata;
    const firstHistory = validateFirstAttackHistory(s, context); if (!firstHistory.ok) return firstHistory;
    const fieldMetadata = validateFieldLegendMetadata(s, context); if (!fieldMetadata.ok) return fieldMetadata;
    const delayedMetadata = validateDelayedMetadata(s, context); if (!delayedMetadata.ok) return delayedMetadata;
    const delayedState = validateDelayedState(s, context); if (!delayedState.ok) return delayedState;
    const endMetadata = validateEndTurnMetadata(s, context); if (!endMetadata.ok) return endMetadata;
    const ordered = validateOrderedMetadata(s, context);
    if (!ordered.ok) return ordered;
    const privateLook = validatePrivateLookMetadata(s, context);
    if (!privateLook.ok) return privateLook;
    const capabilities = validateCapabilityMetadata(s, context);
    if (!capabilities.ok) return capabilities;
    const view = new RulesView(s, context);
    for (const c of Object.values(s.objects.cards)) {
        const content = view.getRevision(c.id)!;
        if (policy.callEffects === "REVIEWED_CALL_V1" && content.execution?.status !== "SUPPORTED") return failure("UNREVIEWED_EXECUTION", "Reviewed gameplay requires an explicit executable coverage decision for every deck card");
        if (content.execution?.status === "UNSUPPORTED") return failure("UNSUPPORTED_CARD_EFFECT", "Corpus presence does not certify executable support");
        if (content.type === "LEGEND") {
            const supported = view.callEffectSupport(c.id);
            if (!supported.ok)
                return supported;
        }
        else if (content.execution?.scope === "ATTACK_CONDITION_POWER_V1" || content.execution?.scope === "TARGETED_SPEND_V1" || content.execution?.scope === "TARGETED_DEFEAT_V1" || content.execution?.scope === "VALUE_CONDITIONS_V1" || content.execution?.scope === "NONCOMBAT_PLAY_V1" || content.execution?.scope === "COMBAT_ATTACK_V1" || content.execution?.scope === "COMBAT_REACT_V1" || content.execution?.scope === "COMBAT_RESTRICTIONS_V1" || content.execution?.scope === "COMBAT_TRIGGERS_V1" || content.execution?.scope === "GEAR_CAPABILITIES_V1" || content.execution?.scope === "GEAR_PRIVATE_LOOK_V1" || content.execution?.scope === "ATTACK_ORDERED_EFFECTS_V1" || content.execution?.scope === "END_TURN_HISTORY_V1" || content.execution?.scope === "GEAR_DELAYED_ATTACK_V1") {
            const supported = supportsPlay(content, context);
            if (!supported.ok) return supported;
        }
        else if (content.mechanics.restrictions?.length || content.mechanics.equip || content.mechanics.abilities.length || content.mechanics.modifiers.length)
            return failure("UNSUPPORTED_CARD_EFFECT", "Turn slice requires cards without unsupported automatic effects");
    }
    if (engineSetup) {
        delete s.turnHistory;
        const mutation = new TurnMutation(s, context);
        const begun = beginSetup(mutation);
        return begun.ok ? mutation.result(false) : begun;
    }
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
