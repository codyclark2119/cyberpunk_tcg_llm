import type { CodegenConfig } from "@graphql-codegen/cli";
const config: CodegenConfig = {
  schema: "packages/graphql/src/type-defs.ts",
  documents: "packages/graphql/src/operations.ts",
  generates: {
    "packages/graphql/src/generated/client.ts": {
      plugins: ["typescript", "typescript-operations", "typed-document-node"],
      config: { enumsAsTypes: true, defaultScalarType: "unknown", useTypeImports: true }
    },
    "packages/graphql/src/generated/server.ts": {
      plugins: ["typescript", "typescript-resolvers"],
      config: {
        enumsAsTypes: true, defaultScalarType: "unknown", useTypeImports: true,
        contextType: "../context#GraphContext",
        mappers: { Card: "@tcg/domain#Card as DomainCard" }
      }
    }
  }
};
export default config;
