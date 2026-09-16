import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardRevisionSnapshotSchema, GameStateSchema, RulesetSchema, canonicalSerialize, createContentBundle, hashCanonical, type CardRevisionSnapshot } from "@tcg/domain";
import { createGameWithEvents, observe, resolveActionId } from "@tcg/engine";
import { buildModelInputV2 } from "@tcg/engine/public-actions";
import { supportsPlay } from "../packages/engine/src/play-support";
import { supportsRestrictedPlay } from "../packages/engine/src/restriction-support";
import { attackSourceValid, isAttackEligible, laggingAttackPermitted } from "../packages/engine/src/combat-queries";
import { restrictionCards, restrictionsContext } from "./combat-restrictions-fixture";
import { ANIMALS_WRECKER, GREEN_SUPPORT, RED_SUPPORT, RIDING_NOMAD, ROCKN_ROCKERBOY, YELLOW_SUPPORT, batchV2Cards, batchV2Context, batchV2Input } from "./api-admission-batch-v2-fixture";
import { BATCH_V2_UNITS, batchV2Replay } from "./api-admission-batch-v2-replay";
import { unwrap } from "./turn-replay";
import sources from "./fixtures/api-admission-batch-v2-card-sources.v1.json";
import rules from "./fixtures/api-admission-batch-v2-rules.v1.json";
import restrictionSources from "./fixtures/combat-restrictions-card-sources.v1.json";
import restrictionRules from "./fixtures/combat-restrictions-rules.v1.json";

// Built lazily and memoised so a broken revision, gate or replay fails the test that needs it, never the whole file at load.
let builtContext: ReturnType<typeof batchV2Context> | undefined, builtReplay: ReturnType<typeof batchV2Replay> | undefined, builtNoPolicy: ReturnType<typeof batchV2Context> | undefined;
const getContext = () => (builtContext ??= batchV2Context());
const getReplay = () => (builtReplay ??= batchV2Replay());
const isBatchUnit = (cardId: string) => (BATCH_V2_UNITS as readonly string[]).includes(cardId);
const structured = (descriptor: object) => canonicalSerialize(Object.fromEntries(Object.entries(descriptor).filter(([key]) => key !== "label")));
function withoutAdrenalinePolicy() {
    const ruleset = RulesetSchema.parse(getContext().content.ruleset);
    delete ruleset.gameplay!.turnSlice!.adrenaline;
    return { content: createContentBundle(ruleset, getContext().content.cards.map(c => CardRevisionSnapshotSchema.parse(c)), getContext().content.manifest.engine) };
}
const getNoPolicy = () => (builtNoPolicy ??= withoutAdrenalinePolicy());

