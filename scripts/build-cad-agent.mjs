import {patchSplines} from './patch-cad-splines.mjs';
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const source = process.env.OPENZCAD_SOURCE || "I:/Projects/Draw3d/.cache/native-build/openzcad-source";
await patchSplines(source);
const require = createRequire(path.join(source, "apps/web/package.json"));
const { build, loadConfigFromFile } = await import(pathToFileURL(require.resolve("vite")).href);
const root = path.join(source, "apps/web");
const loaded = await loadConfigFromFile(
  { command: "build", mode: "production" },
  path.join(root, "vite.config.ts"),
);
const hook = await readFile(new URL("./cad-agent-hook.txt", import.meta.url), "utf8");
await build({
  ...loaded.config,
  configFile: false,
  root,
  base: "/cad/",
  build:{...loaded.config.build,rollupOptions:{...loaded.config.build?.rollupOptions,output:{entryFileNames:"assets/draw3d-[name]-[hash].js",chunkFileNames:"assets/draw3d-[name]-[hash].js",assetFileNames:"assets/draw3d-[name]-[hash][extname]"}}},
  plugins: [
    {
      name: "draw3d-native-agent",
      enforce: "pre",
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith("/apps/web/src/App.tsx")) return;
        const anchor = "  useCommandCardPrefetch(doc !== null);";
        if (code.split(anchor).length !== 2)
          throw new Error("Pinned CAD integration anchor changed");
        return code.replace(anchor, hook + "\n" + anchor);
      },
    },
    ...loaded.config.plugins,
  ],
});
