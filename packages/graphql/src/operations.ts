import { gql } from "graphql-tag";

export const GET_CARDS = gql`
  query GetCards($filter: CardFilterInput, $first: Int, $after: String) {
    cards(filter: $filter, first: $first, after: $after) {
      edges { cursor node {
      id
      schemaVersion
      revision
      status
      cardNumber
      name
      type
      colors
      setCode
      setName
      cost
      power
      ram {
        color
        amount
      }
      rulesText
      tags
      keywords
      } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

export const VALIDATE_DECK = gql`
  mutation ValidateDeck($input: ValidateDeckInput!) {
    validateDeck(input: $input) {
      legal
      mainDeckCount
      ramAvailable {
        color
        amount
      }
      ramRequired {
        color
        amount
      }
      issues {
        code
        message
        severity
        cardId
      }
    }
  }
`;
