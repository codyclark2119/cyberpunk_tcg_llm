import assert from "node:assert/strict";
import test from "node:test";
import { CardRevisionSnapshotSchema, ConditionSchema, EffectSchema, hashCanonical } from "@tcg/domain";
import { supportsPlay } from "../packages/engine/src/play-support";
import { INDUSTRIAL, valueCards, valueContext } from "./value-conditions-fixture";

// Executable documentation of the unchanged V5 boundary, not proof of future V6 gameplay.
// Replace the negative future-vocabulary cases with exact positive/negative admission cases
// only when the complete Program continuation and its registered validator are implemented.
test("V6 foundation: historical decrease-by-two payload remains exact and decrease-by-three is not admitted vocabulary", () => {
    const old = { kind: "DECREASE_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 2 };
    assert.deepEqual(EffectSchema.parse(old), old);
    assert.equal(EffectSchema.safeParse({ ...old, maximum: 3 }).success, false);
});
test("V6 foundation: the proposed directional Program selector is not silently accepted by the old adjustment schema", () => {
    const proposed = { kind: "ADJUST_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 3, direction: "DECREASE" };
    assert.equal(EffectSchema.safeParse(proposed).success, false);
    const industrial = { ...proposed, maximum: 4, direction: "INCREASE" };
    assert.deepEqual(EffectSchema.parse(industrial), industrial);
});
test("V6 foundation: existing resolution-time value-one condition needs no invented zero or new condition vocabulary", () => {
    assert.deepEqual(ConditionSchema.parse({ kind: "GIG_VALUE", value: 1 }), { kind: "GIG_VALUE", value: 1 });
    const draw = { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_VALUE", value: 1 }, count: 1 };
    assert.deepEqual(EffectSchema.parse(draw), draw);
});
test("V6 foundation: both legacy current-value cards still pass their unchanged complete gate", () => {
    const context = valueContext();
    assert.equal(valueCards.length, 2);
    for (const card of valueCards) assert.equal(supportsPlay(card, context).ok, true, card.id);
    assert.equal(context.content.cards.some(card => card.id === "trust-no-one"), false);
});
test("V6 foundation: a schema-valid shortened Blue Program is not a substitute for the reviewed new effect", () => {
    const original = valueCards.find(card => card.id === INDUSTRIAL);
    assert.ok(original);
    // Synthetic gate probe only. It is not an authored revision of the real Trust No One card.
    const probe = CardRevisionSnapshotSchema.parse({ ...original, id: "v6-synthetic-shortened-program", name: "V6 Synthetic Shortened Program", displayName: "V6 Synthetic Shortened Program", deckbuildingIdentity: "v6-synthetic-shortened-program",
        provenance: { ...original.provenance, source: "Synthetic negative gate probe; not a real card revision", sourceHash: hashCanonical({ fixture: "v6-synthetic-shortened-program" }) }, colors: ["BLUE"], ram: { BLUE: 1 }, tags: ["Braindance"],
        mechanics: { ...original.mechanics, abilities: [{ ...original.mechanics.abilities[0], effects: [
            { kind: "DECREASE_GIG_UP_TO", target: { kind: "GIGS", relation: "ANY" }, maximum: 2 },
            { kind: "CONDITIONAL_DRAW", timing: "RESOLUTION", condition: { kind: "GIG_VALUE", value: 1 }, count: 1 }
        ] }] } });
    assert.equal(supportsPlay(probe, valueContext()).ok, false);
});
