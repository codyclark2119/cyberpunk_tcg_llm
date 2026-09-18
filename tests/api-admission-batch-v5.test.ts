import test from "node:test";
import assert from "node:assert/strict";
import { CardInstanceIdSchema, GameStateSchema, PlayerIdSchema } from "@tcg/domain";
import { RulesView, validateState } from "@tcg/engine";
import { pick } from "./value-conditions-focused";
import { supportsPlay } from "../packages/engine/src/play-support";
import { listDefeatTargets } from "../packages/engine/src/targeted-defeat-queries";
import { validateEffectDefeatFacts } from "../packages/engine/src/targeted-defeat-state";
import { listAttackTargets } from "../packages/engine/src/combat-queries";
import { arrange, castProgram, openReact, gearTarget, v5Context, v5Probe } from "./api-admission-batch-v5-scenarios";

type MutableState = ReturnType<typeof GameStateSchema.parse>;

const FIGHT_FACTS = ["FIGHT_STARTED", "FIGHT_RESULT", "FIGHT_DEFEAT_PREVENTED", "FIGHT_PREVENTION_CONSUMED"];
const kinds = (events: { payload: { kind: string } }[]) => events.map(e => e.payload.kind);

test("V5 Main play offers every eligible rival Gear and defeats only the chosen one", () => {
    const a = arrange(), cast = castProgram(a);
    assert.ok(cast.state.resolution.choice, "a strategic multi-target decision must pause");
    assert.equal(cast.state.resolution.choice!.options.length, 2, "V5_MULTI_TARGET_PAUSE");
    assert.equal(cast.state.timing.step, "TARGET_SELECTION");
    const [chosenId, siblingId] = a.gearIds;
    const resolved = pick(cast.state, a.context, o => o.kind === "CARD" && o.cardInstanceId === chosenId);
    const seen = kinds(resolved.events);
    for (const fact of ["DEFEAT_TARGET_SELECTED", "DEFEAT_TRASH_ORDER_SELECTED", "CARD_DEFEATED", "GEAR_DETACHED"]) assert.ok(seen.includes(fact), `${fact} missing from ${seen.join(",")}`);
    assert.ok(seen.indexOf("CARD_DEFEATED") < seen.indexOf("GEAR_DETACHED"), "the defeat fact precedes movement");
    for (const fact of FIGHT_FACTS) assert.equal(seen.includes(fact), false, "V5_EFFECT_DEFEAT_IS_NOT_COMBAT");
    const s = resolved.state;
    assert.equal(s.objects.cards[chosenId].zone.zone, "TRASH", "V5_ONLY_CHOSEN_GEAR_MOVES");
    assert.equal(s.objects.cards[siblingId].zone.zone, "BATTLEFIELD", "V5_SIBLING_RETAINED");
    assert.ok(s.objects.cards[a.hostId].attachments.includes(siblingId), "V5_SIBLING_RETAINED");
    assert.equal(s.objects.cards[a.hostId].zone.zone, "BATTLEFIELD", "V5_HOST_RETAINED");
});

test("V5 the target filter references each Gear's own power, never its host's", () => {
    const a = arrange({ gear: ["mantis-blades", "mandibular-upgrade"], friendlyGear: "satori-sword-of-saburo" });
    const view = new RulesView(a.state, a.context);
    const hostPower = view.getEffectivePower(a.hostId);
    assert.ok(hostPower !== null && hostPower > gearTarget.power.value, "the host must exceed the threshold for this proof to bite");
    const [rivalTwo, rivalZero, friendly] = a.gearIds;
    const found = listDefeatTargets(a.state, a.actor, gearTarget, a.context);
    assert.ok(found.includes(rivalTwo), "V5_OWN_GEAR_POWER: exact threshold is eligible");
    assert.ok(found.includes(rivalZero), "V5_ZERO_POWER_ELIGIBLE");
    assert.equal(found.includes(friendly), false, "V5_RIVAL_RELATION_ONLY");
    assert.equal(view.getEffectivePower(rivalTwo), 2);
    assert.equal(view.getEffectivePower(rivalZero), 0);
});

