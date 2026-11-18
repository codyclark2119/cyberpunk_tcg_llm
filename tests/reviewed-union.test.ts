import test from "node:test";
import assert from "node:assert/strict";
import { demoReferenceContext } from "./demo-format-fixture";
import { demoStarterContext } from "./demo-starter-fixture";
import { catalogSlugs, reviewedUnionContext } from "./reviewed-union-fixture";

test("the reviewed union holds every reviewed real-card revision exactly once", () => {
    const union = reviewedUnionContext().content, slugs = catalogSlugs();
    const keys = union.cards.map(c => `${c.id}@${c.revision}`);
    assert.equal(new Set(keys).size, keys.length);
    for (const card of union.cards) {
        assert.ok(slugs.has(card.id), `${card.id} is not a catalog card`);
        assert.equal(card.schemaVersion === 2 && card.provenance.reviewed && card.execution?.status, "SUPPORTED", card.id);
    }
    for (const card of demoReferenceContext().content.cards) assert.ok(keys.includes(`${card.id}@${card.revision}`), `Demo card ${card.id} missing`);
    for (const id of ["japantown-jonin", "detonate", "trust-no-one", "corporate-surveillance", "goro-takemura-losing-his-way", "royce-don-t-call-me-simon", "wild-in-the-streets", "delamain-rideshare-ai", "offduty-malfini", "modded-muramasa", "maxtac-squadron", "sandevistan", "modded-kusanagi", "don-t-fear-the-reaper", "adam-smasher-metal-over-meat", "jacked-in-voodoo-boy", "octant", "trauma-team-operatives", "maxtac-heavy"])
        assert.ok(union.cards.some(c => c.id === id), `${id} missing`);
    assert.equal(union.cards.length, 53); // 39 before batch V7 (2026-11-15), plus 3 each in V7, V8 and V9, 2 in V10 and 3 in V11
});

test("the union ruleset turns on every reviewed gate and keeps Demo's overtime", () => {
    const union = reviewedUnionContext().content.ruleset.gameplay!.turnSlice!, demo = demoStarterContext().content.ruleset.gameplay!.turnSlice!;
    assert.equal(union.overtime, demo.overtime);
    for (const key of ["targetedSpend", "attackConditionPower", "targetedGearDefeat", "minGigProgram", "friendlyPlayPower"])
        assert.ok(key in union, key);
});

test("the Demo context is untouched by the union", () => {
    assert.equal(demoStarterContext().content.cards.length, 29);
});
