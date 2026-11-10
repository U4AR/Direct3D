import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyInstruction} from '../scripts/sketch-instruction-intent.mjs';
import {verifySketchDeliverable,verifyRequestedOperation} from '../scripts/sketch-task.mjs';
import {expandRefinement,runSketchRefinement} from '../scripts/sketch-refinement.mjs';
import {figureWorkCaseIds,previousSketchWork,resumeSketchWork} from '../src/sketch-work-history.js';
import {fixture,operation} from './sketch-refinement-fixture.mjs';

test('revolving the supplied section cannot be fulfilled with extrusion or an independently designed replacement',()=>{
 const wall={kind:'revolve',profiles:[{figureId:'existing'}],revolution:{wallThicknessMetres:.003}};
 const result={edits:[],solidEdits:[wall]};
 verifyRequestedOperation('hollow_revolve',{},result);
 assert.throws(()=>verifyRequestedOperation('revolve',{bodyDesign:{}},result),/supplied profile/);
 assert.throws(()=>verifyRequestedOperation('revolve',{},{edits:[],solidEdits:[{kind:'extrude'}]}),/Revolve the requested profile/);
 assert.throws(()=>verifyRequestedOperation('hollow_revolve',{},{edits:[],solidEdits:[{...wall,revolution:{}}]}),/wall thickness/);
});

test('finishing a body accepts joins while a redesign requires newly authored geometry',()=>{
 const join={kind:'join-material',targetBodyId:'old-body'};
 verifySketchDeliverable('finish_body',{solidEdits:[join]});
 assert.throws(()=>verifySketchDeliverable('redesign_body',{solidEdits:[join]}),/new main shape/);
 assert.throws(()=>verifySketchDeliverable('redesign_body',{solidEdits:[{kind:'extrude'}],results:[{metrics:{}}]}),/new main shape/);
 verifySketchDeliverable('redesign_body',{solidEdits:[{kind:'revolve'},join],results:[{metrics:{modelCreated:true}}]});
});

test('an authored main section supports linked features on either a revolved or extruded base',()=>{
 for(const form of ['extrude','revolve']){
  const {fit,saved}=fixture();
  const design={name:'Pod',referenceId:fit.results[0].id,form,axisDegrees:0,thicknessMetres:form==='extrude'?.012:null,halfOutline:[[-1,0],[-.7,.7],[0,1],[.8,.4],[1,0]]};
  const plan={summary:'Custom pod and rim',question:null,operations:[],additions:[],solidEdits:[],bodyDesign:design,
   featurePlan:{sketches:[{id:'rim',name:'Rim',strokeIds:['ring'],profile:'circle',widthMetres:null}],
    features:[{id:'joined',name:'Join rim',operation:'join',target:'feature-result:0',sketch:'rim',toolBody:null,extent:'centered',depthMetres:.005}]}};
  const out=expandRefinement(plan,saved,fit);
  assert.deepEqual(out.solidEdits.map(s=>s.kind),[form,'join-material']);
  assert.equal(out.solidEdits[0].profiles[0].figureId,'new-edit:0');assert.equal(out.solidEdits[1].targetBodyId,'feature-result:0');
  verifySketchDeliverable('redesign_body',out);
 }
});

test('new body, material edit, and sketch each have distinct completion conditions',()=>{
 const empty={edits:[],solidEdits:[]},pocket={kind:'pocket',targetBodyId:'existing'};
 assert.throws(()=>verifySketchDeliverable('new_body',empty),/new CAD body/);
 assert.throws(()=>verifySketchDeliverable('new_body',{solidEdits:[pocket]}),/new CAD body/);
 assert.throws(()=>verifySketchDeliverable('material_feature',{solidEdits:[{kind:'extrude'}]}),/existing body/);
 verifySketchDeliverable('material_feature',{solidEdits:[pocket]});
 verifySketchDeliverable('sketch',empty);
 assert.throws(()=>verifySketchDeliverable('sketch',{solidEdits:[{kind:'extrude'}]}),/output is planar/);
 assert.throws(()=>verifySketchDeliverable('material_feature',{solidEdits:[{kind:'extrude'},{...pocket,targetBodyId:'feature-result:0'}]}),/existing body/);
 const cap={solidEdits:[{kind:'revolve'},pocket]};
 assert.throws(()=>verifySketchDeliverable('new_body',cap,'both'),/localized addition/);
 verifySketchDeliverable('new_body',{solidEdits:[...cap.solidEdits,{kind:'join-material'}]},'both');
});

