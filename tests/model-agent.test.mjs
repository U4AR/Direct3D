import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runModelAgent, toolResultParts, safeError, compactAgentContext } from "../scripts/model-agent.mjs";
const response = (output) => ({
  ok: true,
  status: 200,
  json: async () => ({ status: "completed", output }),
});
const call = (id, tool, args) => ({
  type: "function_call",
  call_id: id,
  name: "draw3d_tool",
  arguments: JSON.stringify({ tool, argumentsJson: JSON.stringify(args) }),
});
test("agent validates calls, binds session and feeds images and reasoning back to OpenAI", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "draw3d-agent-"));
  const run = { id: "test", model: "gpt-6-luna", reasoning: "medium", events: [] };
  const requests = [],
    calls = [];
  try {
    const turns = [
      [call("a", "cad_undo", { expectedVersion: "wrong" })],
      [call("b", "agent_status", { sessionId: "another" })],
      [
        { type: "reasoning", encrypted_content: "preserve-this", summary: [] },
        call("c", "agent_capture", {}),
      ],
      [{ type: "message", content: [{ type: "output_text", text: "Inspected the capture." }] }],
    ];
    await runModelAgent({
      run,
      prompt: "Inspect",
      sessionId: "current",
      signal: new AbortController().signal,
      logRoot: folder,
      providerFetch: async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/responses");
        requests.push(JSON.parse(options.body));
        return response(turns.shift());
      },
      execute: async (name, args) => {
        calls.push({ name, args });
        return { image: "data:image/png;base64,aGVsbG8=", camera: { position: [1, 2, 3] } };
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "agent_capture");
    assert.equal(run.answer, "Inspected the capture.");
    assert.match(JSON.stringify(requests[1]), /Invalid numeric argument/);
    assert.match(JSON.stringify(requests[2]), /Session switching is not allowed/);
    assert.ok(
      requests[3].input
        .at(-1)
        .content.some((p) => p.image_url === "data:image/png;base64,aGVsbG8="),
    );
    assert.ok(requests[3].input.some((p) => p.encrypted_content === "preserve-this"));
    assert.equal(requests[0].reasoning.effort, "medium");
    assert.equal(requests[0].store, false);
    assert.equal(requests[0].parallel_tool_calls, false);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
test("cancelled runs never invoke provider or editors", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "draw3d-cancel-"));
  const controller = new AbortController();
  controller.abort(Error("Stop"));
  try {
    await assert.rejects(
      runModelAgent({
        run: { id: "test", events: [] },
        prompt: "x",
        signal: controller.signal,
        logRoot: folder,
        providerFetch: () => assert.fail("provider called"),
        execute: () => assert.fail("editor called"),
      }),
      /Stop/,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
test("image results retain calibration and backend errors redact keys", () => {
  const p = toolResultParts({
    frames: [{ view: "top", image: "data:image/png;base64,YQ==", matrix: [1, 2] }],
  });
  assert.equal(p.images.length, 1);
  assert.match(p.text, /matrix/);
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "secret-test";
  assert.equal(safeError(Error("key secret-test")), "key [REDACTED]");
  if (previous === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previous;
});


const say = (text) => ({ type: "message", content: [{ type: "output_text", text }] });
const regionContract = { id: "wing", goal: "Trace the left butterfly wing", mode: "sculpt", strokeIds: ["s1"],
  technique: "Project outline then construct thin mesh", acceptanceCriteria: ["Contour matches the drawing"] };
test("real regional loops inherit the goal, preserve scope, and stage a verified draft without archiving", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "draw3d-regions-"));
  const run = { id: "test", model: "gpt-6-luna", events: [] };
  const requests = [], editors = [], models = [];
  const turns = [
    [call("p", "agent_plan", { regions: [regionContract] })],
    [call("d", "agent_delegate", { regionId: "wing", instructions: "Keep wing 4mm thick." })],
    [call("c", "sculpt_create", { shape: "sphere", expectedVersion: 0 })],
    [call("bad", "model_transform", { modelId: "other", position: [0,0,0], rotationDeg: [0,0,0], scale: [1,1,1], expectedVersion: 1 })],
    [call("pic", "agent_capture", { modelIds: ["sculpt::wing"] })],
    [say("Created wing; needs assembly review.")],
    [call("scene", "scene_models", {})],
    [call("review", "agent_review", { modelIds: ["sculpt::wing"], summary: "A thin wing draft", uncertainties: ["Confirm thickness"] })],
    [call("postreview", "sculpt_create", { shape: "sphere", expectedVersion: 1 })],
    [say("Please check the wing thickness.")],
  ];
  try {
    await runModelAgent({ run, prompt: "Make my butterfly", promptIds: ["speech-1"], sessionId: "quest",
      signal: new AbortController().signal, logRoot: folder,
      providerFetch: async (_, options) => { requests.push(JSON.parse(options.body)); return response(turns.shift()); },
      execute: async (tool, args) => {
        editors.push({ tool, args });
        if (tool === "scene_models") return { models: structuredClone(models) };
        if (tool === "sculpt_create") { models.push({ id: "sculpt::wing", version: 1, name: "wing", source: "sculpt" }); return { id: "wing" }; }
        if (tool === "agent_capture") return { image: "data:image/png;base64,YQ==" };
        assert.fail("Unexpected editor tool " + tool);
      } });
    const childRequest = requests[2];
    assert.match(childRequest.input[0].content, /Make my butterfly/);
    assert.match(childRequest.input[0].content, /FULL ORCHESTRATOR PLAN/);
    assert.match(childRequest.input[0].content, /Keep wing 4mm thick/);
    assert.equal(childRequest.tools[0].parameters.properties.tool.enum.includes("agent_delegate"), false);
    assert.equal(childRequest.tools[0].parameters.properties.tool.enum.includes("request_complete"), false);
    assert.equal(editors.filter((e) => e.tool === "sculpt_create").length, 1);
    assert.equal(editors.some((e) => e.tool === "model_transform"), false);
    assert.match(JSON.stringify(requests[4].input), /unassigned model/);
    assert.match(JSON.stringify(requests[9].input), /awaiting user feedback/);
    assert.equal(run.regionReports[0].state, "created");
    assert.deepEqual(run.regionReports[0].modelIds, ["sculpt::wing"]);
    assert.equal(run.regionReports[0].verification.imagesChecked, true);
    assert.equal(run.review.state, "awaiting_feedback");
    assert.deepEqual(run.review.strokeIds, ["s1"]);
    assert.deepEqual(run.review.promptIds, ["speech-1"]);
    assert.equal(run.review.models[0].version, 1);
    assert.equal(run.answer, "Please check the wing thickness.");
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("draft review rejects images and scene state from before an edit", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "draw3d-review-"));
  const run = { id: "test", model: "gpt-6-luna", events: [] }, requests = [];
  const turns = [
    [call("s", "scene_models", {})], [call("i", "agent_capture", { modelIds: ["m"] })],
    [call("edit", "model_transform", { modelId: "m", position: [1,0,0], rotationDeg: [0,0,0], scale: [1,1,1], expectedVersion: 1 })],
    [call("badreview", "agent_review", { modelIds: ["m"], summary: "done" })],
    [call("s2", "scene_models", {})], [call("i2", "agent_capture", { modelIds: ["m"] })],
    [call("goodreview", "agent_review", { modelIds: ["m"], summary: "checked" })], [say("Review it")],
  ];
  try {
    await runModelAgent({ run, prompt: "Move it", sessionId: "quest", signal: new AbortController().signal, logRoot: folder,
      providerFetch: async (_, o) => { requests.push(JSON.parse(o.body)); return response(turns.shift()); },
      execute: async (tool) => tool === "scene_models" ? { models: [{ id: "m", version: 2 }] }
        : tool === "agent_capture" ? { image: "data:image/png;base64,YQ==" } : { id: "m", version: 2 } });
    assert.match(JSON.stringify(requests[4].input), /fresh scene_models/);
    assert.equal(run.review.summary, "checked");
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("regional plans reject cycles and enforce point-range and editor boundaries", async () => {
  const { checkedPlan, checkChildScope } = await import("../scripts/regional-agent.mjs");
  assert.throws(() => checkedPlan([{ ...regionContract, dependsOn: ["wing"] }]), /cycle/);
  assert.throws(() => checkedPlan([{ ...regionContract, dependsOn: ["missing"] }]), /Unknown/);
  assert.throws(() => checkedPlan([{ ...regionContract, ranges: [{ strokeId: "other", start: 0, end: 8 }] }]), /assigned/);
  const region = { ...regionContract, ranges: [{ strokeId: "s1", start: 10, end: 20 }] };
  assert.throws(() => checkChildScope("sketch_project", { ranges: [{ strokeId: "s1", start: 0, end: 20 }] }, region, new Set()), /interval/);
  assert.throws(() => checkChildScope("cad_execute", { operation: "addPrimitive" }, region, new Set()), /cannot edit CAD/);
  assert.throws(() => checkChildScope("model_visibility", { modelIds: ["unrelated"], visible: false }, region, new Set()), /unassigned model/);
  const args = {};
  checkChildScope("sketch_project", args, region, new Set());
  assert.deepEqual(args.ranges, region.ranges);
  assert.deepEqual(args.strokeIds, region.strokeIds);
});


test("specialists reuse slim saved analysis and preserve artifacts on a 40-turn budget failure", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "draw3d-artifacts-"));
  const run = { id: "test", model: "gpt-6-luna", events: [] }, requests = [];
  const priorContext = { artifacts: [{ tool: "sketch_project", args: { strokeIds: ["s1"] },
    result: { id: "old-projection", planeId: "old-plane", paths: [{ points: Array(200).fill([1,2]) }], image: "data:image/png;base64,SECRET_IMAGE" } }] };
  const turns = [
    [call("fit", "sketch_fit_plane", { strokeIds: ["s1"] })],
    [call("plan", "agent_plan", { regions: [regionContract] })],
    [call("delegate", "agent_delegate", { regionId: "wing" })],
    [call("pca", "sketch_pca", { strokeIds: ["s1"] })],
    ...Array.from({ length: 39 }, (_, i) => [call("read"+i, "agent_status", {})]),
    [say("The specialist reached its budget; analysis is saved for continuation.")],
  ];
  try {
    await runModelAgent({ run, prompt: "Make a butterfly", priorContext, sessionId: "quest", signal: new AbortController().signal,
      logRoot: folder, providerFetch: async (_, o) => { requests.push(JSON.parse(o.body)); return response(turns.shift()); },
      execute: async (tool) => {
        if (tool === "scene_models") return { models: [] };
        if (tool === "sketch_fit_plane") return { id: "plane-1", version: 1, strokeIds: ["s1"], frame: { normal: [0,0,1], origin: [1,2,3] }, fit: { rmsMetres: 0.001 } };
        if (tool === "sketch_pca") return { strokeIds: ["s1"], eigenvalues: [0.3,0.1,0.001], points: Array(400).fill([1,2,3]) };
        return { active: false };
      } });
    const child = requests[3];
    assert.match(child.instructions, /Maximum 40 turns/);
    assert.match(child.input[0].content, /old-projection/);
    assert.match(child.input[0].content, /plane-1/);
    assert.equal(child.input[0].content.includes("SECRET_IMAGE"), false);
    assert.equal(run.regionReports[0].state, "failed");
    assert.deepEqual(run.regionReports[0].budget, { turns: 40, limit: 40 });
    assert.equal(run.regionReports[0].artifacts.some((a) => a.tool === "sketch_pca"), true);
    assert.equal(run.regionReports[0].artifacts.some((a) => a.result.id === "old-projection"), true);
    assert.ok(JSON.stringify(run.artifacts).length < 50000);
    assert.equal(JSON.stringify(run.artifacts).includes("SECRET_IMAGE"), false);
    assert.deepEqual(run.artifacts.find((a) => a.tool === "sketch_pca").result.points, { count: 400 });
    assert.equal(requests.length, 44);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test("review requires an explicit omission reason for incomplete regions", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "draw3d-omission-"));
  const run = { id: "test", model: "gpt-6-luna", events: [] }, requests = [];
  const turns = [
    [call("plan", "agent_plan", { regions: [regionContract] })],
    [call("delegate", "agent_delegate", { regionId: "wing" })],
    [say("Need user clarification for this outline.")],
    [call("scene", "scene_models", {})],
    [call("capture", "agent_capture", { modelIds: ["existing-body"] })],
    [call("reviewbad", "agent_review", { modelIds: ["existing-body"], summary: "Complete butterfly" })],
    [call("reviewok", "agent_review", { modelIds: ["existing-body"], summary: "Body only", omittedRegions: [{ regionId: "wing", reason: "Outline is ambiguous; confirm which loop is the wing." }] })],
    [say("Please clarify the wing outline.")],
  ];
  try {
    await runModelAgent({ run, prompt: "Butterfly", sessionId: "quest", signal: new AbortController().signal, logRoot: folder,
      providerFetch: async (_, o) => { requests.push(JSON.parse(o.body)); return response(turns.shift()); },
      execute: async (tool) => tool === "scene_models" ? { models: [{ id: "existing-body", version: 1 }] } : { image: "data:image/png;base64,YQ==" } });
    assert.match(JSON.stringify(requests[6].input), /is unfinished/);
    assert.deepEqual(run.review.strokeIds, []);
    assert.equal(run.review.omittedRegions[0].regionId, "wing");
    assert.match(run.review.uncertainties[0], /Omitted wing/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});


test("a specialist can escalate ambiguity and receive the actual user answer on retry", async () => {
  const { answerAgentQuestion } = await import("../scripts/agent-questions.mjs");
  const folder = await mkdtemp(path.join(tmpdir(), "draw3d-child-question-"));
  const run = { id: "test", model: "gpt-6-luna", state: "running", events: [] }, requests = [], models = [];
  const turns = [
    [call("plan", "agent_plan", { regions: [regionContract] })],
    [call("delegate", "agent_delegate", { regionId: "wing" })],
    [say("NEEDS CLARIFICATION: curved wings or a flat silhouette?")],
    [call("question", "agent_ask_question", { question: "Which wing shape?", options: ["Curved", "Flat"], region: "wing" })],
    [call("retry", "agent_delegate", { regionId: "wing" })],
    [call("create", "sculpt_create", { shape: "sphere", expectedVersion: 0 })],
    [call("capture", "agent_capture", { modelIds: ["sculpt::wing"] })],
    [say("Made the curved draft from the clarified intent.")],
    [call("review", "agent_review", { modelIds: ["sculpt::wing"], summary: "Curved wing draft" })],
    [say("Check the curved wing.")],
  ];
  const controller = new AbortController();
  let running;
  try {
    running = runModelAgent({ run, prompt: "Make a butterfly", sessionId: "quest", signal: controller.signal, logRoot: folder,
      providerFetch: async (_, o) => { requests.push(JSON.parse(o.body)); return response(turns.shift()); },
      execute: async (tool) => {
        if (tool === "scene_models") return { models: structuredClone(models) };
        if (tool === "sculpt_create") { models.push({ id: "sculpt::wing", version: 1 }); return { id: "wing" }; }
        if (tool === "agent_capture") return { image: "data:image/png;base64,YQ==" };
        assert.fail("Unexpected editor call " + tool);
      } });
    for (let i = 0; i < 200 && run.state !== "waiting_for_answer"; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(run.state, "waiting_for_answer");
    assert.equal(run.regionReports[0].state, "needs_clarification");
    assert.equal(requests.length, 4);
    assert.equal(requests[2].tools[0].parameters.properties.tool.enum.includes("agent_ask_question"), false);
    answerAgentQuestion(run, { runId: run.id, questionId: run.question.id, answer: "Curved, with raised tips", source: "typed" });
    await running;
    assert.match(requests[5].input[0].content, /Curved, with raised tips/);
    assert.equal(run.regionReports[1].state, "created");
    assert.equal(run.review.summary, "Curved wing draft");
  } finally {
    controller.abort(Error("Test finished"));
    await running?.catch(() => {});
    await rm(folder, { recursive: true, force: true });
  }
});

for (const mismatch of [false,true]) test(`simple fitted primitive needs no delegation; mismatch=${mismatch}`, async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'draw3d-fast-')),run={id:'test',model:'gpt-6-luna',events:[]},calls=[],requests=[];
 const turns=[ [call('ctx','draw3d_context',{})], [call('make','primitive_from_strokes',{strokeIds:['s1'],shape:'cylinder'})], [call('review','agent_review',{modelIds:['m1'],summary:'Fitted cylinder'})], ...(mismatch?[[call('review2','agent_review',{modelIds:['m1'],summary:'Intentionally enlarged cylinder',placementReason:'User requested a giant display copy'})]]:[]), [say('Done')] ];
 try {
 await runModelAgent({run,prompt:'Make a cylinder from stroke 1',sessionId:'quest',signal:new AbortController().signal,logRoot:folder,
 providerFetch:async(_,o)=>{requests.push(JSON.parse(o.body));return response(turns.shift());},execute:async(tool,args)=>{
 calls.push(tool);
 if(tool==='draw3d_context')return {capabilities:{spatialTools:true},strokes:[{id:'s1'}]};
 if(tool==='primitive_from_strokes')return {modelIds:['m1'],strokeIds:['s1'],models:[{id:'m1',version:1}],image:'data:image/png;base64,YQ=='};
 if(tool==='model_fit_check'){assert.deepEqual(args.strokeIds,['s1']);return {grossMismatch:mismatch};}
 assert.fail(tool);
 }});
 assert.deepEqual(calls,['draw3d_context','primitive_from_strokes','model_fit_check',...(mismatch?['model_fit_check']:[])]);assert.equal(run.regionReports.length,0);
 if(mismatch){assert.equal(run.review.summary,'Intentionally enlarged cylinder');assert.match(JSON.stringify(requests.at(-1).input),/scale\/position differs/);}
 else {assert.deepEqual(run.review.strokeIds,['s1']);assert.equal(run.review.models[0].version,1);}
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('initial context keeps calibrated fit parameters and images without duplicating dense samples',()=>{
 const points=Array.from({length:200},(_,i)=>[i/200,1,-.6]);
 const fit={selected:{kind:'spline3d',path:points,parameters:{degree:3,coefficients:[[1,2,3]]},errors:{rmsMetres:.001}},candidates:[{kind:'line',path:points,accepted:false}]};
 const original={strokes:[{id:'s',points,times:points.map((_,i)=>i),localFit:fit}],strokeReference:{strokes:[{id:'s',fit}],frames:[{image:'data:image/png;base64,AA==',view:{cameraToWorld:[1,0,0]}}]}};
 const c=compactAgentContext(original);
 assert.equal(c.strokes[0].pointCount,200);assert.equal(c.strokes[0].samplePreview.length,16);assert.equal(c.strokes[0].points,undefined);assert.equal(c.strokeReference.strokes[0].fit.selected.path,undefined);
 assert.deepEqual(c.strokeReference.strokes[0].fit.selected.parameters,fit.selected.parameters);assert.deepEqual(c.strokeReference.frames,original.strokeReference.frames);assert.equal(original.strokes[0].points.length,200);assert.match(c.sampleAccess,/stroke_load/);
});

test('direct fitted tube retains its source stroke for placement checks and user acceptance',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'draw3d-tube-review-')),run={id:'tube',model:'gpt-6-luna',events:[]};
 const turns=[[call('ctx','draw3d_context',{})],[call('tube','sculpt_tube',{expectedVersion:0,strokeId:'source',useLocalFit:true,expectedFitVersion:1,radiusMetres:.004})],[call('scene','scene_models',{})],[call('image','agent_capture',{modelIds:['tube1']})],[call('review','agent_review',{modelIds:['tube1'],summary:'Tube follows the stroke'})],[say('Ready')]];
 try{await runModelAgent({run,prompt:'Tube',sessionId:'test',signal:new AbortController().signal,logRoot:folder,providerFetch:async()=>response(turns.shift()),execute:async(tool,args)=>{
  if(tool==='draw3d_context')return {capabilities:{spatialTools:true},strokes:[{id:'source'}]};
  if(tool==='sculpt_tube')return {modelId:'tube1',source:{strokeId:'source',fitKind:'spline3d'}};
  if(tool==='scene_models')return {models:[{id:'tube1',version:1}]};
  if(tool==='agent_capture')return {image:'data:image/png;base64,YQ=='};
  if(tool==='model_fit_check'){assert.deepEqual(args.strokeIds,['source']);return {grossMismatch:false};}
  assert.fail(tool);
 }});assert.deepEqual(run.review.strokeIds,['source']);assert.equal(run.placementCheck.grossMismatch,false);
 }finally{await rm(folder,{recursive:true,force:true});}
});

test("desktop attaches every stroke image and estimated values before the first model call",async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'draw3d-desktop-evidence-'));const calls=[],requests=[],strokes=Array.from({length:19},(_,i)=>({id:'s'+i,points:[[0,0,0],[.1,0,0]],localFit:{selected:{kind:'line',parameters:{lengthMetres:.1},errors:{rmsMetres:.001}}}}));
 try{await runModelAgent({run:{id:'desktop',model:'gpt-6-luna',events:[]},prompt:'Refine',desktopEvidence:true,signal:new AbortController().signal,logRoot:folder,execute:async(name,args)=>{calls.push({name,args});if(name==='draw3d_context')return {strokes,desktopSelection:{kind:'surface',modelId:'body'}};return {strokes:args.strokeIds.map(id=>({id,fit:strokes.find(s=>s.id===id).localFit})),frames:args.strokeIds.map(id=>({strokeIds:[id],image:'data:image/png;base64,'+Buffer.from(id).toString('base64')}))};},providerFetch:async(url,options)=>{requests.push(JSON.parse(options.body));return response([{type:'message',content:[{type:'output_text',text:'Reviewed'}]}]);}});
 assert.equal(calls[0].name,'draw3d_context');assert.deepEqual(calls.slice(1).map(c=>c.args.strokeIds.length),[16,3]);const evidence=requests[0].input.at(-1).content;assert.equal(evidence.filter(p=>p.type==='input_image').length,19);assert.match(JSON.stringify(evidence),/rmsMetres/);assert.match(JSON.stringify(evidence),/lengthMetres/);assert.match(evidence[0].text,/desktopSelection/);
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('human shape biases reach the model prompt without altering spline evidence',async()=>{const folder=await mkdtemp(path.join(tmpdir(),'draw3d-prompt-intent-'));let submitted;const fit={selected:{kind:'spline2d',parameters:{degree:3},errors:{rmsMetres:.006}},candidates:[{kind:'circle',accepted:false},{kind:'rectangle',accepted:false}]};try{await runModelAgent({run:{id:'prompt-policy',model:'gpt-6-luna',events:[]},prompt:'Interpret this outline',desktopEvidence:true,signal:new AbortController().signal,logRoot:folder,execute:async(tool,args)=>tool==='draw3d_context'?{strokes:[{id:'rough',points:[[0,0,0],[.1,.1,0]],localFit:fit}]}:{strokes:[{id:'rough',fit}],frames:[{image:'data:image/png;base64,AA=='}]},providerFetch:async(url,options)=>{submitted=JSON.parse(options.body);return response([{type:'message',content:[{type:'output_text',text:'Inspected'}]}]);}});assert.match(submitted.instructions,/A local spline fit describes hand motion/);assert.match(submitted.instructions,/rough rectangle/);assert.match(submitted.instructions,/imperfect circular loop/);assert.match(submitted.instructions,/intentional ellipse/);const evidence=JSON.stringify(submitted.input);assert.match(evidence,/spline2d/);assert.match(evidence,/accepted/);assert.doesNotMatch(evidence,/intentPreferred/);assert.equal(fit.selected.kind,'spline2d');}finally{await rm(folder,{recursive:true,force:true});}});

test('a verified 2D drawing finishes without a solid or 3D agent_review',async()=>{const folder=await mkdtemp(path.join(tmpdir(),'draw3d-2d-review-'));const run={id:'drawing-only',model:'gpt-6-luna',events:[]};let n=0;const calls=[];try{await runModelAgent({run,prompt:'Make a circle',sessionId:'current',signal:new AbortController().signal,logRoot:folder,execute:async(tool,args)=>{calls.push(tool);return {figure:{id:'circle',kind:'circle',radiusMetres:.08},solidCreated:false,image:'data:image/png;base64,AA==',drawingReview:{state:'awaiting_feedback',kind:'drawing',figureIds:['circle'],modelIds:[],models:[],strokeIds:[],summary:'Created a 2D circle'}};},providerFetch:async()=>response(n++===0?[call('circle','drawing_create',{kind:'circle',origin:[0,1,-.6],radiusMetres:.08})]:[{type:'message',content:[{type:'output_text',text:'Created the 2D circle, radius 80 mm.'}]}])});assert.deepEqual(calls,['drawing_create']);assert.equal(run.review.kind,'drawing');assert.deepEqual(run.review.modelIds,[]);assert.match(run.answer,/2D circle/);}finally{await rm(folder,{recursive:true,force:true});}});
