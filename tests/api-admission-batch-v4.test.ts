import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, RulesetSchema, TemporaryPowerModifierSchema, canonicalSerialize, createContentBundle, hashCanonical, type CardRevisionSnapshot } from "@tcg/domain";
import { applyAction, createGameWithEvents, hashReplayState, listLegalActions, observe, resolveActionId, RulesView, validateState, type EngineContext } from "@tcg/engine";
import { buildModelInputV2 } from "@tcg/engine/public-actions";
import { supportsPlay } from "../packages/engine/src/play-support";
import { friendlyPlayPowerEnabled, hasFriendlyPlayPowerMetadata, supportsFriendlyPlayPowerUnit, validateFriendlyPlayPowerMetadata } from "../packages/engine/src/friendly-play-power-support";
import { friendlyPowerTargets } from "../packages/engine/src/friendly-play-power-queries";
import { hasAttackConditionPowerMetadata } from "../packages/engine/src/attack-condition-power-support";
import { applyTemporaryPower, expirePowerOnHiddenEntry, validateTemporaryPower } from "../packages/engine/src/temporary-power";
import { advanceTriggers, beginTriggers, continueTrigger } from "../packages/engine/src/trigger-resolution";
import { moveCardLocation } from "../packages/engine/src/card-movement";
import { TurnMutation } from "../packages/engine/src/turn";
import { JONIN, JONIN_SOURCE_PIN, jonin, batchV4Context, batchV4Input } from "./api-admission-batch-v4-fixture";
import { batchV3Context } from "./api-admission-batch-v3-fixture";
import { batchV4Replay, must } from "./api-admission-batch-v4-replay";
import source from "./fixtures/api-admission-batch-v4-jonin-source.v1.json";

let context: ReturnType<typeof batchV4Context> | undefined;
let replay: ReturnType<typeof batchV4Replay> | undefined;
const getContext = () => (context ??= batchV4Context());
const getReplay = () => (replay ??= batchV4Replay());
function powerStep() {
    const step = getReplay().steps.find(s => s.before.resolution.current?.effect.kind === "POWER_UNTIL_END_OF_TURN"
        && s.before.resolution.current.effect.target.kind === "FRIENDLY_UNIT");
    assert.ok(step, "the fixed legal replay must reach a strategic friendly-power target decision");
    return step;
}
function powerVariant(amount: number, target: "FRIENDLY_UNIT" | "RIVAL_UNIT" | "SOURCE_SUBJECT" = "FRIENDLY_UNIT") {
    const card = CardRevisionSnapshotSchema.parse(jonin);
    card.mechanics.abilities[0].effects = [{ kind: "POWER_UNTIL_END_OF_TURN", target: { kind: target }, amount }];
    return card;
}

test("Batch V4 preserves the exact raw API blob, printed facts, immutable source hash and earlier revisions", () => {
    const bytes = readFileSync(new URL("./fixtures/api-admission-batch-v4-jonin-source.v1.json", import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), JONIN_SOURCE_PIN.rawSha256);
    assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), JONIN_SOURCE_PIN.gitBlob);
    assert.equal(hashCanonical(source), JONIN_SOURCE_PIN.recordHash);
    assert.equal(jonin.provenance.sourceHash, JONIN_SOURCE_PIN.recordHash);
    assert.equal(jonin.id, JONIN); assert.equal(jonin.revision, 1);
    assert.deepEqual(jonin.ram, { RED: 2 }); assert.deepEqual(jonin.printedCost, { kind: "EDDIES", amount: 2 });
    assert.equal(jonin.power, 0); assert.equal(jonin.sellProfile.allowed, false);
    assert.equal(jonin.sourceMarkup, source.rules_text); assert.equal(jonin.rulesText, source.rules_text);
    assert.deepEqual(jonin.tags, ["Tyger Claws"]);
    assert.deepEqual(jonin.printings.map(p => p.id), source.printings.map(p => p.id));
    for (const previous of batchV3Context().content.cards)
        assert.equal(hashCanonical(getContext().content.cards.find(c => c.id === previous.id && c.revision === previous.revision)), hashCanonical(previous));
});

