import { mkdir, readdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const vad = path.dirname(require.resolve("@ricky0123/vad-web"));
const vadRequire = createRequire(require.resolve("@ricky0123/vad-web"));
const ort = path.dirname(vadRequire.resolve("onnxruntime-web"));
await mkdir("public/vad", { recursive: true });
for (const dir of [vad, ort]) {
  for (const file of await readdir(dir)) {
    if (
      /\.(onnx|wasm|mjs)$/.test(file) ||
      file === "vad.worklet.bundle.min.js"
    ) {
      await copyFile(path.join(dir, file), path.join("public/vad", file));
    }
  }
}
console.log("Local Silero VAD assets ready.");
