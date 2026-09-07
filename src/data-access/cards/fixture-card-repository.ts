import { cards } from "@/data/cards";
import type { CardFilter, CardRepository, VersionedCard } from "./types";

const versionedCards: VersionedCard[] = cards.map((card) => ({
  ...card,
  schemaVersion: 1,
  revision: 1,
  status: "ACTIVE"
}));

export class FixtureCardRepository implements CardRepository {
  async find(filter?: CardFilter) {
    if (!filter) return versionedCards;
    const search = filter.search?.trim().toLowerCase();

    return versionedCards.filter((card) => {
      if (filter.type && card.type !== filter.type) return false;
      if (filter.color && !card.colors.includes(filter.color)) return false;
      if (filter.setCode && card.setCode !== filter.setCode) return false;
      if (
        search &&
        !card.name.toLowerCase().includes(search) &&
        !card.cardNumber.toLowerCase().includes(search) &&
        !card.rulesText.toLowerCase().includes(search) &&
        !card.tags.some((tag) => tag.toLowerCase().includes(search))
      ) return false;
      return true;
    });
  }

  async findById(id: string) {
    return versionedCards.find((card) => card.id === id) ?? null;
  }

  async findByIds(ids: string[]) {
    const wanted = new Set(ids);
    return versionedCards.filter((card) => wanted.has(card.id));
  }
}
