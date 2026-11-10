import test from 'node:test';import assert from 'node:assert/strict';
import {measuredDesktopDraft,measuredDraftContext,refineMeasuredEdit,assessMeasuredEdit} from '../scripts/desktop-measured-tool.mjs';
import {measuredDraftFrame,cropInkFrame} from '../scripts/desktop-draft-image.mjs';
import {runDesktopEdit} from '../scripts/desktop-edit.mjs';
import {newDesktopContext} from '../scripts/desktop-context.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const plane={id:'right',origin:[2,3,4],xAxis:[0,0,-1],yAxis:[0,1,0]};
const world=uv=>[2,3+uv[1],4-uv[0]];
const poly=vertices=>vertices.flatMap((p,i)=>i?Array.from({length:16},(_,j)=>p.map((v,k)=>vertices[i-1][k]+(v-vertices[i-1][k])*(j+1)/16)):[p]);
const packet=points=>({workspace:'desktop',version:1,sketchRevision:1,defaultPlane:plane,referencePlanes:[plane],strokes:[{id:'s',plane,points:points.map(world),fit:{selected:{kind:'spline2d'}}}],frames:[],figures:[],models:[]});
const angular=()=>packet(poly([[-.12,.2],[-.04,.23],[.1,.2],[.1,.08],[.01,.06],[.01,-.02],[.08,-.05],[.1,-.14],[.04,-.22],[-.08,-.2],[-.14,-.13],[-.12,-.05],[-.06,-.03],[-.06,.05],[-.12,.1],[-.12,.2]]));
const apply=(e,changes=[],regularization='none',extra={})=>refineMeasuredEdit({call:{arguments:JSON.stringify({draftId:measuredDesktopDraft(e).id,strokeIds:['s'],intent:'Retain angular silhouette and narrow neck',regularization,changes,...extra})},run:{},evidence:e});
test('measured draft preserves angular lobes, narrow neck and location without model coordinates',()=>{
 const e=angular(),d=measuredDesktopDraft(e),p=d.paths[0],{edit}=apply(e,[],'engineering'),report=assessMeasuredEdit(e,edit)[0];
 assert.ok(p.segments.length>8);assert.ok(p.segments.filter(s=>s.kind==='line').length>8);assert.ok(report.result.max<=p.toleranceMetres*1.5);
 assert.ok(edit.edits.every(e=>e.planeId===plane.id&&e.origin[0]===2&&e.extrusionMetres===null));
 const c=measuredDraftContext(d);assert.equal(c.paths[0].strokeId,'s');assert.equal(c.paths[0].source,undefined);
});
test('a broad arc replacing angular geometry is refused while the original draft is retained',()=>{
 const e=angular(),p=measuredDesktopDraft(e).paths[0];assert.ok(!p.choices.some(c=>c.fromSegment===p.segments[0].id&&c.toSegment===p.segments[5].id&&c.kind==='arc'));assert.throws(()=>apply(e,[{candidateId:'invented-broad-arc',name:'Bad broad shoulder'}]),/prevalidated/);const {edit}=apply(e);assert.ok(assessMeasuredEdit(e,edit)[0].result.max<p.toleranceMetres*1.5);
});
test('exact circles and rectangles are callable whole-path primitive alternatives; ellipses stay distinct',()=>{
 for(const [kind,points]of [['circle',Array.from({length:145},(_,i)=>[.1*Math.cos(i*Math.PI/72),.1*Math.sin(i*Math.PI/72)])],['rectangle',poly([[-.15,-.1],[.15,-.1],[.15,.1],[-.15,.1],[-.15,-.1]])]]){
  const e=packet(points),p=measuredDesktopDraft(e).paths[0];assert.ok(p.primitives.some(p=>p.kind===kind));const r=apply(e,[{candidateId:p.choices.find(c=>c.kind===kind).id,name:kind}]);assert.equal(r.edit.edits.length,1);assert.equal(r.edit.edits[0].kind,kind);assert.ok(assessMeasuredEdit(e,r.edit)[0].result.max<p.toleranceMetres*2);
 }
 const ellipse=packet(Array.from({length:145},(_,i)=>[.2*Math.cos(i*Math.PI/72),.06*Math.sin(i*Math.PI/72)]));assert.ok(!measuredDesktopDraft(ellipse).paths[0].primitives.some(p=>p.kind==='circle'));
});
test('stale drafts, unknown IDs and overlapping edits reject before mutation',()=>{
 const e=packet(Array.from({length:81},(_,i)=>[.1*Math.cos(i*Math.PI/40),.1*Math.sin(i*Math.PI/40)])),p=measuredDesktopDraft(e).paths[0],change={candidateId:p.choices[0].id,name:'First'};
 assert.throws(()=>apply(e,[], 'none',{draftId:'stale'}),/changed/);assert.throws(()=>apply(e,[{...change,candidateId:'unknown'}]),/prevalidated/);assert.throws(()=>apply(e,[change,change]),/Overlapping/);
});
test('selecting one stroke preserves independent planes and leaves the other stroke untouched',()=>{
 const e=angular();e.strokes.push({id:'other',points:[[9,0,0],[9,1,0]],plane:{id:'other-plane',origin:[9,0,0],xAxis:[0,1,0],yAxis:[0,0,1]},fit:{}});
 const {edit}=apply(e);assert.ok(edit.edits.every(e=>e.strokeIds.length===1&&e.strokeIds[0]==='s'&&e.planeId==='right'));
});
test('annotated measured image and original-ink crop preserve their coordinate mappings',()=>{
 const p=measuredDesktopDraft(angular()).paths[0],frame=measuredDraftFrame(p,'draft'),crop=cropInkFrame(frame);
 assert.ok(frame.image.startsWith('data:image/png;base64,'));assert.equal(frame.imageReference.uvToImage.length,9);assert.ok(crop.imageReference.cropRectangle);assert.equal(crop.imageReference.pixelToOriginal.length,9);assert.equal(crop.imageReference.sourceFrameId,frame.id);
});
test('automatic provider contract offers only measured changes, and runtime refuses an unbounded redraw',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'measured-contract-')),prior=process.env.SESSION_DIR;process.env.SESSION_DIR=root;
 try{const e=angular(),d=measuredDesktopDraft(e);e.frames=[{layer:'stroke',strokeIds:['s'],image:measuredDraftFrame(d.paths[0],d.id).image}];let count=0;
 const valid=apply(e).edit,unbounded={...valid,edits:[{...valid.edits[0],kind:'circle',radiusMetres:2,closed:true,end:null,segments:null}]};
 const result=await runDesktopEdit({run:{id:crypto.randomUUID(),recordingId:crypto.randomUUID(),model:'gpt-6-luna',events:[]},prompt:'Refine my sketch',promptSource:'desktop-sketch',evidence:e,context:newDesktopContext(),signal:new AbortController().signal,fetcher:async(url,options)=>{count++;const body=JSON.parse(options.body);assert.match(body.instructions,/reflection or rotational symmetry/);assert.match(body.instructions,/parallel opposite edges/);assert.match(body.instructions,/horizontal and vertical/);assert.match(body.instructions,/never claim a constraint/);assert.deepEqual(body.tools.map(t=>t.name),['refine_measured_sketch']);assert.equal(body.text.format.schema.properties.edits.maxItems,0);assert.equal(body.tools[0].parameters.properties.draftId.enum[0],d.id);return {ok:true,status:200,headers:new Headers(),json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(unbounded)}]}]})};}});
 assert.equal(count,1);assert.ok(result.edits.every(e=>e.kind!=='circle'));assert.ok(assessMeasuredEdit(e,result)[0].result.max<d.paths[0].toleranceMetres*1.5);
 }finally{if(prior===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=prior;assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));await rm(root,{recursive:true,force:true});}
});

test('small accidental closure gaps offer a rectangle correction without forcing it or closing an open U',()=>{
 const e=packet(poly([[-.16,-.11],[-.16,.1],[.16,.1],[.16,-.1],[-.16,-.1]])),p=measuredDesktopDraft(e).paths[0];
 assert.equal(p.closed,false);const choice=p.choices.find(c=>c.kind==='rectangle');assert.ok(choice);assert.notEqual(apply(e).edit.edits[0].kind,'rectangle');
 const corrected=apply(e,[{candidateId:choice.id,name:'Intended rectangle'}]).edit;assert.equal(corrected.edits.length,1);assert.equal(corrected.edits[0].kind,'rectangle');
 const open=packet(poly([[-.16,.1],[-.16,-.1],[.16,-.1],[.16,.1]]));assert.ok(!measuredDesktopDraft(open).paths[0].choices.some(c=>c.kind==='rectangle'));
});
