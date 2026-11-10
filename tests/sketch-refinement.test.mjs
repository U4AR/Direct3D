import test from 'node:test';import assert from 'node:assert/strict';
import {buildRefinementRequest,expandRefinement,runSketchRefinement,refinementCost} from '../scripts/sketch-refinement.mjs';
import {planeDrawingSafety,viewAlignedPlane} from '../src/desktop-plane-safety.js';
import {projectRecordedStroke} from '../src/view-plane-projection.js';
import {fixture,operation,cameraView} from './sketch-refinement-fixture.mjs';
import {cacheDecisionDrafts,splitDecisionDrafts,combineDecisionDrafts} from '../src/decision-draft-context.js';
test('Terra receives initial geometry, user intent and images with none reasoning and no tool loop',()=>{const{saved,fit}=fixture(),body=buildRefinementRequest(saved,fit);assert.equal(body.model,'gpt-6.1-terra');assert.equal(body.reasoning.effort,'none');assert.equal(body.tools,undefined);assert.ok(body.input[0].content.filter(p=>p.type==='input_image').length>=2);const data=JSON.parse(body.input[0].content[0].text);assert.ok(Math.abs(data.fittedReferences[0].initialEdit.radiusMetres-.05)<1e-12);assert.match(data.userInstruction,/Clean/);assert.equal(data.fittedReferences[0].initialEdit.segments,undefined);});
test('a compact dimension patch reuses the initial circle identity/frame and creates correct editable output',()=>{const{saved,fit}=fixture(),r=expandRefinement({summary:'Diameter 120 mm',question:null,operations:[operation('g0',{dimensions:{radiusMetres:.06,widthMetres:null,heightMetres:null,extrusionMetres:null}})],additions:[]},saved,fit);assert.equal(r.edits[0].radiusMetres,.06);assert.deepEqual(r.edits[0].origin,fit.edits[0].origin);assert.deepEqual(r.edits[0].strokeIds,['ring']);assert.equal(r.results[0].kind,'circle');assert.ok(Math.abs(r.results[0].pathWorld[0][0]-.06)<1e-8);assert.ok(Math.abs(fit.edits[0].radiusMetres-.05)<1e-12);});
test('projection from the recorded user view recovers a circle on a new parallel offset plane from a tilted capture',()=>{const{saved,fit}=fixture({tilted:true}),r=expandRefinement({summary:'Circle on offset view plane',question:null,operations:[operation('g0',{action:'project',projection:{base:'view',planeId:null,offsetMetres:.1,throughOrigin:true,representation:'circle',closed:true}})],additions:[]},saved,fit);assert.equal(r.edits[0].kind,'circle');assert.ok(Math.abs(r.edits[0].radiusMetres-.0475)<.0001);assert.ok(Math.abs(r.edits[0].origin[2]-.1)<1e-9);assert.equal(r.referencePlanes.length,1);assert.equal(r.edits[0].planeId,r.referencePlanes[0].id);assert.deepEqual(saved.data.plane.origin,[0,0,0]);});
test('plane intent is batched into Decisions and projection honors explicit dimensions in the same model operation',()=>{const{saved,fit}=fixture({tilted:true});assert.ok(saved.body.questions.some(q=>q.name==='g0.support_plane'));const r=expandRefinement({summary:'Circle 120 mm on offset plane',question:null,operations:[operation('g0',{action:'project',dimensions:{radiusMetres:.06,widthMetres:null,heightMetres:null,extrusionMetres:null},projection:{base:'view',planeId:null,offsetMetres:.1,throughOrigin:true,representation:'circle',closed:true}})],additions:[]},saved,fit);assert.equal(r.edits[0].radiusMetres,.06);assert.ok(Math.abs(r.edits[0].origin[2]-.1)<1e-9);});
test('a projected preview retains its output plane as a reference and carries that plane into later acceptance',()=>{const{saved,fit}=fixture({tilted:true}),result=expandRefinement({summary:'Project circle',question:null,operations:[operation('g0',{action:'project',projection:{base:'view',planeId:null,offsetMetres:.1,throughOrigin:true,representation:'circle',closed:true}})],additions:[]},saved,fit),cached=cacheDecisionDrafts(result,saved.data.strokes),next=splitDecisionDrafts({defaultPlane:saved.data.plane,strokes:saved.data.strokes},cached);assert.equal(cached[0].referencePlane.id,result.edits[0].planeId);assert.equal(next.retained.length,1);assert.equal(next.references[0].plane.id,result.edits[0].planeId);assert.ok(next.references[0].points.every(p=>Math.abs(p[2]-.1)<1e-9));const combined=combineDecisionDrafts({id:'next',results:[],edits:[]},next.retained);assert.equal(combined.referencePlanes[0].id,result.edits[0].planeId);});
test('orthographic reprojection retains radius and rejects behind-camera targets',()=>{const f=viewAlignedPlane(cameraView,[0,0,0],{offsetMetres:.2}),stroke={points:[[.05,0,0],[0,.05,0]],view:{...cameraView,projectionMatrix:Array.from({length:16},(_,i)=>i===15?1:0)}},p=projectRecordedStroke(stroke,f);assert.deepEqual(p.points[0],[.05,0,.2]);assert.throws(()=>projectRecordedStroke(stroke,viewAlignedPlane(cameraView,[0,0,0],{offsetMetres:3})),/behind/);});
test('edge-on views are rejected while both face-on sides remain drawable; view planes pass through the design origin',()=>{const plane={normal:[0,0,1]};assert.equal(planeDrawingSafety(plane,[1,0,0]).allowed,false);assert.equal(planeDrawingSafety(plane,[0,0,-1]).allowed,true);assert.equal(planeDrawingSafety(plane,[0,0,1]).allowed,true);assert.deepEqual(viewAlignedPlane(cameraView,[.2,1,-.6]).origin,[.2,1,-.6]);});
test('malformed references, dimensions and conflicting circle scales are rejected before application',()=>{const{saved,fit}=fixture(),plan=op=>({summary:'Edit',question:null,operations:[op],additions:[]});assert.throws(()=>expandRefinement(plan(operation('unknown')),saved,fit),/Unknown/);assert.throws(()=>expandRefinement(plan(operation('g0',{scaleUV:[2,1]})),saved,fit),/uniform/);assert.throws(()=>expandRefinement(plan(operation('g0',{dimensions:{radiusMetres:-1}})),saved,fit),/positive/);});
test('provider transport sends exactly the requested Terra none request and records its compact output',async()=>{const {saved,fit}=fixture();process.env.OPENAI_API_KEY||='synthetic-test-only';process.env.SESSION_DIR='.runtime/terra-refinement/unit';let calls=0;const result=await runSketchRefinement(saved,fit,{fetcher:async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');const b=JSON.parse(options.body);assert.equal(b.reasoning.effort,'none');assert.equal(b.model,'gpt-6.1-terra');return {ok:true,status:200,json:async()=>({status:'completed',usage:{input_tokens:1000,output_tokens:20},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Fit already satisfies the request',question:null,operations:[],additions:[]})}]}]})};}});assert.equal(calls,1);assert.equal(result.refinement.reasoning,'none');assert.ok(Math.abs(result.edits[0].radiusMetres-.05)<1e-12);});

