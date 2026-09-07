import type { CardDocument, VersionedCard } from "./types";

export function cardDocumentToDomain(document: CardDocument): VersionedCard {
  const data = document.data ?? {};

  return {
    id: document._id,
    schemaVersion: document.schemaVersion,
    revision: document.revision,
    status: document.status,
    cardNumber: document.index.cardNumber,
    name: document.index.name,
    type: document.index.type,
    colors: document.index.colors,
    rarity: document.index.rarity,
    setCode: document.index.setCode,
    setName: document.index.setName,
    cost: typeof data.cost === "number" ? data.cost : undefined,
    power: typeof data.power === "number" ? data.power : undefined,
    ram: data.ram,
    rulesText: typeof data.rulesText === "string" ? data.rulesText : "",
    flavorText: typeof data.flavorText === "string" ? data.flavorText : undefined,
    tags: Array.isArray(data.tags) ? data.tags : [],
    keywords: Array.isArray(data.keywords) ? data.keywords : [],
    imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined
  };
}