test("V5 Legends-area Gear is a legal target and its host Legend is not removed", () => {
    const a = arrange({ onLegend: true });
    assert.equal(a.state.objects.cards[a.gearIds[0]].zone.zone, "LEGENDS");
    const cast = castProgram(a);
    assert.equal(cast.state.resolution.choice!.options.length, 2);
    const [chosenId, siblingId] = a.gearIds;
    const s = pick(cast.state, a.context, o => o.kind === "CARD" && o.cardInstanceId === chosenId).state;
    assert.equal(s.objects.cards[chosenId].zone.zone, "TRASH", "V5_LEGENDS_AREA_TARGET");
    assert.equal(s.objects.cards[siblingId].zone.zone, "LEGENDS", "V5_SIBLING_RETAINED");
    assert.equal(s.objects.cards[a.hostId].zone.zone, "LEGENDS", "V5_LEGEND_HOST_NOT_REMOVED");
    assert.equal(s.objects.cards[a.hostId].face, "UP", "V5_LEGEND_HOST_NOT_REMOVED");
});

test("V5 defender React play pauses, survives reload and returns to the same React decision", () => {
    const a = arrange({ caster: "RIVAL" });
    const opened = openReact(a);
    assert.equal(opened.timing.combat.stage, "RIVAL_REACT");
    assert.equal(opened.timing.actingPlayer, a.rival, "the defender holds the React decision");
    const locked = "target" in opened.timing.combat ? JSON.stringify(opened.timing.combat.target) : null;
    const cast = castProgram({ ...a, state: opened }, a.rival);
    assert.ok(cast.state.resolution.choice, "V5_REACT_PERSISTED_PAUSE");
    assert.equal(cast.state.resolution.choice!.options.length, 2, "V5_REACT_TWO_TARGETS");
    assert.deepEqual(cast.state.resolution.returnTo, { kind: "RIVAL_REACT" }, "V5_REACT_RETURN_CONTEXT");
    // The paused React continuation must survive serialization and independent revalidation.
    const reloaded = validateState(JSON.parse(JSON.stringify(cast.state)), a.context);
    assert.equal(reloaded.ok, true, "V5_REACT_PAUSE_VALIDATES");
    if (!reloaded.ok) throw new Error("paused React state rejected");
    const resolved = pick(reloaded.value, a.context, o => o.kind === "CARD" && o.cardInstanceId === a.gearIds[0]);
    const seen = kinds(resolved.events);
    assert.ok(seen.includes("RIVAL_REACT_OPENED"), "V5_RETURNS_TO_REACT");
    for (const fact of FIGHT_FACTS) assert.equal(seen.includes(fact), false, "V5_EFFECT_DEFEAT_IS_NOT_COMBAT");
    const s = resolved.state;
    assert.equal(s.objects.cards[a.gearIds[0]].zone.zone, "TRASH");
    assert.equal(s.timing.combat.stage, "RIVAL_REACT", "V5_ATTACK_SURVIVES");
    assert.equal(s.objects.cards[a.hostId].readiness, "SPENT", "V5_ATTACKER_REMAINS_COMMITTED");
    assert.equal(s.timing.actingPlayer, a.rival, "V5_DEFENDER_RETAINS_REACT");
    assert.equal(s.resolution.choice, null, "V5_REACT_FORCED_GEAR_ORDER");
    const order = resolved.events.filter(e => e.payload.kind === "DEFEAT_TRASH_ORDER_SELECTED").map(e => e.payload);
    assert.deepEqual(order, [{ kind: "DEFEAT_TRASH_ORDER_SELECTED", targetId: a.gearIds[0], cardInstanceId: a.gearIds[0], ownerId: a.actor, forced: true }], "V5_REACT_FORCED_GEAR_ORDER");
    assert.equal(validateState(s, a.context).ok, true, "V5_REACT_RETURN_VALIDATES");
    assert.equal(s.timing.combat.stage, "RIVAL_REACT");
    if (s.timing.combat.stage === "RIVAL_REACT") {
        assert.equal(s.timing.combat.attackerId, a.hostId, "V5_ATTACKER_ID_UNCHANGED");
        const lockedTarget = s.timing.combat.target;
        assert.ok(listAttackTargets(s, a.hostId, a.actor, a.context).some(target => JSON.stringify(target) === JSON.stringify(lockedTarget)), "V5_LOCKED_TARGET_REMAINS_VALID");
    }
    assert.equal(s.objects.cards[a.hostId].zone.zone, "BATTLEFIELD", "V5_ATTACKER_SURVIVES");
    assert.equal("target" in s.timing.combat ? JSON.stringify(s.timing.combat.target) : null, locked, "V5_LOCKED_TARGET_UNCHANGED");
});

