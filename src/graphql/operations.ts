import { gql } from "@apollo/client";

export const GET_CARDS = gql`
  query GetCards($filter: CardFilterInput) {
    cards(filter: $filter) {
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
