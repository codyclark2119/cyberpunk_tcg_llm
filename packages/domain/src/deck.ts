import { matchDemoManifest } from "./demo";
import type { Card, CardColor } from "./card";
import { z } from "zod";
import { CardIdSchema, DeckIdSchema } from "./identity";
import type { Ruleset, DeckFormat } from "./ruleset";
export const DeckSchema = z.strictObject({
    id: DeckIdSchema.optional(), name: z.string().trim().min(1).max(200),
    legends: z.array(CardIdSchema).max(1000),
    cards: z.array(z.strictObject({ cardId: CardIdSchema, quantity: z.number().int().positive() })).max(10000)
});
export type Deck = z.infer<typeof DeckSchema>;
export type DeckCard = Deck["cards"][number];
export type DeckValidationIssue = {
    code: string;
    message: string;
    severity: "error" | "warning";
    cardId?: string;
};
export type DeckValidationResult = {
    legal: boolean;
    mainDeckCount: number;
    ramAvailable: Partial<Record<CardColor, number>>;
    ramRequired: Partial<Record<CardColor, number>>;
    issues: DeckValidationIssue[];
};
function addRam(target: Partial<Record<CardColor, number>>, source?: Partial<Record<CardColor, number>>) {
    if (!source)
        return;
    for (const [color, amount] of Object.entries(source) as [
        CardColor,
        number
    ][]) {
        target[color] = (target[color] ?? 0) + amount;
    }
}
export type AvailableCard = {
    cardId: DeckCard["cardId"];
    quantity: number;
};
export type DeckbuildingContext = {
    format: DeckFormat;
    ruleset: Ruleset;
    availability: {
        kind: "CATALOG";
    } | {
        kind: "OWNED" | "SEALED";
        cards: readonly AvailableCard[];
    };
};
export function validateDeck(deck: Deck, cardPool: readonly Card[], ruleset: Ruleset, options?: Omit<DeckbuildingContext, "ruleset">): DeckValidationResult {
    const format = options?.format ?? "CONSTRUCTED";
    const policy = ruleset.formats?.[format] ?? (format === "CONSTRUCTED" && ruleset.schemaVersion === 1 ? { ...ruleset.deckbuilding, legendUniqueness: "CARD_ID" as const } : undefined);
    if (!policy)
        return { legal: false, mainDeckCount: 0, ramAvailable: {}, ramRequired: {}, issues: [{ code: "UNSUPPORTED_FORMAT", message: "Ruleset has no policy for this format", severity: "error" }] };
    const byId = new Map(cardPool.map((card) => [card.id, card]));
    const issues: DeckValidationIssue[] = [];
    if (format === "DEMO_STARTER_V1" && (!ruleset.demoStarter || !matchDemoManifest(deck, cardPool)))
        issues.push({ code: "DEMO_MANIFEST_MISMATCH", severity: "error", message: "Demo requires an exact supported ARASAKA_DEMO_V1 or MERC_DEMO_V1 composition and revision pins" });
    if (policy.legendUniqueness === "DECKBUILDING_IDENTITY" && deck.legends.some(id => byId.get(id)?.schemaVersion !== 2))
        issues.push({ code: "MISSING_DECKBUILDING_IDENTITY", severity: "error", message: "This format requires reviewed card identities" });
    if (format === "SEALED_LIMITED" && options?.availability.kind !== "SEALED")
        issues.push({ code: "SEALED_POOL_REQUIRED", severity: "error", message: "Sealed requires a quantity-constrained sealed pool" });
    if (options && options.availability.kind !== "CATALOG") {
        const available = new Map<string, number>();
        for (const entry of options.availability.cards) {
            if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0 || available.has(entry.cardId))
                issues.push({ code: "INVALID_POOL", severity: "error", message: "Pool must contain unique IDs and nonnegative integer quantities" });
            available.set(entry.cardId, entry.quantity);
        }
        const used = new Map<string, number>();
        for (const id of deck.legends)
            used.set(id, (used.get(id) ?? 0) + 1);
        for (const entry of deck.cards)
            used.set(entry.cardId, (used.get(entry.cardId) ?? 0) + entry.quantity);
        for (const [id, count] of used)
            if (count > (available.get(id) ?? 0))
                issues.push({ code: "POOL_LIMIT", severity: "error", cardId: id, message: "Deck exceeds available copies" });
    }
    const mainDeckCount = deck.cards.reduce((sum, entry) => sum + entry.quantity, 0);
    if (deck.legends.length !== policy.legendCount || new Set(deck.legends.map(id => { const c = byId.get(id); return policy.legendUniqueness === "DECKBUILDING_IDENTITY" && c?.schemaVersion === 2 ? c.deckbuildingIdentity : id; })).size !== policy.legendCount) {
        issues.push({ code: "LEGEND_COUNT", severity: "error", message: `Decks must contain exactly ${policy.legendCount} unique Legends.` });
    }
    if (mainDeckCount < policy.mainDeck.min || mainDeckCount > policy.mainDeck.max) {
        issues.push({ code: "MAIN_DECK_SIZE", severity: "error", message: `Main deck must contain ${policy.mainDeck.min}–${policy.mainDeck.max} cards; this deck contains ${mainDeckCount}.` });
    }
    const ramAvailable: Partial<Record<CardColor, number>> = {};
    for (const legendId of deck.legends) {
        const legend = byId.get(legendId);
        if (!legend) {
            issues.push({ code: "UNKNOWN_LEGEND", severity: "error", cardId: legendId, message: `Unknown Legend: ${legendId}` });
            continue;
        }
        if (legend.type !== "LEGEND") {
            issues.push({ code: "NOT_A_LEGEND", severity: "error", cardId: legend.id, message: `${legend.name} is not a Legend.` });
        }
        addRam(ramAvailable, legend.ram);
    }
    const ramRequired: Partial<Record<CardColor, number>> = {};
    const quantities = new Map<DeckCard["cardId"], number>();
    for (const entry of deck.cards)
        quantities.set(entry.cardId, (quantities.get(entry.cardId) ?? 0) + entry.quantity);
    for (const [cardId, quantity] of quantities) {
        const entry = { cardId, quantity };
        const card = byId.get(entry.cardId);
        if (!card) {
            issues.push({ code: "UNKNOWN_CARD", severity: "error", cardId: entry.cardId, message: `Unknown card: ${entry.cardId}` });
            continue;
        }
        if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > policy.maxCopies) {
            issues.push({ code: "COPY_LIMIT", severity: "error", cardId: card.id, message: `${card.name} must have between 1 and ${policy.maxCopies} copies.` });
        }
        if (card.type === "LEGEND") {
            issues.push({ code: "LEGEND_IN_MAIN", severity: "error", cardId: card.id, message: `${card.name} belongs in the Legend zone, not the main deck.` });
        }
        for (const color of card.colors) {
            if (color !== "NEUTRAL")
                ramRequired[color] = Math.max(ramRequired[color] ?? 0, card.ram?.[color] ?? 0);
        }
    }
    for (const [color, required] of Object.entries(ramRequired) as [
        CardColor,
        number
    ][]) {
        const available = ramAvailable[color] ?? 0;
        if (required > available) {
            issues.push({ code: "RAM_LIMIT", severity: "error", message: `${color} RAM requires ${required}, but your Legends provide ${available}.` });
        }
    }
    return { legal: !issues.some((issue) => issue.severity === "error"), mainDeckCount, ramAvailable, ramRequired, issues };
}
