import test from "node:test";
import assert from "node:assert/strict";
import { cards } from "@tcg/domain/fixtures";
import { FixtureCardRepository, cardSearchFields, cardToProjection } from "@tcg/persistence";

test("Mongo card projection populates index.searchText from the fixture search fields", () => {
  assert.ok(cards.length > 0);
  for (const card of cards) {
    const projection = cardToProjection(card);
    assert.equal(projection._id, card.id);
    assert.equal(typeof projection.index.searchText, "string");
    assert.ok(projection.index.searchText.length > 0, `${card.id} has empty searchText`);
    for (const field of cardSearchFields(card)) assert.ok(projection.index.searchText.includes(field.toLowerCase()), `${card.id} searchText misses ${field}`);
  }
});

test("index.searchText selects the same cards as FixtureCardRepository search", async () => {
  const repo = new FixtureCardRepository(cards);
  const live = cards.filter((card) => card.status !== "RETIRED");
  const terms = [...new Set(live.flatMap((card) => [card.name, card.cardNumber, ...card.tags, card.rulesText.split(/\s+/)[0] ?? ""]))]
    .map((term) => term.trim()).filter(Boolean).slice(0, 40);
  assert.ok(terms.length > 0);
  for (const term of terms) {
    const fixtureIds = (await repo.list({ first: cards.length, filter: { search: term } })).cards.map((card) => card.id).sort();
    const projectedIds = live.filter((card) => cardToProjection(card).index.searchText.includes(term.toLowerCase())).map((card) => card.id).sort();
    assert.deepEqual(projectedIds, fixtureIds, `search ${JSON.stringify(term)}`);
  }
});
