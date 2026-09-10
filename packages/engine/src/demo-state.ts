import { DeckSchema, demoManifests, matchDemoManifest, validateDeck, failure, success, type GameState } from "@tcg/domain";
import { canonicalSerialize, type ContentBundle } from "@tcg/domain";
import { selectOpposedD20 } from "./first-player";

/** Retain original owner composition across zones; card instances never disappear in this scope. */
export function validateDemoState(state: GameState, content: ContentBundle) {
    const rules = content.ruleset, demo = state.match.format === "DEMO_STARTER_V1";
    if (!demo && state.firstPlayerRolls) return failure("UNSUPPORTED_SETUP_ROLLS", "Literal setup rolls require Demo format");
    if (!demo && !rules.demoStarter) return success(null); // Preserve all legacy/constructed payload semantics.
    if (demo && (!rules.demoStarter || state.match.playerOrder.length !== 2)) return failure("UNSUPPORTED_FORMAT", "Demo requires its pinned format policy and two players");
    const references = demoManifests.flatMap(m => m.entries);
    if (demo && (content.cards.length !== 29 || content.cards.some(c => !references.some(r => r.cardId === c.id && r.revision === c.revision))))
        return failure("DEMO_CONTENT_INVALID", "Demo initialization requires exactly the 29 real reviewed reference revisions");
    const manifests: string[] = [];
    for (const id of state.match.playerOrder) {
        const cards = Object.values(state.objects.cards).filter(c => c.ownerId === id);
        const isLegend = (c: typeof cards[number]) => content.cards.find(r => r.id === c.cardId && r.revision === c.revision)?.type === "LEGEND";
        const deck = DeckSchema.parse({ name: "Original composition", legends: cards.filter(isLegend).map(c => c.cardId), cards: cards.filter(c => !isLegend(c)).map(c => ({ cardId: c.cardId, quantity: 1 })) });
        if (demo) {
            const manifest = matchDemoManifest(deck, content.cards);
            if (!manifest) return failure("DEMO_MANIFEST_MISMATCH", "State must retain its exact original fixed manifest");
            manifests.push(manifest);
        } else if (!validateDeck(deck, content.cards, rules).legal) return failure("INVALID_DECK", "Missing Demo format cannot admit a 27-card state");
    }
    if (!demo) return success(null);
    if (new Set(manifests).size !== 2) return failure("DEMO_PAIR_INVALID", "Demo requires one of each fixed manifest");
    const rounds = state.firstPlayerRolls;
    if (!rounds?.length || rounds.some((r, i) => (r[0] === r[1]) !== (i < rounds.length - 1)) || state.rng.counter < rounds.length * 2)
        return failure("INVALID_FIRST_PLAYER_ROLLS", "All preceding rounds must tie and the final round must select a winner");
    const expected = selectOpposedD20({ ...state.rng, counter: 0 });
    if (canonicalSerialize(expected.rounds) !== canonicalSerialize(rounds) || state.rng.counter < expected.rng.counter ||
        (state.setup?.stage === "FIRST_PLAYER" && state.rng.counter !== expected.rng.counter))
        return failure("INVALID_FIRST_PLAYER_ROLLS", "Roll history must match seeded seat-order draws before shuffling");
    const winner = expected.decidingSeat;
    if (state.setup?.stage === "FIRST_PLAYER" && state.setup.decidingSeat !== winner)
        return failure("INVALID_FIRST_PLAYER_ROLLS", "The higher roller must choose FIRST or SECOND");
    return success(null);
}
