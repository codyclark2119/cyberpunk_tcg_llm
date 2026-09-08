import { canonicalSerialize, hashCanonical, failure, success, type GameState, type PendingChoice } from "@tcg/domain";
import type { EngineContext } from "./state";

/** Agreed setup protocol: uniform seat draw, Fisher–Yates, single cyclic cut.
 * Seat order serializes independent rival cuts; mulligans follow first-player order. */
export function setupChoice(state: GameState): PendingChoice {
    const setup = state.setup!;
    const actorId = state.match.playerOrder[setup.decidingSeat];
    const options: PendingChoice["options"] = setup.stage === "FIRST_PLAYER"
        ? [{ kind: "MODE", mode: "FIRST" }, { kind: "MODE", mode: "SECOND" }]
        : setup.stage === "MULLIGAN"
            ? [{ kind: "CONFIRM", confirmed: false }, { kind: "CONFIRM", confirmed: true }]
            : Array.from({ length: state.players[state.match.playerOrder[setup.completed]].zones[setup.stage === "MAIN_CUT" ? "DECK" : "LEGENDS"].length }, (_, amount) => ({ kind: "AMOUNT", amount }));
    return { id: hashCanonical({ protocol: "setup@1", stage: setup.stage, decidingSeat: setup.decidingSeat, completed: setup.completed }), actorId, kind: setup.stage === "FIRST_PLAYER" ? "MODE" : setup.stage === "MULLIGAN" ? "OPTIONAL" : "AMOUNT", options, min: 1, max: 1, ordered: false, continuationId: "setup@1" };
}
export function validateSetupState(state: GameState, context: EngineContext) {
    const setup = state.setup, rules = context.content.ruleset.gameplay;
    if (!setup || rules?.turnSlice?.setup !== "ENGINE_SETUP_V1" || state.match.playerOrder.length !== 2 || state.timing.turn !== 0 || state.timing.window !== "SETUP" || state.timing.combat.stage !== "NONE" || state.match.outcome)
        return failure("INVALID_SETUP", "Setup requires its pinned two-player protocol and turn zero");
    const { stage, completed, decidingSeat } = setup, ids = state.match.playerOrder;
    const step = stage === "FIRST_PLAYER" ? "CHOOSE_FIRST_PLAYER" : stage === "MULLIGAN" ? "MULLIGAN_DECISION" : "CUT_DECISION";
    const first = state.timing.firstPlayer;
    if (state.timing.step !== step || state.timing.actingPlayer !== ids[decidingSeat] || state.timing.activePlayer !== (first ?? ids[decidingSeat]) ||
        (stage === "FIRST_PLAYER" ? first !== undefined || completed !== 0 : !first || !ids.includes(first)) ||
        ((stage === "MAIN_CUT" || stage === "LEGEND_CUT") && decidingSeat !== 1 - completed) ||
        (stage === "MULLIGAN" && decidingSeat !== (state.players[first!].seat + completed) % 2))
        return failure("INVALID_SETUP_ORDER", "Setup actor, first-player selection, step or decision order disagrees");
    if (state.resolution.stage !== "CHOICE" || state.resolution.current || state.resolution.pending.length || state.resolution.discovered.length || state.resolution.callContinuation || state.resolution.searchContinuation || canonicalSerialize(state.resolution.choice) !== canonicalSerialize(setupChoice(state)))
        return failure("INVALID_SETUP_CHOICE", "Setup choice must exactly match the authoritative continuation");
    for (const id of ids) {
        const p = state.players[id];
        const dice = Object.values(state.objects.gigs).filter(g => g.ownerId === id);
        if (dice.length !== 6 || new Set(dice.map(g => g.dieType)).size !== 6 || dice.some(g => g.roll.kind !== "UNROLLED" || g.controllerId !== id || g.location.zone !== "FIXER") ||
            p.economy.usageTurn !== 0 || p.economy.callsThisTurn !== 0 || p.economy.sellsThisTurn !== 0 || p.statuses.length ||
            p.zones.HAND.length !== (stage === "MULLIGAN" ? rules.openingHand : 0) || p.zones.LEGENDS.length !== 3 ||
            [p.zones.TRASH, p.zones.EDDIES, p.zones.BATTLEFIELD, p.zones.REMOVED].some(z => z.length))
            return failure("INVALID_SETUP_OBJECTS", "Setup hands, zones, dice and usage must remain in their setup configuration");
        for (const c of Object.values(state.objects.cards).filter(c => c.ownerId === id)) {
            const expectedSpent = stage === "MULLIGAN" && id === first && c.zone.zone === "LEGENDS" && p.zones.LEGENDS.indexOf(c.id) < rules.firstPlayerSpentLegends;
            if (c.controllerId !== id || c.zone.playerId !== id || c.face !== "DOWN" || c.damage || c.statuses.length || c.attachments.length || Object.keys(c.counters).length || c.readiness !== (expectedSpent ? "SPENT" : "READY"))
                return failure("INVALID_SETUP_CARD", "Setup cards cannot carry gameplay mutations");
        }
    }
    return success(null);
}
export function setupChoiceLabel(state: GameState, index: number): string {
    const setup = state.setup!, option = setupChoice(state).options[index];
    if (option.kind === "MODE") return option.mode === "FIRST" ? "Go first" : "Go second";
    if (option.kind === "CONFIRM") return option.confirmed ? "Mulligan the entire opening hand" : "Keep the opening hand";
    if (option.kind === "AMOUNT") return option.amount === 0 ? `Decline ${setup.stage === "MAIN_CUT" ? "main deck" : "Legend"} cut` : `Cut rival ${setup.stage === "MAIN_CUT" ? "main deck" : "Legends"} after slot ${option.amount}`;
    throw new Error("Invalid setup option");
}
