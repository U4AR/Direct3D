import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareExistingSketchEdit} from '../scripts/existing-sketch-edit.mjs';
import {verifyDecisionFigure} from '../src/decision-sketch/harness.js';
import {editSketchComponent} from '../src/sketch-component-edit.js';
import {revolveSection} from '../src/revolve-section.js';
import {expandRefinement} from '../scripts/sketch-refinement.mjs';
test('new body design uses a native figure as a reference without updating it',()=>{
 const figure={id:'source',name:'Measured section',version:1,kind:'rectangle',widthMetres:.1,heightMetres:.3,closed:true,origin:[.4,.5,.6],xAxis:[1,0,0],yAxis:[0,1,0],planeId:'front'};
 const {saved,fit}=prepareExistingSketchEdit({prompt:'Make a symmetric body using this as inspiration',figures:[figure]});
 const prior=structuredClone(fit);
 const plan={summary:'New body',question:null,operations:[],additions:[],bodyDesign:{name:'New body',referenceId:'f0',axisDegrees:90,thicknessMetres:.012,halfOutline:[[-1,0],[-.9,.2],[.1,.18],[.45,1],[1,0]]}};
 const result=expandRefinement(plan,saved,fit);
 assert.deepEqual(fit,prior);assert.equal(result.edits.length,1);
 const e=result.edits[0];assert.equal(e.operation,'create');assert.equal(e.figureId,null);
 assert.equal(e.extrusionMetres,.012);assert.equal(e.closed,true);assert.equal(result.results[0].constraints.symmetry,'one');
 assert.deepEqual(e.origin,figure.origin);assert.notEqual(e.kind,figure.kind);
 assert.throws(()=>expandRefinement({...plan,bodyDesign:{...plan.bodyDesign,thicknessMetres:0}},saved,fit),/thickness/);
 const turning=expandRefinement({...plan,bodyDesign:{...plan.bodyDesign,form:'revolve',thicknessMetres:null}},saved,fit);
 assert.equal(turning.edits[0].extrusionMetres,null);
 assert.equal(turning.solidEdits[0].kind,'revolve');
 assert.equal(turning.solidEdits[0].profiles[0].figureId,'new-edit:0');
 const meridian=revolveSection(turning.edits[0],turning.solidEdits[0].revolution);
 assert.ok(meridian.segments.every(s=>s[1]>=0&&s[7]>=0));
 assert.deepEqual(meridian.xAxis,turning.edits[0].xAxis);
});

// An uneven native silhouette, already placed in a non-world sketch frame.
const knots=[[-.031,-.035],[.029,-.035],[.033,.021],[.014,.044],[-.012,.046],[-.028,.024]];
const spline={id:'outline',version:3,kind:'spline',closed:true,construction:false,planeId:'front',
 origin:[.31,.42,.17],xAxis:[0,1,0],yAxis:[0,0,1],segments:knots.map((a,i)=>{
  const b=knots[(i+1)%knots.length];return [...a,...a.map((v,k)=>(2*v+b[k])/3),...b.map((v,k)=>(2*v+a[k])/3),...b];
 })};
const revolve={kind:'revolve',name:'Turned body',loftMode:'smooth',
 profiles:[{figureId:'outline',expectedVersion:3,depthMetres:null,backDepthMetres:null}],
 revolution:{axis:'vertical',angleDegrees:360,axisOriginUV:null,wallThicknessMetres:null}};
const plan={summary:'Revolve outline',operations:[],question:null,additions:[],solidEdits:[revolve]};
test('prepares an editable mirrored source before a revolve without moving the sketch frame',()=>{
 const {saved,fit}=prepareExistingSketchEdit({prompt:'Revolve this outline',figures:[spline]});
 const result=expandRefinement(plan,saved,fit);
 const [profile]=result.edits,[metadata]=result.results;
 assert.equal(result.refinement.operations[0].regularization.symmetry,'vertical');
 assert.equal(profile.figureId,'outline');assert.equal(profile.expectedVersion,3);
 for(const key of ['origin','xAxis','yAxis'])assert.deepEqual(profile[key],spline[key]);
 assert.equal(metadata.constraints.mirrorAxis,'vertical');
 assert.equal(verifyDecisionFigure(profile,metadata),true);
 const half=revolveSection(profile,revolve.revolution);
 assert.equal(half.segments.length,profile.segments.length/2+1);
 const point=profile.segments[1].slice(0,2).map((v,k)=>v+(k===0?.001:0));
 const moved=editSketchComponent(profile,metadata,{kind:'vertex',index:1},point);
 const ref=moved.figure||moved.edit;
 const c=moved.constraints,n=ref.segments.length,j=((c.mirrorOffset-1)%n+n)%n;
 assert.ok(Math.abs(ref.segments[j][0]+point[0])<1e-8);
 assert.ok(Math.abs(ref.segments[j][1]-point[1])<1e-8);
});
test('keeps an explicitly asymmetric section or local repair intact before a solid',()=>{
 const {saved,fit}=prepareExistingSketchEdit({prompt:'Keep the asymmetric edge',figures:[spline]});
 for(const optOut of [true,false]){
  if(!optOut)fit.results[0].repairPolicy={preserveAsymmetry:true};
  const result=expandRefinement({...plan,keepAsDrawn:optOut?['f0']:[]},saved,fit);
  assert.equal(result.edits.length,0);assert.equal(result.solidEdits[0].profiles[0].figureId,'outline');
 }
});