test("friendly +2 has its own metadata owner and complete fail-closed semantic gate", () => {
    assert.equal(hasFriendlyPlayPowerMetadata(jonin), true);
    assert.equal(hasAttackConditionPowerMetadata(jonin), false, "do not route every non-minus-one effect to the self+5 capability");
    assert.equal(supportsFriendlyPlayPowerUnit(jonin, getContext()).ok, true);
    assert.equal(supportsPlay(jonin, getContext()).ok, true);
    for (const amount of [-1, 0, 1, 3, 5]) assert.equal(supportsPlay(powerVariant(amount), getContext()).ok, false, `amount ${amount}`);
    for (const target of ["RIVAL_UNIT", "SOURCE_SUBJECT"] as const) assert.equal(supportsPlay(powerVariant(2, target), getContext()).ok, false, target);
    const defects: [string, (card: CardRevisionSnapshot) => void][] = [
        ["unreviewed", c => { c.provenance.reviewed = false; }],
        ["unsupported status", c => { c.execution!.status = "UNSUPPORTED"; }],
        ["wrong scope", c => { c.execution!.scope = "NONCOMBAT_PLAY_V1"; }],
        ["attack trigger", c => { c.mechanics.abilities[0].trigger = "WHEN_ATTACKING"; }],
        ["condition", c => { c.mechanics.abilities[0].conditions = [{ kind: "GIG_COUNT", minimum: 1 }]; }],
        ["additional effect", c => { c.mechanics.abilities[0].effects.push({ kind: "DRAW", count: 1 }); }],
        ["additional ability", c => { c.mechanics.abilities.push({ ...c.mechanics.abilities[0], id: "extra@1" }); }],
        ["keyword", c => { c.mechanics.keywords.push("ADRENALINE"); }],
        ["modifier", c => { c.mechanics.modifiers.push({ kind: "GRANT_PRINTED_POWER_TO_HOST" }); }],
        ["restriction", c => { c.mechanics.restrictions = [{ kind: "CANNOT_ATTACK" }]; }],
        ["Program", c => { c.type = "PROGRAM"; }]
    ];
    for (const [name, mutate] of defects) {
        const card = CardRevisionSnapshotSchema.parse(jonin); mutate(card);
        assert.equal(supportsPlay(CardRevisionSnapshotSchema.parse(card), getContext()).ok, false, name);
    }
    for (const path of ["friendly-play-power-support.ts", "friendly-play-power-queries.ts", "temporary-power.ts", "trigger-resolution.ts"])
        assert.equal(readFileSync(`packages/engine/src/${path}`, "utf8").includes(JONIN), false, "no runtime CardId dispatch");
});

test("all policy dependencies are explicit and hidden unsupported sources cannot escape validation", () => {
    for (const key of ["friendlyPlayPower", "cardPlay", "combatTriggers", "combatRestrictions", "react", "combatResolution"] as const) {
        const ruleset = RulesetSchema.parse(getContext().content.ruleset); delete ruleset.gameplay!.turnSlice![key];
        // Predicate-only counterfactual. Never present this deliberately unre-pinned bundle as a legal game context.
        const disabled: EngineContext = { content: { ...getContext().content, ruleset } };
        assert.equal(friendlyPlayPowerEnabled(disabled), false, key);
        assert.equal(supportsPlay(jonin, disabled).ok, false, key);
        assert.equal(validateFriendlyPlayPowerMetadata(getReplay().initialized.state, disabled).ok, false, key);
    }
    const ruleset = RulesetSchema.parse(getContext().content.ruleset); delete ruleset.gameplay!.turnSlice!.friendlyPlayPower;
    const disabled = { content: createContentBundle(ruleset, getContext().content.cards.map(c => CardRevisionSnapshotSchema.parse(c)), getContext().content.manifest.engine) };
    assert.equal(createGameWithEvents(batchV4Input("v4-disabled"), disabled).ok, false);
    const created = must(createGameWithEvents(batchV4Input("v4-ram-legal"), getContext()));
    assert.equal(Object.values(created.state.objects.cards).filter(c => c.cardId === JONIN).length, 6);
});