test('Terra cost includes cache-write premiums and read discounts, and missing usage stays unknown',()=>{assert.ok(Math.abs(refinementCost({input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:200,cache_write_tokens:300}}).usd-.001385)<1e-12);assert.equal(refinementCost().usageKnown,false);assert.equal(refinementCost({input_tokens:1000,output_tokens:10},'another-model').usd,null);});
test('an offset parallel to an existing remote sketch is measured from that sketch',()=>{
 const {saved,fit}=fixture({tilted:true}),ref={id:'prior',origin:[0,0,.2],xAxis:[1,0,0],yAxis:[0,1,0],normal:[0,0,1]};
 saved.data.referencePlanes.push(ref);
 const result=expandRefinement({summary:'Parallel section',question:null,additions:[],operations:[operation('g0',{action:'project',projection:{base:'plane',planeId:ref.id,offsetMetres:.035,throughOrigin:false,representation:'circle',closed:true}})]},saved,fit);
 const target=result.referencePlanes.find(p=>p.id===result.edits[0].planeId);
 assert.deepEqual(target.normal,ref.normal);assert.ok(Math.abs(target.origin[2]-.235)<1e-9);
 assert.ok(result.results[0].pathWorld.every(p=>Math.abs(p[2]-.235)<1e-9));
});

