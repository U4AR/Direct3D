import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {captureSurfaceScene,pickImageSurface,surfaceProjectionCandidates,validateSurfaceScene,rebaseSurfaceResult} from '../src/image-surface-pick.js';
import {buildDecisionRequest} from '../scripts/decision-sketch-api.mjs';
import {buildRefinementRequest,expandRefinement,runSketchRefinement} from '../scripts/sketch-refinement.mjs';
import {fixture,operation,cameraView} from './sketch-refinement-fixture.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
function object(id='plate',z=-.2){const mesh=new T.Mesh(new T.BoxGeometry(.6,.6,.2),new T.MeshBasicMaterial());mesh.position.z=z;mesh.updateMatrixWorld(true);return {id,name:'Plate',version:3,geometryVersion:2,mesh};}
function surfaceFixture(){const{saved,fit}=fixture({view:true}),body=object();saved.data.surfaceScene=captureSurfaceScene([body]);saved.data.prompt='Project this circle onto the front face of the plate.';const req=buildDecisionRequest(saved.data);saved.body=req.body;return{saved,fit,body};}
const project=(imagePoint=[.5,.5],offsetMetres=0)=>({summary:'Circle on object face',question:null,operations:[operation('g0',{action:'project',projection:{base:'surface',planeId:null,imagePoint,offsetMetres,throughOrigin:false,representation:'circle',closed:true}})],additions:[]});

test('image point picks the nearest visible face and returns world and object-local planes, without leaking vertices into model input',()=>{const{saved,fit}=surfaceFixture(),hit=pickImageSurface(saved.data.surfaceScene,cameraView,[.5,.5]);assert.equal(hit.modelId,'plate');assert.equal(hit.modelVersion,3);assert.equal(hit.planar,true);close(hit.frame.origin[2],-.1);close(hit.localFrame.origin[2],.1);close(hit.frame.normal[2],1);assert.ok(saved.body.questions.some(q=>q.name==='g0.support_plane'&&q.choices.some(c=>c.value==='object_surface')));const req=buildRefinementRequest(saved,fit);assert.equal(req.tools[0].name,'select_image_surface');const text=req.input[0].content[0].text;assert.ok(!text.includes('positions'));assert.ok(!text.includes('indices'));assert.ok(JSON.parse(text).fittedReferences[0].surfaceCandidates.length);const front=object('front',.4),back=object('back',-.4);assert.equal(pickImageSurface(captureSurfaceScene([back,front]),cameraView,[.5,.5]).modelId,'front');});

test('surface projection and offset start at the actual face, preserve analytic geometry, and keep object provenance',()=>{const{saved,fit}=surfaceFixture(),result=expandRefinement(project([.5,.5],.02),saved,fit);assert.equal(result.edits[0].kind,'circle');close(result.edits[0].origin[2],-.08);close(result.edits[0].radiusMetres,.052);const p=result.referencePlanes[0];assert.equal(p.surfaceAttachment.modelId,'plate');assert.equal(p.surfaceAttachment.modelVersion,3);assert.equal(p.surfaceAttachment.offsetMetres,.02);assert.deepEqual(saved.data.surfaceScene.models[0].matrixWorld.slice(12,15),[0,0,-.2]);assert.throws(()=>expandRefinement({...project(),operations:[operation('g0',{action:'project',projection:{...project().operations[0].projection,throughOrigin:true}})]},saved,fit),/anchored/);});

test('moving and rotating an object after recording preserves its face-local sketch placement',()=>{const{saved,fit,body}=surfaceFixture(),result=expandRefinement(project([.5,.5],.02),saved,fit);body.mesh.position.set(.4,.7,-.8);body.mesh.rotation.y=.6;body.mesh.updateMatrixWorld(true);body.version++;const rebased=rebaseSurfaceResult(result,[body]),expected=new T.Vector3(0,0,.12).applyMatrix4(body.mesh.matrixWorld).toArray();rebased.edits[0].origin.forEach((v,k)=>close(v,expected[k]));const n=new T.Vector3(...rebased.referencePlanes[0].normal);close(n.dot(new T.Vector3(0,0,1).transformDirection(body.mesh.matrixWorld)),1);assert.equal(rebased.referencePlanes[0].surfaceAttachment.modelVersion,4);close(result.edits[0].origin[2],-.08);body.geometryVersion++;assert.throws(()=>rebaseSurfaceResult(result,[body]),/geometry changed/);});

test('orthographic picks use parallel image rays and curved faces are identified as tangent supports',()=>{const camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;camera.updateMatrixWorld(true);const view={cameraToWorld:camera.matrixWorld.toArray(),projectionMatrix:camera.projectionMatrix.toArray()},hit=pickImageSurface(captureSurfaceScene([object()]),view,[.6,.5]);close(hit.frame.origin[0],.2);close(hit.frame.origin[2],-.1);const ball={...object(),mesh:new T.Mesh(new T.SphereGeometry(.5,32,24))},surface=pickImageSurface(captureSurfaceScene([ball]),cameraView,[.5,.5]);assert.equal(surface.planar,false);assert.equal(surface.supportType,'tangent-plane');assert.match(surface.note,/not a flattened or wrapped/);});

