"use client";

import { HttpLink } from "@apollo/client";
import {
  ApolloClient,
  ApolloNextAppProvider,
  InMemoryCache
} from "@apollo/client-integration-nextjs";

function makeClient() {
  const uri =
    typeof window === "undefined"
      ? process.env.GRAPHQL_INTERNAL_URL ?? "http://localhost:3000/api/graphql"
      : "/api/graphql";

  return new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({ uri })
  });
}

export function ApolloProvider({ children }: React.PropsWithChildren) {
  return (
    <ApolloNextAppProvider makeClient={makeClient}>
      {children}
    </ApolloNextAppProvider>
  );
}