test("API Admission Batch V2 pins exact API records, candidate facts, printings and Adrenaline rules for three new immutable revisions", () => {
    assert.deepEqual(batchV2Cards.map(c => c.id), [ANIMALS_WRECKER, ROCKN_ROCKERBOY, RIDING_NOMAD]);
    assert.deepEqual(sources.matchingErrata, []);
    assert.equal(sources.errataSha256, restrictionSources.errataSha256);
    assert.equal(sources.processedErrataSha256, restrictionSources.processedErrataSha256);
    assert.equal(rules.sha256, restrictionRules.sha256); assert.equal(rules.processedSha256, restrictionRules.processedSha256); assert.equal(rules.errataSha256, restrictionRules.errataSha256);
    assert.deepEqual(rules.rules.map(r => r.id), ["2.6", "4.7", "5.6.4", "8.14.1", "9.3.1.1", "11.3", "11.3.1", "11.3.2", "11.23", "11.23.1", "11.23.2"]);
    assert.match(rules.rules.find(r => r.id === "11.23.2")!.text, /may attack even if they.re lagging\. All other criteria for valid attack targets still apply/);
    assert.match(rules.rules.find(r => r.id === "9.3.1.1")!.text, /Lagging Units can.t attack/);
    const priorIds = restrictionsContext().content.cards.map(c => c.id);
    for (const card of batchV2Cards) {
        const { record: r, processedRecord: p, candidate: k } = sources.records.find(s => s.record.slug === card.id)!;
        assert.equal(priorIds.includes(card.id), false, "no earlier immutable revision exists");
        assert.equal(card.revision, 1); assert.equal(card.status, "ACTIVE"); assert.equal(card.provenance.reviewed, true);
        assert.equal(card.provenance.sourceHash, hashCanonical(r));
        assert.equal(k.sourceRecordHash, hashCanonical(p), "candidate hash re-derives from the processed API record");
        assert.equal(k.sourceCardSlug, card.id); assert.equal(k.identityCandidate.cardId, card.id); assert.equal(p.id, card.id);
        assert.equal(card.name, r.name); assert.equal(card.cardNumber, r.print_number);
        assert.equal(card.deckbuildingIdentity, k.identityCandidate.deckbuildingIdentity);
        assert.equal(card.displayName, k.identityCandidate.displayName); assert.equal(card.subtitle, k.identityCandidate.subtitle);
        assert.equal(card.type, k.catalog.type); assert.deepEqual(card.colors, k.catalog.colors);
        assert.deepEqual(card.printedCost, { kind: "EDDIES", amount: k.catalog.cost });
        assert.deepEqual(card.ram, { [k.catalog.colors[0]]: k.catalog.ram });
        assert.equal(card.power, k.catalog.power);
        assert.deepEqual(card.tags, k.catalog.classifications);
        assert.deepEqual(card.sellProfile, { allowed: k.catalog.sellable, baseEddieValue: 1 });
        assert.equal(card.sourceMarkup, r.rules_text); assert.equal(card.sourceMarkup, k.rulesSource.markup); assert.equal(p.text_markup, r.rules_text);
        assert.equal(card.rulesText, r.rules_text);
        // Hints are diagnostics only; the reviewed keyword list is authored explicitly in the fixture.
        assert.deepEqual(k.rulesSource.keywordHints, card.id === RIDING_NOMAD ? ["Adrenaline"] : []);
        assert.deepEqual([k.rulesSource.referencedKeywordHints, k.rulesSource.timingTriggerHints], [[], []]);
        assert.deepEqual(k.errata, []); assert.deepEqual(card.provenance.errata, []);
        assert.deepEqual(card.printings.map(x => [x.id, x.setCode, x.collectorNumber]), r.printings.map(x => [x.id, x.set.code, x.collector_number]));
        assert.deepEqual(k.printings.map(x => [x.setCode, x.collectorNumber]), r.printings.map(x => [x.set.code, x.collector_number]));
        assert.equal(card.printings.some(x => x.collectorNumber === card.id), false, "CardId is not a collector number");
        assert.deepEqual(card.execution, { scope: "COMBAT_RESTRICTIONS_V1", status: "SUPPORTED" });
        assert.deepEqual(card.mechanics, { keywords: card.id === RIDING_NOMAD ? ["ADRENALINE"] : [], modifiers: [], abilities: [] }); assert.deepEqual(card.keywords, []);
    }
});

test("revisions pass the shared reviewed ordinary-Unit gate, and printed Adrenaline requires the explicit ADRENALINE_V1 policy", () => {
    assert.equal(getContext().content.ruleset.gameplay?.turnSlice?.adrenaline, "ADRENALINE_V1");
    for (const card of batchV2Cards) {
        assert.equal(supportsRestrictedPlay(card, getContext()).ok, true, card.id);
        assert.equal(supportsPlay(card, getContext()).ok, true, card.id);
        assert.equal(supportsRestrictedPlay(card, getNoPolicy()).ok, card.id !== RIDING_NOMAD, `${card.id} without policy`);
        assert.equal(supportsPlay(card, getNoPolicy()).ok, card.id !== RIDING_NOMAD, `${card.id} without policy`);
    }
    const restrictions = restrictionsContext();
    for (const card of restrictionCards.filter(c => c.type === "UNIT" && !c.mechanics.keywords.length && !c.mechanics.abilities.length && !c.mechanics.restrictions?.length))
        assert.equal(supportsRestrictedPlay(CardRevisionSnapshotSchema.parse({ ...card, mechanics: { ...card.mechanics, keywords: ["ADRENALINE"] } }), restrictions).ok, false, `${card.id} + ADRENALINE without policy`);
    const gates = ["packages/engine/src/restriction-support.ts", "packages/engine/src/play-support.ts", "packages/engine/src/combat-queries.ts"].map(path => readFileSync(path, "utf8")).join("\n");
    for (const card of batchV2Cards) assert.equal(gates.includes(card.id), false, `${card.id} must not be named by a support gate`);
});