test("V5 forged and stale target choices are rejected by the shared validator", () => {
    const a = arrange({ friendlyGear: "mandibular-upgrade" }), cast = castProgram(a);
    const offered = cast.state.resolution.choice!.options.map(o => o.kind === "CARD" ? o.cardInstanceId : "");
    const friendly = a.gearIds[2];
    assert.equal(offered.includes(friendly), false, "V5_RIVAL_RELATION_ONLY");
    const forged = GameStateSchema.parse(cast.state);
    forged.resolution.choice!.options.push({ kind: "CARD", cardInstanceId: friendly });
    const forgedResult = validateState(forged, a.context);
    assert.equal(forgedResult.ok, false, "V5_FORGED_CHOICE_REJECTED");
    if (!forgedResult.ok) assert.ok(forgedResult.errors.some(e => e.code === "INVALID_DEFEAT_TARGET"), JSON.stringify(forgedResult.errors));
    const stale = GameStateSchema.parse(cast.state), gone = a.gearIds[0], rival = stale.objects.cards[gone].controllerId;
    stale.objects.cards[gone].zone = { playerId: rival, zone: "TRASH" };
    stale.players[rival].zones.BATTLEFIELD = stale.players[rival].zones.BATTLEFIELD!.filter(id => id !== gone);
    (stale.players[rival].zones.TRASH ??= []).push(gone);
    stale.objects.cards[a.hostId].attachments = stale.objects.cards[a.hostId].attachments.filter(id => id !== gone);
    const staleResult = validateState(stale, a.context);
    assert.equal(staleResult.ok, false, "V5_STALE_TARGET_REJECTED");
    if (!staleResult.ok) assert.ok(staleResult.errors.some(e => e.code === "INVALID_DEFEAT_TARGET"), JSON.stringify(staleResult.errors));
});

test("V5 a single eligible Gear resolves synchronously without a strategic prompt", () => {
    const a = arrange({ gear: ["mantis-blades"] }), cast = castProgram(a);
    assert.equal(cast.state.resolution.choice, null, "V5_FORCED_SINGLE_TARGET");
    assert.equal(cast.state.objects.cards[a.gearIds[0]].zone.zone, "TRASH");
    assert.equal(cast.state.objects.cards[a.hostId].zone.zone, "BATTLEFIELD", "V5_HOST_RETAINED");
    assert.ok(kinds(cast.events).includes("DEFEAT_TRASH_ORDER_SELECTED"), "the one-card owner order is still emitted");
});

test("V5 Gear defeat is capability-gated and never enabled by vocabulary alone", () => {
    const off = v5Context(v5Probe, false);
    assert.equal(supportsPlay(v5Probe, off).ok, false, "V5_CAPABILITY_GATED");
    const a = arrange();
    assert.deepEqual(listDefeatTargets(a.state, a.actor, gearTarget, off), [], "V5_CAPABILITY_GATED");
    assert.ok(listDefeatTargets(a.state, a.actor, gearTarget, a.context).length > 0, "the same state enumerates under the policy");
});


test("V5 React reload rejects forged attack and continuation origins", async t => {
    const a = arrange({ caster: "RIVAL" });
    const paused = castProgram({ ...a, state: openReact(a) }, a.rival).state;
    assert.equal(validateState(JSON.parse(JSON.stringify(paused)), a.context).ok, true, "V5_REACT_VALID_ORIGIN");
    const missing = CardInstanceIdSchema.parse("v5-missing-card");
    const outsider = PlayerIdSchema.parse("00000000-0000-4000-8000-000000000099");
    const cases: [string, (s: MutableState) => void][] = [
        ["READY_ATTACKER", s => { s.objects.cards[a.hostId].readiness = "READY"; }],
        ["MISSING_ATTACKER", s => { assert.equal(s.timing.combat.stage, "RIVAL_REACT"); if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.attackerId = missing; }],
        ["GEAR_ATTACKER", s => { if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.attackerId = a.gearIds[0]; }],
        ["LAGGING_ATTACKER", s => { s.objects.cards[a.hostId].statuses.push("LAG"); }],
        ["FOREIGN_ATTACKING_PLAYER", s => { if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.attackingPlayerId = outsider; }],
        ["MISSING_LOCKED_TARGET", s => { if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.target = { kind: "CARD", cardInstanceId: missing }; }],
        ["FRIENDLY_LOCKED_CARD", s => { if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.target = { kind: "CARD", cardInstanceId: a.hostId }; }],
        ["FRIENDLY_LOCKED_GIG_AREA", s => { if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.target = { kind: "GIG_AREA", playerId: a.actor }; }],
        ["EFFECT_CONTROLLER", s => { s.resolution.current!.controllerId = a.actor; }],
        ["CONTINUATION_ACTOR", s => { s.resolution.playContinuation!.actorId = a.actor; }],
        ["SAVED_MAIN_RETURN", s => { s.resolution.returnTo = { kind: "MAIN" }; }],
        ["MISSING_SAVED_RETURN", s => { delete s.resolution.returnTo; }],
        ["ACTIVE_CASTER", s => {
            s.objects.cards[a.sourceId].controllerId = a.actor;
            s.resolution.current!.controllerId = a.actor;
            s.resolution.playContinuation!.actorId = a.actor;
            s.resolution.choice!.actorId = a.actor;
            s.timing.actingPlayer = a.actor;
        }]
    ];
    for (const [name, forge] of cases) await t.test(name, () => {
        const changed = GameStateSchema.parse(paused);
        forge(changed);
        const serialized = JSON.stringify(changed);
        const result = validateState(JSON.parse(serialized), a.context);
        assert.equal(result.ok, false, `V5_REACT_REJECTS_${name}`);
        if (!result.ok) assert.ok(result.errors.some(e => e.code === "INVALID_TARGETED_DEFEAT"), JSON.stringify(result.errors));
        assert.equal(JSON.stringify(changed), serialized, "rejected validation must not mutate the supplied state");
    });
});

