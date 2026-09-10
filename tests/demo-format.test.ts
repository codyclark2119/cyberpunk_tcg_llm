import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CardIdSchema, CardRevisionSchema, ContentBundleSchema, DeckFormatSchema, DeckSchema, hashCanonical, validateDeck } from "@tcg/domain";
import { CreateGameInputSchema, createGameWithEvents } from "@tcg/engine";
import { handleRequest } from "@tcg/wire";
import { attackPowerContext, attackPowerInput } from "./attack-condition-power-fixture";
import { DemoReferenceManifestSchema, demoReferences, demoReferenceContext, referenceCompositionHash, referenceDeck, referenceInput } from "./demo-format-fixture";
import sources from "./fixtures/demo-format-sources.v1.json";
import prior from "./fixtures/attack-condition-power-replay.v1.json";
const context = demoReferenceContext(), full = attackPowerContext();
const count = (m: typeof demoReferences[number], zone: "MAIN" | "LEGENDS") => m.entries.filter(e => e.zone === zone).reduce((n, e) => n + e.quantity, 0);
const validate = (deck: ReturnType<typeof referenceDeck>) => validateDeck(deck, context.content.cards, context.content.ruleset, { format: "CONSTRUCTED", availability: { kind: "CATALOG" } });
const codes = (deck: ReturnType<typeof referenceDeck>) => validate(deck).issues.map(i => i.code);