test("temporary-power schema preserves -1/+5 and requires origin provenance for +2", () => {
    const base = { kind: "POWER", sourceId: "s", targetId: "t", expires: { kind: "END_OF_TURN", turn: 1 } };
    const origin = { effectId: "a".repeat(64), abilityId: "a@1", ordinal: 1 };
    for (const value of [{ ...base, amount: -1 }, { ...base, amount: 5, origin }, { ...base, amount: 2, origin }])
        assert.deepEqual(TemporaryPowerModifierSchema.parse(value), value);
    assert.equal(TemporaryPowerModifierSchema.safeParse({ ...base, amount: 2 }).success, false);
    assert.equal(TemporaryPowerModifierSchema.safeParse({ ...base, amount: 5 }).success, false);
    assert.equal(TemporaryPowerModifierSchema.safeParse({ ...base, amount: 3, origin }).success, false);
});

test("Jonin pauses in the trigger scheduler, offering only friendly face-up field Units including itself", () => {
    const { before } = powerStep(), current = before.resolution.current!;
    assert.equal(before.resolution.playContinuation, undefined);
    assert.equal(before.resolution.triggerContinuation?.origin.kind, "PLAY");
    assert.equal(before.resolution.triggerContinuation?.phase, "TARGET");
    const targets = friendlyPowerTargets(before, current.controllerId, getContext());
    assert.ok(targets.length > 1); assert.ok(current.sourceId && targets.includes(current.sourceId));
    assert.deepEqual(before.resolution.choice!.options, targets.map(cardInstanceId => ({ kind: "CARD", cardInstanceId })));
    for (const id of targets) {
        const c = before.objects.cards[id];
        assert.equal(c.controllerId, current.controllerId); assert.equal(c.face, "UP"); assert.equal(c.zone.zone, "BATTLEFIELD");
    }
    for (const a of must(listLegalActions(before, before.timing.actingPlayer, getContext()))) assert.notEqual(a.descriptor.label, "Unsupported choice");
});

test("the selected target gains exactly +2, with printed power unchanged and one resolved occurrence", () => {
    const { before, after, events } = powerStep();
    const applied = events.find(e => e.payload.kind === "POWER_MODIFIER_APPLIED");
    assert.ok(applied && applied.payload.kind === "POWER_MODIFIER_APPLIED");
    const mod = applied.payload.modifier;
    assert.equal(mod.amount, 2); assert.ok(mod.amount === 2);
    assert.equal(mod.origin.effectId, before.resolution.current!.id);
    assert.equal(new RulesView(after, getContext()).getEffectivePower(mod.targetId), new RulesView(before, getContext()).getEffectivePower(mod.targetId)! + 2);
    assert.equal(new RulesView(after, getContext()).getRevision(mod.targetId)!.power, new RulesView(before, getContext()).getRevision(mod.targetId)!.power);
    assert.equal(events.filter(e => e.payload.kind === "EFFECT_RESOLVED" && e.payload.effectId === mod.origin.effectId).length, 1);
    assert.equal(validateState(JSON.parse(JSON.stringify(after)), getContext()).ok, true);
});

