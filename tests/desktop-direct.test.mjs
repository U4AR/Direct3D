// Full-contract fixtures use a non-rapid model; rapid wire/prompt behavior is covered by rapid-construction tests.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {runDesktopEdit,DIRECT_EDIT_INSTRUCTIONS,desktopReasoning} from '../scripts/desktop-edit.mjs';
import {validateDesktopEdit} from '../src/desktop-edit-contract.js';
const figure={operation:'create',figureId:null,expectedVersion:null,kind:'circle',name:'Circle',origin:[0,1.15,-.6],xAxis:[1,0,0],yAxis:[0,1,0],radiusMetres:.16,widthMetres:null,heightMetres:null,end:null,segments:null,closed:true,extrusionMetres:null,strokeIds:['stroke-a'],dimensionNote:'Approximate radius from drawing scale'};
const edit=()=>({summary:'Interpreted the rough loop as a circle.',assumptions:['Radius estimated from the drawing'],question:null,edits:[structuredClone(figure)]});
const evidence=()=>({version:1,sketchRevision:7,strokes:[{id:'stroke-a',points:[[0,1,-.6],[.1,1.1,-.6]],fit:{selected:{kind:'spline2d',path:[[0,1,-.6],[.1,1.1,-.6]],parameters:{degree:3}}},surface:{frame:{origin:[0,0,-.6],xAxis:[1,0,0],yAxis:[0,1,0]}}}],figures:[],frames:[{layer:'stroke',strokeIds:['stroke-a'],image:'data:image/png;base64,AAAA'}]});
test('direct editor sends all evidence and one structured model request with no tool loop',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'draw3d-direct-')),previous=process.env.SESSION_DIR;process.env.SESSION_DIR=root;let count=0,body;
 const run={id:crypto.randomUUID(),model:'gpt-6.1-sol',recordingId:'fixture',events:[]};
 try{const e=evidence(),result=await runDesktopEdit({run,prompt:'Clean this into a 2D circle.',evidence:e,signal:new AbortController().signal,fetcher:async(url,options)=>{count++;body=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(edit())}]}]})};}});
 assert.equal(count,1);assert.equal(run.providerCallCount,1);assert.equal(body.tools,undefined);assert.equal(body.text.format.type,'json_schema');const input=JSON.parse(body.input[0].content[0].text);assert.deepEqual(input.evidence.strokes[0].points,e.strokes[0].points);assert.deepEqual(input.evidence.strokes[0].fit.selected.parameters,e.strokes[0].fit.selected.parameters);assert.equal(input.evidence.sourceSnapshot,undefined);assert.equal(input.userPrompt,'Clean this into a 2D circle.');assert.equal(body.input[0].content.filter(c=>c.type==='input_image').length,1);assert.equal(result.edits[0].kind,'circle');assert.equal(e.strokes[0].fit.selected.kind,'spline2d');assert.match(DIRECT_EDIT_INSTRUCTIONS,/NO tools/);assert.doesNotMatch(DIRECT_EDIT_INSTRUCTIONS,/use drawing_create or drawing_update/);assert.match(await readFile(path.join(root,'desktop-edits',run.id,'events.jsonl'),'utf8'),/AI move 1 sent/);
 }finally{if(previous===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previous;await rm(root,{recursive:true,force:true});}
});
test('validates source ownership, dimensions and optimistic figure versions without reinterpreting shapes',()=>{const e=evidence();assert.equal(validateDesktopEdit(edit(),e).edits[0].kind,'circle');for(const change of [{radiusMetres:-1},{strokeIds:['not-sent']},{xAxis:[0,0,0]},{operation:'update',figureId:'missing',expectedVersion:1},{extrusionMetres:-.01}]){const v=edit();Object.assign(v.edits[0],change);assert.throws(()=>validateDesktopEdit(v,e));}const q=edit();q.question='Which plane?';assert.throws(()=>validateDesktopEdit(q,e),/clarification/);});
test('direct editor rejects malformed and tool responses, and bounds output-limit recovery',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'draw3d-direct-bad-')),previous=process.env.SESSION_DIR;process.env.SESSION_DIR=root;
 try{for(const data of [{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]},{status:'completed',output:[{type:'function_call',name:'cad_execute'}]},{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not json'}]}]}]){let calls=0;await assert.rejects(runDesktopEdit({run:{id:crypto.randomUUID(),model:'gpt-6.1-sol',events:[]},prompt:'Circle',evidence:evidence(),signal:new AbortController().signal,fetcher:async()=>{calls++;return {ok:true,status:200,json:async()=>data};}}));assert.equal(calls,data.status==='incomplete'?2:1);}}
 finally{if(previous===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previous;await rm(root,{recursive:true,force:true});}
});

test('local application rejects stale or stopped responses before any CAD mutation',async()=>{
 const {prepareDesktopEvidence,applyDesktopEdit}=await import('../src/desktop-direct.js');const originalDocument=global.document;global.document={querySelector:()=>({value:'auto'})};
 const store={session:{strokes:structuredClone(evidence().strokes),revision:7,transcripts:[]},flush:async()=>{}};let calls=0;
 const studio={surfaceModels:()=>[],desktopDrawing:{summary:()=>[],validate:()=>{},dispatch:async()=>{calls++;return {figure:{id:'new'},dimensionsMetres:{radiusMetres:.16}};}}};
 const packet=async()=>({strokes:structuredClone(store.session.strokes),frames:evidence().frames});
 try{const e=await prepareDesktopEvidence({studio,store,reference:packet,context:async()=>({models:[]})});await assert.rejects(applyDesktopEdit({studio,store,evidence:e,edit:edit(),cancelled:()=>true}),/stopped/);assert.equal(calls,0);store.session.strokes[0].points.push([.2,1.2,-.6]);await assert.rejects(applyDesktopEdit({studio,store,evidence:e,edit:edit()}),e=>e.applicationFailure?.kind==='context_changed');assert.equal(calls,0);
 await assert.rejects(prepareDesktopEvidence({studio,store,context:async()=>({models:[]}),reference:async()=>{const p=await packet();store.session.strokes[0].points.push([.3,1.3,-.6]);return p;}}),e=>e.applicationFailure?.kind==='context_changed');
 }finally{global.document=originalDocument;}
});

test('additional model moves are explicit, explained and separate from human questions',()=>{const e=evidence(),v=edit();assert.equal(validateDesktopEdit(v,e).continuation,null);v.continuation={reason:'Inspect the assembled profile before the next feature',nextMove:'Check placement in the updated result image'};assert.equal(validateDesktopEdit(v,e).continuation.nextMove,'Check placement in the updated result image');for(const bad of [{reason:'',nextMove:'Next'},{reason:'Need a move',nextMove:''},true]){v.continuation=bad;assert.throws(()=>validateDesktopEdit(v,e),/additional move/);}v.continuation={reason:'Need input',nextMove:'Guess'};v.edits=[];v.question='Which surface?';assert.throws(()=>validateDesktopEdit(v,e),/additional move/);});


test('per-stroke angle and alignment priors reach each model move while raw numerical evidence stays unchanged',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'draw3d-angle-priors-')),previous=process.env.SESSION_DIR;process.env.SESSION_DIR=root;const inputs=[];const e=evidence(),before=structuredClone(e);const run={id:crypto.randomUUID(),model:'gpt-6.1-sol',events:[],step:1};
 try{for(let turn=1;turn<=2;turn++){run.step=turn;await runDesktopEdit({run,prompt:'Keep my explicitly specified 12.5 degree edge.',evidence:e,continuationContext:turn===2?{requestedMove:{reason:'Inspect',nextMove:'Keep the angle'}}:undefined,signal:new AbortController().signal,fetcher:async(url,options)=>{const body=JSON.parse(options.body);inputs.push(body);return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(edit())}]}]})};}});}
 for(const body of inputs){assert.match(body.instructions,/EVERY stroke on EVERY model move/);assert.match(body.instructions,/nearly horizontal or vertical/);assert.match(body.instructions,/whole-number angles/);assert.match(body.instructions,/12\.5 degrees/);assert.match(body.instructions,/selected surface frame/);assert.match(body.instructions,/parallel related edges, perpendicular corners/);assert.equal(JSON.parse(body.input[0].content[0].text).userPrompt,'Keep my explicitly specified 12.5 degree edge.');}assert.deepEqual(e,before);assert.equal(run.providerCallCount,2);
 }finally{if(previous===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previous;await rm(root,{recursive:true,force:true});}
});
test('the model selects automated mode with a meaningful plan and must continue unfinished work',()=>{const e=evidence(),v=edit();v.automation={goal:'Create the requested layout',reason:'Several dependent figures need coordinated placement',steps:[{id:'layout',label:'Create layout',state:'completed'},{id:'inspect',label:'Inspect result',state:'pending'}]};assert.throws(()=>validateDesktopEdit(v,e),/unfinished automated plan/);v.continuation={reason:'Need updated images to verify spacing',nextMove:'Inspect spacing'};assert.equal(validateDesktopEdit(v,e).automation.goal,'Create the requested layout');v.automation.steps[1].state='completed';v.continuation=null;assert.equal(validateDesktopEdit(v,e).automation.steps.length,2);v.automation.steps[1].id='layout';assert.throws(()=>validateDesktopEdit(v,e),/uniquely identified/);});

