import type { DeepReadonly, LegalAction } from "@tcg/domain";
import type { PlayerObservation } from "@tcg/engine";
/** Test policy only. No state, bundle, RNG, file I/O, action payloads or replay-step input. */
export const DEMO_MATCH_POLICY = "DEMO_MATCH_POLICY_V1";
export type PolicyAction = Pick<LegalAction, "actionId" | "descriptor">;
export function chooseDemoMatchAction(observation: DeepReadonly<PlayerObservation>, legalActions: readonly PolicyAction[]) {
    if (!legalActions.length) throw new Error("POLICY_NO_LEGAL_ACTION");
    const mine = observation.players.find(p => p.seat === observation.viewerSeat)!;
    function score(a: PolicyAction) {
        const {kind,label} = a.descriptor;
        if(kind === "CHOOSE") {
            if(label === "Go first" || label.startsWith("Decline ") && label.endsWith("cut") || label === "Keep the opening hand") return 1000;
            if(label.startsWith("Pay with eddie")) return 900;
            if(label === "Attack rival Gig area") return 800;
            if(label.startsWith("Use the optional")) return 700;
            if(label.startsWith("Reveal and take")) return 700;
            if(label.startsWith("Steal ")) return 600 + Number(label.match(/current (\d+)/)?.[1] ?? 0);
            if(label.startsWith("Defeat ")) {
                const target = observation.players.flatMap(p=>p.cards).find(c=>label.includes(`(${c.publicId},`));
                return 600 + (target?.controllerSeat === observation.viewerSeat ? -100 : 100) + (target?.effectivePower ?? 0);
            }
            if(label.startsWith("Spend ") || label.startsWith("Give ")) {
                const target=observation.players.flatMap(p=>p.cards).find(c=>label.includes(`(${c.publicId}`));
                return 500 + (target?.controllerSeat===observation.viewerSeat?-100:100) + (target?.readiness==="READY"?20:0) + (target?.effectivePower??0);
            }
            if(label.startsWith("Adjust your ") || label.startsWith("Choose rival ")) return 500 + Number(label.match(/current (\d+)/)?.[1]??0);
            if(label.startsWith("Increase by ") || label.startsWith("Decrease by "))return 400 + Number(label.match(/by (\d+)/)?.[1]??0);
            if(label.startsWith("Call "))return 300;
            return 100;
        }
        if(kind === "ROLL_GIG")return 1000 + Number(label.match(/D(\d+)/)?.[1]??0);
        if(kind === "SELL_CARD")return mine.counts.EDDIES<7?900:-100;
        if(kind === "GO_SOLO")return 850;
        if(kind === "PLAY_CARD")return 800;
        if(kind === "CALL_LEGEND")return 700;
        if(kind === "ACTIVATE_ABILITY")return 600;
        if(kind === "DECLARE_ATTACK")return 500;
        if(kind === "DECLARE_BLOCKER")return 400;
        if(kind === "PASS_REACT")return 0;
        return 0; // END_TURN after preferred finite resource/ready-card actions.
    }
    const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
    return [...legalActions].sort((a,b)=>score(b)-score(a)||compare(a.descriptor.label,b.descriptor.label)||compare(a.actionId,b.actionId))[0].actionId;
}
