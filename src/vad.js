import { MicVAD } from "@ricky0123/vad-web";
export const createMicVAD = (callbacks = {}) =>
  MicVAD.new({
    model: "v5",
    baseAssetPath: import.meta.env.BASE_URL + "vad/",
    onnxWASMBasePath: import.meta.env.BASE_URL + "vad/",
    startOnLoad: false,
    ortConfig: (ort) => {
      ort.env.wasm.numThreads = 1;
      ort.env.logLevel = "error";
    },
    ...callbacks,
  });