test('an output-limited reply is discarded and recovered once with more space and a smaller batch',async()=>{const root=await mkdtemp(path.join(tmpdir(),'draw3d-output-recovery-')),previous=process.env.SESSION_DIR;process.env.SESSION_DIR=root;const sent=[];try{const run={id:crypto.randomUUID(),model:'gpt-6.1-sol',events:[]};const result=await runDesktopEdit({run,prompt:'Create a circle',evidence:evidence(),signal:new AbortController().signal,fetcher:async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>sent.length===1?{status:'incomplete',incomplete_details:{reason:'MAX_TOKENS'},output:[{type:'message',content:[{type:'output_text',text:'{"edits":[incomplete'}]}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(edit())}]}]}};}});assert.equal(result.edits.length,1);assert.equal(sent.length,2);assert.equal(sent[0].max_output_tokens,16384);assert.equal(sent[1].max_output_tokens,32768);assert.equal(sent[1].reasoning.effort,'low');assert.equal(JSON.stringify(sent[1].input).includes('[incomplete'),false);assert.equal(run.events.some(e=>e.kind==='recovery'),true);}finally{if(previous===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previous;await rm(root,{recursive:true,force:true});}});

test('saved sketch outputs can be requested by ID without MCP or geometry changes',()=>{const e=evidence();e.sketchCatalog=[{id:'sketch-a',plane:{id:'plane-front'}}];e.sketchOutputs=[];const v={summary:'Inspect saved sketch',assumptions:[],question:null,edits:[],requestedSketchIds:['sketch-a'],continuation:{reason:'Need saved output',nextMove:'Use it with the current sketch'}};assert.deepEqual(validateDesktopEdit(v,e).requestedSketchIds,['sketch-a']);e.sketchOutputs=[{sketchId:'sketch-a'}];assert.throws(()=>validateDesktopEdit(v,e),/missing sketch outputs/);e.sketchOutputs=[];v.requestedSketchIds=['foreign'];assert.throws(()=>validateDesktopEdit(v,e),/Unknown requested/);});
test('multi-sketch solids require distinct closed current profiles and explicit depths',()=>{const e=evidence();e.figures=[{id:'a',version:2,kind:'circle'},{id:'b',version:3,kind:'rectangle'}];const v={summary:'Loft',question:null,assumptions:[],edits:[],solidEdits:[{kind:'loft',name:'Taper',loftMode:'ruled',profiles:[{figureId:'a',expectedVersion:2,depthMetres:null,backDepthMetres:null},{figureId:'b',expectedVersion:3,depthMetres:null,backDepthMetres:null}]}]};assert.equal(validateDesktopEdit(v,e).solidEdits.length,1);v.solidEdits[0].profiles[1].expectedVersion=2;assert.throws(()=>validateDesktopEdit(v,e),/current versions/);v.solidEdits[0].profiles[1].expectedVersion=3;v.solidEdits[0].kind='intersect';assert.throws(()=>validateDesktopEdit(v,e),/depths/);for(const p of v.solidEdits[0].profiles){p.depthMetres=.1;p.backDepthMetres=.1;}assert.equal(validateDesktopEdit(v,e).solidEdits[0].kind,'intersect');e.figures[1].construction=true;assert.throws(()=>validateDesktopEdit(v,e),/closed sketch/);});


