import assert from "node:assert/strict";
import type { DeepReadonly, GameState, LegalAction, PlayerId } from "@tcg/domain";
import { observe, PlayerObservationSchema, type EngineContext } from "@tcg/engine";
import { modelInput, type TrainingPosition } from "@tcg/training-harness";
import { unwrap } from "./turn-replay";
import type { demoMatchReplay } from "./demo-match-replay";
/** Trusted verification only. Never imported by the player policy. */
export function auditDemoObservation(state:GameState,viewer:PlayerId,context:EngineContext) {
    const observation=unwrap(observe(state,viewer,context));PlayerObservationSchema.parse(observation);
    const declared=(state.resolution.playContinuation?.phase==="PAYMENT"||state.resolution.playContinuation?.phase==="EQUIP")?state.resolution.playContinuation.sourceId:undefined;
    const inspected=viewer===state.timing.actingPlayer?state.resolution.searchContinuation?.looked??[]:[];
    assert.deepEqual(observation.inspectedCards?.map(c=>c.instanceId)??[],inspected);
    for(const [id,p] of Object.entries(state.players)) {
        const publicPlayer=observation.players.find(q=>q.seat===p.seat)!;
        assert.equal(publicPlayer.cards.filter(c=>c.zone==="DECK").length,0);
        const expectedHand=p.zones.HAND.filter(cid=>id===viewer||cid===declared);
        assert.deepEqual(publicPlayer.cards.filter(c=>c.zone==="HAND").map(c=>c.publicId),expectedHand);
        for(const zone of ["EDDIES","LEGENDS"] as const)for(const [slot,cid] of p.zones[zone].entries()){
            const actual=state.objects.cards[cid],key=actual.face==="UP"?cid:`seat:${p.seat}:${zone}:${slot}`;
            const visible=publicPlayer.cards.find(c=>c.publicId===key)!;assert.ok(visible);
            if(actual.face==="DOWN"){
                assert.equal(visible.content,undefined);assert.equal(visible.effectivePower,undefined);
                const entitled=state.privateKnowledge?.find(k=>k.viewerId===viewer&&k.cardInstanceId===cid);
                assert.deepEqual(visible.rememberedContent,entitled?.content);
                if(zone==="EDDIES")assert.equal(visible.rememberedContent,undefined);
            }
        }
    }
    return observation;
}
export function auditDemoModelInput(position:TrainingPosition,context:EngineContext) {
    const state=position.state,viewer=state.match.playerOrder[position.actingSeat],input=modelInput(position);
    assert.deepEqual(Object.keys(input).sort(),["legalActions","observation"]);
    assert.deepEqual(input.observation,auditDemoObservation(state,viewer,context));
    const allowed=new Set<string>(input.observation.players.flatMap(p=>p.cards.flatMap(c=>c.content?[c.publicId]:[])));
    for(const c of input.observation.inspectedCards??[])allowed.add(c.instanceId);
    const serialized=JSON.stringify(input);
    assert.equal(serialized.includes(state.rng.seed),false);
    for(const c of Object.values(state.objects.cards))if(!allowed.has(c.id)&&["HAND","DECK","EDDIES","LEGENDS"].includes(c.zone.zone)){
        // Exact physical IDs encode object identity; model actions expose only opaque actionId and public labels.
        assert.equal(serialized.includes(JSON.stringify(c.id)),false,`Hidden instance ${c.id} in model projection`);
    }
    for(const action of input.legalActions)assert.deepEqual(Object.keys(action).sort(),["actionId","descriptor"]);
    function forbidden(value:unknown){if(value&&typeof value==="object")for(const [key,child] of Object.entries(value)){
        assert.ok(!["state","rng","seed","rngCounter","privateKnowledge","events","actorId","action","optionIndices"].includes(key),`Forbidden model field ${key}`);forbidden(child);
    }}forbidden(input);
    return input;
}
export const publicPolicyActions=(actions: readonly DeepReadonly<LegalAction>[])=>actions.map(({actionId,descriptor})=>({actionId,descriptor}));
export function demoMatchDiagnostics(trace:ReturnType<typeof demoMatchReplay>) {
    const states=[trace.initialized.state,...trace.steps.map(s=>s.state)],events=[...trace.initialized.events,...trace.steps.flatMap(s=>s.events)],objects=trace.finalState.objects.cards;
    const eventCounts:Record<string,number>={};for(const e of events)eventCounts[e.payload.kind]=(eventCounts[e.payload.kind]??0)+1;
    const pendingSources=new Map<string,string>();for(const e of events)if(e.payload.kind==="EFFECT_PENDING")pendingSources.set(e.payload.effectId,e.payload.sourceId);
    const drawn=new Set(states.flatMap(s=>Object.values(s.players).flatMap(p=>p.zones.HAND)));
    const seen=new Set(states.flatMap(s=>Object.values(s.objects.cards).filter(c=>c.face==="UP"||c.zone.zone==="HAND").map(c=>c.id)));
    for(const state of states){for(const k of state.privateKnowledge??[])seen.add(k.cardInstanceId);for(const id of state.resolution.searchContinuation?.looked??[])seen.add(id);}
    const participation=trace.content.cards.map(card=>{
        const copies=Object.values(objects).filter(c=>c.cardId===card.id),ids=new Set(copies.map(c=>c.id));
        const has=(id:string|undefined)=>id!==undefined&&copies.some(c=>c.id===id);
        return {cardId:card.id,name:card.displayName,type:card.type,copies:copies.length,drawn:copies.filter(c=>drawn.has(c.id)).length,
            played:events.filter(e=>e.payload.kind==="CARD_PLAYED"&&ids.has(e.payload.cardInstanceId)).length,
            called:events.filter(e=>e.payload.kind==="LEGEND_CALLED"&&ids.has(e.payload.cardInstanceId)).length,
            effectsPending:events.filter(e=>e.payload.kind==="EFFECT_PENDING"&&has(e.payload.sourceId)).length,
            effectsResolved:events.filter(e=>e.payload.kind==="EFFECT_RESOLVED"&&has(pendingSources.get(e.payload.effectId))).length,
            unseenCopies:copies.filter(c=>!seen.has(c.id)).length};
    });
    const final=trace.finalState;
    const resources=trace.finalState.match.playerOrder.map(id=>{
        const p=final.players[id],gigs=Object.values(final.objects.gigs).filter(g=>g.controllerId===id&&g.location.zone==="GIGS");
        return {seat:p.seat,manifest:trace.seatManifests[p.seat].id,deck:p.zones.DECK.length,hand:p.zones.HAND.length,trash:p.zones.TRASH.length,field:p.zones.BATTLEFIELD.length,eddies:p.zones.EDDIES.length,legends:p.zones.LEGENDS.map(cid=>({face:objects[cid].face,readiness:objects[cid].readiness})),removed:p.zones.REMOVED.length,gigs:gigs.length,fixers:p.gigs.FIXER.length,streetCred:gigs.reduce((n,g)=>n+(g.roll.kind==="ROLLED"?g.roll.currentValue:0),0)};
    });
    const turns=Array.from({length:final.timing.turn},(_,i)=>i+1).map(turn=>{
        const decisions=trace.steps.filter(s=>s.beforeTurn===turn),turnStates=states.filter(s=>s.timing.turn===turn),last=turnStates.at(-1)!;
        const turnEvents=events.filter(e=>{const eventStep=trace.steps.find(s=>s.events.some(x=>x.sequence===e.sequence));return eventStep?.beforeTurn===turn;});
        return {turn,activeSeat:last.players[last.timing.activePlayer].seat,
            rolls:turnEvents.filter(e=>e.payload.kind==="GIG_DIE_ROLLED").map(e=>e.payload),
            mainActions:decisions.filter(s=>s.observation.step==="MAIN").map(s=>s.legalActions.find(a=>a.actionId===s.actionId)!.descriptor.label),
            attacks:turnEvents.filter(e=>e.payload.kind==="ATTACK_DECLARED").length,transfers:turnEvents.filter(e=>e.payload.kind==="GIG_CONTROL_CHANGED").length,
            endEffects:trace.steps.filter((s,i)=>s.beforeTurn===turn && states[i].resolution.triggerContinuation?.origin.kind==="END_TURN").map(s=>s.legalActions.find(a=>a.actionId===s.actionId)!.descriptor.label),
            overtime:last.match.overtime?"ACTIVE":last.timing.emptyFixerStarts??0};
    });
    return {eventCounts,participation,resources,turns};
}
