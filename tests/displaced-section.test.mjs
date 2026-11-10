import test from 'node:test';
import assert from 'node:assert/strict';
import {displacedSectionHypothesis} from '../scripts/parallel-depth-hypotheses.mjs';
import {measuredPlacementPlan} from '../scripts/sketch-refinement.mjs';
import {planeSupportQuestion} from '../scripts/decision-plane-support.mjs';
import {cameraView} from './sketch-refinement-fixture.mjs';

function example({angle=17,angle0=0,shift=.036,radius=.09,side=1}={}){
 const plane={id:'front',origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],normal:[0,0,1]};
 function stroke(id,rad,offset,deg){
  const points=Array.from({length:65},(_,i)=>[offset+rad*Math.cos(i*Math.PI/32),rad*.83*Math.sin(i*Math.PI/32),0]);
  const view=structuredClone(cameraView),a=deg*Math.PI/180;
  view.cameraToWorld.splice(8,3,Math.sin(a),0,side*Math.cos(a));
  return {id,view,points,plane};
 }
 const strokes=[stroke('a',.09,0,angle0),stroke('b',radius,shift,angle)];
 const groups=strokes.map((s,i)=>({id:'g'+i,frame:plane,points:s.points.map(p=>p.slice(0,2)),strokes:[s]}));
 const supportSketches=groups.map(g=>({id:g.id,plane,points:g.strokes[0].points,sourceStrokeIds:[g.strokes[0].id]}));
 return {plane,group:groups[1],data:{plane,strokes,supportSketches}};
}
test('signed displacement is measured in metres and supplied to the original image decision',()=>{
 for(const side of [-1,1]){
  const {group,data,plane}=example({side});
  assert.equal(displacedSectionHypothesis(group,data,plane).offsetMetres,-side*.036);
  assert.match(planeSupportQuestion(group,data).instructions,/Measured displaced section relative to g0/);
 }
});
test('face-on layouts, small holes, retraces, locked supports, and repairs keep their plane',()=>{
 for(const params of [{angle:0},{angle:12,angle0:11},{radius:.03},{shift:.002}]){
  const {group,data,plane}=example(params);
  assert.equal(displacedSectionHypothesis(group,data,plane),null);
 }
 const {group,data,plane}=example();
 assert.equal(displacedSectionHypothesis(group,{...data,options:{detectOffsets:false}},plane),null);
 assert.equal(displacedSectionHypothesis(group,{...data,editContext:{targetFigure:'figure'}},plane),null);
 group.strokes[0].drawingTarget={placementChoice:'keep'};
 assert.equal(displacedSectionHypothesis(group,data,plane),null);
});
test('a previously accepted section retains the original capture direction as a placement reference',()=>{
 const {group,data,plane}=example();
 const previous={...data.supportSketches[0],captureDirection:[0,0,1]};
 const input={...data,strokes:group.strokes,supportSketches:[],references:[previous]};
 assert.equal(displacedSectionHypothesis(group,input,plane).offsetMetres,-.036);
});

test('one positive placement decision can directly generate a preview and respects other work',()=>{
 const {group,data,plane}=example(),offset=displacedSectionHypothesis(group,data,plane);
 const r={id:'g1',kind:'ellipse',constraints:{closed:true},supportDecision:{label:'parallel_offset'}},fit={offsets:{g1:offset},results:[r]};
 assert.equal(measuredPlacementPlan(data,fit).operations[0].projection.offsetMetres,-.036);
 assert.equal(measuredPlacementPlan({...data,prompt:'Make a solid'},fit),null);
 assert.equal(measuredPlacementPlan(data,{...fit,wireframes:[{}]}),null);
 r.supportDecision.label='current';
 assert.equal(measuredPlacementPlan(data,fit),null);
});
