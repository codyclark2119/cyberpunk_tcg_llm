import test from "node:test";
import assert from "node:assert/strict";
import { CardIdSchema, CardRevisionSnapshotSchema, createContentBundle, hashCanonical } from "@tcg/domain";
import { createGameWithEvents } from "@tcg/engine";
import { supportsPlay } from "../packages/engine/src/play-support";
import { noncombatContext, noncombatInput, AFTERPARTY } from "./noncombat-fixture";

export const DELAMAIN_RIDESHARE = CardIdSchema.parse("delamain-rideshare-ai");
const BLUE_SUPPORT = CardIdSchema.parse("api-admission-blue-support");

const source = {
    artist: "Łukasz Wiktorzak",
    card_type: "Unit",
    classifications: ["AI"],
    color: "Blue",
    cost: 3,
    display_name: "Delamain: Rideshare AI",
    external_id: "cb-delamain-rideshare-ai",
    flavor_text: null,
    id: "3bb1f191-927e-45b3-86ca-cb30baabfe0d",
    image_url: "https://dstcynss47vun.cloudfront.net/prod/cyberpunk/portal/c7eba3a0-63cb-4311-988e-d487a7c0841a/render-mpvm49le.webp",
    is_eddiable: false,
    keywords: [],
    legality: "legal",
    name: "Delamain",
    power: 0,
    print_number: "111",
    printing_id: "c7eba3a0-63cb-4311-988e-d487a7c0841a",
    printings: [
        { artist: "Łukasz Wiktorzak", collector_number: "111", finish: null, id: "c7eba3a0-63cb-4311-988e-d487a7c0841a", image_url: "https://dstcynss47vun.cloudfront.net/prod/cyberpunk/portal/c7eba3a0-63cb-4311-988e-d487a7c0841a/render-mpvm49le.webp", rarity: "Uncommon", set: { code: "welcometonightcityretail", name: "Welcome to Night City — Retail" }, source_image_url: "https://dstcynss47vun.cloudfront.net/prod/cyberpunk/portal/c7eba3a0-63cb-4311-988e-d487a7c0841a/render-mpvm49le.webp" },
        { artist: "Łukasz Wiktorzak", collector_number: "β111", finish: null, id: "32f8d89a-1e4b-46b8-9323-77c297c5b5ae", image_url: "https://dstcynss47vun.cloudfront.net/prod/cyberpunk/portal/32f8d89a-1e4b-46b8-9323-77c297c5b5ae/render-mpv4pd73.webp", rarity: "Uncommon", set: { code: "welcometonightcitybeta", name: "Welcome to Night City — Beta" }, source_image_url: "https://dstcynss47vun.cloudfront.net/prod/cyberpunk/portal/32f8d89a-1e4b-46b8-9323-77c297c5b5ae/render-mpv4pd73.webp" }
    ],
    ram: 3,
    rarity: "Uncommon",
    rules_text: "{Play} Draw 2.\n(Units with power 0 don't steal Gigs.)",
    selected_printing_id: "c7eba3a0-63cb-4311-988e-d487a7c0841a",
    set: { code: "welcometonightcityretail", name: "Welcome to Night City — Retail" },
    slug: DELAMAIN_RIDESHARE,
    source_image_url: "https://dstcynss47vun.cloudfront.net/prod/cyberpunk/portal/c7eba3a0-63cb-4311-988e-d487a7c0841a/render-mpvm49le.webp",
    subname: "Rideshare AI"
} as const;

export const delamainRideshare = CardRevisionSnapshotSchema.parse({
    schemaVersion: 2,
    id: source.slug,
    revision: 1,
    status: "ACTIVE",
    cardNumber: source.print_number,
    name: source.name,
    subtitle: source.subname,
    displayName: source.display_name,
    deckbuildingIdentity: source.name,
    type: "UNIT",
    colors: ["BLUE"],
    ram: { BLUE: source.ram },
    power: source.power,
    setCode: source.set.code,
    setName: source.set.name,
    printedCost: { kind: "EDDIES", amount: source.cost },
    sellProfile: { allowed: source.is_eddiable, baseEddieValue: 1 },
    rulesText: source.rules_text,
    sourceMarkup: source.rules_text,
    tags: source.classifications,
    keywords: [],
    execution: { scope: "NONCOMBAT_PLAY_V1", status: "SUPPORTED" },
    mechanics: {
        keywords: [],
        modifiers: [],
        abilities: [{
            id: "delamain-rideshare-play-draw@1",
            trigger: "WHEN_PLAYED",
            cost: { kind: "NONE" },
            conditions: [],
            effects: [{ kind: "DRAW", count: 2 }]
        }]
    },
    printings: source.printings.map(p => ({ id: p.id, setCode: p.set.code, collectorNumber: p.collector_number, source: "cyberpunk_tcg_ai/data/raw/cards/delamain-rideshare-ai.json" })),
    provenance: {
        source: "cyberpunk_tcg_ai/data/raw/cards/delamain-rideshare-ai.json (API Content Bridge V1 admission)",
        sourceHash: hashCanonical(source),
        effectiveAt: "2026-09-12",
        errata: [],
        reviewed: true
    }
});

