import { CardRevisionSnapshotSchema, GameStateSchema, RulesetSchema, createContentBundle, hashCanonical, type CardInstanceId, type CardRevisionSnapshot, type GameState, type PlayerId } from "@tcg/domain";
import { applyAction, validateState, type EngineContext } from "@tcg/engine";
import { targetedCards, targetedContext, OVER_THE_EDGE } from "./targeted-defeat-fixture";
import { minotaurReplay } from "./targeted-defeat-replay";
import { clearField, fund, field, equip, payOnly } from "./targeted-defeat-focused";
import { placeCard } from "./value-conditions-focused";
import { unwrap } from "./turn-replay";

/** Deliberately synthetic. This slice proves the capability, not a Detonate admission:
 * no real CardId, upstream record, pinned evidence or publication claim is introduced. */
export const V5_PROBE_ID = "v5-gear-defeat-probe";
export const gearTarget = { kind: "GEAR", relation: "RIVAL", power: { kind: "AT_MOST", value: 2 } } as const;
export const v5Probe: CardRevisionSnapshot = CardRevisionSnapshotSchema.parse({
    ...targetedCards.find(c => c.id === OVER_THE_EDGE)!,
    id: V5_PROBE_ID, name: "Synthetic Gear Defeat Probe", displayName: "Synthetic Gear Defeat Probe",
    deckbuildingIdentity: V5_PROBE_ID, subtitle: "", cardNumber: "V5P", setCode: "DEV", setName: "Synthetic V5 capability tests",
    colors: ["RED"], ram: { RED: 2 }, printedCost: { kind: "EDDIES", amount: 1 },
    sellProfile: { allowed: true, baseEddieValue: 1 }, tags: ["Quickhack"], keywords: [],
    rulesText: "Synthetic capability probe; not an admitted official card.", sourceMarkup: "Synthetic capability probe; not an admitted official card.",
    execution: { scope: "TARGETED_GEAR_DEFEAT_V1", status: "SUPPORTED" },
    mechanics: { keywords: ["QUICK"], modifiers: [], abilities: [{ id: "synthetic-gear-defeat@1", trigger: "WHEN_PLAYED", cost: { kind: "NONE" }, conditions: [], effects: [{ kind: "DEFEAT_UNIT", target: gearTarget }] }] },
    printings: [{ id: "v5-gear-defeat-print", setCode: "DEV", collectorNumber: "V5P", source: "Synthetic capability probe" }],
    provenance: { source: "Synthetic capability probe, not real-card evidence", sourceHash: hashCanonical({ fixture: V5_PROBE_ID }), effectiveAt: "2026-09-18", errata: [], reviewed: true }
});

export function v5Context(card: CardRevisionSnapshot = v5Probe, policy = true): EngineContext {
    const base = targetedContext();
    const slice = { ...base.content.ruleset.gameplay!.turnSlice, ...(policy ? { targetedGearDefeat: "TARGETED_GEAR_DEFEAT_V1" } : {}) };
    const ruleset = RulesetSchema.parse({ ...base.content.ruleset, version: `v5-capability-${policy ? "on" : "off"}`, gameplay: { ...base.content.ruleset.gameplay, turnSlice: slice } });
    return { content: createContentBundle(ruleset, [...base.content.cards, card], base.content.manifest.engine) };
}
/** Repins the reviewed Minotaur trajectory onto the capability context; no RNG or decision is patched. */
function repinned(context: EngineContext) {
    const mino = minotaurReplay(), s = GameStateSchema.parse(mino.beforeSource), b = context.content;
    s.match.rulesetId = b.ruleset.id; s.match.rulesetVersion = b.ruleset.version; s.match.rulesetHash = b.manifest.ruleset.hash;
    s.match.contentManifestHash = b.manifestHash; s.match.engineVersion = b.manifest.engine.version;
    s.match.engineArtifactHash = b.manifest.engine.artifactHash;
    s.match.cards = b.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision }));
    return { state: unwrap(validateState(s, context)), actor: mino.actor, rival: mino.rival };
}
export type Arranged = { state: GameState; actor: PlayerId; rival: PlayerId; hostId: CardInstanceId; gearIds: CardInstanceId[]; sourceId: CardInstanceId; context: EngineContext };
/** Trusted arrangement from a validated boundary: an equipped rival host and the Program in hand. */
export function arrange(opts: { context?: EngineContext; gear?: string[]; host?: string; onLegend?: boolean; caster?: "ACTOR" | "RIVAL"; friendlyGear?: string } = {}): Arranged {
    const context = opts.context ?? v5Context();
    const { state, actor, rival } = repinned(context);
    const caster = opts.caster === "RIVAL" ? rival : actor, owner = caster === actor ? rival : actor;
    let s = fund(clearField(state, context), context);
    let hostId: CardInstanceId;
    if (opts.onLegend) {
        const copy = GameStateSchema.parse(s);
        hostId = copy.players[owner].zones.LEGENDS.find(id => copy.objects.cards[id].zone.zone === "LEGENDS")!;
        copy.objects.cards[hostId].face = "UP";
        s = unwrap(validateState(copy, context));
    } else {
        const placedHost = field(s, context, opts.host ?? "swordwise-huscle", owner);
        s = placedHost.state; hostId = placedHost.id;
    }
    const gearIds: CardInstanceId[] = [];
    for (const g of opts.gear ?? ["mantis-blades", "satori-sword-of-saburo"]) { const e = equip(s, context, g, hostId); s = e.state; gearIds.push(e.id); }
    if (opts.friendlyGear) { const own = field(s, context, "corpo-security", caster); s = own.state; const e = equip(s, context, opts.friendlyGear, own.id); s = e.state; gearIds.push(e.id); }
    const placed = placeCard(s, context, V5_PROBE_ID, caster); s = placed.state;
    if (caster !== actor) s = fund(s, context, caster);
    return { state: s, actor, rival, hostId, gearIds, sourceId: placed.id, context };
}
/** Plays and pays for the Program, stopping at its target decision (or at synchronous completion). */
export function castProgram(a: Arranged, casterId?: PlayerId) {
    const caster = casterId ?? a.actor;
    const played = unwrap(applyAction(a.state, { actorId: caster, action: { kind: "PLAY_CARD", cardInstanceId: a.sourceId } }, a.context));
    return payOnly(played.state, a.context);
}
/** Declares the arranged attack so the defender holds an open React window. */
export function openReact(a: Arranged) {
    const r = unwrap(applyAction(a.state, { actorId: a.actor, action: { kind: "DECLARE_ATTACK", cardInstanceId: a.hostId } }, a.context));
    return r.state;
}
