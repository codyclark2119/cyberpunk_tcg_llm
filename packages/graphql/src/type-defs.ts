import { gql } from "graphql-tag";

export const typeDefs = gql`
  enum CardColor {
    RED
    BLUE
    GREEN
    YELLOW
    NEUTRAL
  }

  enum CardType {
    LEGEND
    UNIT
    GEAR
    PROGRAM
  }

  type RamValue {
    color: CardColor!
    amount: Int!
  }

  type Card {
    id: ID!
    schemaVersion: Int!
    revision: Int!
    status: String!
    cardNumber: String!
    name: String!
    type: CardType!
    colors: [CardColor!]!
    rarity: String
    setCode: String!
    setName: String!
    cost: Int
    power: Int
    ram: [RamValue!]!
    rulesText: String!
    flavorText: String
    tags: [String!]!
    keywords: [String!]!
    imageUrl: String
  }

  input CardFilterInput {
    search: String
    type: CardType
    color: CardColor
    setCode: String
  }

  input DeckCardInput {
    cardId: ID!
    quantity: Int!
  }

  input ValidateDeckInput {
    name: String!
    legendIds: [ID!]!
    cards: [DeckCardInput!]!
  }

  type DeckValidationIssue {
    code: String!
    message: String!
    severity: String!
    cardId: ID
  }

  type DeckValidationResult {
    legal: Boolean!
    mainDeckCount: Int!
    ramAvailable: [RamValue!]!
    ramRequired: [RamValue!]!
    issues: [DeckValidationIssue!]!
  }

  type CardEdge { cursor: String!, node: Card! }
  type PageInfo { endCursor: String, hasNextPage: Boolean! }
  type CardConnection { edges: [CardEdge!]!, pageInfo: PageInfo! }

  type Query {
    cards(first: Int = 20, after: String, filter: CardFilterInput): CardConnection!
    card(id: ID!): Card
    apiVersion: String!
  }

  type Mutation {
    validateDeck(input: ValidateDeckInput!): DeckValidationResult!
  }
`;
