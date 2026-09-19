import test from "node:test";
import assert from "node:assert/strict";
import { CardRevisionSnapshotSchema, GameStateSchema, RulesetSchema, canonicalSerialize, createContentBundle, hashCanonical } from "@tcg/domain";
import { createGameWithEvents, RulesView, validateState } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsReactPlay } from "../packages/engine/src/react-support";
import { supportsTargetedDefeatCard } from "../packages/engine/src/targeted-defeat-support";
import { supportsTargetedGearDefeatCard } from "../packages/engine/src/targeted-gear-defeat-support";
import { listDefeatTargets } from "../packages/engine/src/targeted-defeat-queries";
import { batchV4Context } from "./api-admission-batch-v4-fixture";
import { targetedContext, targetedCards } from "./targeted-defeat-fixture";
import { arrange, castProgram, openReact, gearTarget } from "./api-admission-batch-v5-scenarios";
import { DETONATE, DETONATE_SOURCE_PIN, detonate, batchV5Context, batchV5Input } from "./api-admission-batch-v5-fixture";
import { placeCard, playCard, pick } from "./value-conditions-focused";
import { defeatOrderChoice } from "../packages/engine/src/combat-outcome-queries";
import { validateTargetedDefeatState } from "../packages/engine/src/targeted-defeat-state";
import { unwrap } from "./turn-replay";
import source from "./fixtures/api-admission-batch-v5-detonate-source.v1.json";

const context = batchV5Context();
const configured = (opts: Parameters<typeof arrange>[0] = {}) => arrange({ ...opts, context: opts.context ?? context, sourceCard: DETONATE });

test("V5 Detonate revision preserves source facts and explicitly authors Quick Gear defeat", () => {
    assert.equal(detonate.id, "detonate"); assert.equal(detonate.revision, 1);
    assert.equal(detonate.provenance.sourceHash, DETONATE_SOURCE_PIN.recordHash);
    assert.equal(hashCanonical(source), DETONATE_SOURCE_PIN.recordHash);
    assert.deepEqual(source.keywords, [], "V5_RAW_KEYWORDS_UNCHANGED");
    assert.deepEqual(detonate.keywords, []);
    assert.deepEqual(detonate.mechanics.keywords, ["QUICK"], "V5_QUICK_EXPLICITLY_AUTHORED");
    assert.equal(detonate.type, "PROGRAM"); assert.equal(detonate.power, undefined);
    assert.deepEqual(detonate.colors, ["RED"]); assert.deepEqual(detonate.ram, { RED: 2 });
    assert.deepEqual(detonate.printedCost, { kind: "EDDIES", amount: 1 });
    assert.equal(detonate.sellProfile.allowed, true); assert.deepEqual(detonate.tags, ["Quickhack"]);
    assert.equal(detonate.cardNumber, "031"); assert.equal(detonate.printings.length, 2);
    assert.deepEqual(detonate.printings.map(p => [p.id, p.setCode, p.collectorNumber]), source.printings.map(p => [p.id, p.set.code, p.collector_number]));
    assert.deepEqual(detonate.mechanics.abilities[0].effects, [{ kind: "DEFEAT_UNIT", target: gearTarget }]);
    assert.equal(supportsPlay(detonate, context).ok, true, "V5_REAL_DETONATE_MAIN_ADMISSION");
    assert.equal(supportsReactPlay(detonate, context).ok, true, "V5_REAL_DETONATE_REACT_ADMISSION");
    assert.equal(supportsTargetedDefeatCard(detonate, context).ok, false);
});

