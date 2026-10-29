import { readFile, writeFile } from "node:fs/promises";
import { fuseDepthFrames, meshToOBJ, DEPTH_SCHEMA } from "../src/depth.js";
const [input, output = "review.obj"] = process.argv.slice(2);
if (!input) {
  console.error("Usage: npm run reconstruct -- depth-bundle.json review.obj");
  process.exit(1);
}
const bundle = JSON.parse(await readFile(input, "utf8"));
if (bundle.schema !== DEPTH_SCHEMA)
  throw new Error("Unsupported depth bundle schema.");
const mesh = fuseDepthFrames(bundle.frames);
await writeFile(output, meshToOBJ(mesh));
console.log(
  `Wrote ${mesh.vertices.length} vertices / ${mesh.triangles.length} triangles from ${mesh.frameCount} views. Units: metres.`,
);
