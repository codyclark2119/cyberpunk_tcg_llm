import test from "node:test";
import assert from "node:assert/strict";
import { CardRevisionSnapshotSchema, RulesetSchema } from "@tcg/domain";
import { friendlyPlayPowerEnabled, supportsFriendlyPlayPowerUnit } from "../packages/engine/src/friendly-play-power-support";
import { friendlyPowerTargets } from "../packages/engine/src/friendly-play-power-queries";
import { applyTemporaryPower } from "../packages/engine/src/temporary-power";
import { TurnMutation } from "../packages/engine/src/turn";
import { jonin, batchV4Context } from "./api-admission-batch-v4-fixture";
import { arrangedScenario } from "./api-admission-batch-v4-scenarios";
import { must } from "./api-admission-batch-v4-replay";

test("V4: amount mutation cannot broaden the reviewed semantic gate", () => {
    const context = batchV4Context(); assert.equal(supportsFriendlyPlayPowerUnit(jonin, context).ok, true);
    for (const amount of [-1, 0, 1, 3, 5]) {
        const changed = CardRevisionSnapshotSchema.parse(jonin);
        changed.mechanics.abilities[0].effects = [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: "FRIENDLY_UNIT" }, amount }];
        assert.equal(supportsFriendlyPlayPowerUnit(changed, context).ok, false, "V4_AMOUNT_GATE");
    }
});

test("V4: provenance mutation cannot admit an unreviewed revision", () => {
    const context = batchV4Context(); assert.equal(supportsFriendlyPlayPowerUnit(jonin, context).ok, true);
    const changed = CardRevisionSnapshotSchema.parse(jonin); changed.provenance.reviewed = false;
    assert.equal(supportsFriendlyPlayPowerUnit(changed, context).ok, false, "V4_PROVENANCE_GATE");
});

test("V4: extra modifiers cannot slip through the friendly PLAY gate", () => {
    const context = batchV4Context(); assert.equal(supportsFriendlyPlayPowerUnit(jonin, context).ok, true);
    const changed = CardRevisionSnapshotSchema.parse(jonin); changed.mechanics.modifiers.push({ kind: "GRANT_PRINTED_POWER_TO_HOST" });
    assert.equal(supportsFriendlyPlayPowerUnit(changed, context).ok, false, "V4_EXTRA_MECHANIC");
});

test("V4: the scheduler dependency is tested independently of unrelated failures", () => {
    const base = batchV4Context(); assert.equal(friendlyPlayPowerEnabled(base), true);
    const ruleset = RulesetSchema.parse(base.content.ruleset); delete ruleset.gameplay!.turnSlice!.combatTriggers;
    // Predicate-only counterfactual, not an engine context with valid manifest pins.
    const disabled = { content: { ...base.content, ruleset } };
    assert.equal(friendlyPlayPowerEnabled(disabled), false, "V4_SCHEDULER_DEPENDENCY");
    assert.equal(supportsFriendlyPlayPowerUnit(jonin, disabled).ok, false);
});

test("V4: target relation rejects an otherwise eligible rival Unit", () => {
    const s = arrangedScenario(), target = s.driver.state.objects.cards[s.rivalUnit];
    assert.equal(target.face, "UP"); assert.equal(target.zone.zone, "BATTLEFIELD");
    assert.equal(target.controllerId, s.rival);
    const targets = friendlyPowerTargets(s.driver.state, s.actor, s.context);
    assert.ok(targets.includes(s.oldJonin));
    assert.equal(targets.includes(s.rivalUnit), false, "V4_TARGET_RELATION");
});

test("V4: duplicate reducer application is rejected", () => {
    const s = arrangedScenario(); s.driver.play(s.joninSource);
    const mutation = new TurnMutation(s.driver.state, s.context);
    must(applyTemporaryPower(mutation, s.oldJonin));
    const result = applyTemporaryPower(mutation, s.oldJonin);
    assert.equal(result.ok, false, "V4_DUPLICATE_OCCURRENCE");
    assert.ok(!result.ok && result.errors.some(e => e.code === "DUPLICATE_POWER_OCCURRENCE"));
});
