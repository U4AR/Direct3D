import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
const root = "I:/Projects/Draw3d/.cache/native-build/openzcad-source";
const require = createRequire(root + "/package.json");
const ts = require("typescript");
const factories = await readFile(root + "/packages/command-system/src/index.ts", "utf8");
const doc = await readFile(root + "/packages/document-core/src/index.ts", "utf8");
const shared = await readFile(root + "/packages/shared/src/index.ts", "utf8");
const declarations = {};
for (const [name, text] of [
  ["doc", doc],
  ["shared", shared],
]) {
  const ast = ts.createSourceFile(name + ".ts", text, ts.ScriptTarget.Latest, true);
  for (const n of ast.statements)
    if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n))
      declarations[n.name.text] = n.getText(ast);
}
const ast = ts.createSourceFile("factories.ts", factories, ts.ScriptTarget.Latest, true),
  catalog = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "commandFactories") {
    for (const method of node.initializer.properties) {
      const signature = method.getText(ast).split("{")[0];
      const refs = new Set();
      for (const p of method.parameters || [])
        for (const id of p.type?.getText(ast).match(/[A-Z][A-Za-z0-9]+/g) || []) refs.add(id);
      const types = {};
      function include(id, depth = 0) {
        if (types[id] || !declarations[id] || depth > 3) return;
        types[id] = declarations[id];
        for (const nested of declarations[id].match(/[A-Z][A-Za-z0-9]+/g) || [])
          include(nested, depth + 1);
      }
      refs.forEach((id) => include(id));
      catalog[method.name.getText(ast)] = { signature, types };
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
await writeFile("scripts/cad-command-catalog.json", JSON.stringify(catalog, null, 2));
console.log(Object.keys(catalog).length + " CAD command signatures saved");