test("self-targeting adds power but does not remove Lag or invent an attack permission", () => {
    const { before } = powerStep(), sourceId = before.resolution.current!.sourceId!;
    const index = before.resolution.choice!.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === sourceId);
    assert.ok(index >= 0);
    const next = must(applyAction(before, { actorId: before.timing.actingPlayer, action: { kind: "CHOOSE", choiceId: before.resolution.choice!.id, optionIndices: [index] } }, getContext()));
    assert.equal(new RulesView(next.state, getContext()).getEffectivePower(sourceId), 2);
    assert.equal(next.state.objects.cards[sourceId].statuses.includes("LAG"), true);
    assert.equal(must(listLegalActions(next.state, next.state.timing.actingPlayer, getContext())).some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === sourceId), false);
});

test("one remaining target is automatic; zero remaining targets finish without a fabricated choice", () => {
    for (const keepSource of [true, false]) {
        // Trusted reducer branch fixture, not a claim that these movements occurred in the legal replay.
        const m = new TurnMutation(powerStep().before, getContext()), current = m.state.resolution.current!;
        for (const id of friendlyPowerTargets(m.state, current.controllerId, getContext()))
            if (!keepSource || id !== current.sourceId) moveCardLocation(m, id, "TRASH");
        must(advanceTriggers(m));
        assert.equal(m.state.resolution.choice, null);
        const applied = m.events.filter(e => e.payload.kind === "POWER_MODIFIER_APPLIED");
        assert.equal(applied.length, keepSource ? 1 : 0);
        if (keepSource) assert.ok(m.events.some(e => e.payload.kind === "CARD_TARGET_SELECTED" && e.payload.forced));
    }
});

test("independent PLAY occurrences stack and a single occurrence cannot apply twice", () => {
    const step = powerStep(), target = step.before.resolution.choice!.options[0];
    assert.ok(target.kind === "CARD");
    const duplicate = new TurnMutation(step.before, getContext());
    must(applyTemporaryPower(duplicate, target.cardInstanceId));
    assert.equal(applyTemporaryPower(duplicate, target.cardInstanceId).ok, false);
    const m = new TurnMutation(step.after, getContext());
    const first = step.after.temporaryModifiers!.find(x => x.amount === 2)!;
    const other = Object.values(m.state.objects.cards).find(c => c.cardId === JONIN && c.id !== first.sourceId && c.controllerId === m.state.objects.cards[first.sourceId].controllerId);
    assert.ok(other);
    // Isolated occurrence fixture: no claim of a second paid PLAY action or a new regression trajectory.
    moveCardLocation(m, other.id, "BATTLEFIELD"); other.readiness = "READY"; other.statuses = ["LAG"];
    must(beginTriggers(m, { kind: "PLAY", subjectId: other.id }));
    const index = m.state.resolution.choice!.options.findIndex(o => o.kind === "CARD" && o.cardInstanceId === first.targetId);
    assert.ok(index >= 0); must(continueTrigger(m, index));
    assert.equal(m.state.temporaryModifiers!.filter(x => x.amount === 2 && x.targetId === first.targetId).length, 2);
    assert.equal(new RulesView(m.state, getContext()).getEffectivePower(first.targetId), new RulesView(step.after, getContext()).getEffectivePower(first.targetId)! + 2);
    assert.equal(validateTemporaryPower(m.state, getContext()).ok, true);
});

test("stale target sets, forged magnitudes, duplicate receipts and rival persisted targets fail closed", () => {
    const { before, after } = powerStep();
    const badChoice = GameStateSchema.parse(before), target = badChoice.resolution.choice!.options[0];
    assert.ok(target.kind === "CARD"); badChoice.objects.cards[target.cardInstanceId].face = "DOWN";
    assert.equal(validateState(badChoice, getContext()).ok, false);
    assert.equal(applyAction(badChoice, powerStep().action, getContext()).ok, false);
    const badEffect = GameStateSchema.parse(before);
    assert.ok(badEffect.resolution.current!.effect.kind === "POWER_UNTIL_END_OF_TURN");
    badEffect.resolution.current!.effect.amount = 3;
    assert.equal(validateState(badEffect, getContext()).ok, false);
    const duplicated = GameStateSchema.parse(after); duplicated.temporaryModifiers!.push({ ...duplicated.temporaryModifiers![0] });
    assert.equal(validateState(duplicated, getContext()).ok, false);
    const rivalTarget = GameStateSchema.parse(after), mod = rivalTarget.temporaryModifiers!.find(x => x.amount === 2)!;
    const rival = Object.values(rivalTarget.objects.cards).find(c => c.controllerId !== rivalTarget.objects.cards[mod.sourceId].controllerId)!;
    mod.targetId = rival.id;
    assert.equal(validateState(rivalTarget, getContext()).ok, false);
});

