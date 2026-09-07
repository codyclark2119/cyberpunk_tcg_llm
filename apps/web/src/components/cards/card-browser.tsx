"use client";

import { useState } from "react";
import { useQuery } from "@apollo/client/react";
import { GetCardsDocument } from "@tcg/graphql/client";

export function CardBrowser() {
  const [search, setSearch] = useState("");
  const { data, loading, error, fetchMore } = useQuery(GetCardsDocument, {
    variables: { filter: search.trim() ? { search } : null, first: 20 }
  });

  return (
    <>
      <div className="graphqlDemo">
        <label htmlFor="card-search">GraphQL search</label>
        <input
          id="card-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, number, rules text, or tag"
        />
        <code>Query.cards(filter: CardFilterInput)</code>
      </div>

      {loading && <p className="lede">Querying Apollo…</p>}
      {error && <p className="errorText">GraphQL error: {error.message}</p>}

      <div className="cardGrid">
        {data?.cards.edges.map(({ node: card }) => (
          <article className="cardTile" key={card.id}>
            <div className="cardMeta"><span>{card.cardNumber}</span><span>{card.type}</span></div>
            <div className="placeholderArt">{card.colors.join(" / ")}</div>
            <h2>{card.name}</h2>
            <p>{card.rulesText}</p>
            <div className="chips">{card.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          </article>
        ))}
      </div>
      {data?.cards.pageInfo.hasNextPage && <button type="button" disabled={loading} onClick={() => fetchMore({
        variables: { after: data.cards.pageInfo.endCursor },
        updateQuery: (previous, { fetchMoreResult }) => ({ ...fetchMoreResult, cards: { ...fetchMoreResult.cards, edges: [...previous.cards.edges, ...fetchMoreResult.cards.edges] } })
      })}>Load more cards</button>}
    </>
  );
}
