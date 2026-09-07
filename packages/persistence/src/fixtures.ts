import { cards } from "@tcg/domain/fixtures";
import { defaultRuleset, hashCanonical, type Card, type CardId, type CardRevision, type CardRepository, type RulesetRepository, type Ruleset, type RulesetId, type RulesetVersion, type CardPageRequest, type PublishResult } from "@tcg/domain";
export class FixtureCardRepository implements CardRepository {
  private readonly revisions = new Map<string, Card>();
  private readonly current = new Map<CardId, Card>();
  constructor(initial: readonly Card[] = cards) { for (const card of initial) this.store(card); }
  private store(card: Card) {
    this.revisions.set(JSON.stringify([card.id, card.revision]), structuredClone(card));
    if ((this.current.get(card.id)?.revision ?? 0) <= card.revision) this.current.set(card.id, structuredClone(card));
  }
  async publish(card: Card): Promise<PublishResult> {
    const existing = await this.findRevision(card.id, card.revision);
    if (existing) return { status: hashCanonical(existing) === hashCanonical(card) ? "REPLAY" : "CONFLICT" };
    this.store(card); return { status: "PUBLISHED" };
  }
  async list({ first, afterId, filter }: CardPageRequest) {
    const search = filter?.search?.trim().toLowerCase();
    const matches = [...this.current.values()].filter((card) => card.status !== "RETIRED" && (!afterId || card.id > afterId) &&
      (!filter?.type || card.type === filter.type) && (!filter?.color || card.colors.includes(filter.color)) &&
      (!filter?.setCode || card.setCode === filter.setCode) && (!search || [card.name, card.cardNumber, card.rulesText, ...card.tags].some((x) => x.toLowerCase().includes(search))))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { cards: structuredClone(matches.slice(0, first)), hasNextPage: matches.length > first };
  }
  async findById(id: CardId) { return structuredClone(this.current.get(id) ?? null); }
  async findByIds(ids: CardId[]) { return structuredClone([...this.current.values()].filter((c) => ids.includes(c.id))); }
  async findRevision(id: CardId, revision: CardRevision) { return structuredClone(this.revisions.get(JSON.stringify([id, revision])) ?? null); }
}
export class FixtureRulesetRepository implements RulesetRepository {
  private readonly versions = new Map<string, Ruleset>();
  constructor() { this.versions.set(JSON.stringify([defaultRuleset.id, defaultRuleset.version]), structuredClone(defaultRuleset)); }
  async findVersion(id: RulesetId, version: RulesetVersion) { return structuredClone(this.versions.get(JSON.stringify([id, version])) ?? null); }
  async publish(ruleset: Ruleset): Promise<PublishResult> {
    const key = JSON.stringify([ruleset.id, ruleset.version]); const existing = this.versions.get(key);
    if (existing) return { status: hashCanonical(existing) === hashCanonical(ruleset) ? "REPLAY" : "CONFLICT" };
    this.versions.set(key, structuredClone(ruleset)); return { status: "PUBLISHED" };
  }
}