test('bad pixels, missing hits, malformed snapshots and invalid cameras fail safely',()=>{const scene=captureSurfaceScene([object()]);assert.throws(()=>pickImageSurface(scene,cameraView,[-.1,.5]),/normalized/);assert.throws(()=>pickImageSurface(scene,cameraView,[.99,.99]),/No visible/);assert.throws(()=>pickImageSurface(scene,{...cameraView,projectionMatrix:Array(16).fill(0)},[.5,.5]),/calibrated/);const bad=structuredClone(scene);bad.models[0].indices[0]=99999;assert.throws(()=>validateSurfaceScene(bad),/indices/);assert.throws(()=>buildDecisionRequest({...surfaceFixture().saved.data,surfaceScene:bad}),/indices/);});

test('surface inspection tool returns measured feedback in a bounded optional second model request, recording total usage',async()=>{const{saved,fit}=surfaceFixture();process.env.OPENAI_API_KEY||='synthetic-test-only';process.env.SESSION_DIR='.runtime/terra-refinement/surface-unit';let count=0;const result=await runSketchRefinement(saved,fit,{fetcher:async(url,options)=>{const body=JSON.parse(options.body);count++;if(count===1){assert.equal(body.tools[0].name,'select_image_surface');return {ok:true,json:async()=>({status:'completed',usage:{input_tokens:1000,output_tokens:20},output:[{type:'function_call',id:'tool1',call_id:'call1',name:'select_image_surface',arguments:JSON.stringify({imagePoint:[.5,.5]})}]})};}const output=JSON.parse(body.input.find(i=>i.type==='function_call_output').output);assert.equal(output.modelId,'plate');close(output.frame.origin[2],-.1);const plan=project();plan.operations[0].projection.imagePoint=null;plan.operations[0].projection.planeId=output.id;return {ok:true,json:async()=>({status:'completed',usage:{input_tokens:1200,output_tokens:50},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}]})};}});assert.equal(count,2);assert.equal(result.refinement.modelRequests,2);assert.equal(result.refinement.toolCalls[0].output.modelId,'plate');assert.equal(result.refinement.usage.input_tokens,2200);close(result.edits[0].origin[2],-.1);assert.equal(result.refinement.estimatedCostUSD,.00255);});

test('after a missed and a successful pick, reserve the final plan and its validation repair',async()=>{
 const {saved,fit}=surfaceFixture();
 process.env.OPENAI_API_KEY||='synthetic-test-only';
 process.env.SESSION_DIR='.runtime/terra-refinement/surface-unit';
 let n=0;
 const result=await runSketchRefinement(saved,fit,{fetcher:async(_url,opts)=>{
  const req=JSON.parse(opts.body);
  const i=++n;
  if(i<=2){
   const imagePoint=i===1?[0,0]:[.5,.5];
   return {ok:true,json:async()=>({output:[{type:'function_call',call_id:'pick'+i,name:'select_image_surface',arguments:JSON.stringify({imagePoint})}]})};
  }
  assert.equal(req.tool_choice,'none');
  const feedback=req.input.filter(m=>m.type==='function_call_output').map(m=>JSON.parse(m.output));
  assert.ok(feedback[0].error);assert.equal(feedback[1].modelId,'plate');
  const plan=project();
  plan.operations[0].referenceId=i===3?'invalid':'g0';
  return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}]})};
 }});
 assert.equal(n,4);assert.equal(result.refinement.toolCalls.length,2);
 assert.equal(result.referencePlanes[0].surfaceAttachment.modelId,'plate');
});

test('an independent material edit uses the CAD planner and guide sections without a face-pick round trip',()=>{
 const {saved,fit}=surfaceFixture();
 saved.data.partContext={bodies:[{bodyId:'plate-body',name:'Plate',boundsWorld:{min:[-.3,-.3,-.3],max:[.3,.3,-.1]}}]};
 saved.data.prompt='Add material along this line on the visible side of the plate.';
 const {body}=buildDecisionRequest(saved.data);
 assert.ok(body.questions.find(q=>q.name==='current_task').choices.some(c=>c.value==='material_feature'));
 const result=buildRefinementRequest(saved,{...fit,decisions:[{name:'current_task',choice:'material_feature'}]});
 assert.equal(result.tools,undefined);assert.ok(result.text.format.schema.properties.featurePlan);
 assert.equal(result.text.format.schema.properties.placementAssessments,undefined);
 const pick=buildRefinementRequest(saved,{...fit,decisions:[{name:'current_task',choice:'face_placement'}]});
 assert.equal(pick.tools[0].name,'select_image_surface');
});
