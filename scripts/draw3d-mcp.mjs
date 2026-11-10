import {fittingNames,fittingTool} from "./fitting-tools.mjs";
import { validate } from "./agent-validation.mjs";
// MCP stdio: newline-delimited JSON-RPC; stdout contains protocol messages only.
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { agentTools } from "./agent-tools.mjs";
const endpoint = process.env.DRAW3D_AGENT_URL || "http://127.0.0.1:8788";
const secretFile =
  process.env.DRAW3D_AGENT_TOKEN_FILE || "I:/Projects/Draw3d/.cache/native-build/private/agent-token";
const write = (data) => process.stdout.write(JSON.stringify(data) + "\n");
async function api(route, body) {
  const secret = (await readFile(secretFile, "utf8")).trim();
  const r = await fetch(endpoint + "/api/agent/" + route, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Agent bridge failed");
  return data;
}
async function call(name, args) {
  const t = agentTools.find((t) => t.name === name);
  if (!t) throw Error("Unknown tool");
  validate(t.inputSchema, args);
  if(fittingNames.includes(name))return fittingTool(name,args,args.sessionId,(tool,params)=>call(tool,{...params,sessionId:args.sessionId}));
  if (name === "cad_command_help") {
    const catalog = JSON.parse(
      await readFile(new URL("./cad-command-catalog.json", import.meta.url), "utf8"),
    );
    if (args.operation) {
      if (!Object.hasOwn(catalog, args.operation)) throw Error("Unknown CAD operation");
      return catalog[args.operation];
    }
    return { operations: Object.keys(catalog) };
  }
  if (name === "draw3d_sessions") return api("sessions");
  const { sessionId, ...rest } = args;
  const j = await api("command", { sessionId, tool: name, args: rest });
  const deadline = Date.now() + 125000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const state = await api("job?id=" + encodeURIComponent(j.id));
    if (state.state === "completed") {
      if (state.error) throw Error(state.error);
      return state.result;
    }
  }
  throw Error("Command timed out; inspect state before retrying");
}
createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", async (line) => {
  let m;
  try {
    m = JSON.parse(line);
    if (m.id === undefined) return;
    let result;
    switch (m.method) {
      case "initialize":
        result = {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "draw3d-editors", version: "1.0.0" },
          instructions:
            "Use draw3d_sessions to select a browser. Tools edit shared CAD/sculpt models; camera and workspace are independent from the user. Re-read versions after user edits. No arbitrary code execution.",
        };
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: agentTools };
        break;
      case "tools/call":
        try {
          const data = await call(m.params.name, m.params.arguments || {});
          result = data?.frames
            ? {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      ...data,
                      frames: data.frames.map(({ image, ...frame }) => frame),
                    }),
                  },
                  ...data.frames.flatMap((frame) => [
                    { type: "text", text: "Sketch view: " + frame.view },
                    { type: "image", mimeType: "image/png", data: frame.image.split(",")[1] },
                  ]),
                ],
              }
            : data?.image
              ? {
                  content: [
                    { type: "image", mimeType: "image/png", data: data.image.split(",")[1] },
                    { type: "text", text: JSON.stringify({ ...data, image: undefined }) },
                  ],
                }
              : { content: [{ type: "text", text: JSON.stringify(data) }] };
        } catch (e) {
          result = { isError: true, content: [{ type: "text", text: e.message }] };
        }
        break;
      default:
        write({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
        return;
    }
    write({ jsonrpc: "2.0", id: m.id, result });
  } catch (e) {
    write({ jsonrpc: "2.0", id: m?.id ?? null, error: { code: -32700, message: e.message } });
  }
});