test('a flagged section uses Luna and its local tilt and offset become the editable plane',()=>{
 const {saved,fit}=fixture({view:true});
 const base=saved.data.plane;
 fit.results[0].supportDecision={label:'inclined',confidence:.36};
 const request=buildRefinementRequest(saved,fit);
 assert.equal(request.model,'gpt-6-luna');
 assert.equal(request.reasoning.effort,'none');
 const projection={base:'plane',planeId:base.id,offsetMetres:.025,angleXDegrees:15,angleYDegrees:0,throughOrigin:false,representation:'mixed',closed:true};
 const result=expandRefinement({summary:'Inclined section',question:null,operations:[operation('g0',{action:'project',projection})],additions:[]},saved,fit);
 const plane=result.referencePlanes[0];
 assert.equal(plane.construction.angleXDegrees,15);
 assert.equal(plane.construction.offsetMetres,.025);
 assert.ok(Math.abs(plane.normal.reduce((sum,v,k)=>sum+v*base.normal[k],0)-Math.cos(Math.PI/12))<1e-8);
 assert.equal(result.edits[0].planeId,plane.id);
});

test('Luna may reject a false plane flag in one call and retain the original support',async()=>{
 const {saved,fit}=fixture({view:true});
 fit.results[0].supportDecision={label:'parallel_offset',confidence:.2};
 process.env.OPENAI_API_KEY||='synthetic-test-only';
 process.env.SESSION_DIR='.runtime/plane-confirm/unit';
 let calls=0;
 const result=await runSketchRefinement(saved,fit,{fetcher:async(url,options)=>{
  calls++;
  const body=JSON.parse(options.body);
  assert.equal(body.model,'gpt-6-luna');
  assert.ok(body.text.format.schema.required.includes('placementAssessments'));
  const data=JSON.parse(body.input[0].content[0].text);
  assert.equal(data.fittedReferences[0].capturePlaneEvidence[0].viewAngleFromNormalDegrees,0);
  return {ok:true,json:async()=>({status:'completed',usage:{input_tokens:100,output_tokens:20},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Keep the circular detail in this sketch',question:null,operations:[],additions:[],placementAssessments:[{referenceId:'g0',choice:'keep',reason:'A circle on the capture plane needs no depth change.'}]})}]}]})};
 }});
 assert.equal(calls,1);
 assert.equal(result.refinement.placementAssessments[0].choice,'keep');
 assert.deepEqual(result.edits,fit.edits);
 assert.deepEqual(result.results[0].frame,fit.results[0].frame);
});

test('a clarification is reviewed internally before a routine editable dimension reaches the user',async()=>{
 const {saved,fit}=fixture();
 process.env.OPENAI_API_KEY||='synthetic-test-only';
 process.env.SESSION_DIR='.runtime/terra-refinement/question-unit';
 let calls=0;
 const result=await runSketchRefinement(saved,fit,{fetcher:async(_url,options)=>{
  const request=JSON.parse(options.body);
  calls++;
  const plan={summary:'Kept the measured circle',question:calls===1?'Can you confirm the measured radius?':null,operations:[],additions:[]};
  if(calls===2){
   assert.ok(request.text.format.schema.properties.clarificationReason);
   plan.clarificationReason=null;
  }
  return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}]})};
 }});
 assert.equal(calls,2);assert.equal(result.refinement.question,null);assert.equal(result.edits[0].kind,'circle');
});
