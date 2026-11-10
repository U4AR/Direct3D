import {versionCadWorker} from './scripts/version-cad-worker.mjs';
import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
let outputDirectory="dist";
export default defineConfig({
  plugins: [
    {
      name:'current-public-assets',apply:'build',configResolved(config){outputDirectory=config.build.outDir;},
      async closeBundle(){
        // CAD builds leave old hashed assets for open tabs. Package only the
        // current manifest, avoiding stale files left by previous installations.
        const source=path.resolve('public'),target=path.resolve(outputDirectory),manifest=JSON.parse(await fs.promises.readFile(path.join(source,'cad/asset-manifest.json'),'utf8')),assets=new Set(manifest);
        async function copy(from,to,relative=''){await fs.promises.mkdir(to,{recursive:true});for(const e of await fs.promises.readdir(from,{withFileTypes:true})){const rel=relative+e.name;if(rel.startsWith('cad/assets/')&&!e.isDirectory()&&!assets.has(rel.slice('cad/assets/'.length)))continue;const src=path.join(from,e.name),dst=path.join(to,e.name),directory=e.isDirectory()||e.isSymbolicLink()&&(await fs.promises.stat(src)).isDirectory();if(directory)await copy(src,dst,rel+'/');else await fs.promises.copyFile(src,dst);}}
        await copy(source,target);
        await versionCadWorker(path.join(target,'cad'));
      }
    },
    {
      name: "local-vad-assets",
      configureServer(server) {
        // ONNX dynamically imports its untransformed Emscripten module. Vite's
        // default public middleware rejects .mjs?import; serve only these assets.
        server.middlewares.use("/vad", (req, res, next) => {
          const name = req.url.split("?")[0];
          if (!/^\/[a-zA-Z0-9_.-]+\.(mjs|js|wasm|onnx)$/.test(name))
            return next();
          const file = path.join(process.cwd(), "public", "vad", name.slice(1));
          if (!fs.existsSync(file)) return next();
          res.setHeader(
            "Content-Type",
            /\.(mjs|js)$/.test(name)
              ? "text/javascript"
              : name.endsWith(".wasm")
                ? "application/wasm"
                : "application/octet-stream",
          );
          fs.createReadStream(file).pipe(res);
        });
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/private/**", "**/sessions/**", "**/artifacts/**"] },
    https:
      process.env.HTTPS_KEY && process.env.HTTPS_CERT
        ? {
            key: fs.readFileSync(process.env.HTTPS_KEY),
            cert: fs.readFileSync(process.env.HTTPS_CERT),
          }
        : undefined,
    proxy: { "/api": { target: process.env.DRAW3D_BACKEND_URL || "http://127.0.0.1:8788" } },
  },
  build: { copyPublicDir:false, target: "es2022", rollupOptions: { input: { inspector:"inspector.html", concepts: "concepts.html", spatial: "index.html", desktop: "desktop.html" } } },
});