test('history follows the target figure across sessions and ignores unrelated or rejected work',async()=>{
 const rules=['old','bad','other','latest'].map(id=>({id:id+':g0',figureId:id==='other'?'B':'A'}));
 const cases=[{id:'old',asset:'legacy'},{id:'bad',asset:'invalid'},{id:'other',work:{instruction:'unrelated'}},{id:'latest',feedback:[{verdict:'discarded'}]}];
 const work=await previousSketchWork([{id:'A'}],rules,cases,async asset=>{
  if(asset==='invalid')throw new SyntaxError('Incomplete legacy record');
  assert.equal(asset,'legacy');return {data:{prompt:'Build a keyed sleeve'},result:{edits:[],refinement:{summary:'Profile prepared'}}};
 });
 assert.deepEqual(work.map(w=>[w.instruction,w.outcome,w.figureIds]),[['Build a keyed sleeve','sketch',['A']]]);
});

test('editing the same figure twice preserves the original construction request',async()=>{
 const first={id:'a:g0',figureId:'A'};
 const second={id:'b:f0',figureId:'A',previousCaseIds:figureWorkCaseIds(first)};
 const third={id:'c:f0',figureId:'A',previousCaseIds:figureWorkCaseIds(second)};
 const cases=['Build the bushing','Smooth the outline','Continue'].map((instruction,i)=>({id:'abc'[i],work:{instruction}}));
 const work=await previousSketchWork([{id:'A'}],[third],cases);
 assert.deepEqual(work.map(w=>w.instruction),cases.map(c=>c.work.instruction));
});

test('task classification uses the current instruction and prior target work without retransmitting images',async()=>{
 const data={previousWorkOnTargets:[{instruction:'Build a keyed sleeve'}],partContext:{bodies:[]},image:'private-image'};
 const result=await classifyInstruction(data,'Continue.',{apiKey:'test',record:async()=>{},fetcher:async(url,opts)=>{
  assert.ok(url.endsWith('/decisions'));assert.ok(!opts.body.includes('private-image'));
  assert.match(opts.body,/Continue\./);assert.match(opts.body,/keyed sleeve/);
  return {ok:true,json:async()=>({answers:[{type:'choice',name:'deliverable',choice:'new_body'},{type:'choice',name:'local_features',choice:'cut'}]})};
 }});
 assert.equal(result.choice,'new_body');assert.equal(result.localFeatures,'cut');
});

test('a sketch-only plan for a requested solid is repaired automatically before returning',async()=>{
 const {saved,fit}=fixture();
 saved.data.prompt='Make a 10 mm thick disk';fit.instructionTask='new_body';
 process.env.OPENAI_API_KEY||='synthetic-only';process.env.SESSION_DIR='.runtime/sketch-workflow-unit';
 let calls=0;
 const result=await runSketchRefinement(saved,fit,{fetcher:async(_url,opts)=>{
  calls++;
  const operations=calls===1?[]:[operation('g0',{dimensions:{extrusionMetres:.01}})];
  if(calls===2)assert.match(opts.body,/No independent body is constructed/);
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Disk',question:null,operations,additions:[],solidEdits:[]})}]}]})};
 }});
 assert.equal(calls,2);assert.equal(result.requestedDeliverable,'new_body');assert.equal(result.edits[0].extrusionMetres,.01);
});

test('a continuation restores bounded guides only for the target and an independent request starts fresh',async()=>{
 const ids=[{id:'target',strokeIds:['guide']}],rules=[{id:'first:g0',figureId:'target'}],cases=[{id:'first',asset:'case',work:{instruction:'Build a sleeve',outcome:'sketch'}}];
 const record=()=>({data:{strokes:['unrelated','guide'].map(id=>({id,points:Array.from({length:400},(_,i)=>[i,0,0])}))},result:{}});
 const work=await previousSketchWork(ids,rules,cases,record,{includeGuides:true});
 assert.deepEqual(work[0].guides.map(g=>g.id),['guide']);
 assert.ok(work[0].guides[0].points.length<=97);
 assert.equal(resumeSketchWork('Do something.',work).instruction,'Build a sleeve');
 assert.equal(resumeSketchWork('Draw a circle instead',work),null);
 const summary=await previousSketchWork(ids,rules,cases,()=>assert.fail('Unnecessary asset read'));
 assert.equal(summary[0].guides,undefined);
});

test('an angular outline with a retraced tip is recovered from the enclosing ink',async()=>{
 const {simpleOutline,recoverLineOutline}=await import('../src/decision-sketch/simple-outline.js');
 const raw=[[0,0],[.65,0],[.98,.035],[1,.05],[.65,.1],[0,.1]];
 const flattened=[[0,0],[.65,0],[1,0],[.65,0],[.65,.1],[0,.1]];
 assert.equal(simpleOutline(flattened),false);
 const repaired=recoverLineOutline(raw,{symmetry:'none',align:true});
 assert.ok(simpleOutline(repaired.knots));assert.ok(repaired.knots.some(p=>p[0]>.97));
 assert.ok(simpleOutline([[0,0],[1,0],[1,1],[0,1]]));
 assert.equal(simpleOutline([[0,0],[1,1],[0,1],[1,0]]),false);
});
