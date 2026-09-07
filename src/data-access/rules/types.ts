export type RulesetStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";

/** Flexible Mongo document for a beta ruleset. */
export type RulesetDocument = {
  _id?: unknown;
  rulesetId: string;
  version: string;
  schemaVersion: number;
  status: RulesetStatus;
  effectiveAt?: Date;
  deckbuilding?: Record<string, unknown>;
  turnStructure?: Record<string, unknown>;
  timing?: Record<string, unknown>;
  keywords?: Record<string, unknown>;
  effects?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  source?: {
    url?: string;
    importedAt?: Date;
  };
};

export interface RulesetRepository {
  findVersion(rulesetId: string, version: string): Promise<RulesetDocument | null>;
  findActive(rulesetId: string): Promise<RulesetDocument | null>;
}
