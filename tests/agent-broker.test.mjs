import { tmpdir } from "node:os";
import path from "node:path";
import { encodeWav, blobToBase64 } from "../src/audio.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { handleAgent, tokenFile } from "../scripts/agent-broker.mjs";
test("broker enforces origin, capabilities, session ownership and single dispatch", async () => {
  const server = http.createServer((req, res) => handleAgent(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port + "/api/agent/";
  const secret = (await readFile(tokenFile, "utf8")).trim();
  const request = (route, { token, origin, data } = {}) =>
    fetch(base + route, {
      method: data ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  try {
    assert.equal((await request("sessions")).status, 401);
    assert.equal(
      (await request("register", { origin: "https://evil.example", data: {} })).status,
      403,
    );
    assert.equal((await request("register", { data: {} })).status, 400);
    const a = await (
      await request("register", { origin: "http://localhost:5173", data: { label: "test A", recordingId:"a1111111-1111-4111-a111-111111111111" } })
    ).json();
    const b = await (
      await request("register", { origin: "http://localhost:5173", data: { label: "test B" } })
    ).json();
    assert.equal(
      (
        await request("command", {
          token: a.token,
          data: { sessionId: a.id, tool: "agent_status" },
        })
      ).status,
      401,
    );
    for (const route of ["sketch-command", "sketch-refine", "image-surface", "desktop-edit", "desktop-applied", "ai-run", "ai-stop", "ai-answer", "ai-status", "audio-log"]) {
      assert.equal(
        (await request(route + "?session=" + a.id, { token: b.token, data: { prompt: "test" } }))
          .status,
        401,
      );
      assert.equal(
        (await request(route + "?session=" + a.id, { token: secret, data: { prompt: "test" } }))
          .status,
        401,
      );
    }
    const ai = await (
      await request("ai-status?session=" + a.id, { token: a.token, data: {} })
    ).json();
    assert.equal(ai.model, "gpt-6-luna");
    assert.equal(ai.run, null);
    // Browser capabilities use a separate header so HTTPS gateway Basic auth remains intact.
    const httpsLogin=await fetch(base+'ai-status?session='+a.id,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173',Authorization:'Basic ZGVzaWduZXI6dGVzdA==','X-Draw3D-Capability':a.token},body:'{}'});
    assert.equal(httpsLogin.status,200);
    const wrongLogin=await fetch(base+'ai-status?session='+a.id,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173','X-Draw3D-Capability':b.token},body:'{}'});assert.equal(wrongLogin.status,401);
    const previousRoot=process.env.SESSION_DIR;
    const logRoot=await mkdtemp(path.join(tmpdir(),"draw3d-audio-test-"));
    process.env.SESSION_DIR=logRoot;
    try {
      const id="b2222222-2222-4222-b222-222222222222";
      const audio=await blobToBase64(encodeWav(new Float32Array([0,.5,-.5,0])));
      assert.equal((await request("audio-log?session="+a.id,{token:b.token,data:{id,audio}})).status,401);
      assert.equal((await request("audio-log?session="+a.id,{token:a.token,data:{id:"../escape",audio}})).status,400);
      const saved=await (await request("audio-log?session="+a.id,{token:a.token,data:{id,audio,start:10,end:11}})).json();
      assert.equal(saved.saved,true);
      const bytes=await readFile(path.join(logRoot,"audio","a1111111-1111-4111-a111-111111111111",id+".wav"));
      assert.equal(bytes.toString('base64'),audio);
    } finally {if(previousRoot===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previousRoot;await rm(logRoot,{recursive:true,force:true});}
    const job = await (
      await request("command", { token: secret, data: { sessionId: a.id, tool: "agent_status" } })
    ).json();
    assert.equal((await request("poll?session=" + a.id, { token: b.token, data: {} })).status, 401);
    const polled = await (
      await request("poll?session=" + a.id, { token: a.token, data: {} })
    ).json();
    assert.equal(polled.job.id, job.id);
    assert.equal(
      (await (await request("poll?session=" + a.id, { token: a.token, data: {} })).json()).job,
      null,
    );
    assert.equal(
      (
        await request("result?session=" + b.id, {
          token: b.token,
          data: { id: job.id, result: {} },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("result?session=" + a.id, {
          token: a.token,
          data: { id: job.id, result: { ok: true } },
        })
      ).status,
      200,
    );
    const completed = await (await request("job?id=" + job.id, { token: secret })).json();
    assert.equal(completed.state, "completed");
    assert.equal(completed.result.ok, true);
    const sessions = await (await request("sessions", { token: secret })).json();
    assert.ok(!JSON.stringify(sessions).includes(a.token));
  } finally {
    await new Promise((r) => server.close(r));
  }
});


test("clarification resumes the same run once, with scoped answers and cancellation while waiting", async () => {
  const server = http.createServer((req, res) => handleAgent(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/agent/";
  const originalFetch = globalThis.fetch, previousKey = process.env.OPENAI_API_KEY, previousRoot = process.env.SESSION_DIR;
  const logRoot = await mkdtemp(path.join(tmpdir(), "draw3d-question-"));
  process.env.OPENAI_API_KEY = "question-test-key"; process.env.SESSION_DIR = logRoot;
  const providerRequests = [];
  const questionCall = { type: "function_call", call_id: "clarification-call", name: "draw3d_tool",
    arguments: JSON.stringify({ tool: "agent_ask_question", argumentsJson: JSON.stringify({ question: "Should the wings curve?", options: ["Curved", "Flat"], reason: "This changes the surface construction.", region: "wings" }) }) };
  globalThis.fetch = async (url, options) => {
    if (String(url) !== "https://api.openai.com/v1/responses") return originalFetch(url, options);
    const input = JSON.parse(options.body); providerRequests.push(input);
    const answered = input.input.some((entry) => entry.type === "function_call_output" && entry.call_id === "clarification-call");
    return { ok: true, status: 200, json: async () => ({ status: "completed", output: answered
      ? [{ type: "message", content: [{ type: "output_text", text: "Your curved-wing choice is recorded." }] }]
      : [questionCall] }) };
  };
  const request = async (route, session, data = {}) => originalFetch(base + route + (session ? "?session=" + session.id : ""), {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:5173", ...(session ? { Authorization: "Bearer " + session.token } : {}) }, body: JSON.stringify(data),
  });
  const waitFor = async (session, state) => {
    for (let i = 0; i < 200; i++) {
      const data = await (await request("ai-status", session)).json();
      if (data.run?.state === state) return data.run;
      if (data.run?.state === "failed") throw Error(data.run.error);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail("Agent did not enter " + state);
  };
  let a, b;
  try {
    a = await (await request("register", null, { label: "question A" })).json();
    b = await (await request("register", null, { label: "question B" })).json();
    assert.equal((await request("ai-run", a, { prompt: "Create a butterfly" })).status, 200);
    const pending = await waitFor(a, "waiting_for_answer");
    assert.equal(pending.question.question, "Should the wings curve?");
    assert.deepEqual(pending.question.options, ["Curved", "Flat"]);
    assert.equal(providerRequests.length, 1);
    assert.equal((await request("ai-run", a, { prompt: "A second request" })).status, 400);
    const answer = { runId: pending.id, questionId: pending.question.id, answer: "Curved", source: "speech" };
    assert.equal((await request("ai-answer", { ...a, token: b.token }, answer)).status, 401);
    assert.equal((await request("ai-answer", b, answer)).status, 400);
    assert.equal((await request("ai-answer", a, { ...answer, runId: "wrong" })).status, 400);
    const first = await (await request("ai-answer", a, answer)).json();
    assert.equal(first.accepted, true); assert.equal(first.duplicate, false);
    const completed = await waitFor(a, "completed");
    assert.equal(completed.id, pending.id);
    assert.equal(completed.question.status, "answered");
    assert.equal(completed.question.source, "speech");
    assert.equal(providerRequests.length, 2);
    const resumed = providerRequests[1].input;
    const output = resumed.find((entry) => entry.type === "function_call_output" && entry.call_id === "clarification-call");
    assert.equal(JSON.parse(output.output).answer, "Curved");
    assert.ok(resumed.some((entry) => entry.role === "user" && JSON.stringify(entry.content).includes("user answered")));
    const duplicate = await (await request("ai-answer", a, answer)).json();
    assert.equal(duplicate.duplicate, true);
    assert.equal((await request("ai-answer", a, { ...answer, answer: "Flat" })).status, 400);
    assert.equal(providerRequests.length, 2);
    const logs = (await readFile(path.join(logRoot, "agent-runs", pending.id, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(logs.filter((entry) => entry.type === "question.answered").length, 1);
    assert.equal((await request("ai-run", a, { prompt: "Another butterfly" })).status, 200);
    const waitingA = await waitFor(a, "waiting_for_answer");
    assert.equal((await request("ai-run", b, { prompt: "A vase" })).status, 200);
    await waitFor(b, "waiting_for_answer");
    const c = await (await request("register", null, { label: "question C" })).json();
    assert.equal((await request("ai-run", c, { prompt: "A third active run" })).status, 400);
    await request("ai-stop", a); await request("ai-stop", b);
    const stopped = await waitFor(a, "stopped"); await waitFor(b, "stopped");
    assert.equal(stopped.question.status, "cancelled");
    assert.equal((await request("ai-answer", a, { ...answer, runId: waitingA.id, questionId: waitingA.question.id })).status, 400);
    assert.equal(providerRequests.length, 4);
  } finally {
    if (a) await request("ai-stop", a).catch(() => {});
    if (b) await request("ai-stop", b).catch(() => {});
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    if (previousRoot === undefined) delete process.env.SESSION_DIR; else process.env.SESSION_DIR = previousRoot;
    await new Promise((resolve) => server.close(resolve));
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("the active-work deadline preserves remaining time while a user thinks", async () => {
  const { createPausableDeadline } = await import("../scripts/agent-questions.mjs");
  let now = 0, next = 0, expired = false;
  const scheduled = new Map();
  const deadline = createPausableDeadline(() => { expired = true; }, 100, {
    now: () => now,
    setTimeout: (callback, delay) => { const id = ++next; scheduled.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => scheduled.delete(id),
  });
  now = 30; deadline.pause();
  assert.equal(scheduled.size, 0);
  now = 86400000;
  assert.equal(expired, false);
  deadline.resume();
  assert.equal([...scheduled.values()][0].delay, 70);
  deadline.dispose();
  assert.equal(scheduled.size, 0);
});


test('desktop broker makes one model request, acknowledges local application and cancels without tool jobs',async()=>{
 const previousKey=process.env.OPENAI_API_KEY,previousRoot=process.env.SESSION_DIR,originalFetch=global.fetch;process.env.OPENAI_API_KEY='synthetic-fixture-key';const folder=await mkdtemp(path.join(tmpdir(),'draw3d-direct-broker-'));process.env.SESSION_DIR=folder;let calls=0,hold=false,release;
 const result={summary:'Created a synthetic drawing.',assumptions:[],question:null,edits:[]};
 global.fetch=async(url,options)=>{if(String(url).startsWith('https://api.openai.com/v1/responses')){calls++;const body=JSON.parse(options.body);assert.equal(body.tools,undefined);if(hold)await new Promise(resolve=>release=resolve);return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]})};}return originalFetch(url,options);};
 const server=http.createServer((req,res)=>handleAgent(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/agent/';
 const request=async(route,data,cap)=>{const r=await originalFetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173',...(cap?{Authorization:'Bearer '+cap.token}:{})},body:JSON.stringify(data)});assert.equal(r.status,200);return r.json();};
 try{const cap=await request('register',{label:'synthetic direct broker test'}),send=(route,data)=>request(route+'?session='+cap.id,data,cap),payload={requestId:'synthetic-one',prompt:'Synthetic protocol test only',evidence:{version:1,sketchRevision:0,strokes:[],figures:[],frames:[]}};
 const first=await send('desktop-edit',payload);assert.equal(first.run.mode,'direct');assert.equal(first.run.providerCallCount,1);assert.equal(calls,1);const polled=await send('poll',{});assert.equal(polled.job,null);const ack=await send('desktop-applied',{runId:first.run.id,appliedCount:0,review:{kind:'drawing'}});assert.equal(ack.run.state,'completed');assert.equal(calls,1);const duplicate=await send('desktop-edit',payload);assert.equal(duplicate.run.id,first.run.id);assert.equal(calls,1);
 hold=true;const pending=send('desktop-edit',{...payload,requestId:'synthetic-two'});for(let i=0;i<100&&calls<2;i++)await new Promise(r=>setTimeout(r,5));assert.equal(calls,2);const stopped=await send('ai-stop',{});assert.equal(stopped.run.state,'stopped');release();assert.equal((await pending).run.state,'stopped');
 }finally{global.fetch=originalFetch;server.closeAllConnections();await new Promise(r=>server.close(r));if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;if(previousRoot===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previousRoot;await rm(folder,{recursive:true,force:true});}
});


test('model-requested moves continue the same direct run with refreshed evidence and application results',async()=>{
 const key=process.env.OPENAI_API_KEY,root=process.env.SESSION_DIR,originalFetch=global.fetch;process.env.OPENAI_API_KEY='synthetic-fixture-key';const folder=await mkdtemp(path.join(tmpdir(),'draw3d-continuation-'));process.env.SESSION_DIR=folder;let calls=0;const inputs=[];
 global.fetch=async(url,options)=>{if(!String(url).startsWith('https://api.openai.com/v1/responses'))return originalFetch(url,options);calls++;const body=JSON.parse(options.body);assert.equal(body.tools,undefined);inputs.push(JSON.parse(body.input.at(-1).content[0].text));return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Move '+calls,assumptions:[],question:null,edits:[],automation:{goal:'Requested coordinated layout',reason:'Dependent construction and inspection',steps:[{id:'construct',label:'Construct the layout',state:calls===1?'active':'completed'},{id:'inspect',label:'Inspect dimensions',state:calls<3?'pending':'completed'}]},continuation:calls<3?{reason:'Inspect updated geometry before finishing move '+calls,nextMove:'Check the latest dimensions'}:null})}]}]})};};
 const server=http.createServer((req,res)=>handleAgent(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/agent/';
 const request=async(route,data,cap)=>{const r=await originalFetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173',...(cap?{Authorization:'Bearer '+cap.token}:{})},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
 try{const {data:cap}=await request('register',{label:'synthetic continuation test'}),send=(route,data)=>request(route+'?session='+cap.id,data,cap),evidence={version:1,sketchRevision:0,strokes:[],figures:[],frames:[]};let {data:response}=await send('desktop-edit',{requestId:'move-1',prompt:'Original user goal',evidence});const id=response.run.id;
 // A client cannot invent another move before local application is acknowledged.
 assert.equal((await send('desktop-edit',{requestId:'premature',continueRunId:id,previousTurn:1,evidence})).status,400);assert.equal(calls,1);
 for(let turn=1;turn<=3;turn++){assert.equal(response.run.id,id);assert.equal(response.run.step,turn);assert.equal(response.run.automation.goal,'Requested coordinated layout');const report={kind:'drawing',figureIds:['figure-'+turn],models:[],modelIds:[],sourceStrokeIds:[]};let {data:ack}=await send('desktop-applied',{runId:id,turn,appliedCount:1,review:report});if(turn<3){assert.equal(ack.run.state,'running');assert.equal(ack.continuation.previousTurn,turn);const duplicate=(await send('desktop-applied',{runId:id,turn,appliedCount:1,review:report})).data;assert.deepEqual(duplicate.continuation,ack.continuation);response=(await send('desktop-edit',{requestId:'move-'+(turn+1),continueRunId:id,previousTurn:turn,prompt:'Ignored client replacement goal',evidence:{...evidence,sketchRevision:turn,figures:[{id:'figure-'+turn,version:turn}]}})).data;}else{assert.equal(ack.run.state,'completed');assert.equal(ack.run.providerCallCount,3);assert.equal(ack.run.automation.state,'completed');assert.equal(ack.run.automation.steps.every(s=>s.state==='completed'),true);assert.deepEqual(ack.run.review.figureIds,['figure-1','figure-2','figure-3']);}}
 assert.equal(calls,3);assert.equal(inputs[2].userPrompt,'Original user goal');assert.equal(inputs[2].evidence.sketchRevision,2);assert.equal(inputs[2].continuation.automation.goal,'Requested coordinated layout');assert.equal(inputs[2].applicationResults.length,2);assert.equal(inputs[2].applicationResults[1].appliedCount,1);assert.equal((await send('poll',{})).data.job,null);
 assert.equal((await send('desktop-edit',{requestId:'unrequested-fourth',continueRunId:id,previousTurn:3,evidence})).status,400);assert.equal(calls,3);
 }finally{global.fetch=originalFetch;server.closeAllConnections();await new Promise(r=>server.close(r));if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;if(root===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=root;await rm(folder,{recursive:true,force:true});}
});


test('full browser slots reclaim disconnected idle sessions while a recently polled browser stays authorized',async()=>{
 const {handleAgent:isolated}=await import('../scripts/agent-broker.mjs?idle-slot-test'),server=http.createServer((req,res)=>isolated(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/agent/',realNow=Date.now;let now=realNow();Date.now=()=>now;
 const call=(route,data={},token)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173',...(token?{'X-Draw3D-Capability':token}:{})},body:JSON.stringify(data)});
 try{const sessions=[];for(let i=0;i<32;i++){const response=await call('register',{label:'slot-test-'+i});assert.equal(response.status,200);sessions.push(await response.json());}assert.equal((await call('register')).status,400);now+=119000;const active=sessions.at(-1);assert.equal((await call('ai-status?session='+active.id,{},active.token)).status,200);now+=2000;assert.equal((await call('register',{label:'replacement'})).status,200);assert.equal((await call('ai-status?session='+active.id,{},active.token)).status,200);assert.equal((await call('ai-status?session='+sessions[0].id,{},sessions[0].token)).status,401);}finally{Date.now=realNow;await new Promise(r=>server.close(r));}
});