const withMechanics = (card: CardRevisionSnapshot, mechanics: Partial<CardRevisionSnapshot["mechanics"]>) => ({ ...card, mechanics: { ...card.mechanics, ...mechanics } });
const variants: [string, (card: CardRevisionSnapshot) => unknown][] = [
    ["unreviewed provenance", c => ({ ...c, provenance: { ...c.provenance, reviewed: false } })],
    ["unsupported execution status", c => ({ ...c, execution: { scope: "COMBAT_RESTRICTIONS_V1", status: "UNSUPPORTED" } })],
    ["different execution scope", c => ({ ...c, execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" } })],
    ["added Blocker keyword", c => withMechanics(c, { keywords: [...c.mechanics.keywords, "BLOCKER"] })],
    ["added Go Solo keyword", c => withMechanics(c, { keywords: [...c.mechanics.keywords, "GO_SOLO"] })],
    ["added Quick keyword", c => withMechanics(c, { keywords: [...c.mechanics.keywords, "QUICK"] })],
    ["added attack restriction", c => withMechanics(c, { restrictions: [{ kind: "CANNOT_ATTACK" }] })],
    ["added triggered draw", c => withMechanics(c, { abilities: [{ id: "unreviewed-draw", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DRAW", count: 1 }] }] })],
    ["added continuous modifier", c => withMechanics(c, { modifiers: [{ kind: "GRANT_PRINTED_POWER_TO_HOST" }] })],
    ["added equip clause", c => withMechanics(c, { equip: { kind: "FRIENDLY_UNIT_OR_FACE_UP_LEGEND" } })],
    ["non-numeric printed cost", c => ({ ...c, printedCost: { kind: "DASH" } })],
    ["missing printed power", c => ({ ...c, power: undefined })],
    ["different card type", c => ({ ...c, type: "PROGRAM", power: undefined })]
];

test("nearby unreviewed or unsupported variants fail closed at every play gate, even under the Adrenaline policy", () => {
    for (const card of batchV2Cards) for (const [name, mutate] of variants) {
        const variant = CardRevisionSnapshotSchema.parse(mutate(card));
        assert.equal(supportsRestrictedPlay(variant, getContext()).ok, false, `${card.id}: ${name}`);
        assert.equal(supportsPlay(variant, getContext()).ok, false, `${card.id}: ${name}`);
    }
    const unreviewed = CardRevisionSnapshotSchema.parse(variants[0][1](batchV2Cards[0]));
    const cards = getContext().content.cards.map(c => c.id === unreviewed.id ? unreviewed : CardRevisionSnapshotSchema.parse(c));
    assert.throws(() => createContentBundle(RulesetSchema.parse(getContext().content.ruleset), cards, getContext().content.manifest.engine));
});

test("a RAM-legal constructed deck initializes with all three Units; missing RAM support or policy is still rejected", () => {
    const input = batchV2Input("api-admission-batch-v2-init"), created = createGameWithEvents(input, getContext());
    assert.equal(created.ok, true, created.ok ? undefined : JSON.stringify(created.errors));
    if (created.ok) for (const id of BATCH_V2_UNITS) assert.equal(Object.values(created.value.state.objects.cards).filter(c => c.cardId === id).length, 6, id);
    for (const [support, replacement, color] of [[RED_SUPPORT, "dev-legend-red", "RED"], [YELLOW_SUPPORT, "dev-legend-blue", "YELLOW"], [GREEN_SUPPORT, "dev-legend-blue", "GREEN"]] as const) {
        const illegal = { ...input, decks: input.decks.map(d => ({ ...d, legends: d.legends.map(id => id === support ? replacement : id) })) };
        const rejected = createGameWithEvents(illegal, getContext());
        assert.equal(rejected.ok, false, color);
        if (!rejected.ok) assert.match(JSON.stringify(rejected.errors), new RegExp(`RAM_LIMIT.*${color} RAM requires`));
    }
    assert.equal(createGameWithEvents(input, getNoPolicy()).ok, false, "Riding Nomad is not executable content without ADRENALINE_V1");
});

test("vanilla Units resolve through ordinary play, exact payment, Lag and printed-power Gig steals in a legal game", () => {
    for (const [card, allowance] of [[ANIMALS_WRECKER, 2], [ROCKN_ROCKERBOY, 1]] as const) {
        const revision = batchV2Cards.find(c => c.id === card)!, steal = getReplay().steals.find(s => s.cardId === card);
        assert.ok(steal, `${card} started a Gig steal`);
        const instance = steal.attackerId;
        const playIndex = getReplay().steps.findIndex(s => s.action.action.kind === "PLAY_CARD" && s.action.action.cardInstanceId === instance);
        assert.ok(playIndex >= 0, `${card} was played from hand`);
        const turn = getReplay().steps[playIndex].before.timing.turn;
        const settled = getReplay().steps.findIndex((s, i) => i > playIndex && s.before.objects.cards[instance].zone.zone === "BATTLEFIELD");
        assert.ok(settled > playIndex);
        const resolution = getReplay().steps.slice(playIndex, settled).flatMap(s => s.events.map(e => e.payload));
        const payment = resolution.find(e => e.kind === "PAYMENT_MADE");
        assert.ok(payment?.kind === "PAYMENT_MADE" && revision.printedCost.kind === "EDDIES");
        assert.equal(payment.sources.length, revision.printedCost.amount);
        assert.ok(resolution.some(e => e.kind === "CARD_PLAYED" && e.cardInstanceId === instance));
        const entered = getReplay().steps[settled].before.objects.cards[instance];
        assert.equal(entered.readiness, "READY"); assert.deepEqual(entered.statuses, ["LAG"]);
        for (const s of getReplay().steps.filter(s => s.before.timing.turn === turn && s.before.objects.cards[instance].zone.zone === "BATTLEFIELD"))
            assert.equal(s.legalActions.some(a => a.action.kind === "DECLARE_ATTACK" && a.action.cardInstanceId === instance), false, `${card} cannot attack the turn it is played`);
        assert.ok(steal.turn > turn);
        assert.equal(steal.power, revision.power); assert.equal(steal.allowance, allowance);
        const stolen = getReplay().steps.filter(s => s.before.timing.turn === steal.turn).flatMap(s => s.events).filter(e => e.payload.kind === "GIG_STOLEN" && e.payload.attackerId === instance);
        assert.equal(stolen.length, allowance);
    }
});

test("Riding Nomad attacks while lagging only under ADRENALINE_V1; Lag and every other attack criterion still apply (11.23.2)", () => {
    const steal = getReplay().steals.find(s => s.cardId === RIDING_NOMAD);
    assert.ok(steal, "Riding Nomad started a Gig steal");
    const instance = steal.attackerId;
    const playIndex = getReplay().steps.findIndex(s => s.action.action.kind === "PLAY_CARD" && s.action.action.cardInstanceId === instance);
    const declareIndex = getReplay().steps.findIndex(s => s.action.action.kind === "DECLARE_ATTACK" && s.action.action.cardInstanceId === instance);
    assert.ok(playIndex >= 0 && declareIndex > playIndex);
    const turn = getReplay().steps[playIndex].before.timing.turn, declare = getReplay().steps[declareIndex];
    assert.equal(declare.before.timing.turn, turn, "attacks the turn it is played");
    assert.deepEqual(declare.before.objects.cards[instance].statuses, ["LAG"], "still lagging when it attacks");
    assert.equal(steal.turn, turn); assert.equal(steal.power, 4); assert.equal(steal.allowance, 1);
    assert.equal(attackSourceValid(declare.before, declare.actorId, instance, getContext()), true);
    assert.equal(isAttackEligible(declare.before, declare.actorId, instance, getContext()), true);
    assert.equal(attackSourceValid(declare.before, declare.actorId, instance, getNoPolicy()), false, "no policy, no lagging attack");
    // The exemption itself checks both the policy and the keyword, independent of the admission gate.
    assert.equal(laggingAttackPermitted(declare.before, instance, getContext()), true);
    assert.equal(laggingAttackPermitted(declare.before, instance, getNoPolicy()), false, "exemption requires ADRENALINE_V1");
    const vanillaSteal = getReplay().steals.find(s => s.cardId === ANIMALS_WRECKER);
    assert.ok(vanillaSteal);
    const vanillaPlay = getReplay().steps.findIndex(s => s.action.action.kind === "PLAY_CARD" && s.action.action.cardInstanceId === vanillaSteal.attackerId);
    const lagging = getReplay().steps.find((s, i) => i > vanillaPlay && s.before.objects.cards[vanillaSteal.attackerId].zone.zone === "BATTLEFIELD");
    assert.ok(vanillaPlay >= 0 && lagging);
    assert.deepEqual(lagging.before.objects.cards[vanillaSteal.attackerId].statuses, ["LAG"]);
    assert.equal(laggingAttackPermitted(lagging.before, vanillaSteal.attackerId, getContext()), false, "no exemption for a lagging Unit without printed Adrenaline");
    const spent = GameStateSchema.parse(declare.before); spent.objects.cards[instance].readiness = "SPENT";
    assert.equal(isAttackEligible(spent, declare.actorId, instance, getContext()), false, "readiness is still required");
    assert.ok(getReplay().steps.filter(s => s.before.timing.turn === turn).flatMap(s => s.events).some(e => e.payload.kind === "LAG_REMOVED" && e.payload.cardInstanceId === instance), "Lag is still removed at end of turn");
});

test("Batch V2 Units in hand stay hidden from the rival except while publicly declared for payment", () => {
    let hidden = 0, declared = 0;
    for (const s of getReplay().steps) {
        const hand = s.before.players[s.actorId].zones.HAND.filter(id => isBatchUnit(s.before.objects.cards[id].cardId));
        if (!hand.length) continue;
        const rival = s.before.match.playerOrder.find(p => p !== s.actorId)!;
        const rivalObservation = unwrap(observe(s.before, rival, getContext())), rivalView = JSON.stringify(rivalObservation);
        const ownView = JSON.stringify(unwrap(observe(s.before, s.actorId, getContext())));
        const play = s.before.resolution.playContinuation;
        const declaredSource = play && (play.phase === "PAYMENT" || play.phase === "EQUIP") ? play.sourceId : undefined;
        for (const id of hand) {
            assert.ok(ownView.includes(`"${id}"`), id);
            if (id === declaredSource) { declared++; assert.equal(s.before.objects.cards[id].face, "UP"); assert.ok(rivalView.includes(`"${id}"`), `${id} is public while declared`); }
            else { hidden++; assert.equal(rivalView.includes(`"${id}"`), false, `${id} must stay hidden`); }
        }
        const seat = s.before.players[s.actorId].seat;
        assert.equal(rivalObservation.players.find(p => p.seat === seat)!.counts.HAND, s.before.players[s.actorId].zones.HAND.length);
    }
    assert.ok(hidden > 0); assert.ok(declared > 0);
});

test("every replay position projects to Descriptor V2 without duplicates, private fields or lost actions", () => {
    let batchActions = 0;
    for (const s of getReplay().steps) {
        const input = unwrap(buildModelInputV2(s.before, s.actorId, getContext()));
        assert.deepEqual(input.legalActions.map(a => a.actionId), s.legalActions.map(a => a.actionId));
        assert.equal(new Set(input.legalActions.map(a => structured(a.descriptor))).size, input.legalActions.length);
        for (const a of input.legalActions) assert.ok(resolveActionId(s.before, s.actorId, a.actionId, getContext()).ok);
        const publicJson = JSON.stringify(input.legalActions);
        for (const forbidden of ["actorId", "choiceId", "optionIndices", "cardInstanceId", "sourceInstanceId"]) assert.equal(publicJson.includes(`"${forbidden}"`), false, forbidden);
        batchActions += s.legalActions.filter(a => "cardInstanceId" in a.action && isBatchUnit(s.before.objects.cards[a.action.cardInstanceId].cardId)).length;
    }
    assert.ok(batchActions > 0);
});

test("the Batch V2 replay is deterministic and independent of actionId ordering", () => {
    const again = batchV2Replay(getReplay().seed, batchV2Context());
    assert.equal(again.finalStateHash, getReplay().finalStateHash);
    assert.deepEqual(again.steps.map(s => [s.actionId, s.stateHash, s.positionHash, s.observationHash]), getReplay().steps.map(s => [s.actionId, s.stateHash, s.positionHash, s.observationHash]));
    const perturbed = batchV2Replay(getReplay().seed, batchV2Context({ ...getContext().content.manifest.engine, artifactHash: "f".repeat(64) }));
    assert.notDeepEqual(perturbed.steps.map(s => s.actionId), getReplay().steps.map(s => s.actionId));
    assert.deepEqual(perturbed.steps.map(s => [s.actorId, s.action.action]), getReplay().steps.map(s => [s.actorId, s.action.action]));
    assert.deepEqual(perturbed.steals, getReplay().steals);
});
