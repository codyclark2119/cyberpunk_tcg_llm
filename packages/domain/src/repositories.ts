import type { Card, CardFilter } from "./card";
import type { CardId, CardRevision, RulesetId, RulesetVersion } from "./identity";
import type { Ruleset } from "./ruleset";
export type CardPageRequest = { first: number; afterId?: CardId; filter?: CardFilter };
export type CardPage = { cards: Card[]; hasNextPage: boolean };
export type PublishResult = { status: "PUBLISHED" | "REPLAY" } | { status: "CONFLICT" };
export interface CardRepository {
  list(request: CardPageRequest): Promise<CardPage>;
  findById(id: CardId): Promise<Card | null>;
  findByIds(ids: CardId[]): Promise<Card[]>;
  findRevision(id: CardId, revision: CardRevision): Promise<Card | null>;
  publish(card: Card): Promise<PublishResult>;
}
export interface RulesetRepository {
  findVersion(id: RulesetId, version: RulesetVersion): Promise<Ruleset | null>;
  publish(ruleset: Ruleset): Promise<PublishResult>;
}
