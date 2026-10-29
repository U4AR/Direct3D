import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [
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
    https:
      process.env.HTTPS_KEY && process.env.HTTPS_CERT
        ? {
            key: fs.readFileSync(process.env.HTTPS_KEY),
            cert: fs.readFileSync(process.env.HTTPS_CERT),
          }
        : undefined,
    proxy: { "/api": { target: "http://127.0.0.1:8788" } },
  },
  build: { target: "es2022" },
});
