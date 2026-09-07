import { DeckValidationDemo } from "@/components/decks/deck-validation-demo";

export default function DeckBuilderPage() {
  return (
    <div className="page">
      <div className="eyebrow">DECK BUILDER // APOLLO MUTATION</div>
      <h1>Development Deck</h1>
      <p className="lede">This prototype now sends deck input through GraphQL. Apollo Server adapts the mutation input into the framework-agnostic deck validator and returns a structured legality result.</p>
      <DeckValidationDemo />
    </div>
  );
}
