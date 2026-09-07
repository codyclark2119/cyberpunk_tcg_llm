import type { Card, CardColor, CardType } from "@/domain/card";

export type CardStatus = "ACTIVE" | "PREVIEW" | "RETIRED";

/**
 * Mongo source document.
 *
 * `index` is the intentionally small, stable projection we index and filter on.
 * `data` is allowed to evolve while the game is in beta. New mechanics can be
 * added without a PostgreSQL migration or immediately widening the GraphQL API.
 */
export type CardDocument = {
  _id: string;
  schemaVersion: number;
  revision: number;
  status: CardStatus;
  index: {
    cardNumber: string;
    name: string;
    type: CardType;
    colors: CardColor[];
    setCode: string;
    setName: string;
    rarity?: string;
    searchText?: string;
  };
  data: {
    cost?: number;
    power?: number;
    ram?: Partial<Record<CardColor, number>>;
    rulesText?: string;
    flavorText?: string;
    tags?: string[];
    keywords?: string[];
    imageUrl?: string;
    [futureField: string]: unknown;
  };
  ruleset?: {
    id: string;
    minVersion?: string;
    maxVersion?: string;
  };
  source?: {
    externalId?: string;
    url?: string;
    importedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
};

export type CardFilter = {
  search?: string | null;
  type?: CardType | null;
  color?: CardColor | null;
  setCode?: string | null;
};

export type VersionedCard = Card & {
  schemaVersion: number;
  revision: number;
  status: CardStatus;
};

export interface CardRepository {
  find(filter?: CardFilter): Promise<VersionedCard[]>;
  findById(id: string): Promise<VersionedCard | null>;
  findByIds(ids: string[]): Promise<VersionedCard[]>;
}
