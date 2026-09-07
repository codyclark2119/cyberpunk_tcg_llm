import { CardBrowser } from "@/components/cards/card-browser";

export default function CardsPage() {
  return (
    <div className="page">
      <div className="eyebrow">CARD DATABASE // APOLLO QUERY</div>
      <h1>Cards</h1>
      <p className="lede">This page no longer imports the card array directly. Apollo Client queries the GraphQL API, the resolver applies filters, and the resolver reads the same domain data the game engine will eventually use.</p>
      <CardBrowser />
    </div>
  );
}