function context() {
    const base = noncombatContext();
    const blueBase = base.content.cards.find(card => card.id === "dev-legend-blue");
    assert.ok(blueBase);
    const blueSupport = CardRevisionSnapshotSchema.parse({
        ...blueBase,
        schemaVersion: 2,
        id: BLUE_SUPPORT,
        revision: 1,
        status: "ACTIVE",
        name: "API Admission Blue Support",
        subtitle: "",
        displayName: "API Admission Blue Support",
        deckbuildingIdentity: BLUE_SUPPORT,
        ram: { BLUE: 3 },
        execution: { scope: "NONCOMBAT_SLICE_V1", status: "SUPPORTED" },
        printings: [{ id: "api-admission-blue-support-print", setCode: "DEV", collectorNumber: "A01", source: "Synthetic test support" }],
        provenance: {
            source: "Synthetic Blue RAM 3 support Legend for API admission test; not a real card",
            sourceHash: hashCanonical({ fixture: BLUE_SUPPORT, ram: 3 }),
            effectiveAt: "2026-09-13",
            errata: [],
            reviewed: true
        }
    });
    return { content: createContentBundle(base.content.ruleset, [...base.content.cards, blueSupport, delamainRideshare], base.content.manifest.engine) };
}

function assertRejected(candidate: unknown, ctx: ReturnType<typeof context>) {
    const parsed = CardRevisionSnapshotSchema.parse(candidate);
    assert.equal(supportsPlay(parsed, ctx).ok, false);
}

test("API Admission Batch V1 pins Delamain Rideshare source facts and admits simple play-draw semantics", () => {
    const ctx = context();
    assert.equal(delamainRideshare.provenance.sourceHash, hashCanonical(source));
    assert.equal(delamainRideshare.rulesText, source.rules_text);
    assert.deepEqual(delamainRideshare.mechanics.abilities[0].effects, [{ kind: "DRAW", count: 2 }]);
    assert.equal(supportsPlay(delamainRideshare, ctx).ok, true);
});

test("simple play-draw admission fails closed if review or semantic shape changes", () => {
    const ctx = context();
    const ability = delamainRideshare.mechanics.abilities[0];
    assert.ok(ability);

    assertRejected({ ...delamainRideshare, provenance: { ...delamainRideshare.provenance, reviewed: false } }, ctx);
    assertRejected({
        ...delamainRideshare,
        mechanics: { ...delamainRideshare.mechanics, abilities: [{ ...ability, trigger: undefined }] }
    }, ctx);
    assertRejected({
        ...delamainRideshare,
        mechanics: { ...delamainRideshare.mechanics, abilities: [{ ...ability, effects: [{ kind: "DRAW", count: 1 }] }] }
    }, ctx);
    assertRejected({
        ...delamainRideshare,
        mechanics: { ...delamainRideshare.mechanics, abilities: [{ ...ability, conditions: [{ kind: "GIG_COUNT", minimum: 1 }] }] }
    }, ctx);
});

test("authoritative game initialization accepts the admitted API-driven revision in a RAM-legal deck", () => {
    const ctx = context();
    const input = noncombatInput("api-admission-batch-v1");
    input.decks = input.decks.map(deck => ({
        ...deck,
        legends: deck.legends.map(id => id === "dev-legend-red" ? BLUE_SUPPORT : id),
        main: deck.main.map(id => id === AFTERPARTY ? DELAMAIN_RIDESHARE : id)
    }));
    const created = createGameWithEvents(input, ctx);
    assert.equal(created.ok, true, created.ok ? undefined : JSON.stringify(created.errors));
    if (created.ok) assert.ok(Object.values(created.value.state.objects.cards).some(c => c.cardId === DELAMAIN_RIDESHARE));
});
