"use client";

import { useState } from "react";
import { useQuery } from "@apollo/client/react";
import { GET_CARDS } from "@/graphql/operations";

type CardResult = {
  id: string;
  cardNumber: string;
  name: string;
  type: string;
  colors: string[];
  rulesText: string;
  tags: string[];
};

export function CardBrowser() {
  const [search, setSearch] = useState("");
  const { data, loading, error } = useQuery<{ cards: CardResult[] }>(GET_CARDS, {
    variables: { filter: search.trim() ? { search } : null }
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
        {data?.cards.map((card) => (
          <article className="cardTile" key={card.id}>
            <div className="cardMeta"><span>{card.cardNumber}</span><span>{card.type}</span></div>
            <div className="placeholderArt">{card.colors.join(" / ")}</div>
            <h2>{card.name}</h2>
            <p>{card.rulesText}</p>
            <div className="chips">{card.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          </article>
        ))}
      </div>
    </>
  );
}