test('a spline-fit angular outline is represented by connected native lines after one model repair',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'draw3d-profile-repair-')),previous=process.env.SESSION_DIR;process.env.SESSION_DIR=root;
 const e=evidence(),before=structuredClone(e),sent=[],run={id:crypto.randomUUID(),model:'gpt-6.1-sol',events:[]};
 const vertices=[[-.08,1.27,-.6],[.2,1.27,-.6],[.2,1.03,-.6],[-.08,1.03,-.6],[-.2,1.09,-.6],[-.2,1.21,-.6]];
 const valid={...edit(),summary:'Six connected straight edges form the chamfered tag profile.',edits:vertices.map((origin,i)=>({...figure,kind:'line',name:'Tag edge '+(i+1),origin,end:vertices[(i+1)%vertices.length],radiusMetres:null,closed:false,segments:null}))};
 const invalid={...edit(),edits:[{...figure,kind:'spline',radiusMetres:null,segments:['0,0,.03,0,.06,0,.09,0']}]};
 try{
  const result=await runDesktopEdit({run,prompt:'Clean up this drawing.',evidence:e,signal:new AbortController().signal,fetcher:async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(sent.length===1?invalid:valid)}]}]})};}});
  assert.equal(run.providerCallCount,2);assert.equal(result.edits.length,6);assert.ok(result.edits.every(e=>e.kind==='line'&&e.segments===null&&e.extrusionMetres===null));
  result.edits.forEach((edge,i)=>assert.deepEqual(edge.end,result.edits[(i+1)%6].origin));assert.deepEqual(e,before);
  assert.match(sent[0].instructions,/one kind:"line" edit per intended edge/);assert.match(sent[0].instructions,/generic fallback for every unrecognized primitive/);assert.match(sent[0].instructions,/comma-separated strings/);
  const feedback=JSON.parse(sent[1].input.at(-1).content[0].text);assert.equal(feedback.kind,'drawing_validation_feedback');assert.match(feedback.error,/finite local-plane cubic Bezier/);assert.match(feedback.note,/No edits/);assert.equal(sent[1].tools,undefined);
  const events=await readFile(path.join(root,'desktop-edits',run.id,'events.jsonl'),'utf8');assert.match(events,/Invalid AI geometry/);assert.match(events,/"appliedCount":0/);
  const {readdir}=await import('node:fs/promises');const contextFile=(await readdir(path.join(root,'desktop-context')))[0];const saved=JSON.parse(await readFile(path.join(root,'desktop-context',contextFile),'utf8'));assert.equal(saved.decisions.length,1);assert.equal(saved.history.filter(m=>m.role==='assistant').length,1);assert.doesNotMatch(JSON.stringify(saved.history),/segments.*0,0,.03,0,.06,0,.09,0/);
 }finally{if(previous===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previous;await rm(root,{recursive:true,force:true});}
});

