import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardInstanceIdSchema, GameStateSchema, CardRevisionSnapshotSchema, RulesetSchema, createContentBundle, hashCanonical, type GameState, type LegalAction, type PendingChoice } from "@tcg/domain";
import { createGameWithEvents, applyAction, listLegalActions, validateState, observe, RulesView, hashPosition, hashReplayState, moveCardForEffect, resolveActionId } from "@tcg/engine";
import { generatePosition, modelInput } from "@tcg/training-harness";
import { gearContext, gearInput, MANTIS, VIKTOR, mantis } from "./gear-fixture";
import { gearReplay } from "./gear-replay";
import { unwrap } from "./turn-replay";
import captured from "./fixtures/gear-card-source.v1.json";
import rules from "./fixtures/gear-rules.v1.json";
const context = gearContext(), replay = gearReplay();
const history: GameState[] = [replay.initialized.state];
for (const step of replay.steps) history.push(unwrap(applyAction(history.at(-1)!, step.action, context)).state);
const firstPlayIndex = replay.steps.findIndex(s => s.action.action.kind === "PLAY_CARD");
const before = history[firstPlayIndex], final = replay.finalState, actor = before.timing.actingPlayer, royce = replay.royceId, gear = replay.searchedGear[0];
function legal(s: GameState, ctx = context) { return unwrap(listLegalActions(s, s.timing.actingPlayer, ctx)); }
function act(s: GameState, predicate: (a: LegalAction) => boolean, ctx = context) { const a = legal(s, ctx).find(predicate); assert.ok(a); return unwrap(applyAction(s, {actorId: a.actorId, action: a.action}, ctx)); }
function choose(s: GameState, predicate: (o: PendingChoice["options"][number]) => boolean) { return act(s, a => a.action.kind === "CHOOSE" && predicate(s.resolution.choice!.options[a.action.optionIndices[0]])); }
function equipDecision(s = before, id = gear) {
    let next = act(s, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === id).state;
    while (next.timing.step === "PAYMENT_SELECTION") next = choose(next, o => o.kind === "PAYMENT").state;
    assert.equal(next.resolution.playContinuation?.phase, "EQUIP");
    return next;
}
function equip(s = before, id = gear, host = royce) { return choose(equipDecision(s, id), o => o.kind === "CARD" && o.cardInstanceId === host); }
function repin(s: GameState, ctx: typeof context) { return GameStateSchema.parse({...s,match:{...s.match,rulesetVersion:ctx.content.ruleset.version,rulesetHash:ctx.content.manifest.ruleset.hash,contentManifestHash:ctx.content.manifestHash,cards:ctx.content.manifest.cards.map(({cardId,revision})=>({cardId,revision}))}}); }
function unitHost(s = before) {
    const draft = GameStateSchema.parse(s), unit = Object.values(draft.objects.cards).find(c => c.controllerId === actor && c.cardId === "kerry-eurodyne-the-last-rockerboy")!;
    const refs = draft.players[unit.zone.playerId].zones[unit.zone.zone]!; refs.splice(refs.indexOf(unit.id), 1);
    draft.players[actor].zones.BATTLEFIELD.push(unit.id); unit.zone.zone = "BATTLEFIELD"; unit.face = "UP"; unit.readiness = "SPENT"; unit.statuses = ["LAG"];
    return {state: unwrap(validateState(draft, context)), id: unit.id};
}
test("Mantis review retains raw identity, six printings, exact text and independent source/rule hashes", () => {
    assert.equal(mantis.id, MANTIS); assert.equal(mantis.revision, 1);
    assert.equal(mantis.sourceMarkup, '(Equip to a friendly Unit or face-up Legend.)\n"One cut, one kill."');
    assert.equal(mantis.power, 2); assert.deepEqual(mantis.printedCost, {kind:"EDDIES", amount:1});
    assert.equal(mantis.provenance.sourceHash, hashCanonical(captured.record));
    assert.equal(mantis.printings.length, 6); assert.equal(mantis.printings[0].id, captured.record.selected_printing_id);
    assert.deepEqual(captured.matchingErrata, []);
    for (const hash of [captured.captureHash,rules.sha256,rules.rawRulesCaptureHash]) assert.match(hash,/^[a-f0-9]{64}$/);
    for (const rule of ["3.17.2","4.10","4.10.2","4.11.2","4.12.1","4.12.2","5.7.7","11.6.1.2","11.6.6"]) assert.ok(rules.records.some(r=>r.id===rule));
    assert.equal(mantis.mechanics.abilities.length,0);
});
test("ordinary Gear play uses a single parent, shared exact payment and a paid equip decision without independent field entry", () => {
    assert.equal(legal(before).filter(a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === gear).length, 1);
    const played = act(before, a => a.action.kind === "PLAY_CARD" && a.action.cardInstanceId === gear);
    assert.equal(played.state.timing.step, "PAYMENT_SELECTION");
    assert.equal(played.state.objects.cards[gear].zone.zone, "HAND");
    assert.deepEqual(played.events.map(e=>e.payload.kind),["CARD_REVEALED","PHASE_CHANGED"]);
    const paid = choose(played.state, o=>o.kind==="PAYMENT");
    assert.equal(paid.state.timing.step,"TARGET_SELECTION");
    assert.equal(paid.state.resolution.playContinuation?.phase,"EQUIP");
    assert.equal(paid.state.objects.cards[gear].zone.zone,"HAND");
    assert.ok(paid.events.some(e=>e.payload.kind==="PAYMENT_MADE"));
    assert.equal(paid.events.some(e=>e.payload.kind==="CARD_PLAYED" || e.payload.kind==="CARD_MOVED"),false);
    assert.equal(paid.state.resolution.current,null); // Equipping is a play requirement, not an invented printed trigger.
});
test("no host, wrong zone, wrong actor, wrong timing and insufficient payment prevent Gear play", () => {
    const noHost = GameStateSchema.parse(before); for (const c of Object.values(noHost.objects.cards)) if (c.zone.zone==="LEGENDS") c.face="DOWN";
    const noPay = GameStateSchema.parse(before); for (const c of Object.values(noPay.objects.cards)) if (["LEGENDS","EDDIES"].includes(c.zone.zone)) c.readiness="SPENT";
    for (const s of [noHost,noPay]) assert.equal(legal(s).some(a=>a.action.kind==="PLAY_CARD" && a.action.cardInstanceId===gear),false);
    const handless = GameStateSchema.parse(before); handless.players[actor].zones.HAND.splice(handless.players[actor].zones.HAND.indexOf(gear),1); handless.players[actor].zones.TRASH.push(gear); handless.objects.cards[gear].zone.zone="TRASH";
    assert.equal(legal(handless).some(a=>a.action.kind==="PLAY_CARD"&&a.action.cardInstanceId===gear),false);
    assert.equal(applyAction(before,{actorId:before.match.playerOrder[1],action:{kind:"PLAY_CARD",cardInstanceId:gear}},context).ok,false);
    const pending=equipDecision(); assert.equal(legal(pending).some(a=>a.action.kind==="PLAY_CARD"),false);
    assert.equal(applyAction(before,{actorId:actor,action:{kind:"PLAY_CARD",cardInstanceId:before.players[actor].zones.DECK[0]}},context).ok,false);
});
test("extra Gear abilities/keywords, unsupported scope or missing equip/power metadata fail deck and play admission", () => {
    for (const patch of [
        {execution: {scope:"NONCOMBAT_PLAY_V1",status:"UNSUPPORTED"}}, {execution:undefined},
        {mechanics:{...mantis.mechanics,equip:undefined}}, {mechanics:{...mantis.mechanics,modifiers:[]}},
        {mechanics:{...mantis.mechanics,keywords:["QUICK"]}}, {mechanics:{...mantis.mechanics,abilities:[{id:"unsupported@1",trigger:"WHEN_ATTACKING",cost:{kind:"NONE"},conditions:[],effects:[{kind:"DRAW",count:1}]}]}},
        {printedCost:{kind:"DASH"}}, {power:undefined}
    ]) {
        const cards=context.content.cards.map(c=>c.id===MANTIS?CardRevisionSnapshotSchema.parse(JSON.parse(JSON.stringify({...c,...patch}))):CardRevisionSnapshotSchema.parse(c));
        const ctx={content:createContentBundle(RulesetSchema.parse(context.content.ruleset),cards,context.content.manifest.engine)};
        assert.equal(createGameWithEvents(gearInput(),ctx).ok,false);
        assert.equal(legal(repin(before,ctx),ctx).some(a=>a.action.kind==="PLAY_CARD"&&a.action.cardInstanceId===gear),false);
    }
});
test("legal hosts include ready/spent/Lag Units and face-up Legends; exclude face-down Legends, rivals, Gear and inactive cards", () => {
    const fixture=unitHost(), s=equipDecision(fixture.state), ids=s.resolution.choice!.options.flatMap(o=>o.kind==="CARD"?[o.cardInstanceId]:[]);
    assert.ok(ids.includes(fixture.id)); assert.ok(ids.includes(royce));
    assert.equal(ids.includes(gear),false);
    assert.equal(ids.some(id=>s.objects.cards[id].controllerId!==actor),false);
    assert.equal(ids.some(id=>s.objects.cards[id].face==="DOWN"),false);
    assert.ok(ids.every(id=>["BATTLEFIELD","LEGENDS"].includes(s.objects.cards[id].zone.zone)));
    const view=new RulesView(s,context); assert.deepEqual(view.getLegalTargets(gear,{kind:"FRIENDLY_UNIT_OR_FACE_UP_LEGEND"}),ids);
    assert.ok(ids.some(id=>s.objects.cards[id].cardId===VIKTOR));
    assert.equal(view.getEffectivePower(ids.find(id=>s.objects.cards[id].cardId===VIKTOR)!),null); // No invented base power for an unprinted value.
    const done=choose(s,o=>o.kind==="CARD"&&o.cardInstanceId===fixture.id);
    assert.equal(new RulesView(done.state,context).getEffectivePower(fixture.id),7);
    assert.equal(done.state.objects.cards[fixture.id].readiness,"SPENT");
    assert.deepEqual(done.state.objects.cards[fixture.id].statuses,["LAG"]);
});
test("single legal host remains a non-training choice; multiple hosts produce a genuine actionId position", () => {
    const draft=GameStateSchema.parse(before);
    for (const c of Object.values(draft.objects.cards)) if (c.zone.zone==="LEGENDS"&&c.id!==royce)c.face="DOWN";
    const single=equipDecision(draft); assert.equal(legal(single).length,1);
    const multiple=equipDecision(); assert.ok(legal(multiple).length>=2);
    const p=unwrap(generatePosition(multiple,actor,context,"gear-host-choice"));
    assert.ok(modelInput(p).legalActions.length>=2);
    assert.ok(replay.positions.filter(p=>p.state.resolution.playContinuation?.phase==="EQUIP").every(p=>p.legalActions.length>=2));
});
test("equip target/source/payment continuations reject forged and stale data atomically", () => {
    const s=equipDecision(), action=legal(s)[0], original=hashReplayState(s);
    for(const mutate of [
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.resolution.choice!.options[0]={kind:"CARD",cardInstanceId:gear};},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[royce].face="DOWN";},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[royce].controllerId=s.match.playerOrder[1];},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[gear].face="DOWN";},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[gear].readiness="SPENT";},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.resolution.playContinuation!.remainingCost=1;},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.resolution.playContinuation!.abilityId="invented@1";},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{const p=s.resolution.playContinuation!.selectedSources[0];s.objects.cards[p.cardInstanceId].readiness="READY";},
    ]) {const bad=GameStateSchema.parse(s);mutate(bad);assert.equal(validateState(bad,context).ok,false);assert.equal(applyAction(bad,{actorId:action.actorId,action:action.action},context).ok,false);}
    assert.equal(applyAction(s,{actorId:actor,action:{kind:"CHOOSE",choiceId:s.resolution.choice!.id,optionIndices:[999]}},context).ok,false);
    assert.equal(hashReplayState(s),original);
    const done=choose(s,o=>o.kind==="CARD"&&o.cardInstanceId===royce);
    assert.equal(resolveActionId(done.state,actor,action.actionId,context).ok,false);
});
test("attachment invariants reject self, duplicate, multiple host, dangling, wrong type/area/control and hidden attachments", () => {
    const original=final;
    for (const mutate of [
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[royce].attachments=[royce];},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[royce].attachments.push(gear);},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{const v=Object.values(s.objects.cards).find(c=>c.cardId===VIKTOR&&c.controllerId===actor)!;v.attachments.push(gear);},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[royce].attachments.push(CardInstanceIdSchema.parse("missing"));},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[royce].attachments=[s.players[actor].zones.HAND[0]];},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[gear].controllerId=s.match.playerOrder[1];},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[gear].face="DOWN";},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[royce].face="DOWN";},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[gear].attachments=[royce];},
        (s:ReturnType<typeof GameStateSchema.parse>)=>{s.objects.cards[royce].attachments=[];},
    ]) {const bad=GameStateSchema.parse(original);mutate(bad);assert.equal(validateState(bad,context).ok,false);}
    for (const zone of ["HAND","TRASH","REMOVED","BATTLEFIELD"] as const) {
        const bad=GameStateSchema.parse(original);bad.players[actor].zones.LEGENDS.splice(bad.players[actor].zones.LEGENDS.indexOf(gear),1);bad.players[actor].zones[zone].push(gear);bad.objects.cards[gear].zone.zone=zone;
        assert.equal(validateState(bad,context).ok,false);
    }
});
test("owning a host is not required; controlled friendly attachment preserves independent immutable ownership", () => {
    const draft=GameStateSchema.parse(before);draft.objects.cards[royce].ownerId=draft.match.playerOrder[1];
    const done=equip(draft).state;
    assert.equal(done.objects.cards[royce].ownerId,done.match.playerOrder[1]);
    assert.equal(done.objects.cards[gear].ownerId,actor);
    assert.equal(done.objects.cards[gear].controllerId,actor);
    assert.equal(new RulesView(done,context).getAttachmentHost(gear)?.id,royce);
});
test("Royce composes printed Gear power and own-turn Gear-count modifier through actual attachment queries", () => {
    assert.deepEqual(replay.roycePower,[6,10,14]);
    const base=JSON.stringify(context.content), one=equip().state;
    assert.equal(new RulesView(before,context).getEquippedGearCount(royce),0);
    assert.equal(new RulesView(one,context).getEffectivePower(royce),10);
    const view=new RulesView(final,context);assert.equal(view.getEquippedGearCount(royce),2);
    assert.deepEqual(view.getAttachedGear(royce).map(c=>c.id),[...replay.searchedGear].sort());
    assert.equal(view.getEffectivePower(gear),2);
    const swapped=GameStateSchema.parse(final);swapped.objects.cards[royce].attachments.reverse();
    assert.equal(new RulesView(swapped,context).getEffectivePower(royce),14);
    const rival=act(final,a=>a.action.kind==="END_TURN").state;
    assert.equal(new RulesView(rival,context).getEffectivePower(royce),10); // Both printed Gear bonuses remain; Royce's own-turn bonus stops.
    assert.equal(JSON.stringify(context.content),base);
    for(const forbidden of ["equippedGearCount","effectivePower","attachedTo"])assert.equal(JSON.stringify(final).includes('"'+forbidden+'"'),false);
});
test("same real Gear instance found by Viktor is taken, played and attached without replacement", () => {
    for(const id of replay.searchedGear) {
        assert.ok(replay.steps.some(s=>s.events.some(e=>e.payload.kind==="CARD_MOVED"&&e.payload.cardInstanceId===id&&e.payload.from.zone==="DECK"&&e.payload.to.zone==="HAND")));
        assert.ok(replay.steps.some(s=>s.action.action.kind==="PLAY_CARD"&&s.action.action.cardInstanceId===id));
        const attached=replay.steps.flatMap(s=>s.events).find(e=>e.payload.kind==="GEAR_ATTACHED"&&e.payload.gearInstanceId===id)!.payload;
        assert.ok(attached.kind==="GEAR_ATTACHED"&&attached.hostInstanceId===royce&&attached.reason==="PLAY_CARD");
        const initial=replay.initialized.state.objects.cards[id], last=final.objects.cards[id];
        for (const field of ["id","cardId","revision","ownerId","controllerId"] as const) assert.equal(last[field],initial[field]);
        assert.equal(last.zone.zone,"LEGENDS");assert.equal(last.face,"UP");assert.equal(last.readiness,"READY");
    }
});
test("played Gear in the Legends area is neither a SELL action nor a Legend payment/Call source", () => {
    const view=new RulesView(final,context);
    for(const id of replay.searchedGear) {
        assert.equal(view.listPaymentSources(actor).some(p=>p.cardInstanceId===id),false);
        assert.equal(view.validatePaymentChoice(actor,[{kind:"LEGEND",cardInstanceId:id}],{kind:"EDDIES",amount:1}).ok,false);
        assert.equal(legal(final).some(a=>["SELL_CARD","PLAY_CARD","CALL_LEGEND"].includes(a.action.kind)&&"cardInstanceId" in a.action&&a.action.cardInstanceId===id),false);
    }
    assert.ok(legal(before).some(a=>a.action.kind==="SELL_CARD"&&a.action.cardInstanceId===gear));
});
test("public observations expose attachment relation and derived power without hidden hand/Legend/deck/RNG information", () => {
    const obs=unwrap(observe(final,final.match.playerOrder[1],context)), own=obs.players.find(p=>p.seat===0)!;
    const host=own.cards.find(c=>c.publicId===royce)!;
    assert.deepEqual([...host.attachments!].sort(),[...replay.searchedGear].sort()); assert.equal(host.effectivePower,14);
    for(const id of replay.searchedGear)assert.ok(own.cards.some(c=>c.publicId===id&&c.content?.cardId===MANTIS&&c.effectivePower===2));
    assert.equal(own.cards.some(c=>c.zone==="HAND"||c.zone==="DECK"),false);
    assert.ok(own.cards.filter(c=>c.face==="DOWN").every(c=>!c.content&&c.effectivePower===undefined&&c.attachments===undefined));
    const choice=equipDecision(), revealed=unwrap(observe(choice,choice.match.playerOrder[1],context));
    assert.deepEqual(revealed.players[0].cards.filter(c=>c.zone==="HAND").map(c=>c.publicId),[gear]);
    const input=JSON.stringify(modelInput(unwrap(generatePosition(choice,actor,context,"equip-visible"))));
    assert.equal(input.includes('"rng"'),false); assert.equal(input.includes(choice.rng.seed),false);
});
test("Gear target decisions retain POSITION_V2 and action IDs when only transport provenance changes", () => {
    const s=equipDecision(), draft=GameStateSchema.parse({...s,match:{...s.match,id:"00000000-0000-4000-8000-000000000099",version:s.match.version+7,eventSequence:s.match.eventSequence+100}}), changed=unwrap(validateState(draft,context));
    assert.equal(hashPosition(s),hashPosition(changed));assert.deepEqual(legal(s),legal(changed));assert.notEqual(hashReplayState(s),hashReplayState(changed));
});
test("Gear leaving its host detaches centrally, preserves identity and immediately removes both derived bonuses", () => {
    const sourceHash=hashReplayState(final), first=unwrap(moveCardForEffect(final,gear,"TRASH",context));
    assert.deepEqual(first.events.map(e=>e.payload.kind),["CARD_MOVED","GEAR_DETACHED"]);
    assert.equal(first.state.objects.cards[gear].zone.zone,"TRASH"); assert.equal(new RulesView(first.state,context).getEffectivePower(royce),10);
    const second=unwrap(moveCardForEffect(first.state,replay.searchedGear[1],"HAND",context));
    assert.equal(new RulesView(second.state,context).getEffectivePower(royce),6);
    assert.equal(new RulesView(second.state,context).getAttachmentHost(gear),null);
    assert.equal(second.state.objects.cards[replay.searchedGear[1]].face,"DOWN");
    assert.equal(hashReplayState(final),sourceHash);
    assert.deepEqual(first,unwrap(moveCardForEffect(final,gear,"TRASH",context)));
});
test("host moves with Gear to hand, trash or removed; no residual relation and no voluntary UNEQUIP action", () => {
    const u=unitHost(), equipped=equip(u.state,gear,u.id).state;
    for(const destination of ["HAND","TRASH","REMOVED"] as const) {
        const result=unwrap(moveCardForEffect(equipped,u.id,destination,context,destination==="TRASH"?[gear,u.id]:undefined));
        for(const id of [gear,u.id])assert.equal(result.state.objects.cards[id].zone.zone,destination);
        assert.deepEqual(result.state.objects.cards[u.id].attachments,[]);
        assert.equal(new RulesView(result.state,context).getEffectivePower(u.id),5);
        assert.equal(result.state.objects.cards[gear].face,destination==="HAND"?"DOWN":"UP");
        assert.ok(result.events.some(e=>e.payload.kind==="GEAR_DETACHED"&&e.payload.reason==="HOST_LEFT_AREA"));
        assert.equal(result.state.resolution.stage,"DECISION");
    }
    assert.equal(moveCardForEffect(equipped,u.id,"TRASH",context).ok,false);
    assert.equal(moveCardForEffect(equipped,u.id,"TRASH",context,[gear,gear]).ok,false);
    assert.equal(moveCardForEffect(equipped,u.id,"DECK" as "HAND",context).ok,false);
    assert.equal(legal(equipped).some(a=>a.action.kind.includes("EQUIP")),false);
});
test("a departing Legend is removed after Gear follows to the intermediate area and detaches", () => {
    for(const destination of ["HAND","TRASH","REMOVED"] as const) {
        const result=unwrap(moveCardForEffect(final,royce,destination,context,destination==="TRASH"?[...replay.searchedGear,royce]:undefined));
        assert.equal(result.state.objects.cards[royce].zone.zone,"REMOVED");
        for(const id of replay.searchedGear)assert.equal(result.state.objects.cards[id].zone.zone,destination);
        assert.deepEqual(result.state.objects.cards[royce].attachments,[]);
        if(destination!=="REMOVED") {
            const facts=result.events.map(e=>e.payload.kind);assert.ok(facts.lastIndexOf("CARD_MOVED")>facts.lastIndexOf("GEAR_DETACHED"));
        }
    }
    const broken=GameStateSchema.parse(final);broken.players[actor].zones.LEGENDS.splice(broken.players[actor].zones.LEGENDS.indexOf(royce),1);broken.players[actor].zones.HAND.push(royce);broken.objects.cards[royce].zone.zone="HAND";
    assert.equal(validateState(broken,context).ok,false); // Caller cannot rely on silent relationship repair.
});
test("trusted departures require explicit future cross-owner destinations, while removal uses each owner's pile", () => {
    const s=GameStateSchema.parse(final), rival=s.match.playerOrder[1];
    s.objects.cards[royce].ownerId=rival;
    assert.equal(validateState(s,context).ok,true); // Friendly equip eligibility depends on control, not ownership.
    const beforeHash=hashReplayState(s);
    assert.equal(moveCardForEffect(s,royce,"HAND",context).ok,false);
    assert.equal(moveCardForEffect(s,royce,"TRASH",context,[royce,...replay.searchedGear]).ok,false);
    const removed=unwrap(moveCardForEffect(s,royce,"REMOVED",context)).state;
    assert.deepEqual(removed.objects.cards[royce].zone,{zone:"REMOVED",playerId:rival});
    for(const id of replay.searchedGear)assert.deepEqual(removed.objects.cards[id].zone,{zone:"REMOVED",playerId:actor});
    assert.deepEqual(removed.objects.cards[royce].attachments,[]);
    assert.equal(hashReplayState(s),beforeHash);
});
test("equipped Gear can be replayed from hand onto another host after a verified departure", () => {
    const returned=unwrap(moveCardForEffect(final,gear,"HAND",context)).state;
    const target=Object.values(returned.objects.cards).find(c=>c.cardId===VIKTOR&&c.controllerId===actor)!.id;
    const s=GameStateSchema.parse(returned);for(const id of s.players[actor].zones.LEGENDS)if(s.objects.cards[id].cardId!==MANTIS)s.objects.cards[id].readiness="READY";
    const done=equip(s,gear,target).state;
    assert.equal(new RulesView(done,context).getAttachmentHost(gear)?.id,target);
    assert.equal(new RulesView(done,context).getEquippedGearCount(royce),1);
    assert.equal(new RulesView(done,context).getEffectivePower(target),null);
});
test("new Gear replay is deterministic, matches its artifact and never introduces combat", () => {
    assert.deepEqual(replay,gearReplay());
    assert.deepEqual(replay,JSON.parse(readFileSync(new URL("./fixtures/gear-replay.v1.json",import.meta.url),"utf8")));
    assert.equal(replay.steps.length,25);assert.equal(replay.positions.length,25);
    for(const step of replay.steps)assert.equal(step.legalActions.some(a=>["DECLARE_ATTACK","DECLARE_BLOCKER","GO_SOLO","PASS_REACT"].includes(a.action.kind)),false);
});