test("normal turn-end and hidden-entry expiry remove +2 without rewriting printed characteristics", () => {
    const end = getReplay().steps.find(s => s.action.action.kind === "END_TURN" && s.before.temporaryModifiers?.some(x => x.amount === 2));
    assert.ok(end);
    assert.equal(end.after.temporaryModifiers?.some(x => x.amount === 2) ?? false, false);
    assert.ok(end.events.some(e => e.payload.kind === "POWER_MODIFIER_EXPIRED" && e.payload.reason === "TURN_END"));
    const m = new TurnMutation(powerStep().after, getContext()), mod = m.state.temporaryModifiers!.find(x => x.amount === 2)!;
    expirePowerOnHiddenEntry(m, mod.targetId);
    assert.equal(m.state.temporaryModifiers?.some(x => x.targetId === mod.targetId) ?? false, false);
    assert.ok(m.events.some(e => e.payload.kind === "POWER_MODIFIER_EXPIRED" && e.payload.reason === "HIDDEN_AREA"));
    assert.equal(jonin.power, 0);
});

test("every new replay decision round-trips through public V2 actions and keeps hidden hand identities private", () => {
    for (const step of getReplay().steps) {
        const actor = step.before.timing.actingPlayer;
        const input = must(buildModelInputV2(step.before, actor, getContext()));
        assert.deepEqual(input.legalActions.map(a => a.actionId), step.legalActions.map(a => a.actionId));
        const semantic = input.legalActions.map(a => canonicalSerialize(Object.fromEntries(Object.entries(a.descriptor).filter(([key]) => key !== "label"))));
        assert.equal(new Set(semantic).size, semantic.length);
        for (const a of input.legalActions) assert.equal(resolveActionId(step.before, actor, a.actionId, getContext()).ok, true);
        const json = JSON.stringify(input.legalActions);
        for (const field of ["actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId"]) assert.equal(json.includes(`"${field}"`), false, field);
        const rival = step.before.match.playerOrder.find(p => p !== actor)!;
        const observed = JSON.stringify(must(observe(step.before, rival, getContext())));
        const play = step.before.resolution.playContinuation;
        for (const id of step.before.players[actor].zones.HAND)
            if (id !== play?.sourceId) assert.equal(observed.includes(`"${id}"`), false, "rival may not see undeclared own-hand identity");
        assert.equal(hashReplayState(step.before), hashReplayState(GameStateSchema.parse(step.before)));
    }
    const state = powerStep().before, selected = powerStep().actionId;
    assert.equal(resolveActionId(powerStep().after, state.timing.actingPlayer, selected, getContext()).ok, false, "old selection token is stale");
});

test("repeated generation and an artifact-pin perturbation preserve the semantic replay choices", () => {
    const first = getReplay(), again = batchV4Replay(first.seed, getContext());
    assert.equal(again.finalStateHash, first.finalStateHash);
    const perturbed = batchV4Replay(first.seed, batchV4Context({ ...getContext().content.manifest.engine, artifactHash: "f".repeat(64) }));
    assert.deepEqual(perturbed.steps.map(s => s.action), first.steps.map(s => s.action));
    assert.deepEqual(perturbed.steps.map(s => s.events), first.steps.map(s => s.events));
});