test('geometry repair stays bounded and a valid intentional cubic remains a spline',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'draw3d-repair-limit-')),previous=process.env.SESSION_DIR;process.env.SESSION_DIR=root;
 const invalid={...edit(),edits:[{...figure,kind:'spline',radiusMetres:null,segments:['0,0,.03,.08,.08,-.03,.15,.02']}]};
 const curve={...edit(),summary:'Preserved the intentional curved contour.',edits:[{...figure,kind:'spline',radiusMetres:null,closed:false,segments:[[0,0,.03,.08,.08,-.03,.15,.02]]}]};
 const response=value=>({ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]})});
 try{
  let calls=0;const run={id:crypto.randomUUID(),model:'gpt-6.1-sol',events:[]};await assert.rejects(runDesktopEdit({run,prompt:'Clean drawing',evidence:evidence(),signal:new AbortController().signal,fetcher:async()=>{calls++;return response(invalid);}}),/after one repair.*No edits were applied/);assert.equal(calls,2);assert.equal(run.events.some(e=>e.kind==='response'),false);
  calls=0;const result=await runDesktopEdit({run:{id:crypto.randomUUID(),model:'gpt-6.1-sol',events:[]},prompt:'Preserve my intentional cubic curve.',evidence:evidence(),signal:new AbortController().signal,fetcher:async()=>{calls++;return response(curve);}});assert.equal(calls,1);assert.equal(result.edits[0].kind,'spline');assert.deepEqual(result.edits[0].segments,curve.edits[0].segments);
 }finally{if(previous===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previous;await rm(root,{recursive:true,force:true});}
});


test('a rounded end survives geometry repair when cubic coordinates were flattened',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'draw3d-rounded-repair-')),previous=process.env.SESSION_DIR;process.env.SESSION_DIR=root;
 const e=evidence(),before=structuredClone(e),sent=[],run={id:crypto.randomUUID(),model:'gpt-6.1-sol',events:[]};
 const line=(name,origin,end)=>({...figure,kind:'line',name,origin,end,radiusMetres:null,closed:false});
 const segments=[[0,.05,.027614,.05,.05,.027614,.05,0],[.05,0,.05,-.027614,.027614,-.05,0,-.05]];
 const rounded={...edit(),summary:'A tab with three straight sides and a smooth rounded right end.',edits:[line('Left',[-.2,1.1,-.6],[-.2,1.2,-.6]),line('Top',[-.2,1.2,-.6],[.15,1.2,-.6]),{...figure,kind:'spline',name:'Rounded end',origin:[.15,1.15,-.6],radiusMetres:null,closed:false,segments},line('Bottom',[.15,1.1,-.6],[-.2,1.1,-.6])]};
 const flat=structuredClone(rounded);flat.edits[2].segments=segments.map(s=>s.join(','));
 try{
  const result=await runDesktopEdit({run,prompt:'Refine my drawing.',evidence:e,signal:new AbortController().signal,fetcher:async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(sent.length===1?flat:rounded)}]}]})};}});
  assert.equal(sent.length,2);assert.deepEqual(e,before);assert.deepEqual(result.edits.map(e=>e.kind),['line','line','spline','line']);assert.deepEqual(result.edits[2].segments,segments);
  const feedback=JSON.parse(sent[1].input.at(-1).content[0].text);assert.match(feedback.error,/edits\[2\]\.segments/);assert.match(feedback.error,/exactly eight finite numbers/);assert.match(feedback.note,/Keep rounded ends/);assert.match(feedback.note,/not a switch to a different shape/);
  for(const body of sent){assert.match(body.instructions,/mixed profile may contain both/);assert.match(body.instructions,/not a chain of short straight chords/);assert.match(body.instructions,/never one flat 16-number array/);assert.doesNotMatch(body.instructions,/angular outline needs connected straight line edits/);}
  assert.match(sent[1].instructions,/formatting error does not justify replacing a rounded cap/);assert.equal(run.providerCallCount,2);
 }finally{if(previous===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previous;await rm(root,{recursive:true,force:true});}
});


