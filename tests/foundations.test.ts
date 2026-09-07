import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSerialize, hashCanonical, CardSchema, CardRevisionSchema, CardIdSchema, DeckSchema, defaultRuleset, RulesetSchema, validateDeck, GameStateSchema, GameActionSchema } from "@tcg/domain";
import { cards } from "@tcg/domain/fixtures";
import { FixtureCardRepository, FixtureRulesetRepository, parseEnvironment, cardFromDocument, cardToDocument } from "@tcg/persistence";
import { validateState, listLegalActions, validateAction, applyAction } from "@tcg/engine";
import { generatePosition, importPositions, exportPositions, evaluateCandidate } from "@tcg/training-harness";
import { encodeCursor, decodeCursor, PageInputSchema } from "../packages/graphql/src/pagination";
const player = "00000000-0000-4000-8000-000000000001";
const state = GameStateSchema.parse({ schemaVersion: 1, matchId: "00000000-0000-4000-8000-000000000002", version: 0, eventSequence: 0, rulesetId: defaultRuleset.id, rulesetVersion: defaultRuleset.version, players: [player], actingPlayer: player, cards: [], phase: "UNIMPLEMENTED" });
const action = GameActionSchema.parse({ commandId: "00000000-0000-4000-8000-000000000003", actorId: player, expectedStateVersion: 0, type: "UNIMPLEMENTED" });
const context = { ruleset: defaultRuleset };

test("canonical JSON and SHA-256 are stable across nested key insertion order", () => {
  assert.equal(canonicalSerialize({ b: [2, { y: false, x: null }], a: 1 }), '{"a":1,"b":[2,{"x":null,"y":false}]}');
  assert.equal(hashCanonical({ b: 2, a: 1 }), hashCanonical({ a: 1, b: 2 }));
  assert.equal(hashCanonical({}), "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
  assert.notEqual(hashCanonical([1, 2]), hashCanonical([2, 1]));
  for (const value of [NaN, Infinity, undefined, new Date(), { x: undefined }, new Array(2)]) assert.throws(() => canonicalSerialize(value));
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; assert.throws(() => canonicalSerialize(cyclic));
});
test("immutable fixture revisions are defensive copies; replay and conflict differ", async () => {
  const repo = new FixtureCardRepository([]);
  const card = structuredClone(cards[0]);
  assert.equal((await repo.publish(card)).status, "PUBLISHED");
  card.name = "mutated caller";
  assert.equal((await repo.findRevision(cards[0].id, cards[0].revision))?.name, cards[0].name);
  assert.equal((await repo.publish(cards[0])).status, "REPLAY");
  assert.equal((await repo.publish(card)).status, "CONFLICT");
  const revision2 = { ...cards[0], revision: CardRevisionSchema.parse(2), name: "Revision two" };
  await repo.publish(revision2); await repo.publish(cards[0]);
  assert.equal((await repo.findById(cards[0].id))?.revision, 2);
  assert.equal((await repo.findRevision(cards[0].id, cards[0].revision))?.name, cards[0].name);
});
test("rulesets retain immutable versions", async () => {
  const repo = new FixtureRulesetRepository();
  assert.equal((await repo.publish(defaultRuleset)).status, "REPLAY");
  assert.equal((await repo.publish({ ...defaultRuleset, deckbuilding: { ...defaultRuleset.deckbuilding, maxCopies: 8 } })).status, "CONFLICT");
});
test("deck validation uses the supplied ruleset and aggregates duplicate entries", () => {
  const deck = DeckSchema.parse({ name: "Test", legends: cards.filter(c => c.type === "LEGEND").map(c => c.id), cards: [{ cardId: "dev-unit-red", quantity: 3 }] });
  assert.deepEqual(validateDeck(deck, cards, defaultRuleset).issues.map(i => i.code), ["MAIN_DECK_SIZE"]);
  const relaxed = RulesetSchema.parse({ ...defaultRuleset, deckbuilding: { ...defaultRuleset.deckbuilding, mainDeck: { min: 3, max: 6 } } });
  assert.equal(validateDeck(deck, cards, relaxed).legal, true);
  const duplicated = { ...deck, cards: [...deck.cards, ...deck.cards] };
  assert.equal(validateDeck(duplicated, cards, relaxed).issues[0].code, "COPY_LIMIT");
});
test("runtime boundaries reject malformed content, env, states and actions", () => {
  assert.equal(CardSchema.safeParse({ ...cards[0], revision: 0 }).success, false);
  assert.equal(CardSchema.safeParse({ ...cards[0], unexpected: true }).success, false);
  assert.equal(RulesetSchema.safeParse({ ...defaultRuleset, deckbuilding: { mainDeck: { min: 5, max: 1 } } }).success, false);
  assert.throws(() => parseEnvironment({ MONGODB_URI: "https://example.com" }));
  assert.equal(parseEnvironment({ MONGODB_URI: "" }).MONGODB_URI, undefined);
  assert.equal(GameStateSchema.safeParse({ ...state, version: -1 }).success, false);
  assert.equal(GameActionSchema.safeParse({ ...action, type: "PLAY_CARD" }).success, false);
  assert.throws(() => cardFromDocument({ ...cardToDocument(cards[0]), contentHash: "0".repeat(64) }));
});
test("engine is deterministic, preserves state, checks versions and invents no actions", () => {
  const before = canonicalSerialize(state);
  assert.equal(validateState(state, context).ok, true);
  assert.deepEqual(listLegalActions(state, state.actingPlayer, context), { ok: true, value: [] });
  assert.deepEqual(applyAction(state, action, context), applyAction(structuredClone(state), structuredClone(action), structuredClone(context)));
  const stale = validateAction(state, GameActionSchema.parse({ ...action, expectedStateVersion: 1 }), context);
  assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.errors[0].code, "STALE_STATE");
  assert.equal(canonicalSerialize(state), before);
});
test("opaque cursors round-trip, reject bad encoding and bind to filters", async () => {
  const id = CardIdSchema.parse("dev-legend-red"); const cursor = encodeCursor(id, { search: "red" });
  assert.equal(decodeCursor(cursor, { search: "red" }), id);
  assert.throws(() => decodeCursor(cursor, { search: "blue" }));
  for (const invalid of ["!", "e30", "", cursor + "="]) assert.throws(() => decodeCursor(invalid));
  assert.equal(PageInputSchema.safeParse({ first: 0 }).success, false);
  const repo = new FixtureCardRepository(); const page1 = await repo.list({ first: 2 }); const page2 = await repo.list({ first: 2, afterId: page1.cards[1].id });
  assert.equal(page1.hasNextPage, true); assert.equal(page2.hasNextPage, false);
  assert.equal(new Set([...page1.cards, ...page2.cards].map(c => c.id)).size, 4);
});
test("training positions export deterministic deduplicated JSONL and reject corruption", () => {
  const position = generatePosition(state, state.actingPlayer, context); assert.equal(position.ok, true);
  if (!position.ok) return;
  const jsonl = exportPositions([position.value, position.value]);
  assert.equal(importPositions(jsonl).length, 1);
  assert.equal(evaluateCandidate(position.value, action, context).ok, false);
  assert.throws(() => importPositions(JSON.stringify({ ...position.value, stateHash: "0".repeat(64) })));
});
