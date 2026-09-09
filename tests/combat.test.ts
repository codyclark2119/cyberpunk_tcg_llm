import { effectiveCardTypes } from "../packages/engine/src/characteristics";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardInstanceIdSchema, GameStateSchema, CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical, type GameState, type CardInstanceId, type LegalAction, type Result } from "@tcg/domain";
import { applyAction, createGameWithEvents, listLegalActions, validateState, RulesView, observe, hashPosition, hashReplayState, resolveActionId, advanceResolution } from "@tcg/engine";
import { generatePosition, modelInput } from "@tcg/training-harness";
import { handleRequest } from "@tcg/wire";
import { TurnMutation } from "../packages/engine/src/turn";
import { finishAttackEffects } from "../packages/engine/src/combat";
import { combatContext, combatInput, swordwise, SWORDWISE } from "./combat-fixture";
import { combatReplay } from "./combat-replay";
import { KERRY } from "./noncombat-fixture";
import { MANTIS, ROYCE } from "./gear-fixture";
import { unwrap } from "./turn-replay";
import source from "./fixtures/combat-card-source.v1.json";
import rules from "./fixtures/combat-rules.v1.json";
const context = combatContext(), replay = combatReplay(), states: GameState[] = [replay.initialized.state];
for (const step of replay.steps) states.push(unwrap(applyAction(states.at(-1)!, step.action, context)).state);
const before = states.at(-3)!, choice = states.at(-2)!, final = states.at(-1)!, actor = before.timing.activePlayer, rival = before.match.playerOrder.find(id => id !== actor)!, attacker = replay.attackerId;
const kerry = Object.values(before.objects.cards).find(c => c.controllerId === actor && c.cardId === KERRY && c.zone.zone === "BATTLEFIELD")!.id;
const defender = Object.values(before.objects.cards).find(c => c.controllerId === rival && c.cardId === KERRY && c.zone.zone === "BATTLEFIELD")!.id;
const gear = before.objects.cards[attacker].attachments[0];
function legal(s: GameState, ctx = context) { return unwrap(listLegalActions(s, s.timing.actingPlayer, ctx)); }
function act(s: GameState, predicate: (a: LegalAction) => boolean) { const a = legal(s).find(predicate); assert.ok(a); return unwrap(applyAction(s, { actorId: a.actorId, action: a.action }, context)); }
function attack(s = before, id = attacker) { return act(s, a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === id); }
function select(s = choice, kind: "CARD" | "GIG_AREA" = "CARD") { return act(s, a => a.action.kind === "CHOOSE" && (() => { const o = s.resolution.choice!.options[a.action.optionIndices[0]]; return o.kind === "ATTACK_TARGET" && o.target.kind === kind; })()); }
function relocate(s: ReturnType<typeof GameStateSchema.parse>, id: CardInstanceId, zone: "HAND" | "TRASH" | "BATTLEFIELD") {
    const c = s.objects.cards[id], from = s.players[c.zone.playerId].zones[c.zone.zone]!; from.splice(from.indexOf(id), 1); s.players[c.controllerId].zones[zone].push(id); c.zone = { zone, playerId: c.controllerId };
    if (zone !== "BATTLEFIELD") c.statuses = c.statuses.filter(x => x !== "LAG");
}
function failed<T>(r: Result<T>, code?: string) { assert.equal(r.ok, false); if (!r.ok && code) assert.equal(r.errors[0].code, code); }
function repin(s: GameState, ctx: typeof context) { return GameStateSchema.parse({ ...s, match: { ...s.match, rulesetVersion: ctx.content.ruleset.version, rulesetHash: ctx.content.manifest.ruleset.hash, contentManifestHash: ctx.content.manifestHash, cards: ctx.content.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision })) } }); }