test("V5 real-card decks initialize only with the complete Gear capability", () => {
    const input = batchV5Input("v5-admission");
    for (const deck of input.decks) { assert.equal(deck.main.length, 42); assert.equal(deck.main.filter(id => id === DETONATE).length, 3); }
    const initialized = createGameWithEvents(input, context);
    assert.equal(initialized.ok, true, "V5_REAL_DETONATE_DECK_ADMISSION");
    const ruleset = RulesetSchema.parse(context.content.ruleset);
    delete ruleset.gameplay!.turnSlice!.targetedGearDefeat;
    const off = { content: createContentBundle(ruleset, context.content.cards, context.content.manifest.engine) };
    assert.equal(createGameWithEvents(input, off).ok, false, "V5_REAL_DETONATE_POLICY_OFF");
    for (const mutate of [
        (c: ReturnType<typeof CardRevisionSnapshotSchema.parse>) => { c.mechanics.keywords = []; },
        (c: ReturnType<typeof CardRevisionSnapshotSchema.parse>) => { c.mechanics.abilities = []; },
        (c: ReturnType<typeof CardRevisionSnapshotSchema.parse>) => { c.execution!.scope = "TARGETED_DEFEAT_V1"; },
        (c: ReturnType<typeof CardRevisionSnapshotSchema.parse>) => { c.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); },
        (c: ReturnType<typeof CardRevisionSnapshotSchema.parse>) => { c.provenance.reviewed = false; }
    ]) {
        const forged = CardRevisionSnapshotSchema.parse(detonate); mutate(forged);
        assert.equal(supportsTargetedGearDefeatCard(forged, context).ok, false, "V5_REAL_DETONATE_FORGERY_REJECTED");
    }
});

test("V5 preserves every prior reviewed revision and legacy Unit source gate", () => {
    for (const previous of [batchV4Context(), targetedContext()]) for (const card of previous.content.cards) {
        assert.equal(canonicalSerialize(context.content.cards.find(c => c.id === card.id && c.revision === card.revision)), canonicalSerialize(card), "V5_PRIOR_REVISION_UNCHANGED");
    }
    for (const card of targetedCards) assert.equal(supportsTargetedDefeatCard(card, context).ok, true);
    assert.equal(context.content.cards.some(c => c.id === "v5-gear-defeat-probe"), false);
});

// Trusted arrangements isolate edge cases. Complete legal paid-play trajectories live
// separately in api-admission-batch-v5-replay.ts and never call these helpers.
for (const react of [false, true]) for (const count of [0, 1]) test(`V5 real Detonate ${react ? "React" : "Main"} with ${count} targets completes without a strategic pause`, () => {
    const a = configured({ caster: react ? "RIVAL" : "ACTOR", gear: count ? ["mantis-blades"] : [] });
    const opened = react ? openReact(a) : a.state, locked = canonicalSerialize(opened.timing.combat);
    const cast = castProgram({ ...a, state: opened }, react ? a.rival : a.actor);
    assert.equal(cast.state.resolution.choice, null, "V5_REAL_FORCED_OR_EMPTY_COMPLETION");
    assert.equal(cast.state.objects.cards[a.sourceId].zone.zone, "TRASH");
    assert.equal(cast.state.timing.actingPlayer, react ? a.rival : a.actor);
    assert.equal(cast.state.timing.step, react ? "RIVAL_REACT" : "MAIN");
    assert.equal(canonicalSerialize(cast.state.timing.combat), locked, "V5_EMPTY_SINGLE_ATTACK_UNCHANGED");
    assert.equal(validateState(cast.state, context).ok, true);
    const orders = cast.events.filter(e => e.payload.kind === "DEFEAT_TRASH_ORDER_SELECTED").map(e => e.payload);
    assert.deepEqual(orders, count ? [{ kind: "DEFEAT_TRASH_ORDER_SELECTED", targetId: a.gearIds[0], cardInstanceId: a.gearIds[0], ownerId: cast.state.objects.cards[a.gearIds[0]].ownerId, forced: true }] : [], "V5_REACT_FORCED_GEAR_ORDER");
    if (count) assert.equal(cast.state.objects.cards[a.gearIds[0]].zone.zone, "TRASH");
});

