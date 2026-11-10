import test from 'node:test';import assert from 'node:assert/strict';
import {readGeminiStream} from '../scripts/gemini-stream.mjs';
import {resolveSpatialParameters,validateSpatialParameters} from '../src/spatial-edit-contract.js';
import {spatialGeometry} from '../src/spatial-geometry.js';
import {desktopReasoning} from '../scripts/desktop-edit.mjs';
const axes=[[1,0,0],[0,1,0],[0,0,1]],frame={center:[0,1,-.6],axes,sizeMetres:[.2,.2,0]};
const create=(kind,parameters)=>({operation:'create',figureId:null,expectedVersion:null,candidateId:null,kind,parameters});
test('Gemini streaming handles split SSE/UTF8, reports public output only, and preserves completion/usage',async()=>{
 const messages=[{candidates:[{content:{parts:[{text:'private reasoning',thought:true}]}}]},{candidates:[{content:{parts:[{text:'{"summary":"Créer '}]}}]},{candidates:[{finishReason:'STOP',content:{parts:[{text:'a cylinder"}'}]}}],usageMetadata:{totalTokenCount:10}}];const bytes=new TextEncoder().encode(messages.map(m=>'data: '+JSON.stringify(m)+'\r\n\r\n').join(''));let offset=0;const response=new Response(new ReadableStream({pull(c){if(offset>=bytes.length){c.close();return;}c.enqueue(bytes.slice(offset,offset+=7));}}));const seen=[];const result=await readGeminiStream(response,p=>seen.push(p.text));assert.equal(result.candidates[0].finishReason,'STOP');assert.equal(result.usageMetadata.totalTokenCount,10);assert.equal(seen.at(-1),'{"summary":"Créer a cylinder"}');assert.ok(seen.every(t=>!t.includes('private')));
});
test('reference plane → exact circle → extrusion resolves real versioned geometry and preserves source',()=>{
 const plane={id:'plane',version:1,kind:'plane',parameters:frame};validateSpatialParameters('plane',frame);
 const e={figures:[plane],spatialFit:{candidates:[]}};const circle=resolveSpatialParameters(create('circle3d',{planeFigureId:'plane',radiusMetres:.02}),e);assert.deepEqual(circle.center,frame.center);assert.deepEqual(circle.axes,axes);
 e.figures.push({id:'profile',version:2,kind:'circle3d',parameters:circle});const original=structuredClone(e);const p=resolveSpatialParameters(create('extrusion',{profileFigureId:'profile',profileVersion:2,depthMetres:.1}),e);assert.equal(p.profileKind,'circle3d');assert.equal(p.radiusMetres,.02);assert.deepEqual(e,original);
 const g=spatialGeometry('extrusion',p);g.computeBoundingBox();assert.ok(Math.abs(g.boundingBox.min.z-(-.6))<1e-6);assert.ok(Math.abs(g.boundingBox.max.z-(-.5))<1e-6);g.dispose();
 assert.throws(()=>resolveSpatialParameters(create('extrusion',{profileFigureId:'profile',profileVersion:1,depthMetres:.1}),e),/stale/);
});
test('rectangle extrusion follows a rotated reference frame; invalid planes do not become solids',()=>{
 const p={...frame,axes:[[0,0,-1],[0,1,0],[1,0,0]],sizeMetres:[.12,.08,0]};validateSpatialParameters('rectangle3d',p);const e={figures:[{id:'r',version:1,kind:'rectangle3d',parameters:p}],spatialFit:{candidates:[]}};const resolved=resolveSpatialParameters(create('extrusion',{profileFigureId:'r',profileVersion:1,depthMetres:.05}),e),g=spatialGeometry('extrusion',resolved);g.computeBoundingBox();assert.ok(Math.abs(g.boundingBox.max.x-.05)<1e-6);assert.ok(Math.abs(g.boundingBox.min.x)<1e-6);g.dispose();assert.throws(()=>validateSpatialParameters('plane',{...frame,sizeMetres:[.2,.2,.01]}),/zero Z/);
});
test('both rapid models keep the lowest supported thinking even for a substantial build',()=>{for(const model of ['gemini-4-argon','gemini-3.8-flash'])assert.equal(desktopReasoning({run:{model,automation:{goal:'assembly'}},prompt:'Create an assembly and boolean union',evidence:{outputPreference:'solid'}}),'low');});
import {rapidContextInput,newDesktopContext} from '../scripts/desktop-context.mjs';
import {expandRapidSpatial} from '../scripts/rapid-spatial-contract.mjs';
test('fast request keeps raw drawings and authoritative state without accumulating obsolete scene images',()=>{
 const c=newDesktopContext();c.currentGoal='Make a cylinder';c.instructions=[{text:'Preserve symmetry'}];c.history=[{role:'user',content:[{type:'input_image',image_url:'obsolete-scene'}]}];c.applications=[{runId:'r',turn:1,appliedCount:1,review:{figureIds:['plane'],operationTrace:[{phase:'applied',label:'Created plane',figureId:'plane',kind:'plane'}]}}];
 const e={version:1,workspace:'vr',strokes:[{id:'s',points:[[0,0,0],[1,1,0]],fit:{selected:{kind:'spline3d',path:[[0,0,0],[1,1,0]]}}}],figures:[{id:'plane',version:3,kind:'plane',parameters:frame}],frames:[{layer:'stroke',strokeIds:['s'],image:'raw-image'},{layer:'spatial-front',image:'current-scene'}],creationTimeline:[{label:'Created plane',phase:'applied',kind:'plane',figureId:'plane',version:3,parameters:{redundant:'not needed twice'}}]};const before=structuredClone(c.history),input=rapidContextInput(c,e,{prompt:'Now draw the circle'});const text=input[0].content[0].text,packet=JSON.parse(text);
 assert.deepEqual(input[0].content.filter(p=>p.type==='input_image').map(p=>[p.image_url,p.detail]),[['raw-image','high'],['current-scene','low']]);assert.equal(packet.evidence.figures[0].version,3);assert.equal(packet.applicationResults[0].appliedCount,1);assert.equal(packet.explicitInstructions[0].text,'Preserve symmetry');assert.ok(!text.includes('obsolete-scene'));assert.deepEqual(c.history,before);
});
test('compact output expands only explicit model operations and retains completed plan steps',()=>{
 const run={prompt:'Create a plane and circle'};let result=expandRapidSpatial({summary:'Create plane',action:{operation:'create',kind:'plane',id:null,version:null,candidate:null,name:'Plane',params:frame,strokes:[],dimensions:'200 mm'},next:'Draw the circle',question:null,plan:['Plane','Circle'],completed:[1]},run);assert.equal(result.edits[0].kind,'plane');assert.equal(result.automation.steps[0].state,'completed');assert.equal(result.continuation.nextMove,'Draw the circle');
 run.automation=result.automation;result=expandRapidSpatial({summary:'Done',action:null,next:null,question:null,plan:null,completed:[2]},run);assert.ok(result.automation.steps.every(s=>s.state==='completed'));assert.equal(result.continuation,null);assert.throws(()=>expandRapidSpatial({summary:'Bad',action:null,next:null,question:null,plan:null,completed:[9]},run),/Unknown completed/);
});