test("Swordwise review retains exact ATTACK text, cost/power/RAM, five printings and source pins", () => {
    assert.equal(swordwise.id, SWORDWISE); assert.equal(swordwise.revision, 1);
    assert.equal(swordwise.rulesText, "{Attack} If this Unit has power 5+, draw 1.");
    assert.equal(swordwise.power, 3); assert.deepEqual(swordwise.printedCost, { kind: "EDDIES", amount: 3 }); assert.equal(swordwise.ram?.RED, 2);
    assert.equal(swordwise.sellProfile.allowed, false); assert.equal(swordwise.printings.length, 5);
    assert.equal(swordwise.provenance.sourceHash, hashCanonical(source.record)); assert.deepEqual(source.matchingErrata, []);
    for (const id of ["9.3.1", "9.3.2.1", "9.3.2.2", "9.3.3", "9.6", "9.26.3", "4.2.1", "11.21.2", "11.3.1.1"]) assert.ok(rules.records.some(r => r.id === id));
});
test("complete combat execution shape is checked at deck admission and play/attack enumeration", () => {
    for (const patch of [
        { execution: { scope: "COMBAT_ATTACK_V1", status: "UNSUPPORTED" } }, { execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" } },
        { mechanics: { ...swordwise.mechanics, keywords: ["QUICK"] } }, { mechanics: { ...swordwise.mechanics, abilities: [...swordwise.mechanics.abilities, swordwise.mechanics.abilities[0]] } },
        { mechanics: { ...swordwise.mechanics, abilities: [{ ...swordwise.mechanics.abilities[0], effects: [{ kind: "DRAW", count: 1 }] }] } },
        { mechanics: { ...swordwise.mechanics, abilities: [{ ...swordwise.mechanics.abilities[0], trigger: "WHEN_DEFEATED" }] } }, { printedCost: { kind: "DASH" } }
    ]) {
        const cards = context.content.cards.map(c => CardRevisionSnapshotSchema.parse(c.id === SWORDWISE ? { ...c, ...patch } : c));
        const ctx = { content: createContentBundle(RulesetSchema.parse(context.content.ruleset), cards, context.content.manifest.engine) };
        failed(createGameWithEvents(combatInput(), ctx));
        assert.equal(legal(repin(before, ctx), ctx).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker), false);
    }
});
test("ready Units have separate attack choices alongside existing legal MAIN actions", () => {
    const view = new RulesView(before, context);
    assert.deepEqual(view.listAttackers(actor).sort(), [attacker, kerry].sort());
    const actions = legal(before);
    for (const kind of ["DECLARE_ATTACK", "SELL_CARD", "CALL_LEGEND", "END_TURN"]) assert.ok(actions.some(a => a.action.kind === kind), kind);
    assert.equal(actions.filter(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === attacker).length, 1);
});
test("spent, Lag, face-down, wrong-zone and wrong-controller Units cannot attack atomically", () => {
    for (const change of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[kerry].readiness = "SPENT"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[kerry].statuses.push("LAG"); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[kerry].face = "DOWN"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { relocate(s, kerry, "HAND"); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { relocate(s, kerry, "TRASH"); }
    ]) {
        const s = GameStateSchema.parse(before); change(s); const original = hashReplayState(s);
        assert.equal(legal(s).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === kerry), false);
        failed(applyAction(s, { actorId: actor, action: { kind: "DECLARE_ATTACK", cardInstanceId: kerry } }, context)); assert.equal(hashReplayState(s), original);
    }
    failed(applyAction(before, { actorId: rival, action: { kind: "DECLARE_ATTACK", cardInstanceId: attacker } }, context));
    failed(applyAction(before, { actorId: actor, action: { kind: "DECLARE_ATTACK", cardInstanceId: defender } }, context));
    assert.deepEqual(unwrap(listLegalActions(before, rival, context)), []);
});
test("effective Unit semantics include field Legends architecturally, while Legends-area Royce, Gear and Programs cannot attack", () => {
    const s = GameStateSchema.parse(before), royce = Object.values(s.objects.cards).find(c => c.controllerId === actor && c.cardId === ROYCE)!;
    royce.face = "UP";
    const view = new RulesView(s, context); assert.equal(view.getEffectivePower(royce.id), 6); assert.equal(view.isUnitForGameplay(royce.id), false);
    for (const c of Object.values(s.objects.cards).filter(c => ["LEGENDS", "HAND"].includes(c.zone.zone) || c.cardId === MANTIS)) assert.equal(view.isAttackEligible(actor, c.id), false);
    relocate(s, royce.id, "BATTLEFIELD");
    assert.deepEqual(effectiveCardTypes(s, royce.id, context), ["LEGEND", "UNIT"]);
    // The printed/effective distinction remains; a fabricated unreviewed field Royce is now rejected at validation.
    assert.equal(validateState(s, context).ok, false);
    assert.throws(() => new RulesView(s, context), /UNSUPPORTED_FIELD_LEGEND/);
});
test("real Kerry play applies Lag, end of turn clears it and the same ready Unit later becomes an attacker", () => {
    const entered = states.find(s => s.objects.cards[kerry]?.zone.zone === "BATTLEFIELD" && s.objects.cards[kerry].statuses.includes("LAG"))!;
    assert.ok(entered); assert.equal(new RulesView(entered, context).isAttackEligible(actor, kerry), false);
    const later = states.find(s => s.timing.activePlayer === actor && s.timing.window === "MAIN" && new RulesView(s, context).isAttackEligible(actor, kerry));
    assert.ok(later); assert.equal(later.objects.cards[kerry].id, kerry); assert.equal(later.objects.cards[kerry].readiness, "READY");
    assert.ok(replay.steps.some(s => s.events.some(e => e.payload.kind === "LAG_REMOVED" && e.payload.cardInstanceId === kerry)));
});
test("targets are spent rival field Units and a nonempty rival Gig area; ready Units and individual dice are excluded", () => {
    const view = new RulesView(before, context), targets = view.listAttackTargets(attacker, actor);
    assert.deepEqual(targets, [{ kind: "CARD", cardInstanceId: defender }, { kind: "GIG_AREA", playerId: rival }]);
    const s = GameStateSchema.parse(before), extra = Object.values(s.objects.cards).find(c => c.controllerId === rival && c.cardId === SWORDWISE)!;
    relocate(s, extra.id, "BATTLEFIELD"); extra.face = "UP"; extra.readiness = "READY";
    assert.equal(new RulesView(s, context).listAttackTargets(attacker, actor).length, 2);
    extra.readiness = "SPENT"; assert.equal(new RulesView(s, context).listAttackTargets(attacker, actor).length, 3);
    extra.statuses = ["LAG"]; assert.equal(new RulesView(s, context).listAttackTargets(attacker, actor).length, 3); // Lag prevents attacking, not being attacked.
});
test("no targets suppress attack; one area target locks automatically with no forced training choice", () => {
    const s = GameStateSchema.parse(before); s.objects.cards[defender].readiness = "READY";
    const only = attack(s); assert.equal(only.state.timing.combat.stage, "RIVAL_REACT"); assert.equal(only.state.resolution.choice, null);
    assert.deepEqual(new RulesView(only.state, context).getCombatTarget(), { kind: "GIG_AREA", playerId: rival });
    for (const id of [...s.players[rival].gigs.GIGS]) { const g = s.objects.gigs[id]; g.roll = { kind: "UNROLLED" }; g.location.zone = "FIXER"; s.players[rival].gigs.FIXER.push(id); }
    s.players[rival].gigs.GIGS = [];
    assert.deepEqual(new RulesView(s, context).listAttackers(actor), []);
});
test("target selection precedes spending, declaration and trigger discovery; other MAIN actions stop", () => {
    const declared = attack(); assert.deepEqual(declared.state, choice);
    assert.deepEqual(declared.events.map(e => e.payload.kind), ["PHASE_CHANGED"]);
    assert.equal(choice.objects.cards[attacker].readiness, "READY"); assert.equal(choice.resolution.current, null);
    assert.equal(choice.timing.combat.stage, "ATTACK_TARGET_SELECTION");
    assert.ok(legal(choice).every(a => a.action.kind === "CHOOSE"));
    for (const kind of ["DECLARE_ATTACK", "END_TURN"] as const) failed(applyAction(choice, { actorId: actor, action: kind === "END_TURN" ? { kind } : { kind, cardInstanceId: kerry } }, context));
});
test("locking a target spends only the attacker, resolves one conditional DRAW and opens React in rule order", () => {
    const result = select();
    assert.deepEqual(result.events.map(e => e.payload.kind), ["ATTACK_TARGET_SELECTED", "ATTACKER_SPENT", "ATTACK_DECLARED", "EFFECT_PENDING", "CONDITION_EVALUATED", "CARD_MOVED", "EFFECT_RESOLVED", "RIVAL_REACT_OPENED"]);
    assert.equal(result.state.players[actor].zones.HAND.length, choice.players[actor].zones.HAND.length + 1);
    assert.equal(result.state.objects.cards[attacker].readiness, "SPENT"); assert.equal(result.state.timing.actingPlayer, rival);
    for (const c of Object.values(choice.objects.cards)) if (c.id !== attacker) assert.equal(result.state.objects.cards[c.id].readiness, c.readiness);
    assert.equal(result.state.timing.combat.stage, "RIVAL_REACT"); assert.deepEqual(result.state, final);
    assert.equal(result.events.some(e => e.payload.kind === "ABILITY_ACTIVATED"), false);
});
test("false Swordwise power condition still resolves its ATTACK trigger once without drawing or choices", () => {
    const s = GameStateSchema.parse(before); s.objects.cards[attacker].attachments = []; relocate(s, gear, "TRASH");
    const result = select(attack(s).state);
    assert.equal(result.state.players[actor].zones.HAND.length, s.players[actor].zones.HAND.length);
    assert.equal(result.events.filter(e => e.payload.kind === "EFFECT_PENDING").length, 1);
    assert.equal(result.events.filter(e => e.payload.kind === "EFFECT_RESOLVED").length, 1);
    assert.ok(result.events.some(e => e.payload.kind === "CONDITION_EVALUATED" && !e.payload.met));
    assert.equal(result.state.timing.combat.stage, "RIVAL_REACT");
});
test("Kerry attacks without activating its Spend ability; Mantis composes to 7 and stays attached", () => {
    const s = GameStateSchema.parse(before); s.objects.cards[attacker].attachments = []; s.objects.cards[kerry].attachments.push(gear);
    const result = select(attack(s, kerry).state), view = new RulesView(result.state, context);
    assert.equal(view.getEffectivePower(kerry), 7); assert.equal(view.getAttachmentHost(gear)?.id, kerry);
    assert.equal(result.events.some(e => e.payload.kind === "EFFECT_PENDING" || e.payload.kind === "ABILITY_ACTIVATED" || e.payload.kind === "GEAR_DETACHED"), false);
    assert.deepEqual(result.state.objects.cards[gear], s.objects.cards[gear]);
});
test("attack keeps physical identity, base revisions and Gear; derived power is never cached into CombatState", () => {
    for (const key of ["id", "cardId", "revision", "ownerId", "controllerId", "zone", "attachments"] as const) assert.deepEqual(final.objects.cards[attacker][key], before.objects.cards[attacker][key]);
    assert.deepEqual(final.objects.cards[gear], before.objects.cards[gear]); assert.equal(new RulesView(final, context).getEffectivePower(attacker), 5);
    assert.equal(swordwise.power, 3); assert.equal(JSON.stringify(final.timing.combat).includes("power"), false);
    assert.equal(new RulesView(final, context).testCondition(actor, { kind: "SOURCE_POWER_AT_LEAST", minimum: 5 }, attacker), true);
});
test("forged choices, stale attackers/targets, wrong actor and stale actionIds reject without mutation", () => {
    const selected = legal(choice)[0], request = { actorId: actor, action: selected.action };
    for (const change of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[defender].readiness = "READY"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { relocate(s, defender, "HAND"); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[attacker].readiness = "SPENT"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[attacker].controllerId = rival; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.choice!.options[0] = { kind: "ATTACK_TARGET", target: { kind: "GIG_AREA", playerId: actor } }; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.choice!.id = "forged"; }
    ]) { const s = GameStateSchema.parse(choice); change(s); const hash = hashReplayState(s); failed(applyAction(s, request, context)); assert.equal(hashReplayState(s), hash); }
    failed(applyAction(choice, { actorId: rival, action: selected.action }, context));
    failed(applyAction(choice, { actorId: actor, action: { kind: "CHOOSE", choiceId: choice.resolution.choice!.id, optionIndices: [99] } }, context));
    failed(resolveActionId(choice, actor, legal(before).find(a => a.action.kind === "DECLARE_ATTACK")!.actionId, context), "UNKNOWN_ACTION_ID");
});
test("combat invariants reject incompatible timing, missing references, target shape, wrong actor and pending work", () => {
    for (const change of [
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.window = "MAIN"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.actingPlayer = actor; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.objects.cards[attacker].readiness = "READY"; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.attackerId = CardInstanceIdSchema.parse("missing"); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { if (s.timing.combat.stage === "RIVAL_REACT") s.timing.combat.target = { kind: "CARD", cardInstanceId: kerry }; },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.resolution.pending.push({ id: "forged", sourceId: attacker, controllerId: actor, effect: { kind: "DRAW", count: 1 }, causedBySequence: 0 }); },
        (s: ReturnType<typeof GameStateSchema.parse>) => { s.timing.combat = { stage: "NONE" }; }
    ]) { const s = GameStateSchema.parse(final); change(s); failed(validateState(s, context)); }
    const invalid = { ...final, timing: { ...final.timing, combat: { ...final.timing.combat, target: { kind: "GIG_AREA", cardInstanceId: defender } } } };
    failed(validateState(invalid, context));
});
test("after-effects invalidation ends the attack without retargeting, fighting or stealing", () => {
    for (const change of [
        (m: TurnMutation) => { relocate(m.state, defender, "TRASH"); },
        (m: TurnMutation) => { m.state.objects.cards[defender].readiness = "READY"; },
        (m: TurnMutation) => { relocate(m.state, kerry, "HAND"); }
    ]) {
        const base = select(attack(before, kerry).state).state, m = new TurnMutation(base, context);
        assert.equal(m.state.timing.combat.stage, "RIVAL_REACT");
        if (m.state.timing.combat.stage !== "RIVAL_REACT") throw new Error("Expected React");
        m.state.timing.combat.stage = "ATTACK_EFFECTS"; m.state.timing.step = "ATTACK_EFFECTS"; m.state.timing.window = "RESOLVING"; m.state.timing.actingPlayer = actor;
        change(m); unwrap(finishAttackEffects(m)); const result = unwrap(m.result());
        assert.equal(result.state.timing.combat.stage, "NONE"); assert.equal(result.state.timing.window, "MAIN");
        assert.deepEqual(result.events.map(e => e.payload.kind), ["ATTACK_ENDED", "PHASE_CHANGED"]);
        assert.deepEqual(result.state.objects.gigs, base.objects.gigs); assert.equal(result.state.match.outcome, undefined);
    }
});
test("empty draw during ATTACK keeps the existing immediate match-loss policy instead of opening React", () => {
    const s = GameStateSchema.parse(before); for (const id of [...s.players[actor].zones.DECK]) relocate(s, id, "TRASH");
    const result = select(attack(s).state);
    assert.equal(result.state.match.outcome?.reason, "EMPTY_DRAW"); assert.equal(result.state.timing.combat.stage, "NONE"); assert.equal(result.state.timing.step, "FINISHED");
    assert.equal(result.events.some(e => e.payload.kind === "RIVAL_REACT_OPENED"), false);
});
test("both players see public combat, power and Gear while opponent hand, hidden Legends/Eddies, deck and RNG stay hidden", () => {
    for (const viewer of [actor, rival]) {
        const observation = unwrap(observe(final, viewer, context));
        assert.equal(observation.combat?.attackerId, attacker); assert.equal(observation.combat?.stage, "RIVAL_REACT");
        assert.deepEqual(observation.combat?.target, { kind: "CARD", cardInstanceId: defender });
        assert.deepEqual(observation.unsupportedCapabilities, ["UNSUPPORTED_RIVAL_REACT"]);
        const host = observation.players.flatMap(p => p.cards).find(c => c.publicId === attacker)!;
        assert.equal(host.effectivePower, 5); assert.equal(host.readiness, "SPENT"); assert.deepEqual(host.attachments, [gear]);
        const opponent = observation.players.find(p => p.seat !== observation.viewerSeat)!;
        assert.equal(opponent.cards.some(c => c.zone === "HAND" || c.zone === "DECK"), false);
        assert.ok(opponent.cards.filter(c => c.face === "DOWN").every(c => !c.content && !c.attachments && c.effectivePower === undefined));
        assert.equal(JSON.stringify(observation).includes(final.rng.seed), false);
    }
    const input = JSON.stringify(modelInput(unwrap(generatePosition(choice, actor, context, "combat-target"))));
    assert.equal(input.includes('"rng"'), false); assert.equal(input.includes(choice.rng.seed), false);
});
test("React is valid and observable but every advance attempt reports its unsupported capability without auto-pass", () => {
    const original = hashReplayState(final);
    for (const player of [actor, rival]) assert.deepEqual(unwrap(listLegalActions(final, player, context)), []);
    failed(advanceResolution(final, context), "UNSUPPORTED_RIVAL_REACT");
    failed(applyAction(final, { actorId: rival, action: { kind: "PASS_REACT" } }, context), "UNSUPPORTED_RIVAL_REACT");
    failed(resolveActionId(final, rival, "0".repeat(64), context), "UNSUPPORTED_RIVAL_REACT");
    failed(generatePosition(final, rival, context, "not-trainable"), "NO_PLAYER_DECISION");
    assert.equal(hashReplayState(final), original); assert.equal(final.match.outcome, undefined);
});
test("wire v1 exposes the React marker and returns a structured unsupported error for attempted progression", () => {
    const request = { schemaVersion: 1, requestId: "combat-boundary", content: context.content, state: final, actorId: rival };
    const seen = handleRequest({ ...request, op: "observe" });
    assert.ok(seen.ok && seen.value.kind === "observation");
    if (seen.ok && seen.value.kind === "observation") assert.deepEqual(seen.value.observation.unsupportedCapabilities, ["UNSUPPORTED_RIVAL_REACT"]);
    const stopped = handleRequest({ ...request, op: "applyAction", actionId: "0".repeat(64) });
    assert.equal(stopped.ok, false); if (!stopped.ok) assert.equal(stopped.errors[0].code, "UNSUPPORTED_RIVAL_REACT");
});
test("POSITION_V2 and target actionIds ignore transport counters but replay hashes retain them", () => {
    const changed = GameStateSchema.parse({ ...choice, match: { ...choice.match, id: "00000000-0000-4000-8000-000000000099", version: choice.match.version + 10, eventSequence: choice.match.eventSequence + 100 } });
    assert.equal(hashPosition(choice), hashPosition(changed)); assert.deepEqual(legal(choice), legal(changed)); assert.notEqual(hashReplayState(choice), hashReplayState(changed));
    const a = select(), b = select(changed); assert.equal(hashPosition(a.state), hashPosition(b.state)); assert.deepEqual(a.events.map(e => e.payload), b.events.map(e => e.payload));
});
test("combat replay and its strategic positions are deterministic and end at the pinned unresolved combat", () => {
    assert.deepEqual(replay, combatReplay());
    assert.deepEqual(replay, JSON.parse(readFileSync(new URL("./fixtures/combat-attack-replay.v1.json", import.meta.url), "utf8")));
    assert.equal(replay.steps.length, 41); assert.ok(replay.positions.some(p => p.state.timing.step === "ATTACK_TARGET_SELECTION"));
    assert.ok(replay.positions.some(p => p.state.timing.step === "MAIN" && p.legalActions.some(a => a.action.kind === "DECLARE_ATTACK")));
    assert.ok(replay.positions.every(p => p.legalActions.length > 1 && !["ATTACK_EFFECTS", "RIVAL_REACT"].includes(p.state.timing.step!)));
    assert.equal(replay.attackPower, 5); assert.equal(final.timing.combat.stage, "RIVAL_REACT");
    assert.equal(replay.steps.flatMap(s => s.legalActions).some(a => ["DECLARE_BLOCKER", "PASS_REACT", "GO_SOLO"].includes(a.action.kind)), false);
});
