import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashCanonical } from "@tcg/domain";
import { validateV4Evidence, evidenceBytes, V4_RULE_IDS } from "../scripts/lib/api-admission-batch-v4-evidence";
import card from "./fixtures/api-admission-batch-v4-card-sources.v1.json";
import rules from "./fixtures/api-admission-batch-v4-rules.v1.json";

test("V4: committed evidence pins the real processed record, candidate and exact rules projection", () => {
    const checked = validateV4Evidence(card, rules);
    assert.equal(checked.card.candidate.sourceRecordHash, checked.card.processedRecordHash);
    assert.deepEqual(checked.rules.rules.map(r => r.id), [...V4_RULE_IDS]);
    for (const field of ["mechanics", "execution", "reviewed", "revision", "status"]) assert.equal(field in checked.card.candidate, false);
    assert.deepEqual(checked.card.matchingErrata, []);
});

test("V4: evidence serialization is canonical and matches both committed files", () => {
    const checked = validateV4Evidence(card, rules);
    for (const [name, value] of [["api-admission-batch-v4-card-sources.v1.json", checked.card], ["api-admission-batch-v4-rules.v1.json", checked.rules]] as const) {
        const expected = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
        assert.equal(evidenceBytes(value), expected);
        assert.equal(evidenceBytes(JSON.parse(evidenceBytes(value))), expected);
    }
    // Cross-repository regeneration is a separate --check command, not claimed by this offline round-trip.
});

test("V4: rehashing a changed source record cannot turn drift into reviewed evidence", () => {
    const changed = structuredClone(card); changed.processedRecord.cost = 3;
    changed.processedRecordHash = hashCanonical(changed.processedRecord); changed.candidate.sourceRecordHash = changed.processedRecordHash;
    assert.throws(() => validateV4Evidence(changed, rules));
    const candidate = structuredClone(card); candidate.candidate.catalog.sellable = true;
    assert.throws(() => validateV4Evidence(candidate, rules));
    const text = structuredClone(rules); text.rules[0].text += " altered"; text.rulesHash = hashCanonical(text.rules);
    assert.throws(() => validateV4Evidence(card, text));
    const absent = structuredClone(rules); absent.rules.pop(); absent.rulesHash = hashCanonical(absent.rules);
    assert.throws(() => validateV4Evidence(card, absent));
});

test("V4: evidence preserves reminder text and the source's formula verbatim", () => {
    validateV4Evidence(card, rules);
    assert.ok(card.candidate.rulesSource.markup.includes("(Units with power 0 don't steal Gigs.)"));
    assert.ok(rules.rules.find(r => r.id === "3.18.1.2.2.1")!.text.includes("not effect text"));
    assert.ok(rules.rules.find(r => r.id === "9.23.2.2")!.text.includes("`X = (P / 10) + 1)`"), "Do not silently fix source wording in captured evidence");
});
