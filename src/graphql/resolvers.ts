import { getCardRepository } from "@/data-access/cards";
import type { Card, CardColor } from "@/domain/card";
import { validateDeck } from "@/domain/deck";

type CardFilterInput = {
  search?: string | null;
  type?: Card["type"] | null;
  color?: CardColor | null;
  setCode?: string | null;
};

type ValidateDeckInput = {
  name: string;
  legendIds: string[];
  cards: { cardId: string; quantity: number }[];
};

function ramToList(ram?: Partial<Record<CardColor, number>>) {
  return Object.entries(ram ?? {}).map(([color, amount]) => ({ color, amount }));
}

export const resolvers = {
  Query: {
    apiVersion: () => "0.3.0-hybrid-storage",
    cards: async (_parent: unknown, args: { filter?: CardFilterInput }) => {
      return getCardRepository().find(args.filter);
    },
    card: async (_parent: unknown, args: { id: string }) => {
      return getCardRepository().findById(args.id);
    }
  },
  Card: {
    ram: (card: Card) => ramToList(card.ram)
  },
  Mutation: {
    validateDeck: async (_parent: unknown, args: { input: ValidateDeckInput }) => {
      const ids = [
        ...args.input.legendIds,
        ...args.input.cards.map((entry) => entry.cardId)
      ];
      const cardPool = await getCardRepository().findByIds(ids);

      const result = validateDeck(
        {
          name: args.input.name,
          legends: args.input.legendIds,
          cards: args.input.cards
        },
        cardPool
      );

      return {
        ...result,
        ramAvailable: ramToList(result.ramAvailable),
        ramRequired: ramToList(result.ramRequired)
      };
    }
  }
};
