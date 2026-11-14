import { readFileSync } from "node:fs";
import { z } from "zod";
import { DeckSchema, type Deck } from "@tcg/domain";
import { demoStarterContext, demoStarterInput } from "./demo-starter-fixture";

// CONSTRUCTED games on the reviewed executable revisions (plan section 6, scope 2).
// The engine already initializes and plays CONSTRUCTED decks under the reviewed
// turn-slice ruleset; this fixture only supplies decks and a createGame input.
// Rule 7.5.1 lets players agree on any random method for the first player, so the
// constructed path's seeded two-way draw is rules-compliant; Demo keeps OPPOSED_D20.

const DeckEntrySchema = z.strictObject({ cardId: z.string().min(1), quantity: z.number().int().positive() });
/** A deck file: `main` lists either slugs (one per copy) or {cardId, quantity} entries. */
export const DeckFileSchema = z.object({
    decks: z.array(z.object({
        id: z.string().min(1).optional(),
        legends: z.array(z.string().min(1)),
        main: z.union([z.array(z.string().min(1)), z.array(DeckEntrySchema)])
    })).length(2)
});
export type DeckFile = z.infer<typeof DeckFileSchema>;

export function readDeckFile(path: string): DeckFile {
    return DeckFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
function expand(main: DeckFile["decks"][number]["main"]): string[] {
    return main.flatMap(e => typeof e === "string" ? [e] : Array.from({ length: e.quantity }, () => e.cardId));
}
export const constructedReferenceDecksPath = new URL("./fixtures/constructed-reference-decks.v1.json", import.meta.url);
export function constructedReferenceDecks(): DeckFile {
    return readDeckFile(constructedReferenceDecksPath.pathname);
}
export function constructedDeck(deck: DeckFile["decks"][number]): Deck {
    const counts = new Map<string, number>();
    for (const id of expand(deck.main)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return DeckSchema.parse({ name: deck.id ?? "constructed", legends: deck.legends, cards: [...counts].map(([cardId, quantity]) => ({ cardId, quantity })) });
}
/** The reviewed content (every executable revision) and its turn-slice ruleset. */
export function constructedContext() {
    return demoStarterContext();
}
/** A createGame input for two CONSTRUCTED decks; players and matchId as in the Demo input. */
export function constructedInput(seed: string, file: DeckFile = constructedReferenceDecks()) {
    const { matchId, players } = demoStarterInput(seed);
    return { matchId, players, seed, format: "CONSTRUCTED" as const,
        decks: file.decks.map(d => ({ legends: [...d.legends], main: expand(d.main) })) };
}
