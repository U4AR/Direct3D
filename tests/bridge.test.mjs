import test from "node:test";
import assert from "node:assert/strict";
import { buildInput, startBridge, silentPCM } from "../scripts/model-bridge.mjs";
test("Gemini payload preserves target calibration and sends other views as context", () => {
  const image = "data:image/png;base64,YWJj";
  const input = buildInput({
    description: "A vase",
    frame: {
      id: "view-1",
      near: 1,
      far: 3,
      sketchImage: image,
      depthImage: image,
      intrinsics: { fx: 100 },
      cameraToWorld: [1],
    },
    context: [{ id: "view-2", sketchImage: image, cameraToWorld: [2] }],
  });
  assert.equal(input.filter((x) => x.type === "image").length, 3);
  assert.match(input[0].text, /CAMERA-Z/);
  assert.match(input[0].text, /A vase/);
  assert.throws(() => buildInput({ description: "", frame: {}, context: [] }));
});
test("bridge clearly reports an absent key without making an upstream request", async () => {
  const old = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const server = await startBridge(0);
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/depth`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /GEMINI_API_KEY/);
  } finally {
    await new Promise((r) => server.close(r));
    if (old) process.env.GEMINI_API_KEY = old;
  }
});


test("backend alone authenticates upstream and keeps credentials out of responses",async()=>{
  const {encodeWav}=await import("../src/audio.js");
  const old=process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY="server-only-test-credential";
  let upstream=0;
  const server=await startBridge(0,{providerFetch:async(url,options)=>{
    upstream++;
    assert.equal(url,"https://generativelanguage.googleapis.com/v1/interactions");
    assert.equal(options.headers["x-goog-api-key"],"server-only-test-credential");
    const payload=JSON.parse(options.body);
    assert.equal(payload.input[0].type,"user_input");
    assert.equal(payload.input[0].content[1].type,"audio");
    assert.equal(payload.response_format.type,"text");
    assert.equal(payload.response_modalities,undefined);
    assert.equal(options.body.includes("server-only-test-credential"),false);
    return new Response(JSON.stringify({steps:[{type:"model_output",content:[{type:"text",text:"A vase"}]}]}),{status:200});
  }});
  try{
    const audio=Buffer.from(await encodeWav(Float32Array.from({length:1600},(_,i)=>Math.sin(i)*0.1)).arrayBuffer()).toString("base64");
    assert.equal(silentPCM(audio),false);
    const post=audio=>fetch(`http://127.0.0.1:${server.address().port}/api/transcribe`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({audio,mimeType:"audio/wav"})});
    const response=await post(audio);assert.equal(response.status,200);assert.equal((await response.json()).text,"A vase");
    const silence=Buffer.from(await encodeWav(new Float32Array(1600)).arrayBuffer()).toString("base64");
    assert.equal(silentPCM(silence),true);
    assert.equal((await(await post(silence)).json()).skipped,"silence");
    assert.equal(upstream,1);
    const health=await(await fetch(`http://127.0.0.1:${server.address().port}/api/depth/health`)).text();
    assert.equal(health.includes("server-only-test-credential"),false);
  } finally{await new Promise(r=>server.close(r));if(old)process.env.GEMINI_API_KEY=old;else delete process.env.GEMINI_API_KEY;}
});


test("unavailable image primary falls back on PC with 1K settings and reports actual model",async()=>{
  const old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="fallback-test-key";
  const calls=[];
  const server=await startBridge(0,{imageModel:"models/gemini-nano-banana-2.1",imageFallbackModel:"models/gemini-3.1-flash-lite-image",providerFetch:async(url,options)=>{
    const payload=JSON.parse(options.body);calls.push({url,payload});
    assert.equal(options.headers["x-goog-api-key"],"fallback-test-key");
    if(calls.length===1) return new Response(JSON.stringify({error:{message:"No quota"}}),{status:429});
    assert.equal(payload.model,"models/gemini-3.1-flash-lite-image");
    assert.equal(payload.response_format.image_size,"1K");
    assert.equal(payload.generation_config.thinking_level,"minimal");
    assert.deepEqual(payload.input,calls[0].payload.input);
    return new Response(JSON.stringify({steps:[{type:"model_output",content:[{type:"image",mime_type:"image/png",data:"YWJj"}]}]}),{status:200});
  }});
  try {
    const image="data:image/png;base64,YWJj";
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/depth`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({description:"a vase",frame:{id:"one",near:1,far:3,sketchImage:image,depthImage:image,intrinsics:{},cameraToWorld:[]},context:[]})});
    const result=await response.json();assert.equal(response.status,200);
    assert.equal(result.model,"models/gemini-3.1-flash-lite-image");assert.equal(result.fallbackUsed,true);assert.equal(calls.length,2);
  } finally {await new Promise(r=>server.close(r));if(old)process.env.GEMINI_API_KEY=old;else delete process.env.GEMINI_API_KEY;}
});


test("Nano Banana 2 Lite is called first with its supported image settings",async()=>{
  const old=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="primary-lite-test-key";
  let calls=0;
  const server=await startBridge(0,{providerFetch:async(url,options)=>{
    calls++;
    const body=JSON.parse(options.body);
    assert.equal(url,"https://generativelanguage.googleapis.com/v1/interactions");
    assert.equal(body.model,"models/gemini-3.1-flash-lite-image");
    assert.equal(body.response_format.image_size,"1K");
    assert.equal(body.generation_config.max_output_tokens,4096);
    assert.equal(body.generation_config.thinking_level,"minimal");
    return new Response(JSON.stringify({steps:[{type:"model_output",content:[{type:"image",mime_type:"image/png",data:"YWJj"}]}]}),{status:200});
  }});
  try{
    const image="data:image/png;base64,YWJj";
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api/depth`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({description:"vase",frame:{id:"one",near:1,far:3,sketchImage:image,depthImage:image,intrinsics:{},cameraToWorld:[]},context:[]})});
    assert.equal(r.status,200);const result=await r.json();assert.equal(result.model,"models/gemini-3.1-flash-lite-image");assert.equal(result.fallbackUsed,false);assert.equal(calls,1);
  }finally{await new Promise(r=>server.close(r));if(old)process.env.GEMINI_API_KEY=old;else delete process.env.GEMINI_API_KEY;}
});
