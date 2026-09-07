import { ApolloServer } from "@apollo/server";
import { resolvers } from "./resolvers";
import { typeDefs } from "./type-defs";
import type { GraphContext } from "./context";
export type { GraphContext } from "./context";
export function createGraphServer() { return new ApolloServer<GraphContext>({ typeDefs, resolvers }); }
