import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import ts from "typescript";
const allowed: Record<string, string[]> = {
  domain: ["zod"], engine: ["@tcg/domain", "zod"],
  graphql: ["@tcg/domain", "@apollo/server", "graphql", "graphql-tag", "@graphql-typed-document-node/core", "zod"],
  persistence: ["@tcg/domain", "mongodb", "pg", "zod"],
  "training-harness": ["@tcg/domain", "@tcg/engine", "zod"]
};
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]);
}
test("workspace manifests and source imports enforce dependency direction", () => {
  for (const [name, dependencies] of Object.entries(allowed)) {
    const root = resolve("packages", name);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    for (const dependency of Object.keys(manifest.dependencies)) assert.ok(dependencies.includes(dependency), `${name} -> ${dependency}`);
    for (const file of files(join(root, "src")).filter(f => f.endsWith(".ts"))) {
      const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      function check(node: ts.Node) {
        let specifier: string | undefined;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
          assert.ok(node.arguments[0] && ts.isStringLiteral(node.arguments[0]), "Dynamic module paths are not allowed in packages");
          specifier = node.arguments[0].text;
        }
        if (specifier) {
          if (specifier.startsWith(".")) assert.ok(!relative(root, resolve(file, "..", specifier)).startsWith(".."), `${file} escapes package`);
          else {
            const packageName = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
            assert.ok(dependencies.includes(packageName) || (name === "domain" && specifier === "node:crypto"), `${file} imports forbidden ${specifier}`);
          }
        }
        ts.forEachChild(node, check);
      }
      check(ast);
    }
  }
});
