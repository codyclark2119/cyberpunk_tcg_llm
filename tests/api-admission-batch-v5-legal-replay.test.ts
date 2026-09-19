import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, hashReplayState, RulesView, validateState } from "@tcg/engine";
import { listAttackTargets } from "../packages/engine/src/combat-queries";
import { DETONATE, batchV5Context } from "./api-admission-batch-v5-fixture";
import { batchV5Replay, type BatchV5Mode } from "./api-admission-batch-v5-replay";
import { must } from "./api-admission-batch-v4-replay";

const cache = new Map<BatchV5Mode, ReturnType<typeof batchV5Replay>>();
function replay(mode: BatchV5Mode) {
    let result = cache.get(mode);
    if (!result) { result = batchV5Replay(mode); cache.set(mode, result); }
    return result;
}
const FIGHT_FACTS = ["FIGHT_STARTED", "FIGHT_RESULT", "FIGHT_DEFEAT_PREVENTED", "FIGHT_PREVENTION_CONSUMED"];

for (const mode of ["MAIN", "REACT"] as const) {
    test(`real Detonate ${mode} reaches a paid two-target choice through legal setup, turns and equips`, () => {
        const r = replay(mode), { pausedTarget: paused, pendingPayment: payment, context } = r;
        assert.equal(r.beforeSource.objects.cards[r.sourceId].zone.zone, "HAND", "V5_REAL_SOURCE_IN_HAND");
        assert.equal(r.beforeSource.objects.cards[r.sourceId].cardId, DETONATE, "V5_REAL_DETONATE_REVISION");
        assert.equal(payment.resolution.choice?.kind, "PAYMENT", "V5_REAL_PAID_PLAY");
        assert.equal(paused.objects.cards[r.sourceId].zone.zone, "RESOLVING_PROGRAM");
        assert.equal(paused.timing.step, "TARGET_SELECTION");
        assert.equal(paused.timing.actingPlayer, r.caster);
        assert.deepEqual(paused.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : null).sort(), [r.chosenId, r.siblingId].sort(), "V5_REAL_TWO_TARGET_PAUSE");
        const view = new RulesView(paused, context);
        assert.equal(view.getEffectivePower(r.chosenId), 2, "V5_REAL_INCLUSIVE_GEAR_POWER");
        assert.equal(view.getEffectivePower(r.siblingId), 2);
        assert.ok(view.getEffectivePower(r.hostId)! > 2, "V5_REAL_OWN_POWER_NOT_HOST");
        for (const id of [r.hostId, r.chosenId, r.siblingId]) {
            assert.ok(r.steps.some(s => s.action.action.kind === "PLAY_CARD" && s.action.action.cardInstanceId === id), "every host and Gear was legally played");
            assert.equal(paused.objects.cards[id].controllerId, r.owner);
        }
        assert.equal(validateState(JSON.parse(JSON.stringify(paused)), context).ok, true, "V5_REAL_PAUSE_RELOAD");
        assert.equal(hashReplayState(r.resumedTarget), hashReplayState(paused));
        const independentlyResumed = must(applyAction(must(validateState(JSON.parse(JSON.stringify(paused)), context)), r.resolvedStep.action, context));
        assert.equal(hashReplayState(independentlyResumed.state), r.finalStateHash, "V5_REAL_RELOADED_RESOLUTION");
        assert.deepEqual(independentlyResumed.events, r.resolvedStep.events);
    });

    test(`real Detonate ${mode} defeats only selected Gear with a forced owner order and no fight facts`, () => {
        const r = replay(mode), s = r.finalState, events = r.resolvedStep.events, kinds = events.map(e => e.payload.kind);
        assert.equal(s.objects.cards[r.chosenId].zone.zone, "TRASH", "V5_REAL_CHOSEN_GEAR_TO_TRASH");
        assert.equal(s.objects.cards[r.chosenId].zone.playerId, r.owner, "V5_REAL_OWNER_TRASH");
        assert.equal(s.objects.cards[r.sourceId].zone.zone, "TRASH", "V5_REAL_PROGRAM_COMPLETES");
        assert.equal(s.objects.cards[r.hostId].zone.zone, "BATTLEFIELD", "V5_REAL_HOST_SURVIVES");
        assert.equal(s.objects.cards[r.siblingId].zone.zone, "BATTLEFIELD", "V5_REAL_SIBLING_SURVIVES");
        assert.deepEqual(s.objects.cards[r.hostId].attachments, [r.siblingId], "V5_REAL_ONLY_CHOSEN_DETACHES");
        assert.equal(new RulesView(s, r.context).getEffectivePower(r.hostId), new RulesView(r.pausedTarget, r.context).getEffectivePower(r.hostId)! - 2, "V5_REAL_LIVE_HOST_POWER");
        assert.deepEqual(events.filter(e => e.payload.kind === "DEFEAT_TRASH_ORDER_SELECTED").map(e => e.payload),
            [{ kind: "DEFEAT_TRASH_ORDER_SELECTED", targetId: r.chosenId, cardInstanceId: r.chosenId, ownerId: r.owner, forced: true }], "V5_REAL_FORCED_GEAR_ORDER");
        assert.deepEqual(events.filter(e => e.payload.kind === "CARD_DEFEATED").map(e => e.payload),
            [{ kind: "CARD_DEFEATED", cardInstanceId: r.chosenId, defeatedBy: r.sourceId }], "V5_REAL_NO_HOST_DEFEATED_FACT");
        assert.deepEqual(events.filter(e => e.payload.kind === "GEAR_DETACHED").map(e => e.payload),
            [{ kind: "GEAR_DETACHED", gearInstanceId: r.chosenId, hostInstanceId: r.hostId, reason: "GEAR_LEFT_AREA" }], "V5_REAL_GEAR_DETACHED");
        assert.ok(kinds.indexOf("CARD_DEFEATED") < kinds.indexOf("GEAR_DETACHED"), "V5_REAL_DEFEAT_BEFORE_DEPARTURE");
        for (const kind of FIGHT_FACTS) assert.equal(kinds.includes(kind as typeof kinds[number]), false, "V5_REAL_EFFECT_IS_NOT_FIGHT");
        assert.equal(s.resolution.choice, null, "V5_REAL_NO_STRATEGIC_OWNER_ORDER");
        assert.equal(validateState(s, r.context).ok, true);
        if (mode === "MAIN") {
            assert.equal(s.timing.step, "MAIN");
            assert.equal(s.timing.actingPlayer, r.caster);
        }
    });

    test(`real Detonate ${mode} replay is repeatable and its V2 tokens are engine-pin-independent`, () => {
        const first = replay(mode), repeated = batchV5Replay(mode, first.seed, first.context);
        assert.equal(repeated.finalStateHash, first.finalStateHash, "V5_REAL_DETERMINISTIC_REPLAY");
        assert.deepEqual(repeated.steps.map(s => s.actionId), first.steps.map(s => s.actionId));
        const engine = first.context.content.manifest.engine;
        const perturbed = batchV5Replay(mode, first.seed, batchV5Context({ ...engine, artifactHash: engine.artifactHash === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64) }));
        // listLegalActions binds version-2 action IDs to the entitled observation, not the position
        // hash, whenever a projecting policy (here targetedDefeat) is enabled; that binding is
        // deliberately pin-independent. Prove the perturbation actually took effect via the state
        // pin, then pin the binding itself so a silent switch back to position-hash tokens fails.
        assert.notEqual(perturbed.steps[0].before.match.engineArtifactHash, first.steps[0].before.match.engineArtifactHash, "V5_REAL_PERTURBATION_APPLIED");
        assert.deepEqual(perturbed.steps.map(s => s.actionId), first.steps.map(s => s.actionId), "V5_REAL_V2_TOKENS_BIND_TO_ENTITLED_OBSERVATION");
        assert.deepEqual(perturbed.steps.map(s => s.action), first.steps.map(s => s.action), "V5_REAL_SEMANTIC_SELECTION_STABLE");
        assert.deepEqual(perturbed.steps.map(s => s.events), first.steps.map(s => s.events), "V5_REAL_EVENTS_STABLE");
    });

    test(`real Detonate ${mode} replay preserves its full trajectory with reversed legal-action lists`, () => {
        const first = replay(mode);
        const reversed = batchV5Replay(mode, first.seed, first.context, { actionOrder: "REVERSED" });
        assert.equal(reversed.steps.length, first.steps.length, "V5_REAL_REVERSED_STEP_COUNT");
        // A broad roll predicate must actually face multiple matches, not only unique choices.
        assert.ok(first.steps.some(step => step.action.action.kind === "ROLL_GIG"
            && step.legalActions.filter(a => a.action.kind === "ROLL_GIG").length > 1), "V5_REAL_MULTIPLE_ROLL_MATCHES_EXERCISED");
        let changedOrders = 0;
        for (const [index, original] of first.steps.entries()) {
            const changed = reversed.steps[index];
            assert.ok(changed);
            const ids = original.legalActions.map(a => a.actionId);
            const reversedIds = changed.legalActions.map(a => a.actionId);
            assert.deepEqual(reversedIds, [...ids].reverse(), "V5_REAL_ACTION_ORDER_REVERSED");
            if (ids.length > 1) {
                assert.notDeepEqual(reversedIds, ids, "V5_REAL_ORDER_PERTURBATION_APPLIED");
                changedOrders++;
            }
        }
        assert.ok(changedOrders > 0, "V5_REAL_NONTRIVIAL_ORDER_PERTURBATION");
        assert.deepEqual(reversed.steps.map(s => s.action), first.steps.map(s => s.action), "V5_REAL_REVERSED_SEMANTIC_SELECTION_STABLE");
        assert.deepEqual(reversed.steps.map(s => s.events), first.steps.map(s => s.events), "V5_REAL_REVERSED_EVENTS_STABLE");
        assert.deepEqual(reversed.steps.map(s => s.before), first.steps.map(s => s.before), "V5_REAL_REVERSED_STATES_STABLE");
        assert.deepEqual(reversed.finalState, first.finalState, "V5_REAL_REVERSED_FINAL_STATE_STABLE");
        assert.equal(reversed.finalStateHash, first.finalStateHash, "V5_REAL_REVERSED_FINAL_HASH_STABLE");
    });
}

