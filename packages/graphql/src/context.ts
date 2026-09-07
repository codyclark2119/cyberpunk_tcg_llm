import type { CardRepository, RulesetRepository, RulesetId, RulesetVersion } from "@tcg/domain";
export type GraphContext = { cards: CardRepository; rulesets: RulesetRepository; rulesetId: RulesetId; rulesetVersion: RulesetVersion };