for (const [i, manifest] of demoReferences.entries()) {
    test(manifest.id + " preserves exact physical quantities, unique rows and immutable reference status", () => {
        assert.equal(manifest.status, "REFERENCE_ONLY"); assert.ok(Object.isFrozen(manifest.entries[0]));
        assert.equal(count(manifest, "MAIN"), 27); assert.equal(count(manifest, "LEGENDS"), 3);
        assert.equal(new Set(manifest.entries.map(e => e.cardId)).size, i === 0 ? 14 : 15);
        assert.deepEqual(manifest.entries.filter(e => e.zone === "MAIN").map(e => e.quantity), i === 0 ? [1,2,3,3,3,2,3,3,3,1,3] : [2,1,2,3,2,2,3,3,1,3,3,2]);
    });
    test(manifest.id + " matches independently audited PDF page/slot counts and collectors", () => {
        const slots = manifest.provenance.physicalSlots;
        assert.equal(new Set(slots.map(s => `${s.pdfPage}:${s.slot}`)).size, 30);
        assert.deepEqual([1,2,3,4].map(p => slots.filter(s => s.pdfPage === p).length), [9,9,9,3]);
        for (const entry of manifest.entries) {
            const matches = slots.filter(s => s.cardId === entry.cardId);
            assert.equal(matches.length, entry.quantity);
            assert.ok(matches.every(s => s.zone === entry.zone && s.collectorNumber === entry.printing.collectorNumber));
        }
        assert.equal(manifest.provenance.sha256, sources.sources.find(s => s.file === manifest.provenance.sourceId)?.sha256);
    });
    test(manifest.id + " round trips canonical composition, presentation order and split entries", () => {
        const copy = DemoReferenceManifestSchema.parse(JSON.parse(JSON.stringify(manifest)));
        assert.equal(referenceCompositionHash(copy), manifest.compositionHash);
        copy.entries.reverse(); copy.provenance.physicalSlots.reverse();
        assert.equal(referenceCompositionHash(copy), manifest.compositionHash);
        const entry = copy.entries.find(e => e.quantity > 1)!;
        entry.quantity--; copy.entries.push({ ...entry, quantity: 1 });
        assert.equal(referenceCompositionHash(copy), manifest.compositionHash);
    });
    for (const field of ["quantity", "cardId", "revision", "zone", "legend"] as const) test(manifest.id + " composition identity changes with " + field, () => {
        const copy = DemoReferenceManifestSchema.parse(manifest), entry = copy.entries.find(e => e.zone === "MAIN")!;
        if (field === "quantity") entry.quantity++;
        if (field === "cardId") entry.cardId = CardIdSchema.parse("another-card");
        if (field === "revision") entry.revision = CardRevisionSchema.parse(2);
        if (field === "zone") entry.zone = "LEGENDS";
        if (field === "legend") copy.entries.find(e => e.zone === "LEGENDS")!.cardId = CardIdSchema.parse("another-legend");
        assert.notEqual(referenceCompositionHash(copy), manifest.compositionHash);
    });
    test(manifest.id + " printing provenance is separate from gameplay composition", () => {
        const copy = DemoReferenceManifestSchema.parse(manifest); copy.entries[0].printing.collectorNumber = "999";
        assert.equal(referenceCompositionHash(copy), manifest.compositionHash);
        assert.notEqual(hashCanonical(copy), hashCanonical(manifest));
    });
    test(manifest.id + " rejects both default and explicit constructed solely for 27 main", () => {
        const deck = referenceDeck(manifest), explicit = validate(deck), implicit = validateDeck(deck, context.content.cards, context.content.ruleset);
        assert.deepEqual(explicit, implicit); assert.equal(explicit.legal, false); assert.equal(explicit.mainDeckCount, 27);
        assert.deepEqual(explicit.issues.map(e => e.code), ["MAIN_DECK_SIZE"]);
        assert.match(explicit.issues[0].message, /40.*50/);
        assert.deepEqual(explicit.ramAvailable, i === 0 ? { GREEN: 4, RED: 2 } : { BLUE: 4, YELLOW: 2 });
        assert.deepEqual(explicit.ramRequired, i === 0 ? { GREEN: 3, RED: 2 } : { BLUE: 3, YELLOW: 2 });
    });
    for (const size of [26,28]) test(manifest.id + " " + size + " main never auto-selects a small format", () => {
        const deck = referenceDeck(manifest); deck.cards[0].quantity += size - 27;
        deck.cards = deck.cards.filter(e => e.quantity > 0);
        const result = validate(deck); assert.equal(result.mainDeckCount, size); assert.ok(result.issues.some(e => e.code === "MAIN_DECK_SIZE"));
    });
    for (const size of [2,4]) test(manifest.id + " constructed rejects " + size + " Legends", () => {
        const deck = referenceDeck(manifest); deck.legends = size === 2 ? deck.legends.slice(0,2) : [...deck.legends, deck.legends[0]];
        assert.ok(codes(deck).includes("LEGEND_COUNT"));
    });
    test(manifest.id + " constructed catches split four-copy entries while preserving 27", () => {
        const deck = referenceDeck(manifest), entry = deck.cards.find(e => e.quantity === 3)!;
        deck.cards.push({ cardId: entry.cardId, quantity: 1 }); deck.cards[0].quantity--;
        deck.cards = deck.cards.filter(e => e.quantity > 0);
        assert.equal(validate(deck).mainDeckCount, 27); assert.ok(codes(deck).includes("COPY_LIMIT"));
    });
    test(manifest.id + " constructed rejects wrong areas, duplicate Legend identity and unknown CardId", () => {
        const deck = referenceDeck(manifest); deck.cards[0].cardId = deck.legends[0];
        assert.ok(codes(deck).includes("LEGEND_IN_MAIN"));
        deck.legends[0] = referenceDeck(manifest).cards[0].cardId; assert.ok(codes(deck).includes("NOT_A_LEGEND"));
        deck.legends[0] = deck.legends[1]; assert.ok(codes(deck).includes("LEGEND_COUNT"));
        deck.cards[0].cardId = CardIdSchema.parse("unknown-reference"); assert.ok(codes(deck).includes("UNKNOWN_CARD"));
    });
}
test("coverage resolves all 29 real immutable revisions and all 60 copies without filler", () => {
    const entries = demoReferences.flatMap(m => m.entries);
    assert.equal(new Set(entries.map(e => e.cardId)).size, 29); assert.equal(entries.reduce((n,e) => n + e.quantity, 0), 60);
    assert.equal(context.content.cards.length, 29);
    for (const entry of entries) {
        const card = context.content.cards.find(c => c.id === entry.cardId && c.revision === entry.revision);
        assert.ok(card, entry.cardId); assert.equal(card.execution?.status, "SUPPORTED"); assert.ok(card.provenance.reviewed);
        assert.equal(hashCanonical(card), entry.revisionHash);
        const printing = card.printings.find(p => p.id === entry.printing.applicationPrintingId);
        assert.ok(printing); assert.equal(printing.setCode, entry.printing.setCode); assert.equal(printing.collectorNumber, entry.printing.collectorNumber);
    }
    assert.equal(entries.find(e => e.cardId === "psycho-squad")?.quantity, 3);
    assert.deepEqual(entries.filter(e => e.printing.id !== e.printing.applicationPrintingId).map(e => [e.cardId, e.printing.id, e.printing.applicationPrintingId]), [["viktor-vektor-sit-down-and-relax", "2344e8d6-3aed-415b-ab6e-f1d634b5ba18", "viktor-vektor-sit-down-and-relax-printing-2"]]);
});
test("all physical roadmap rows agree by deck and collector without changing user quantities", () => {
    const rows = readFileSync("docs/demo-deck-coverage-roadmap.md", "utf8").split("\n").filter(l => /^\|.*\| (Arasaka|Mercs) \|/.test(l));
    assert.equal(rows.length, 29);
    for (const row of rows) {
        const cells = row.split("|").map(c => c.trim());
        const manifest = demoReferences[cells[2] === "Arasaka" ? 0 : 1], number = /demo (\d+)/.exec(cells[4])?.[1];
        assert.ok(number); const entry = manifest.entries.find(e => e.printing.collectorNumber === number);
        assert.ok(entry); assert.equal(entry.quantity, Number(cells[3]));
    }
});
test("real-only bundle round trips and 53 revisions/constructed ruleset agree under current engine pins", () => {
    assert.equal(context.content.manifestHash, demoReferenceContext().content.manifestHash);
    assert.deepEqual(ContentBundleSchema.parse(JSON.parse(JSON.stringify(context.content))), context.content);
    assert.equal(full.content.cards.length, 53); assert.deepEqual(full.content, ContentBundleSchema.parse(prior.content));
    assert.deepEqual(context.content.ruleset, prior.content.ruleset); assert.deepEqual(context.content.manifest.engine, prior.content.manifest.engine);
    assert.deepEqual(context.content.ruleset.formats?.CONSTRUCTED, { mainDeck: { min: 40, max: 50 }, legendCount: 3, maxCopies: 3, legendUniqueness: "DECKBUILDING_IDENTITY" });
});
test("size-preserving Merc RAM mutation fails without adding a teaching waiver", () => {
    const deck = referenceDeck(demoReferences[1]); deck.cards[0].cardId = CardIdSchema.parse("field-operator");
    const result = validate(deck); assert.equal(result.mainDeckCount, 27); assert.ok(result.issues.some(e => e.code === "RAM_LIMIT"));
    assert.equal(result.issues.some(e => e.code === "COPY_LIMIT"), false);
});
for (const format of [undefined, "CONSTRUCTED"] as const) test("public initializer rejects exact decks with " + (format ?? "missing format"), () => {
    const result = createGameWithEvents({ ...referenceInput(), ...(format ? { format } : {}) }, context);
    assert.equal(result.ok, false); if (result.ok) assert.fail("27-card constructed initialization admitted");
    assert.ok(result.errors.some(e => e.code === "INVALID_DECK" && e.message.includes("MAIN_DECK_SIZE")));
});
for (const format of ["DEMO_STARTER", "DEMO_STARTER_V2", "unknown-format"]) test("unknown format fails closed at domain, initialization and wire: " + format, () => {
    assert.equal(DeckFormatSchema.safeParse(format).success, false);
    const initialization = { ...referenceInput(), format };
    assert.equal(CreateGameInputSchema.safeParse(initialization).success, false);
    const response = handleRequest({ schemaVersion: 1, requestId: "demo-negative", op: "createGame", initialization, content: context.content });
    assert.equal(response.ok, false); if (response.ok) assert.fail("unsupported format admitted");
    assert.equal(response.errors[0].code, "INVALID_REQUEST");
    const support = handleRequest({ schemaVersion: 1, requestId: "support-negative", op: "createGame", initialization: { ...attackPowerInput("support"), format }, content: full.content });
    assert.equal(support.ok, false);
});
test("unknown manifest and policy fields reject instead of being ignored", () => {
    assert.equal(DemoReferenceManifestSchema.safeParse({ ...demoReferences[0], id: "UNKNOWN_DEMO_V1" }).success, false);
    assert.equal(DemoReferenceManifestSchema.safeParse({ ...demoReferences[0], schemaVersion: 2 }).success, false);
    for (const field of [{ demoManifest: "ARASAKA_DEMO_V1" }, { formatPolicyVersion: "DEMO_STARTER_V1" }]) {
        const response = handleRequest({ schemaVersion: 1, requestId: "extra-negative", op: "createGame", content: full.content, initialization: { ...attackPowerInput("support"), ...field } });
        assert.equal(response.ok, false);
    }
});
test("existing 42-main/3-Legend constructed support validates and initializes unchanged", () => {
    const input = attackPowerInput("support");
    for (const d of input.decks) {
        assert.equal(d.main.length, 42); assert.equal(d.legends.length, 3);
        const deck = DeckSchema.parse({ name: "support", legends: d.legends, cards: d.main.map(cardId => ({ cardId, quantity: 1 })) });
        assert.ok(validateDeck(deck, full.content.cards, full.content.ruleset).legal);
    }
    const implicit = createGameWithEvents(input, full), explicit = createGameWithEvents({ ...input, format: "CONSTRUCTED" }, full);
    assert.ok(implicit.ok); assert.deepEqual(explicit, implicit);
    assert.equal(implicit.value.state.timing.turn, 0); assert.equal(implicit.value.state.timing.step, "CHOOSE_FIRST_PLAYER");
});
test("source review pins positive direct play separately from the unresolved ordered setup", () => {
    assert.equal(sources.directPlay, "CONFIRMED"); assert.equal(sources.status, "NOT_ADMITTED"); assert.equal(sources.rules.length, 88);
    assert.equal(sources.localRules.nodeCount, 713); assert.ok(sources.localRules.liveParsedEquality);
    assert.match(sources.rules.find(r => r.display_number === "7.3")!.body_markdown, /40-50/);
    assert.match(sources.rules.find(r => r.display_number === "7.4")!.body_markdown, /listed order/);
    assert.equal(sources.decisions.find(d => d.topic === "setupOrder")?.result, "UNRESOLVED_CONFLICT");
    assert.equal(sources.decisions.find(d => d.topic === "overtime")?.result, "REQUIRED_BUT_ENGINE_UNSUPPORTED");
    for (const source of sources.sources) assert.match(source.sha256, /^[0-9a-f]{64}$/);
});