test("V5 real Detonate defeats Legends-area Gear while retaining host and sibling", () => {
    const a = configured({ onLegend: true }), cast = castProgram(a);
    assert.equal(cast.state.resolution.choice!.options.length, 2);
    const beforeHost = cast.state.objects.cards[a.hostId];
    assert.equal(new RulesView(cast.state, context).getEffectivePower(a.hostId), null);
    const resolved = pick(cast.state, context, o => o.kind === "CARD" && o.cardInstanceId === a.gearIds[0]);
    assert.equal(resolved.state.objects.cards[a.gearIds[0]].zone.zone, "TRASH", "V5_REAL_LEGENDS_GEAR_DEFEATED");
    assert.deepEqual(resolved.state.objects.cards[a.hostId], { ...beforeHost, attachments: [a.gearIds[1]] }, "V5_REAL_LEGEND_RETAINED");
    assert.equal(resolved.state.objects.cards[a.gearIds[1]].zone.zone, "LEGENDS");
});

test("V5 excludes explicitly synthetic over-limit Gear without changing real printed values", () => {
    const mantis = context.content.cards.find(c => c.id === "mantis-blades")!;
    const over = CardRevisionSnapshotSchema.parse({ ...mantis, id: "v5-synthetic-power-three-gear", name: "Synthetic power-three Gear", displayName: "Synthetic power-three Gear", deckbuildingIdentity: "v5-synthetic-power-three-gear", power: 3,
        printings: [{ id: "v5-power-three-print", setCode: "DEV", collectorNumber: "V5G3", source: "Synthetic threshold fixture" }],
        provenance: { source: "Synthetic power-three Gear, not altered Mantis", sourceHash: hashCanonical({ fixture: "v5-power-three", power: 3 }), effectiveAt: "2026-09-18", errata: [], reviewed: true } });
    const extra = { content: createContentBundle(context.content.ruleset, [...context.content.cards, over], context.content.manifest.engine) };
    const a = configured({ context: extra, gear: ["mantis-blades", "mandibular-upgrade", over.id] });
    assert.deepEqual(listDefeatTargets(a.state, a.actor, gearTarget, extra), [...a.gearIds.slice(0, 2)].sort(), "V5_REAL_OVER_LIMIT_EXCLUDED");
    assert.equal(mantis.power, 2);
});

test("V5 React Gear defeat preserves fight prevention and does not fire its host's DEFEATED ability", () => {
    const a = configured({ caster: "RIVAL", host: "dexter-deshawn-one-last-chance" });
    const reboot = placeCard(a.state, context, "reboot-optics", a.rival);
    const opened = openReact({ ...a, state: reboot.state });
    const protectedState = playCard(opened, context, "reboot-optics").state;
    assert.equal(protectedState.fightPreventions?.length, 1);
    const cast = castProgram({ ...a, state: protectedState }, a.rival);
    const beforeHand = cast.state.players[a.actor].zones.HAND, power = new RulesView(cast.state, context).getEffectivePower(a.hostId)!;
    assert.equal(new RulesView(cast.state, context).getEffectiveTriggeredAbilities(a.hostId).filter(b => b.kind === "WHEN_FIGHT_WON").length, 1);
    const resolved = pick(cast.state, context, o => o.kind === "CARD" && o.cardInstanceId === a.gearIds[1]);
    assert.equal(new RulesView(resolved.state, context).getEffectiveTriggeredAbilities(a.hostId).filter(b => b.kind === "WHEN_FIGHT_WON").length, 0, "V5_REAL_INHERITED_CAPABILITY_REMOVED");
    assert.deepEqual(resolved.state.fightPreventions, protectedState.fightPreventions, "V5_REAL_PREVENTION_NOT_CONSUMED");
    assert.deepEqual(resolved.state.players[a.actor].zones.HAND, beforeHand, "V5_HOST_DEFEATED_TRIGGER_NOT_FIRED");
    assert.equal(new RulesView(resolved.state, context).getEffectivePower(a.hostId), power - 2, "V5_REAL_HOST_POWER_UPDATED");
    const facts = resolved.events.map(e => e.payload.kind);
    for (const kind of ["FIGHT_STARTED", "FIGHT_RESULT", "FIGHT_DEFEAT_PREVENTED", "FIGHT_PREVENTION_CONSUMED", "EFFECT_PENDING"])
        assert.equal(facts.includes(kind as typeof facts[number]), false, `V5_REAL_NO_FALSE_${kind}`);
    assert.equal(resolved.events.filter(e => e.payload.kind === "CARD_DEFEATED").length, 1, "V5_REAL_DEFEAT_FACT_REQUIRED");
    assert.ok(facts.indexOf("CARD_MOVED") >= 0);
    assert.ok(facts.indexOf("CARD_DEFEATED") < facts.indexOf("CARD_MOVED"), "V5_REAL_DEFEAT_PRECEDES_MOVEMENT");
});


