import { GraphQLError } from "graphql";
import { CARD_COLORS, CardIdSchema, DeckSchema, validateDeck, type CardColor } from "@tcg/domain";
import { PageInputSchema, encodeCursor, decodeCursor } from "./pagination";
import type { Resolvers } from "./generated/server";
function input<T>(parse: () => T): T {
  try { return parse(); } catch { throw new GraphQLError("Invalid request input or pagination cursor", { extensions: { code: "BAD_USER_INPUT" } }); }
}
function ramToList(ram?: Partial<Record<CardColor, number>>) {
  return CARD_COLORS.flatMap((color) => {
    const amount = ram?.[color];
    return amount === undefined ? [] : [{ color, amount }];
  });
}
export const resolvers: Resolvers = {
  Query: {
    apiVersion: () => "0.3.0-phase1",
    cards: async (_parent, args, context) => {
      const page = input(() => PageInputSchema.parse(args));
      const cursor = page.after;
      const afterId = cursor ? input(() => decodeCursor(cursor, page.filter)) : undefined;
      const result = await context.cards.list({ first: page.first, afterId, filter: page.filter ?? undefined });
      const edges = result.cards.map((node) => ({ cursor: encodeCursor(node.id, page.filter), node }));
      return { edges, pageInfo: { hasNextPage: result.hasNextPage, endCursor: edges.at(-1)?.cursor ?? null } };
    },
    card: (_parent, args, context) => context.cards.findById(input(() => CardIdSchema.parse(args.id)))
  },
  Card: { ram: (card) => ramToList(card.ram) },
  Mutation: {
    validateDeck: async (_parent, args, context) => {
      const deck = input(() => DeckSchema.parse({ name: args.input.name, legends: args.input.legendIds, cards: args.input.cards }));
      const ruleset = await context.rulesets.findVersion(context.rulesetId, context.rulesetVersion);
      if (!ruleset) throw new GraphQLError("Configured ruleset is missing. Run npm run mongo:seed for development content.", { extensions: { code: "CONTENT_NOT_FOUND" } });
      const cards = await context.cards.findByIds([...deck.legends, ...deck.cards.map((entry) => entry.cardId)]);
      const result = validateDeck(deck, cards, ruleset);
      return { ...result, ramAvailable: ramToList(result.ramAvailable), ramRequired: ramToList(result.ramRequired) };
    }
  }
};
