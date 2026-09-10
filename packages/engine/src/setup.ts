import { success, failure, type Result } from "@tcg/domain";
import { TurnMutation } from "./turn";
import { drawDeterministicInteger } from "./rng";
import { selectOpposedD20 } from "./first-player";
import { setupChoice } from "./setup-state";

function offer(m: TurnMutation) {
    const s = m.state, setup = s.setup!;
    s.timing.actingPlayer = s.match.playerOrder[setup.decidingSeat];
    s.timing.activePlayer = s.timing.firstPlayer ?? s.timing.actingPlayer;
    s.timing.window = "SETUP";
    s.timing.step = setup.stage === "FIRST_PLAYER" ? "CHOOSE_FIRST_PLAYER" : setup.stage === "MULLIGAN" ? "MULLIGAN_DECISION" : "CUT_DECISION";
    s.resolution = { stage: "CHOICE", current: null, pending: [], discovered: [], choice: setupChoice(s) };
}
function shuffle(m: TurnMutation, seat: number, zone: "DECK" | "LEGENDS") {
    const s = m.state, playerId = s.match.playerOrder[seat], items = s.players[playerId].zones[zone], rngCounter = s.rng.counter;
    for (let i = items.length - 1; i > 0; i--) {
        const r = drawDeterministicInteger(s.rng, i + 1);
        s.rng = r.rng;
        [items[i], items[r.rawValue - 1]] = [items[r.rawValue - 1], items[i]];
    }
    m.emit({ kind: "SETUP_SHUFFLED", playerId, zone, order: [...items], rngCounter });
}
export function beginSetup(m: TurnMutation): Result<null> {
    const s = m.state, rules = m.context.content.ruleset.gameplay!;
    if (rules.openingHand !== 6 || rules.firstPlayerSpentLegends !== 2)
        return failure("UNSUPPORTED_SETUP_POLICY", "Captured setup requires six-card hands and two spent Legends");
    s.timing.turn = 0;
    delete s.timing.firstPlayer;
    for (const p of Object.values(s.players)) p.economy = { sellsThisTurn: 0, callsThisTurn: 0, usageTurn: 0 };
    for (const c of Object.values(s.objects.cards)) c.readiness = "READY";
    const counter = s.rng.counter;
    let decidingSeat: number;
    if (s.match.format === "DEMO_STARTER_V1") {
        const result = selectOpposedD20(s.rng);
        s.rng = result.rng; s.firstPlayerRolls = result.rounds; decidingSeat = result.decidingSeat;
        for (const [index, rolls] of result.rounds.entries())
            m.emit({ kind: "FIRST_PLAYER_ROLLED", round: index + 1, rolls, tied: rolls[0] === rolls[1] });
    } else {
        const result = drawDeterministicInteger(s.rng, 2);
        s.rng = result.rng; decidingSeat = result.rawValue - 1;
    }
    s.setup = { stage: "FIRST_PLAYER", decidingSeat, completed: 0 };
    m.emit({ kind: "FIRST_PLAYER_DETERMINED", playerId: s.match.playerOrder[s.setup.decidingSeat], rngCounter: counter });
    offer(m);
    return success(null);
}
/** Called only after exact legal-action membership and setup invariant validation. */
export function continueSetup(m: TurnMutation, index: number): Result<null> {
    const s = m.state, setup = s.setup!, option = s.resolution.choice!.options[index], actor = s.timing.actingPlayer;
    if (setup.stage === "FIRST_PLAYER" && option.kind === "MODE") {
        const firstSeat = option.mode === "FIRST" ? setup.decidingSeat : 1 - setup.decidingSeat;
        s.timing.firstPlayer = s.match.playerOrder[firstSeat];
        m.emit({ kind: "FIRST_PLAYER_CHOSEN", playerId: s.timing.firstPlayer, chosenBy: actor });
        for (const seat of [0, 1]) shuffle(m, seat, "DECK");
        s.setup = { stage: "MAIN_CUT", decidingSeat: 1, completed: 0 };
    } else if ((setup.stage === "MAIN_CUT" || setup.stage === "LEGEND_CUT") && option.kind === "AMOUNT") {
        const zone = setup.stage === "MAIN_CUT" ? "DECK" : "LEGENDS", ownerId = s.match.playerOrder[setup.completed], items = s.players[ownerId].zones[zone];
        items.push(...items.splice(0, option.amount));
        m.emit({ kind: "SETUP_CUT", playerId: actor, ownerId, zone, position: option.amount });
        if (setup.completed === 0) s.setup = { ...setup, completed: 1, decidingSeat: 0 };
        else if (setup.stage === "MAIN_CUT") {
            for (const seat of [0, 1]) shuffle(m, seat, "LEGENDS");
            s.setup = { stage: "LEGEND_CUT", completed: 0, decidingSeat: 1 };
        } else {
            const first = s.timing.firstPlayer!;
            for (const cid of s.players[first].zones.LEGENDS.slice(0, m.context.content.ruleset.gameplay!.firstPlayerSpentLegends)) {
                s.objects.cards[cid].readiness = "SPENT";
                m.emit({ kind: "SETUP_LEGEND_SPENT", cardInstanceId: cid });
            }
            for (const playerId of s.match.playerOrder) m.emit({ kind: "FIXER_PREPARED", playerId });
            for (const player of s.match.playerOrder) {
                const drawn = m.draw(player, 6);
                if (!drawn.ok) return drawn;
            }
            s.setup = { stage: "MULLIGAN", completed: 0, decidingSeat: s.players[first].seat };
        }
    } else if (setup.stage === "MULLIGAN" && option.kind === "CONFIRM") {
        m.emit({ kind: "MULLIGAN_DECLARED", playerId: actor, accepted: option.confirmed });
        if (option.confirmed) {
            const p = s.players[actor];
            for (const cid of p.zones.HAND.splice(0)) {
                const c = s.objects.cards[cid], from = { ...c.zone };
                c.zone = { playerId: actor, zone: "DECK" };
                p.zones.DECK.push(cid);
                m.emit({ kind: "CARD_MOVED", cardInstanceId: cid, from, to: c.zone });
            }
            // 7.9.3.2 repeats the shuffle method; it does not repeat 7.6.2's cut offer.
            shuffle(m, setup.decidingSeat, "DECK");
            const drawn = m.draw(actor, 6);
            if (!drawn.ok) return drawn;
            m.emit({ kind: "MULLIGAN_RESOLVED", playerId: actor });
        }
        if (setup.completed === 0) s.setup = { stage: "MULLIGAN", completed: 1, decidingSeat: 1 - setup.decidingSeat };
        else {
            delete s.setup;
            s.resolution = { stage: "DECISION", current: null, pending: [], discovered: [], choice: null };
            s.timing.turn = 1;
            s.timing.activePlayer = s.timing.firstPlayer!;
            m.emit({ kind: "GAME_SETUP_COMPLETED" });
            return m.startTurn();
        }
    } else return failure("INVALID_SETUP_CHOICE", "Option does not match setup stage");
    offer(m);
    return success(null);
}