test("V5 Gear aftermath facts retain their Main or defender React origin", async t => {
    // Validator-only fixtures: current Gear has no own DEFEATED trigger. The empty binding
    // batch below exercises the bounded fact validator, not a reachable persisted trigger pause.
    for (const react of [false, true]) {
        const a = arrange({ caster: react ? "RIVAL" : "ACTOR" });
        const cast = castProgram({ ...a, state: react ? openReact(a) : a.state }, react ? a.rival : a.actor);
        const resolved = pick(cast.state, a.context, o => o.kind === "CARD" && o.cardInstanceId === a.gearIds[0]).state;
        assert.equal(validateState(resolved, a.context).ok, true);
        assert.equal(resolved.objects.cards[a.sourceId].zone.zone, "TRASH");
        assert.equal(resolved.objects.cards[a.gearIds[0]].zone.zone, "TRASH");
        const facts = GameStateSchema.parse(resolved);
        facts.resolution.triggerContinuation = {
            origin: { kind: "DEFEAT", effectSource: a.sourceId, defeated: [{ targetId: a.gearIds[0], defeatedBy: a.sourceId }] },
            ordinal: 1, bindings: [], resolvedIds: [], phase: "SELECT"
        };
        assert.equal(validateEffectDefeatFacts(facts, a.context).ok, true, react ? "V5_REACT_AFTERMATH_VALID" : "V5_MAIN_AFTERMATH_VALID");
        const cases: [string, (s: MutableState) => void][] = react ? [
            ["ACTIVE_CASTER", s => { s.objects.cards[a.sourceId].controllerId = a.actor; }],
            ["ACTIVE_CASTER_AND_ACTOR", s => { s.objects.cards[a.sourceId].controllerId = a.actor; s.timing.actingPlayer = a.actor; }],
            ["WRONG_ACTING_PLAYER", s => { s.timing.actingPlayer = a.actor; }],
            ["READY_ATTACKER", s => { s.objects.cards[a.hostId].readiness = "READY"; }],
            ["MISSING_ATTACKER", s => { if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.attackerId = CardInstanceIdSchema.parse("v5-missing-card"); }],
            ["FOREIGN_ATTACKING_PLAYER", s => { if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.attackingPlayerId = PlayerIdSchema.parse("00000000-0000-4000-8000-000000000099"); }],
            ["FRIENDLY_LOCKED_TARGET", s => { if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.target = { kind: "GIG_AREA", playerId: a.actor }; }],
            ["LOST_REACT_ORIGIN", s => { s.timing.combat = { stage: "NONE" }; }]
        ] : [["NONACTIVE_MAIN_CASTER", s => { s.objects.cards[a.sourceId].controllerId = a.rival; }]];
        for (const [name, forge] of cases) await t.test(name, () => {
            const changed = structuredClone(facts);
            forge(changed);
            const result = validateEffectDefeatFacts(changed, a.context);
            assert.equal(result.ok, false, `V5_AFTERMATH_REJECTS_${name}`);
            if (!result.ok) assert.ok(result.errors.some(e => e.code === "INVALID_EFFECT_DEFEAT_FACT"), JSON.stringify(result.errors));
        });
    }
});