test("real Detonate defender React reload preserves the committed attack and returns priority to its defender", () => {
    const r = replay("REACT"), opened = r.beforeSource, paused = r.pausedTarget, final = r.finalState;
    assert.equal(opened.timing.combat.stage, "RIVAL_REACT");
    assert.equal(paused.timing.combat.stage, "RIVAL_REACT");
    assert.equal(final.timing.combat.stage, "RIVAL_REACT", "V5_REAL_ATTACK_SURVIVES");
    assert.deepEqual(paused.resolution.returnTo, { kind: "RIVAL_REACT" }, "V5_REAL_SAVED_REACT_RETURN");
    assert.deepEqual(final.timing.combat, opened.timing.combat, "V5_REAL_LOCKED_ATTACK_UNCHANGED");
    assert.equal(final.timing.activePlayer, r.owner);
    assert.equal(final.timing.actingPlayer, r.caster, "V5_REAL_DEFENDER_RETAINS_PRIORITY");
    assert.equal(final.objects.cards[r.hostId].readiness, "SPENT", "V5_REAL_ATTACKER_REMAINS_SPENT");
    assert.ok(r.resolvedStep.events.some(e => e.payload.kind === "RIVAL_REACT_OPENED"), "V5_REAL_RETURNS_TO_REACT");
    assert.ok(final.timing.combat.stage === "RIVAL_REACT");
    assert.equal(final.timing.combat.attackingPlayerId, r.owner);
    assert.equal(final.timing.combat.attackerId, r.hostId);
    const locked = final.timing.combat.target;
    assert.ok(listAttackTargets(final, r.hostId, r.owner, r.context).some(t => JSON.stringify(t) === JSON.stringify(locked)), "V5_REAL_LOCKED_TARGET_LEGAL_AFTER_REMOVAL");
});
