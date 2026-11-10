import { build } from "esbuild";
import { mkdir, cp, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
const source = process.env.SCULPTGL_SOURCE || "I:/Projects/Draw3d/.cache/native-build/sculptgl-source",
  target = path.resolve("public/sculpt");
const commit = "8e45dafc0f7906e5238dfffc1a2df742bd25f29d";
if (
  execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== commit
)
  throw Error("Unexpected SculptGL revision");
await mkdir(target, { recursive: true });
for (const name of ["css", "resources", "worker"])
  await cp(path.join(source, "app", name), path.join(target, name), { recursive: true });
await cp(path.join(source, "LICENSE"), path.join(target, "LICENSE"));
await build({
  entryPoints: ["scripts/sculpt-agent.js"],
  outfile: path.join(target, "sculpt.js"),
  bundle: true,
  minify: true,
  loader: { ".glsl": "text" },
  nodePaths: [
    path.join(source, "src"),
    path.join(source, "lib"),
    path.join(source, "node_modules"),
  ],
});
await writeFile(
  path.join(target, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Draw3D SculptGL</title><link rel="stylesheet" href="css/yagui.css"></head><body oncontextmenu="return false">${["fileopen", "backgroundopen", "alphaopen", "textureopen", "matcapopen"].map((id) => `<input type="file" id="${id}" multiple hidden>`).join("")}<div id="viewport"><canvas id="canvas"></canvas></div><script src="sculpt.js"></script><script src="/magnetism.js"></script></body></html>`,
);
await writeFile(
  path.join(target, "integration.json"),
  JSON.stringify({
    engine: "SculptGL",
    commit,
    license: "MIT",
    source: "https://github.com/stephomi/sculptgl",
    modifications: [
      "Local agent bridge",
      "Initial subdivision budget 8000 faces; native subdivision remains available",
      "Local assets only",
    ],
  }),
);
console.log("SculptGL bundled");