test('routine sketch edits stay fast while substantial work receives more reasoning without a classification request',async()=>{
 assert.equal(desktopReasoning({prompt:'Refine my rounded tab',evidence:{}}),'low');
 assert.equal(desktopReasoning({prompt:'Change the radius to 24 mm',evidence:{figures:Array(40).fill({})}}),'low');
 assert.equal(desktopReasoning({prompt:'Create an assembly with a repeated hole pattern'}),'medium');
 assert.equal(desktopReasoning({promptSource:'sketch-build'}),'medium');
 assert.equal(desktopReasoning({evidence:{outputPreference:'solid'}}),'medium');
 assert.equal(desktopReasoning({run:{automation:{goal:'Requested layout'}}}),'medium');
 const root=await mkdtemp(path.join(tmpdir(),'draw3d-reasoning-')),previous=process.env.SESSION_DIR;process.env.SESSION_DIR=root;
 try{for(const [prompt,effort]of [['Refine this stroke','low'],['Create a coordinated layout','medium']]){let calls=0,body;const run={id:crypto.randomUUID(),model:'gpt-6.1-sol',events:[]};await runDesktopEdit({run,prompt,evidence:evidence(),signal:new AbortController().signal,fetcher:async(url,options)=>{calls++;body=JSON.parse(options.body);return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(edit())}]}]})};}});assert.equal(calls,1);assert.equal(body.reasoning.effort,effort);assert.equal(run.reasoning,effort);assert.match(body.instructions,/compact JSON without indentation/);assert.ok(run.events.some(e=>e.kind==='timing'&&e.details.durationMs>=0));}}
 finally{if(previous===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previous;await rm(root,{recursive:true,force:true});}
});


test('packed cubic coordinates preserve the model curve in one request without AI repair',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'draw3d-packed-curve-')),previous=process.env.SESSION_DIR;process.env.SESSION_DIR=root;
 const segments=[[0,.05,.027614,.05,.05,.027614,.05,0],[.05,0,.05,-.027614,.027614,-.05,0,-.05]],packed={...edit(),edits:[{...figure,kind:'spline',radiusMetres:null,closed:false,segments:segments.flat()}]};let calls=0;const run={id:crypto.randomUUID(),model:'gpt-6.1-sol',events:[]};
 try{const result=await runDesktopEdit({run,prompt:'Refine the drawing',evidence:evidence(),signal:new AbortController().signal,fetcher:async()=>{calls++;return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(packed)}]}]})};}});assert.equal(calls,1);assert.equal(result.edits[0].kind,'spline');assert.deepEqual(result.edits[0].segments,segments);assert.equal(run.events.some(e=>e.kind==='recovery'),false);assert.equal(run.events.some(e=>e.kind==='format'&&e.details.coordinatesChanged===false),true);}
 finally{if(previous===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=previous;await rm(root,{recursive:true,force:true});}
});

test('native circular arcs use radius and angles without cubic controls or implicit extrusion',()=>{
 const e=evidence(),arc={...edit(),edits:[{...figure,kind:'arc',radiusMetres:.05,startAngleDeg:-90,endAngleDeg:90,closed:false}]};assert.equal(validateDesktopEdit(arc,e).edits[0].kind,'arc');
 for(const change of [{startAngleDeg:0,endAngleDeg:360},{radiusMetres:-.05},{closed:true},{extrusionMetres:.02}]){const invalid=structuredClone(arc);Object.assign(invalid.edits[0],change);assert.throws(()=>validateDesktopEdit(invalid,e));}
});
