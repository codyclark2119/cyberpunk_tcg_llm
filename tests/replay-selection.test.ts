import test from "node:test";
import assert from "node:assert/strict";
import { CardInstanceIdSchema, PlayerIdSchema, type LegalAction } from "@tcg/domain";
import { selectReplayAction } from "./replay-selection";

const actorId = PlayerIdSchema.parse("00000000-0000-4000-8000-000000000001");
const firstCard = CardInstanceIdSchema.parse("p0-c10");
const secondCard = CardInstanceIdSchema.parse("p0-c24");

function sell(cardInstanceId: typeof firstCard, actionId: string): LegalAction {
    return {
        actorId,
        actionId,
        action: { kind: "SELL_CARD", cardInstanceId },
        descriptor: { kind: "SELL_CARD", label: `Sell ${cardInstanceId}` }
    };
}

test("stable replay selection is independent of actionId and input order", () => {
    const a = sell(firstCard, "zzz-engine-dependent");
    const b = sell(secondCard, "aaa-engine-dependent");
    const predicate = (action: LegalAction) => action.action.kind === "SELL_CARD";

    assert.equal(selectReplayAction([a, b], predicate)?.action.kind, "SELL_CARD");
    assert.deepEqual(selectReplayAction([a, b], predicate)?.action, { kind: "SELL_CARD", cardInstanceId: firstCard });
    assert.deepEqual(selectReplayAction([b, a], predicate)?.action, { kind: "SELL_CARD", cardInstanceId: firstCard });

    const bumpedA = sell(firstCard, "000-new-engine");
    const bumpedB = sell(secondCard, "fff-new-engine");
    assert.deepEqual(selectReplayAction([bumpedB, bumpedA], predicate)?.action, { kind: "SELL_CARD", cardInstanceId: firstCard });
});

test("stable replay selection preserves unique matches and no-match behavior", () => {
    const a = sell(firstCard, "one");
    assert.equal(selectReplayAction([a], action => action.action.kind === "SELL_CARD"), a);
    assert.equal(selectReplayAction([a], action => action.action.kind === "END_TURN"), undefined);
});
