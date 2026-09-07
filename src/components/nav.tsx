import Link from "next/link";

export function Nav() {
  return (
    <header className="nav">
      <Link className="brand" href="/">CYBERPUNK TCG // ONLINE</Link>
      <nav>
        <Link href="/cards">Cards</Link>
        <Link href="/decks/new">Deck Builder</Link>
      </nav>
    </header>
  );
}
