import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type Card = {
  __typename?: 'Card';
  cardNumber: Scalars['String']['output'];
  colors: Array<CardColor>;
  cost?: Maybe<Scalars['Int']['output']>;
  flavorText?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  imageUrl?: Maybe<Scalars['String']['output']>;
  keywords: Array<Scalars['String']['output']>;
  name: Scalars['String']['output'];
  power?: Maybe<Scalars['Int']['output']>;
  ram: Array<RamValue>;
  rarity?: Maybe<Scalars['String']['output']>;
  revision: Scalars['Int']['output'];
  rulesText: Scalars['String']['output'];
  schemaVersion: Scalars['Int']['output'];
  setCode: Scalars['String']['output'];
  setName: Scalars['String']['output'];
  status: Scalars['String']['output'];
  tags: Array<Scalars['String']['output']>;
  type: CardType;
};

export type CardColor =
  | 'BLUE'
  | 'GREEN'
  | 'NEUTRAL'
  | 'RED'
  | 'YELLOW';

export type CardConnection = {
  __typename?: 'CardConnection';
  edges: Array<CardEdge>;
  pageInfo: PageInfo;
};

export type CardEdge = {
  __typename?: 'CardEdge';
  cursor: Scalars['String']['output'];
  node: Card;
};

export type CardFilterInput = {
  color?: InputMaybe<CardColor>;
  search?: InputMaybe<Scalars['String']['input']>;
  setCode?: InputMaybe<Scalars['String']['input']>;
  type?: InputMaybe<CardType>;
};

export type CardType =
  | 'GEAR'
  | 'LEGEND'
  | 'PROGRAM'
  | 'UNIT';

export type DeckCardInput = {
  cardId: Scalars['ID']['input'];
  quantity: Scalars['Int']['input'];
};

export type DeckValidationIssue = {
  __typename?: 'DeckValidationIssue';
  cardId?: Maybe<Scalars['ID']['output']>;
  code: Scalars['String']['output'];
  message: Scalars['String']['output'];
  severity: Scalars['String']['output'];
};

export type DeckValidationResult = {
  __typename?: 'DeckValidationResult';
  issues: Array<DeckValidationIssue>;
  legal: Scalars['Boolean']['output'];
  mainDeckCount: Scalars['Int']['output'];
  ramAvailable: Array<RamValue>;
  ramRequired: Array<RamValue>;
};

export type Mutation = {
  __typename?: 'Mutation';
  validateDeck: DeckValidationResult;
};


export type MutationValidateDeckArgs = {
  input: ValidateDeckInput;
};

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
};

export type Query = {
  __typename?: 'Query';
  apiVersion: Scalars['String']['output'];
  card?: Maybe<Card>;
  cards: CardConnection;
};


export type QueryCardArgs = {
  id: Scalars['ID']['input'];
};


export type QueryCardsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  filter?: InputMaybe<CardFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
};

export type RamValue = {
  __typename?: 'RamValue';
  amount: Scalars['Int']['output'];
  color: CardColor;
};

export type ValidateDeckInput = {
  cards: Array<DeckCardInput>;
  legendIds: Array<Scalars['ID']['input']>;
  name: Scalars['String']['input'];
};

export type GetCardsQueryVariables = Exact<{
  filter?: InputMaybe<CardFilterInput>;
  first?: InputMaybe<Scalars['Int']['input']>;
  after?: InputMaybe<Scalars['String']['input']>;
}>;


export type GetCardsQuery = { __typename?: 'Query', cards: { __typename?: 'CardConnection', edges: Array<{ __typename?: 'CardEdge', cursor: string, node: { __typename?: 'Card', id: string, schemaVersion: number, revision: number, status: string, cardNumber: string, name: string, type: CardType, colors: Array<CardColor>, setCode: string, setName: string, cost?: number | null, power?: number | null, rulesText: string, tags: Array<string>, keywords: Array<string>, ram: Array<{ __typename?: 'RamValue', color: CardColor, amount: number }> } }>, pageInfo: { __typename?: 'PageInfo', endCursor?: string | null, hasNextPage: boolean } } };

export type ValidateDeckMutationVariables = Exact<{
  input: ValidateDeckInput;
}>;


export type ValidateDeckMutation = { __typename?: 'Mutation', validateDeck: { __typename?: 'DeckValidationResult', legal: boolean, mainDeckCount: number, ramAvailable: Array<{ __typename?: 'RamValue', color: CardColor, amount: number }>, ramRequired: Array<{ __typename?: 'RamValue', color: CardColor, amount: number }>, issues: Array<{ __typename?: 'DeckValidationIssue', code: string, message: string, severity: string, cardId?: string | null }> } };


export const GetCardsDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"GetCards"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"filter"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"CardFilterInput"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"first"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"after"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cards"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"filter"},"value":{"kind":"Variable","name":{"kind":"Name","value":"filter"}}},{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"Variable","name":{"kind":"Name","value":"first"}}},{"kind":"Argument","name":{"kind":"Name","value":"after"},"value":{"kind":"Variable","name":{"kind":"Name","value":"after"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"edges"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"cursor"}},{"kind":"Field","name":{"kind":"Name","value":"node"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"schemaVersion"}},{"kind":"Field","name":{"kind":"Name","value":"revision"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"cardNumber"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"type"}},{"kind":"Field","name":{"kind":"Name","value":"colors"}},{"kind":"Field","name":{"kind":"Name","value":"setCode"}},{"kind":"Field","name":{"kind":"Name","value":"setName"}},{"kind":"Field","name":{"kind":"Name","value":"cost"}},{"kind":"Field","name":{"kind":"Name","value":"power"}},{"kind":"Field","name":{"kind":"Name","value":"ram"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"rulesText"}},{"kind":"Field","name":{"kind":"Name","value":"tags"}},{"kind":"Field","name":{"kind":"Name","value":"keywords"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"pageInfo"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"endCursor"}},{"kind":"Field","name":{"kind":"Name","value":"hasNextPage"}}]}}]}}]}}]} as unknown as DocumentNode<GetCardsQuery, GetCardsQueryVariables>;
export const ValidateDeckDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ValidateDeck"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"input"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ValidateDeckInput"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"validateDeck"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"Variable","name":{"kind":"Name","value":"input"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"legal"}},{"kind":"Field","name":{"kind":"Name","value":"mainDeckCount"}},{"kind":"Field","name":{"kind":"Name","value":"ramAvailable"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"ramRequired"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"color"}},{"kind":"Field","name":{"kind":"Name","value":"amount"}}]}},{"kind":"Field","name":{"kind":"Name","value":"issues"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"code"}},{"kind":"Field","name":{"kind":"Name","value":"message"}},{"kind":"Field","name":{"kind":"Name","value":"severity"}},{"kind":"Field","name":{"kind":"Name","value":"cardId"}}]}}]}}]}}]} as unknown as DocumentNode<ValidateDeckMutation, ValidateDeckMutationVariables>;