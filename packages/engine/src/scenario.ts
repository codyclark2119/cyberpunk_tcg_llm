// composeScenario (plan section 7): build one exact, valid position at the active seat's MAIN step
// from a public description, so a caller can ask the engine what it offers there and play actions
// from it. It authors nothing: every card passes the same admission createGame runs, and the
// finished state passes validateState unchanged. It starts with an empty turn history (no plays,
// sells, Calls or steals this turn) and no pending trigger, choice or combat; a caller reaches
// those by applying engine-offered actions. Deck order is the described order; the seed only
// drives later randomness (Gig rolls, d20s, shuffles).
import { z } from "zod";
import { DeckSchema, GameStateSchema, MatchIdSchema, PlayerIdSchema, success, validateDeck, type GameState, type Result } from "@tcg/domain";
import { validateState, type EngineContext } from "./state";
import { admitDeckCards } from "./initialization";
import { triggersEnabled } from "./trigger-support";
import { firstAttackHistoryEnabled } from "./first-attack-support";
import { initialFirstAttackHistory } from "./first-attack-history";
import { programPlayHistoryEnabled } from "./restriction-support";

const Slug = z.string().min(1);
const Readiness = z.enum(["READY", "SPENT"]);
const ScenarioPlayerSchema = z.strictObject({
    field: z.array(z.strictObject({ card: Slug, readiness: Readiness, gear: z.array(Slug).optional() })),
    legends: z.array(z.strictObject({ card: Slug, face: z.enum(["UP", "DOWN"]), readiness: Readiness, gear: z.array(Slug).optional() })),
    hand: z.array(Slug), trash: z.array(Slug), deck: z.array(Slug),
    gigs: z.array(z.strictObject({ die: z.enum(["D4", "D6", "D8", "D10", "D12"]), value: z.number().int().positive() })),
    eddies: z.strictObject({ ready: z.number().int().nonnegative(), spent: z.number().int().nonnegative() })
});
export const ScenarioSchema = z.strictObject({
    seed: z.string().min(1), turn: z.number().int().positive().optional(), activeSeat: z.union([z.literal(0), z.literal(1)]),
    players: z.tuple([ScenarioPlayerSchema, ScenarioPlayerSchema])
});
export type Scenario = z.infer<typeof ScenarioSchema>;
/** Fixed ids, so a scenario's state, hashes and action ids depend on its description alone. */
export const SCENARIO_MATCH_ID = MatchIdSchema.parse("00000000-0000-4000-8000-0000000005c0");
export const SCENARIO_PLAYERS = [PlayerIdSchema.parse("00000000-0000-4000-8000-0000000005c1"), PlayerIdSchema.parse("00000000-0000-4000-8000-0000000005c2")] as const;
export const SCENARIO_DEFAULT_TURN = 3;

type Issue = { code: string; message: string; path?: string };
const reject = (code: string, message: string, path?: string): Result<never> => ({ ok: false, errors: [{ code, message, ...(path ? { path } : {}) }] });

