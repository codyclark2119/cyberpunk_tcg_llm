import Link from "next/link";

export default function Home() {
  return (
    <div className="page hero">
      <div className="eyebrow">MILESTONE 02 // APOLLO GRAPHQL</div>
      <h1>Build decks. Validate rules. Prepare for online play.</h1>
      <p className="lede">GraphQL is now the application boundary: Apollo Client talks to Apollo Server, resolvers call framework-agnostic domain logic, and the same schema can grow into subscriptions for live matches.</p>
      <div className="actions">
        <Link className="button primary" href="/cards">Browse card fixtures</Link>
        <Link className="button" href="/decks/new">Open deck builder</Link>
      </div>
      <section className="grid three">
        <article className="panel"><span>01</span><h2>GraphQL API</h2><p>Schema-first queries and mutations expose normalized card data without coupling React components to storage.</p></article>
        <article className="panel"><span>02</span><h2>Apollo Client</h2><p>Client components query the API through Apollo cache and will later consume optimistic mutations and subscriptions.</p></article>
        <article className="panel"><span>03</span><h2>Game Core</h2><p>Domain services remain transport-agnostic so HTTP mutations and WebSocket subscriptions can share one authoritative engine.</p></article>
      </section>
    </div>
  );
}
