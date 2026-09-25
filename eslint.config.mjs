import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals, ...nextTypescript,
  { ignores: ["**/.next/**", "**/next-env.d.ts", "packages/graphql/src/generated/**"] },
  { settings: { next: { rootDir: "apps/web/" } } },
  { rules: { "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }] } },
  {
    files: ["packages/domain/**/*.ts", "packages/engine/**/*.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: ["react", "react/*", "next", "next/*", "@apollo/*", "graphql", "graphql-*", "mongodb", "pg", "ws", "socket.io", "@tcg/persistence", "@tcg/graphql", "@tcg/web"] }] }
  }
]);