test("V5 real hidden Detonate instances cannot evade the registered metadata validators", () => {
    const initial = unwrap(createGameWithEvents(batchV5Input("v5-hidden-admission"), context)).state;
    assert.ok(Object.values(initial.objects.cards).some(c => c.cardId === DETONATE && c.zone.zone === "DECK"));
    const variants: [string, (c: ReturnType<typeof CardRevisionSnapshotSchema.parse>) => void][] = [
        ["EMPTY", c => { c.mechanics.abilities = []; }],
        ["WRONG_SCOPE", c => { c.execution!.scope = "NONCOMBAT_PLAY_V1"; }],
        ["MIXED", c => { c.mechanics.abilities[0].effects.push({ kind: "DEFEAT_UNIT", target: { kind: "UNITS", relation: "RIVAL", power: { kind: "AT_MOST", value: 5 } } }); }],
        ["UNREVIEWED", c => { c.provenance.reviewed = false; }]
    ];
    for (const [name, mutate] of variants) {
        const forged = CardRevisionSnapshotSchema.parse(detonate); mutate(forged);
        // Bundle construction is itself fail-closed: ContentBundleSchema rejects unreviewed
        // revisions before any state exists, so a throw here is an equally valid rejection.
        let content: ReturnType<typeof createContentBundle> | null = null;
        try { content = createContentBundle(context.content.ruleset, context.content.cards.map(c => c.id === DETONATE ? forged : c), context.content.manifest.engine); }
        catch { content = null; }
        if (!content) continue;
        const state = GameStateSchema.parse(initial);
        state.match.contentManifestHash = content.manifestHash;
        const result = validateState(JSON.parse(JSON.stringify(state)), { content });
        assert.equal(result.ok, false, `V5_REAL_HIDDEN_${name}_REJECTED`);
        if (!result.ok) assert.ok(result.errors.some(e => ["UNSUPPORTED_TARGETED_DEFEAT", "UNSUPPORTED_TARGETED_GEAR_DEFEAT_SHAPE"].includes(e.code)), JSON.stringify(result.errors));
    }
});

test("V5 a one-Gear React defeat cannot persist a strategic owner-order phase", () => {
    const a = configured({ caster: "RIVAL" }), paused = castProgram({ ...a, state: openReact(a) }, a.rival).state;
    assert.equal(validateState(paused, context).ok, true);
    const forged = GameStateSchema.parse(paused);
    forged.resolution.targetedDefeatContinuation = { phase: "ORDER" };
    forged.resolution.defeatContinuation = { defeats: [{ targetId: a.gearIds[0], defeatedBy: a.sourceId }], orders: [{ targetId: a.gearIds[0], cardIds: [] }] };
    forged.resolution.choice = structuredClone(defeatOrderChoice(forged));
    forged.timing.step = "DEFEAT_ORDER_SELECTION"; forged.timing.window = "DEFEAT_ORDER_SELECTION";
    const direct = validateTargetedDefeatState(forged, context);
    assert.equal(direct.ok, false, "V5_REACT_FORGED_ORDER_REJECTED");
    if (!direct.ok) assert.ok(direct.errors.some(e => e.code === "INVALID_DEFEAT_ORDER"), JSON.stringify(direct.errors));
    assert.equal(validateState(JSON.parse(JSON.stringify(forged)), context).ok, false, "V5_REACT_FORGED_ORDER_RELOAD_REJECTED");
    forged.timing.actingPlayer = a.actor;
    assert.equal(validateState(forged, context).ok, false, "V5_REACT_FORGED_ORDER_ACTOR_TRANSFER_REJECTED");
});
