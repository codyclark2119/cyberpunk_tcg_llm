import type { CardRepository } from "./types";
import { FixtureCardRepository } from "./fixture-card-repository";
import { MongoCardRepository } from "./mongo-card-repository";

let repository: CardRepository | undefined;

/**
 * The fixture repository keeps first-run development friction low.
 * As soon as MONGODB_URI is configured, Apollo reads cards from MongoDB.
 */
export function getCardRepository(): CardRepository {
  if (!repository) {
    repository = process.env.MONGODB_URI
      ? new MongoCardRepository()
      : new FixtureCardRepository();
  }
  return repository;
}

export type { CardRepository, CardDocument, CardFilter, VersionedCard } from "./types";
