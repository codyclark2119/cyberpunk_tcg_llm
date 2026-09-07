"use client";

import { useMutation } from "@apollo/client/react";
import { ValidateDeckDocument } from "@tcg/graphql/client";

const developmentDeck = {
  name: "Development Deck",
  legendIds: ["dev-legend-red", "dev-legend-blue", "dev-legend-green"],
  cards: [{ cardId: "dev-unit-red", quantity: 3 }]
};

export function DeckValidationDemo() {
  const [validateDeck, { data, loading, error }] = useMutation(ValidateDeckDocument);

  const result = data?.validateDeck;

  return (
    <section className="grid two">
      <article className="panel">
        <span>MUTATION INPUT</span>
        <h2>{developmentDeck.name}</h2>
        <p>3 fixture Legends · 3 main-deck cards</p>
        <button
          className="button primary"
          type="button"
          disabled={loading}
          onClick={() => validateDeck({ variables: { input: developmentDeck } })}
        >
          {loading ? "Validating…" : "Run validateDeck mutation"}
        </button>
        <pre className="codePanel">{JSON.stringify(developmentDeck, null, 2)}</pre>
      </article>

      <article className="panel">
        <span>SERVER RESULT</span>
        {!result && !error && <p>Run the mutation to see the GraphQL response.</p>}
        {error && <p className="errorText">GraphQL error: {error.message}</p>}
        {result && (
          <>
            <div className={result.legal ? "status good" : "status bad"}>
              {result.legal ? "LEGAL" : "NOT LEGAL"}
            </div>
            <p>Main deck: {result.mainDeckCount} cards</p>
            {result.issues.length === 0
              ? <p>No validation issues.</p>
              : result.issues.map((issue) => <p key={`${issue.code}-${issue.cardId ?? "deck"}`}>{issue.message}</p>)}
            <pre className="codePanel">{JSON.stringify(result, null, 2)}</pre>
          </>
        )}
      </article>
    </section>
  );
}