export function composeScenario(input: unknown, context: EngineContext): Result<GameState> {
    const parsed = ScenarioSchema.safeParse(input);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return reject("INVALID_SCENARIO", issue?.message ?? parsed.error.message, issue ? pathOf(issue.path) : undefined);
    }
    const sc = parsed.data, content = context.content, rules = content.ruleset.gameplay;
    if (rules?.initialization !== "TURN_SLICE_V1") return reject("UNSUPPORTED_INITIALIZATION", "Scenarios require the reviewed turn-slice ruleset");
    const revisionOf = (slug: string) => content.cards.find(c => c.id === slug);
    const typed = (slug: string, path: string, ok: (type: string) => boolean, want: string): Issue | null => {
        const r = revisionOf(slug);
        if (!r) return { code: "UNKNOWN_CARD", message: `${slug} is not in the content bundle`, path };
        return ok(r.type) ? null : { code: "WRONG_CARD_TYPE", message: `${slug} is a ${r.type}, not ${want}`, path };
    };
    for (const [seat, p] of sc.players.entries()) {
        const at = `players[${seat}]`, checks: (Issue | null)[] = [];
        p.field.forEach((u, i) => { checks.push(typed(u.card, `${at}.field[${i}].card`, t => t === "UNIT", "a Unit")); (u.gear ?? []).forEach((g, j) => checks.push(typed(g, `${at}.field[${i}].gear[${j}]`, t => t === "GEAR", "a Gear"))); });
        p.legends.forEach((l, i) => { checks.push(typed(l.card, `${at}.legends[${i}].card`, t => t === "LEGEND", "a Legend")); (l.gear ?? []).forEach((g, j) => checks.push(typed(g, `${at}.legends[${i}].gear[${j}]`, t => t === "GEAR", "a Gear"))); });
        for (const zone of ["hand", "trash", "deck"] as const) p[zone].forEach((slug, i) => checks.push(typed(slug, `${at}.${zone}[${i}]`, t => t !== "LEGEND", "a main-deck card")));
        // Only a face-up Legend hosts Gear in the Legends area (validateGearAttachments).
        p.legends.forEach((l, i) => { if (l.face === "DOWN" && l.gear?.length) checks.push({ code: "ILLEGAL_GEAR_HOST", message: `${l.card} is face-down, and only a face-up Legend can host Gear`, path: `${at}.legends[${i}].gear` }); });
        const issue = checks.find(Boolean);
        if (issue) return reject(issue.code, issue.message, issue.path);
        const dice = new Set<string>();
        for (const [i, g] of p.gigs.entries()) {
            if (dice.has(g.die)) return reject("INVALID_GIG", `${g.die} appears twice`, `${at}.gigs[${i}]`);
            if (g.value > Number(g.die.slice(1))) return reject("INVALID_GIG", `${g.die} cannot show ${g.value}`, `${at}.gigs[${i}].value`);
            dice.add(g.die);
        }
    }
    // Every state is a legal CONSTRUCTED composition (validateState checks it), so the deck below the
    // described top cards is completed to the minimum size with the first fitting cards: vanilla
    // before cards with abilities, then by slug, within copy and RAM limits.
    const format = content.ruleset.formats?.CONSTRUCTED;
    if (!format) return reject("UNSUPPORTED_FORMAT", "Scenarios require the CONSTRUCTED format policy");
    const fillers: string[][] = [], eddieCards: string[][] = [];
    for (const [seat, p] of sc.players.entries()) {
        const main = [...p.field.flatMap(u => [u.card, ...(u.gear ?? [])]), ...p.legends.flatMap(l => l.gear ?? []), ...p.hand, ...p.trash, ...p.deck];
        const legends = p.legends.map(l => revisionOf(l.card)!), counts = new Map<string, number>();
        for (const slug of main) counts.set(slug, (counts.get(slug) ?? 0) + 1);
        const fits = (c: (typeof content.cards)[number]) => c.type !== "LEGEND" && c.colors.every(color => color === "NEUTRAL" || (c.ram?.[color] ?? 0) <= legends.reduce((n, l) => n + (l.ram?.[color] ?? 0), 0));
        const plain = (c: (typeof content.cards)[number]) => !c.mechanics.abilities.length && !c.mechanics.modifiers.length && !c.mechanics.keywords.length && !c.mechanics.restrictions?.length && !c.mechanics.equip;
        const pool = content.cards.filter(fits).sort((a, b) => Number(plain(b)) - Number(plain(a)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), fill: string[] = [], eddies: string[] = [];
        const take = (out: string[], want: number, ok: (c: (typeof pool)[number]) => boolean) => { for (const c of pool) while (out.length < want && ok(c) && (counts.get(c.id) ?? 0) < format.maxCopies) { out.push(c.id); counts.set(c.id, (counts.get(c.id) ?? 0) + 1); } };
        // An Eddie is a face-down sold card worth its base Eddie value, so each stands as a sellable 1-value card.
        take(eddies, p.eddies.ready + p.eddies.spent, c => c.sellProfile.allowed && c.sellProfile.baseEddieValue === 1);
        if (eddies.length < p.eddies.ready + p.eddies.spent) return reject("INVALID_DECK", "Too few sellable 1-value cards fit this deck to stand for its Eddies", `players[${seat}].eddies`);
        take(fill, Math.max(0, format.mainDeck.min - main.length - eddies.length), () => true);
        const deck = DeckSchema.safeParse({ name: "Scenario", legends: p.legends.map(l => l.card), cards: [...counts].map(([cardId, quantity]) => ({ cardId, quantity })) });
        const legal = deck.success ? validateDeck(deck.data, content.cards as Parameters<typeof validateDeck>[1], content.ruleset as Parameters<typeof validateDeck>[2]) : null;
        if (!legal?.legal) return reject("INVALID_DECK", legal ? legal.issues.filter(i => i.severity === "error").map(i => i.message).join("; ") : "Not a deck", `players[${seat}]`);
        fillers.push(fill); eddieCards.push(eddies);
    }
    const turn = sc.turn ?? SCENARIO_DEFAULT_TURN, ids = [...SCENARIO_PLAYERS], active = ids[sc.activeSeat];
    // Turn parity agrees with the first player: odd turns are the first player's.
    const first = turn % 2 === 1 ? active : ids[1 - sc.activeSeat];
    const cards: Record<string, unknown> = {}, gigs: Record<string, unknown> = {}, players: Record<string, unknown> = {};
    for (const [seat, p] of sc.players.entries()) {
        const id = ids[seat], zones: Record<string, string[]> = { DECK: [], HAND: [], BATTLEFIELD: [], TRASH: [], EDDIES: [], LEGENDS: [], REMOVED: [] };
        let n = 0;
        const add = (slug: string, zone: string, face: "UP" | "DOWN", readiness: "READY" | "SPENT", list = true) => {
            const r = revisionOf(slug)!, instance = `p${seat}-c${n++}`;
            cards[instance] = { id: instance, cardId: r.id, revision: r.revision, ownerId: id, controllerId: id, zone: { playerId: id, zone }, face, readiness, damage: 0, counters: {}, statuses: [], attachments: [] as string[] };
            if (list) zones[zone].push(instance);
            return instance;
        };
        // Hosts take the first slots of their zone in the described order, so legends[i] is LEGENDS slot i
        // and field[i] is field slot i; attached Gear shares its host's zone (4.12) and follows all hosts.
        const legendIds = p.legends.map(l => add(l.card, "LEGENDS", l.face, l.readiness));
        const unitIds = p.field.map(u => add(u.card, "BATTLEFIELD", "UP", u.readiness));
        const equip = (hostId: string, zone: string, gear: string[] = []) => { (cards[hostId] as { attachments: string[] }).attachments = gear.map(g => add(g, zone, "UP", "READY")); };
        p.legends.forEach((l, i) => equip(legendIds[i], "LEGENDS", l.gear));
        p.field.forEach((u, i) => equip(unitIds[i], "BATTLEFIELD", u.gear));
        for (const slug of p.hand) add(slug, "HAND", "DOWN", "READY");
        for (const slug of p.trash) add(slug, "TRASH", "UP", "READY");
        for (const slug of [...p.deck, ...fillers[seat]]) add(slug, "DECK", "DOWN", "READY");
        eddieCards[seat].forEach((slug, i) => add(slug, "EDDIES", "DOWN", i < p.eddies.ready ? "READY" : "SPENT"));
        const fixer: string[] = [], area: string[] = [];
        for (const dieType of ["D4", "D6", "D8", "D10", "D12", "D20"]) {
            const gid = `p${seat}-${dieType}`, rolled = p.gigs.find(g => g.die === dieType);
            (rolled ? area : fixer).push(gid);
            gigs[gid] = { id: gid, ownerId: id, controllerId: id, location: { playerId: id, zone: rolled ? "GIGS" : "FIXER" }, dieType,
                roll: rolled ? { kind: "ROLLED", initialValue: rolled.value, currentValue: rolled.value } : { kind: "UNROLLED" } };
        }
        players[id] = { id, seat, zones, economy: { sellsThisTurn: 0, callsThisTurn: 0, usageTurn: turn }, gigs: { FIXER: fixer, GIGS: area }, statuses: [] };
    }
    const draft = {
        schemaVersion: 2,
        match: { id: SCENARIO_MATCH_ID, version: 0, eventSequence: 0, rulesetId: content.ruleset.id, rulesetVersion: content.ruleset.version, rulesetHash: content.manifest.ruleset.hash,
            contentManifestHash: content.manifestHash, engineVersion: content.manifest.engine.version, engineArtifactHash: content.manifest.engine.artifactHash,
            cards: content.manifest.cards.map(({ cardId, revision }) => ({ cardId, revision })), playerOrder: ids },
        timing: { turn, activePlayer: active, actingPlayer: active, emptyFixerStarts: 0, step: "MAIN", firstPlayer: first, window: "MAIN", combat: { stage: "NONE" } },
        players, objects: { cards, gigs },
        resolution: { stage: "DECISION", current: null, pending: [], discovered: [], choice: null },
        rng: { algorithm: "SHA256_COUNTER_V1", seed: sc.seed, counter: 0 }
    };
    const shaped = GameStateSchema.safeParse(draft);
    if (!shaped.success) return reject("INVALID_SCENARIO", shaped.error.issues[0]?.message ?? shaped.error.message);
    const s = shaped.data;
    if (triggersEnabled(context)) s.turnHistory = { ...(firstAttackHistoryEnabled(context) ? { firstArasakaAttacks: initialFirstAttackHistory(s) } : {}), turn, triggeredBatches: 0, blueUnitOrGearPlays: Object.fromEntries(ids.map(id => [id, 0])), ...(programPlayHistoryEnabled(context) ? { programPlays: Object.fromEntries(ids.map(id => [id, 0])) } : {}) };
    const admitted = admitDeckCards(s, context);
    if (!admitted.ok) return reject("UNADMITTED_CARD", admitted.errors.map(e => `${e.code}: ${e.message}`).join("; "));
    const valid = validateState(s, context);
    if (!valid.ok && valid.errors.some(e => e.code === "INVALID_GEAR_ATTACHMENT" || e.code === "INVALID_EQUIP_HOST"))
        return reject("ILLEGAL_GEAR_HOST", valid.errors.map(e => e.message).join("; "));
    return valid.ok ? success(valid.value) : valid;
}
function pathOf(path: readonly PropertyKey[]) {
    return path.reduce<string>((out, k) => typeof k === "number" ? `${out}[${k}]` : out ? `${out}.${String(k)}` : String(k), "");
}
