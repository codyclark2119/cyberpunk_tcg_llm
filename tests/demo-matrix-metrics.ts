import { hashCanonical } from "@tcg/domain";
import { modelInput } from "@tcg/training-harness";
import { applicablePowerModifiers } from "../packages/engine/src/characteristics";
import type { demoMatrixReplay } from "./demo-matrix-replay";
import { coordinateId } from "./demo-matrix-config";
export type MatrixTrace = ReturnType<typeof demoMatrixReplay>;
export const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
export function distribution(values: number[]) {
    const sorted=[...values].sort((a,b)=>a-b), n=sorted.length;
    return {count:n,min:sorted[0]??0,median:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.ceil((n-1)/2)])/2:0,p95:sorted[Math.max(0,Math.ceil(n*.95)-1)]??0,max:sorted.at(-1)??0,total:values.reduce((a,b)=>a+b,0)};
}
export const MECHANICS=["gearOnLegend","preEquippedGoSolo","dyingNightPlayed","dyingAttack","dyingDelayedCreated","dyingEndReady","dyingVEndReady","delamainSteal","delamainEndPending","delamainEddieChoice","delamainEndResolved","quickFloorIt","quickReboot","floorItPower","losingPlus5","saburoAura","saburoAndLosing","yorinobuTrigger","minotaurDefeat","overTheEdgeDefeat","corporateSpend","dexterDefeatedTrigger","fieldLegendDefeated","fieldLegendRemoved","legendGearTrashOrder","multiGigSteal","overtimeProgress1","overtimeProgress2","overtimeEntered","overtimeWin","emptyDraw","multipleBlockers","inheritedBlocker","kiroshiLook","kiroshiMemoryRetained","kiroshiMemoryRevealed","kiroshiMemoryCleaned"] as const;
export function summarizeMatrixTrace(trace: MatrixTrace) {
    const mechanics: Record<string,{count:number;firstTurn:number|null}>=Object.fromEntries(MECHANICS.map(k=>[k,{count:0,firstTurn:null}]));
    const count=(kind:string,turn:number,n=1)=>{const m=mechanics[kind];m.count+=n;m.firstTurn??=turn;};
    const cards=trace.content.cards.map(c=>({cardId:c.id,name:c.displayName,drawn:false,playedCalled:false,triggered:false,resolved:false,unseen:true}));
    const byCard=new Map(cards.map(c=>[c.cardId,c]));
    const instances=new Map(Object.values(trace.finalState.objects.cards).map(c=>[String(c.id),c]));
    const card=(id:string)=>{const c=instances.get(id);return c?byCard.get(c.cardId):undefined;};
    const name=(id:string)=>card(id)?.name??"";
    const sourceName=(id:string)=>name(id).toLowerCase();
    const targetedDefeats=new Set<string>(), delayedSubjects=new Map<string,string>(), pending=new Map<string,string>(),seenModifiers=new Set<string>(),seenBindings=new Set<string>();
    const eventCounts:Record<string,number>={},selectedCategories:Record<string,number>={},availableCategories:Record<string,number>={};
    const inc=(map:Record<string,number>,key:string,n=1)=>map[key]=(map[key]??0)+n;
    let maxReactActions=0,reactActions=0,maxTriggerBatch=0,maxTriggerSources=0,maxPaymentChoices=0,maxGigChoices=0,crossControllerChoices=0;
    let state=trace.initialized.state;
    const context={content:trace.content};
    for(const current of [trace.initialized.state,...trace.steps.map(s=>s.state)]) {
        for(const c of Object.values(current.objects.cards)) {
            const p=card(c.id)!;
            if(c.zone.zone==="HAND")p.drawn=true;
            if(c.zone.zone==="HAND"||c.face==="UP")p.unseen=false;
        }
        for(const k of current.privateKnowledge??[])card(k.cardInstanceId)!.unseen=false;
        for(const id of current.resolution.searchContinuation?.looked??[])card(id)!.unseen=false;
    }
    for(const [index,step] of trace.steps.entries()) {
        const turn=step.beforeTurn,next=step.state,chosen=step.legalActions.find(a=>a.actionId===step.actionId)!;
        inc(selectedCategories,`${step.observation.step}:${chosen.descriptor.kind}`);
        if(step.observation.actingSeat!==step.observation.activeSeat)crossControllerChoices++;
        if(step.observation.step==="PAYMENT_SELECTION")maxPaymentChoices=Math.max(maxPaymentChoices,step.legalActions.length);
        if(["GIG_STEAL_SELECTION","TARGET_SELECTION","AMOUNT_SELECTION"].includes(step.observation.step!))maxGigChoices=Math.max(maxGigChoices,step.legalActions.filter(a=>/Gig|D(4|6|8|10|12|20)|Increase|Decrease/.test(a.descriptor.label)).length);
        if(state.timing.window==="RIVAL_REACT"||state.resolution.returnTo?.kind==="RIVAL_REACT") {reactActions++;maxReactActions=Math.max(maxReactActions,reactActions);}
        const bindings=state.resolution.triggerContinuation?.bindings??[];
        maxTriggerBatch=Math.max(maxTriggerBatch,bindings.length);maxTriggerSources=Math.max(maxTriggerSources,new Set(bindings.map(b=>b.sourceId)).size);
        for(const b of bindings) {
            const key=hashCanonical({b,turn,ordinal:state.resolution.triggerContinuation!.ordinal});
            if(seenBindings.has(key))continue;seenBindings.add(key);


            if(sourceName(b.sourceId).includes("delamain")&&b.kind==="WHEN_OWN_TURN_ENDS")count("delamainEndPending",turn);
        }
        if(step.observation.step==="EDDIE_READY_SELECTION"&&sourceName(state.resolution.current?.sourceId??"").includes("delamain"))count("delamainEddieChoice",turn);
        const blockers=step.legalActions.filter(a=>a.action.kind==="DECLARE_BLOCKER");
        if(blockers.length>1)count("multipleBlockers",turn); // Decision boundaries, explicitly not distinct combat count.
        for(const a of blockers)if(a.action.kind==="DECLARE_BLOCKER") {
            const id=a.action.cardInstanceId,c=state.objects.cards[id],r=trace.content.cards.find(r=>r.id===c.cardId)!;
            if(!r.mechanics.keywords.includes("BLOCKER"))count("inheritedBlocker",turn);
        }
        for(const c of Object.values(state.objects.cards)) {
            const mods=applicablePowerModifiers(state,c.id,context),aura=mods.some(m=>m.kind==="FRIENDLY_ARASAKA_ATTACKING_UNIT_POWER");
            if(aura){const key=`${turn}:${c.id}:${state.turnHistory?.firstArasakaAttacks?.[c.controllerId]?.count??0}`;
                if(!seenModifiers.has(`aura:${key}`)){seenModifiers.add(`aura:${key}`);count("saburoAura",turn);}
                if(mods.some(m=>m.amount===5)&&!seenModifiers.has(`both:${key}`)){seenModifiers.add(`both:${key}`);count("saburoAndLosing",turn);}}
        }
        if(next.timing.emptyFixerStarts!==state.timing.emptyFixerStarts&&next.timing.emptyFixerStarts)count(`overtimeProgress${next.timing.emptyFixerStarts}`,next.timing.turn);
        for(const k of state.privateKnowledge??[]) {
            const remains=next.privateKnowledge?.some(n=>n.viewerId===k.viewerId&&n.cardInstanceId===k.cardInstanceId);
            if(remains)count("kiroshiMemoryRetained",turn);
            else {count("kiroshiMemoryCleaned",turn);if(next.objects.cards[k.cardInstanceId].face==="UP")count("kiroshiMemoryRevealed",turn);}
        }
        if(chosen.action.kind==="PLAY_CARD"&&state.timing.window==="RIVAL_REACT") {
            const n=sourceName(chosen.action.cardInstanceId);if(n.includes("floor it"))count("quickFloorIt",turn);if(n.includes("reboot"))count("quickReboot",turn);
        }
        if(chosen.action.kind==="GO_SOLO"&&state.objects.cards[chosen.action.cardInstanceId].attachments.length)count("preEquippedGoSolo",turn);
        const payloads=step.events.map(e=>e.payload);
        if(payloads.filter(e=>e.kind==="GIG_STOLEN").length>1)count("multiGigSteal",turn);
        let activeEffect=state.resolution.current?.id;
        for(const e of step.events){const p=e.payload;inc(eventCounts,p.kind);
            if(p.kind==="ATTACK_ENDED")reactActions=0;
            if(p.kind==="GEAR_ATTACHED"&&state.objects.cards[p.hostInstanceId].zone.zone==="LEGENDS")count("gearOnLegend",turn);
            if(p.kind==="CARD_PLAYED"||p.kind==="LEGEND_CALLED") {card(p.cardInstanceId)!.playedCalled=true;if(p.kind==="CARD_PLAYED"&&sourceName(p.cardInstanceId).includes("dying night"))count("dyingNightPlayed",turn);}
            if(p.kind==="EFFECT_PENDING") {pending.set(p.effectId,p.sourceId);card(p.sourceId)!.triggered=true;
                if(sourceName(p.sourceId).includes("yorinobu"))count("yorinobuTrigger",turn);
                if(sourceName(p.sourceId).includes("dexter")&&payloads.some(e=>e.kind==="CARD_DEFEATED"&&e.cardInstanceId===p.sourceId))count("dexterDefeatedTrigger",turn);
            }
            if(p.kind==="TRIGGER_ORDER_SELECTED")activeEffect=p.effectId;
            if(p.kind==="DEFEAT_TARGET_SELECTED")targetedDefeats.add(`${p.sourceId}:${p.targetId}`);
            if(p.kind==="EFFECT_RESOLVED") {activeEffect=undefined;const id=pending.get(p.effectId);if(id){card(id)!.resolved=true;
                if(state.resolution.triggerContinuation?.origin.kind==="END_TURN"&&sourceName(id).includes("delamain"))count("delamainEndResolved",turn);}}
            if(p.kind==="DELAYED_EFFECT_CREATED") {delayedSubjects.set(p.delayedEffect.id,p.delayedEffect.subjectId);count("dyingDelayedCreated",turn);count("dyingAttack",turn);}
            if(p.kind==="CARD_READIED"&&next.objects.cards[p.cardInstanceId].zone.zone==="EDDIES") {
                const subject=activeEffect?delayedSubjects.get(activeEffect):undefined;
                if(subject) {count("dyingEndReady",turn);if(sourceName(subject).startsWith("v:"))count("dyingVEndReady",turn);}
            }
            if(p.kind==="GIG_STOLEN"&&sourceName(p.attackerId).includes("delamain"))count("delamainSteal",turn);
            if(p.kind==="POWER_MODIFIER_APPLIED")count(p.modifier.amount===5?"losingPlus5":"floorItPower",turn);
            if(p.kind==="CARD_DEFEATED") {
                const n=sourceName(p.defeatedBy),target=trace.content.cards.find(r=>r.id===state.objects.cards[p.cardInstanceId].cardId)!;
                if(n.includes("minotaur")&&targetedDefeats.has(`${p.defeatedBy}:${p.cardInstanceId}`))count("minotaurDefeat",turn);
                if(n.includes("over the edge")&&targetedDefeats.has(`${p.defeatedBy}:${p.cardInstanceId}`))count("overTheEdgeDefeat",turn);
                if(target.type==="LEGEND")count("fieldLegendDefeated",turn);
            }
            if(p.kind==="CARD_SPENT"&&p.cause&&sourceName(p.cause.sourceId).includes("corporate surveillance"))count("corporateSpend",turn);
            if(p.kind==="CARD_MOVED"&&p.to.zone==="REMOVED")count("fieldLegendRemoved",turn);
            if(p.kind==="DEFEAT_TRASH_ORDER_SELECTED"&&trace.content.cards.find(r=>r.id===state.objects.cards[p.targetId].cardId)?.type==="LEGEND"&&p.cardInstanceId!==p.targetId)count("legendGearTrashOrder",turn);
            if(p.kind==="OVERTIME_STARTED")count("overtimeEntered",turn);
            if(p.kind==="GAME_ENDED"&&p.reason==="OVERTIME_GIGS")count("overtimeWin",turn);
            if(p.kind==="GAME_ENDED"&&p.reason==="EMPTY_DRAW")count("emptyDraw",turn);
            if(p.kind==="LEGEND_LOOKED_AT")count("kiroshiLook",turn);
        }
        if(index===0)for(const e of trace.initialized.events)inc(eventCounts,e.payload.kind);
        state=next;
    }
    const samples=trace.positions.map(p=>{
        for(const a of p.legalActions)inc(availableCategories,`${p.observation.step}:${a.descriptor.kind}`);
        const input=modelInput(p);
        return {coordinate:coordinateId(trace.coordinate),seed:trace.coordinate.seed,turn:p.state.timing.turn,actor:p.actingSeat,phase:p.observation.step,categories:[...new Set(p.legalActions.map(a=>a.descriptor.kind))],legal:p.legalActions.length,observationBytes:bytes(input.observation),descriptorBytes:bytes(input.legalActions),modelBytes:bytes(input),trustedPositionBytes:bytes(p),positionHash:p.positionHash,observationHash:p.observationHash};
    });
    const events=[...trace.initialized.events,...trace.steps.flatMap(s=>s.events)];
    const first=events.find(e=>e.payload.kind==="FIRST_PLAYER_CHOSEN")?.payload;
    return {coordinate:trace.coordinate,policyId:trace.policy.id,initialized:true,pins:{engine:trace.content.manifest.engine,ruleset:trace.content.manifest.ruleset,contentHash:trace.content.manifestHash},seats:trace.seatManifests,status:trace.failure?.classification??(trace.finalState.match.outcome?"SUPPORTED_TERMINAL":trace.purpose==="SETUP_AUDIT"?"SETUP_ONLY":"HISTORICAL_PREFIX"),failure:trace.failure,
        terminal:trace.finalState.match.outcome??null,winner:trace.finalState.match.outcome?trace.seatManifests[trace.finalState.players[trace.finalState.match.outcome.winnerId].seat].id:null,
        setup:{chooserSeat:first?.kind==="FIRST_PLAYER_CHOSEN"?trace.finalState.players[first.chosenBy].seat:null,actualFirstSeat:first?.kind==="FIRST_PLAYER_CHOSEN"?trace.finalState.players[first.playerId].seat:null,d20Ties:events.filter(e=>e.payload.kind==="FIRST_PLAYER_ROLLED"&&e.payload.tied).length,mulligans:events.filter(e=>e.payload.kind==="MULLIGAN_DECLARED").map(e=>e.payload)},
        turns:trace.finalState.timing.turn,actions:trace.steps.length,positions:trace.positions.length,events:trace.finalState.match.eventSequence,finalHash:trace.finalStateHash,mechanics,cards,eventCounts,
        complexity:{maxReactActions,maxTriggerBatch,maxTriggerSources,maxPaymentChoices,maxGigChoices,crossControllerChoices},selectedCategories,availableCategories,
        sizes:{legal:distribution(samples.map(s=>s.legal)),observation:distribution(samples.map(s=>s.observationBytes)),descriptors:distribution(samples.map(s=>s.descriptorBytes)),model:distribution(samples.map(s=>s.modelBytes)),trustedPosition:distribution(samples.map(s=>s.trustedPositionBytes))},samples};
}
export type MatrixSummary=ReturnType<typeof summarizeMatrixTrace>;
export function aggregateMatrix(summaries:MatrixSummary[]) {
    const samples=summaries.flatMap(s=>s.samples),completed=summaries.filter(s=>s.status==="SUPPORTED_TERMINAL");
    const histogram=(values:string[])=>values.reduce<Record<string,number>>((out,v)=>(out[v]=(out[v]??0)+1,out),{});
    const mechanics=MECHANICS.map(mechanic=>{const games=summaries.filter(s=>s.mechanics[mechanic].count>0);return {mechanic,gamesOccurred:games.length,totalOccurrences:games.reduce((n,s)=>n+s.mechanics[mechanic].count,0),firstSeed:games[0]?.coordinate.seed??null,firstCoordinate:games[0]?coordinateId(games[0].coordinate):null,firstTurn:games[0]?.mechanics[mechanic].firstTurn??null};});
    const cards=(summaries[0]?.cards??[]).map(c=>{const games=summaries.map(s=>s.cards.find(x=>x.cardId===c.cardId)!);return {cardId:c.cardId,name:c.name,gamesDrawn:games.filter(c=>c.drawn).length,gamesPlayedCalled:games.filter(c=>c.playedCalled).length,gamesTriggered:games.filter(c=>c.triggered).length,gamesResolved:games.filter(c=>c.resolved).length,gamesUnseen:games.filter(c=>c.unseen).length};});
    const duplicates=(key:"positionHash"|"observationHash")=>{const map=new Map<string,Set<string>>();for(const p of samples){const s=map.get(p[key])??new Set<string>();s.add(p.coordinate);map.set(p[key],s);}return {total:samples.length,distinct:map.size,hashesInMultipleGames:[...map.values()].filter(s=>s.size>1).length};};
    const categories=(key:"selectedCategories"|"availableCategories")=>{const result:Record<string,number>={};for(const s of summaries)for(const [k,n] of Object.entries(s[key]))result[k]=(result[k]??0)+n;return result;};
    return {attempted:summaries.length,completed:completed.length,classifications:histogram(summaries.map(s=>s.status)),terminals:histogram(completed.map(s=>s.terminal!.reason)),winners:histogram(completed.map(s=>s.winner!)),d20Ties:histogram(summaries.map(s=>String(s.setup.d20Ties))),
        length:{turns:distribution(completed.map(s=>s.turns)),actions:distribution(completed.map(s=>s.actions)),positions:distribution(completed.map(s=>s.positions))},
        actions:summaries.reduce((n,s)=>n+s.actions,0),positions:samples.length,legal:distribution(samples.map(s=>s.legal)),observationBytes:distribution(samples.map(s=>s.observationBytes)),descriptorBytes:distribution(samples.map(s=>s.descriptorBytes)),modelBytes:distribution(samples.map(s=>s.modelBytes)),trustedPositionBytes:distribution(samples.map(s=>s.trustedPositionBytes)),
        over20:samples.filter(s=>s.legal>20).length,over50:samples.filter(s=>s.legal>50).length,over100:samples.filter(s=>s.legal>100).length,
        top10:[...samples].sort((a,b)=>b.legal-a.legal||a.coordinate.localeCompare(b.coordinate)||a.turn-b.turn).slice(0,10),
        phaseExamples:[...new Set(samples.map(s=>s.phase))].map(phase=>samples.find(s=>s.phase===phase)!),
        positionDuplication:duplicates("positionHash"),observationDuplication:duplicates("observationHash"),selectedCategories:categories("selectedCategories"),availableCategories:categories("availableCategories"),mechanics,cards};
}
