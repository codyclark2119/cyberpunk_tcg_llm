import type { Card, CardColor } from "./card";

import { z } from "zod";
import { CardIdSchema, DeckIdSchema } from "./identity";
import type { Ruleset } from "./ruleset";
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
  if (!source) return;
  for (const [color, amount] of Object.entries(source) as [CardColor, number][]) {
    target[color] = (target[color] ?? 0) + amount;
  }
}

export function validateDeck(deck: Deck, cardPool: readonly Card[], ruleset: Ruleset): DeckValidationResult {
  const byId = new Map(cardPool.map((card) => [card.id, card]));
  const issues: DeckValidationIssue[] = [];
  const mainDeckCount = deck.cards.reduce((sum, entry) => sum + entry.quantity, 0);

  if (deck.legends.length !== ruleset.deckbuilding.legendCount || new Set(deck.legends).size !== ruleset.deckbuilding.legendCount) {
    issues.push({ code: "LEGEND_COUNT", severity: "error", message: `Decks must contain exactly ${ruleset.deckbuilding.legendCount} unique Legends.` });
  }

  if (mainDeckCount < ruleset.deckbuilding.mainDeck.min || mainDeckCount > ruleset.deckbuilding.mainDeck.max) {
    issues.push({ code: "MAIN_DECK_SIZE", severity: "error", message: `Main deck must contain ${ruleset.deckbuilding.mainDeck.min}–${ruleset.deckbuilding.mainDeck.max} cards; this deck contains ${mainDeckCount}.` });
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
  for (const entry of deck.cards) quantities.set(entry.cardId, (quantities.get(entry.cardId) ?? 0) + entry.quantity);
  for (const [cardId, quantity] of quantities) {
    const entry = { cardId, quantity };
    const card = byId.get(entry.cardId);
    if (!card) {
      issues.push({ code: "UNKNOWN_CARD", severity: "error", cardId: entry.cardId, message: `Unknown card: ${entry.cardId}` });
      continue;
    }
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > ruleset.deckbuilding.maxCopies) {
      issues.push({ code: "COPY_LIMIT", severity: "error", cardId: card.id, message: `${card.name} must have between 1 and ${ruleset.deckbuilding.maxCopies} copies.` });
    }
    if (card.type === "LEGEND") {
      issues.push({ code: "LEGEND_IN_MAIN", severity: "error", cardId: card.id, message: `${card.name} belongs in the Legend zone, not the main deck.` });
    }
    for (const color of card.colors) {
      if (color !== "NEUTRAL") ramRequired[color] = Math.max(ramRequired[color] ?? 0, card.ram?.[color] ?? 0);
    }
  }

  for (const [color, required] of Object.entries(ramRequired) as [CardColor, number][]) {
    const available = ramAvailable[color] ?? 0;
    if (required > available) {
      issues.push({ code: "RAM_LIMIT", severity: "error", message: `${color} RAM requires ${required}, but your Legends provide ${available}.` });
    }
  }

  return { legal: !issues.some((issue) => issue.severity === "error"), mainDeckCount, ramAvailable, ramRequired, issues };
}
