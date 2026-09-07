import { cards } from "@tcg/domain/fixtures";

const seenIds = new Set<string>();
const seenNumbers = new Set<string>();
let failed = false;

for (const card of cards) {
  if (seenIds.has(card.id)) { console.error(`Duplicate id: ${card.id}`); failed = true; }
  if (seenNumbers.has(card.cardNumber)) { console.error(`Duplicate card number: ${card.cardNumber}`); failed = true; }
  if (!card.name.trim()) { console.error(`Missing card name: ${card.id}`); failed = true; }
  if (!card.colors.length) { console.error(`Missing color: ${card.id}`); failed = true; }
  seenIds.add(card.id);
  seenNumbers.add(card.cardNumber);
}

if (failed) process.exit(1);
console.log(`Validated ${cards.length} card records.`);
