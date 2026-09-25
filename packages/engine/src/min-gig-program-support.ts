import { canonicalSerialize, failure, success, type CardRevisionSnapshot, type DeepReadonly, type GameState } from "@tcg/domain";
import type { EngineContext } from "./state";

export function minGigProgramEnabled(context: EngineContext) {
    return context.content.ruleset.gameplay?.turnSlice?.minGigProgram === "MIN_GIG_PROGRAM_V1";
}

/** Complete Trust No One shape. No name dispatch and no generic expression language. */
export function supportsMinGigProgramCard(card: DeepReadonly<CardRevisionSnapshot> | undefined, context: EngineContext) {
    const m = card?.mechanics, a = m?.abilities[0], policy = context.content.ruleset.gameplay?.turnSlice;
    const effects = [
        { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 3, direction: "DECREASE" },
        { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_VALUE", value: 1 }, count: 1 }
    ];
    if (!minGigProgramEnabled(context) || policy?.cardPlay !== "NONCOMBAT_PLAY_V1" ||
        context.content.ruleset.gameplay?.gigValueBounds !== "DIE_FACES_V1" ||
        !card?.provenance.reviewed || card.execution?.scope !== "MIN_GIG_PROGRAM_V1" || card.execution.status !== "SUPPORTED" ||
        card.type !== "PROGRAM" || card.printedCost.kind !== "EDDIES" || card.printedCost.amount !== 1 || card.power !== undefined ||
        !card.sellProfile.allowed || canonicalSerialize(card.colors) !== canonicalSerialize(["BLUE"]) ||
        canonicalSerialize(card.ram) !== canonicalSerialize({ BLUE: 1 }) || canonicalSerialize(card.tags) !== canonicalSerialize(["Braindance"]) ||
        card.keywords.length || !m || m.equip || m.keywords.length || m.modifiers.length || m.restrictions?.length ||
        m.abilities.length !== 1 || !a || a.trigger !== "WHEN_PLAYED" || a.activation || a.inherited || a.guard ||
        a.conditions.length || a.cost.kind !== "NONE" || canonicalSerialize(a.effects) !== canonicalSerialize(effects))
        return failure("UNSUPPORTED_MIN_GIG_PROGRAM", "Complete reviewed Blue RAM1 cost1 Braindance Program with decrease-up-to3 then current min-Gig draw required");
    return success(null);
}

/** Directional decrease metadata belongs to this exact reviewed scope and fails closed elsewhere. */
export function hasMinGigProgramMetadata(card: DeepReadonly<CardRevisionSnapshot>) {
    return card.execution?.scope === "MIN_GIG_PROGRAM_V1" ||
        card.mechanics.abilities.some(a => a.effects.some(e => e.kind === "ADJUST_GIG_UP_TO" && e.direction === "DECREASE"));
}
export function validateMinGigProgramMetadata(state: GameState, context: EngineContext) {
    for (const c of Object.values(state.objects.cards)) {
        const r = context.content.cards.find(r => r.id === c.cardId && r.revision === c.revision);
        if (r && hasMinGigProgramMetadata(r)) {
            const supported = supportsMinGigProgramCard(r, context);
            if (!supported.ok) return supported;
        }
    }
    return success(null);
}
