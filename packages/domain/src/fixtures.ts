import { CardSchema } from "./card";
// Development fixtures only. Replace with verified official card data through the importer.
const rawCards = [
  {
    id: "dev-legend-red",
    cardNumber: "DEV-L01",
    name: "Red Legend Fixture",
    type: "LEGEND",
    colors: ["RED"],
    setCode: "DEV",
    setName: "Development Fixtures",
    ram: { RED: 2 },
    rulesText: "Development-only card used to exercise deck validation.",
    tags: ["Fixture"],
    keywords: []
  },
  {
    id: "dev-legend-blue",
    cardNumber: "DEV-L02",
    name: "Blue Legend Fixture",
    type: "LEGEND",
    colors: ["BLUE"],
    setCode: "DEV",
    setName: "Development Fixtures",
    ram: { BLUE: 2 },
    rulesText: "Development-only card used to exercise deck validation.",
    tags: ["Fixture"],
    keywords: []
  },
  {
    id: "dev-legend-green",
    cardNumber: "DEV-L03",
    name: "Green Legend Fixture",
    type: "LEGEND",
    colors: ["GREEN"],
    setCode: "DEV",
    setName: "Development Fixtures",
    ram: { GREEN: 2 },
    rulesText: "Development-only card used to exercise deck validation.",
    tags: ["Fixture"],
    keywords: []
  },
  {
    id: "dev-unit-red",
    cardNumber: "DEV-U01",
    name: "Red Unit Fixture",
    type: "UNIT",
    colors: ["RED"],
    setCode: "DEV",
    setName: "Development Fixtures",
    cost: 2,
    power: 3,
    ram: { RED: 1 },
    rulesText: "Development-only unit.",
    tags: ["Fixture"],
    keywords: []
  }
];

export const cards = rawCards.map((card) => CardSchema.parse({ ...card, schemaVersion: 1, revision: 1, status: "ACTIVE" }));
