import type { GraphQLResolveInfo } from 'graphql';
import type { Card as DomainCard } from '@tcg/domain';
import type { GraphContext } from '../context';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
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



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  Card: ResolverTypeWrapper<DomainCard>;
  CardColor: CardColor;
  CardConnection: ResolverTypeWrapper<Omit<CardConnection, 'edges'> & { edges: Array<ResolversTypes['CardEdge']> }>;
  CardEdge: ResolverTypeWrapper<Omit<CardEdge, 'node'> & { node: ResolversTypes['Card'] }>;
  CardFilterInput: CardFilterInput;
  CardType: CardType;
  DeckCardInput: DeckCardInput;
  DeckValidationIssue: ResolverTypeWrapper<DeckValidationIssue>;
  DeckValidationResult: ResolverTypeWrapper<DeckValidationResult>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  RamValue: ResolverTypeWrapper<RamValue>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  ValidateDeckInput: ValidateDeckInput;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Boolean: Scalars['Boolean']['output'];
  Card: DomainCard;
  CardConnection: Omit<CardConnection, 'edges'> & { edges: Array<ResolversParentTypes['CardEdge']> };
  CardEdge: Omit<CardEdge, 'node'> & { node: ResolversParentTypes['Card'] };
  CardFilterInput: CardFilterInput;
  DeckCardInput: DeckCardInput;
  DeckValidationIssue: DeckValidationIssue;
  DeckValidationResult: DeckValidationResult;
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  Mutation: Record<PropertyKey, never>;
  PageInfo: PageInfo;
  Query: Record<PropertyKey, never>;
  RamValue: RamValue;
  String: Scalars['String']['output'];
  ValidateDeckInput: ValidateDeckInput;
};

export type CardResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['Card'] = ResolversParentTypes['Card']> = {
  cardNumber?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  colors?: Resolver<Array<ResolversTypes['CardColor']>, ParentType, ContextType>;
  cost?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  flavorText?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  imageUrl?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  keywords?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  power?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  ram?: Resolver<Array<ResolversTypes['RamValue']>, ParentType, ContextType>;
  rarity?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  revision?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  rulesText?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  schemaVersion?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  setCode?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  setName?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  tags?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  type?: Resolver<ResolversTypes['CardType'], ParentType, ContextType>;
};

export type CardConnectionResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['CardConnection'] = ResolversParentTypes['CardConnection']> = {
  edges?: Resolver<Array<ResolversTypes['CardEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
};

export type CardEdgeResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['CardEdge'] = ResolversParentTypes['CardEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['Card'], ParentType, ContextType>;
};

export type DeckValidationIssueResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['DeckValidationIssue'] = ResolversParentTypes['DeckValidationIssue']> = {
  cardId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  severity?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type DeckValidationResultResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['DeckValidationResult'] = ResolversParentTypes['DeckValidationResult']> = {
  issues?: Resolver<Array<ResolversTypes['DeckValidationIssue']>, ParentType, ContextType>;
  legal?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  mainDeckCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  ramAvailable?: Resolver<Array<ResolversTypes['RamValue']>, ParentType, ContextType>;
  ramRequired?: Resolver<Array<ResolversTypes['RamValue']>, ParentType, ContextType>;
};

export type MutationResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  validateDeck?: Resolver<ResolversTypes['DeckValidationResult'], ParentType, ContextType, RequireFields<MutationValidateDeckArgs, 'input'>>;
};

export type PageInfoResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = {
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type QueryResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  apiVersion?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  card?: Resolver<Maybe<ResolversTypes['Card']>, ParentType, ContextType, RequireFields<QueryCardArgs, 'id'>>;
  cards?: Resolver<ResolversTypes['CardConnection'], ParentType, ContextType, RequireFields<QueryCardsArgs, 'first'>>;
};

export type RamValueResolvers<ContextType = GraphContext, ParentType extends ResolversParentTypes['RamValue'] = ResolversParentTypes['RamValue']> = {
  amount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  color?: Resolver<ResolversTypes['CardColor'], ParentType, ContextType>;
};

export type Resolvers<ContextType = GraphContext> = {
  Card?: CardResolvers<ContextType>;
  CardConnection?: CardConnectionResolvers<ContextType>;
  CardEdge?: CardEdgeResolvers<ContextType>;
  DeckValidationIssue?: DeckValidationIssueResolvers<ContextType>;
  DeckValidationResult?: DeckValidationResultResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  RamValue?: RamValueResolvers<ContextType>;
};

