import {editSketchComponent} from '../src/sketch-component-edit.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {prepareExistingSketchEdit,runExistingSketchEdit} from '../scripts/existing-sketch-edit.mjs';
import {expandRefinement,buildRefinementRequest} from '../scripts/sketch-refinement.mjs';
import {regularizeSketch} from '../src/sketch-regularization.js';
import {verifyDecisionFigure} from '../src/decision-sketch/harness.js';
import {fixture,operation} from './sketch-refinement-fixture.mjs';
function input(){const{saved,fit}=fixture({view:true}),f={...fit.edits[0],id:'accepted-ring',version:4,strokeIds:['archived-ink']};return {prompt:'Make it smooth and symmetric on four axes.',source:'speech',plane:saved.data.plane,view:saved.data.view,referencePlanes:saved.data.referencePlanes,figures:[f]};}

test('speech-only correction builds current geometry as an in-place versioned reference without requiring new ink',()=>{const data=input(),{saved,fit}=prepareExistingSketchEdit(data);assert.equal(fit.edits[0].operation,'update');assert.equal(fit.edits[0].figureId,'accepted-ring');assert.equal(fit.edits[0].expectedVersion,4);assert.equal(fit.cost.usd,0);const b=buildRefinementRequest(saved,fit),context=JSON.parse(b.input[0].content[0].text);assert.equal(context.mode,'edit-existing');assert.match(context.userInstruction,/four axes/);assert.equal(context.fittedReferences[0].initialEdit.operation,'update');assert.equal(b.reasoning.effort,'none');});

test('numerical regularization guarantees smooth joins and four reflection axes, preserving identity and support frame',()=>{const{saved,fit}=prepareExistingSketchEdit(input()),plan={summary:'Rounded four-axis profile',question:null,operations:[operation('f0',{action:'regularize',regularization:{smooth:true,symmetry:'four'}})],additions:[]},result=expandRefinement(plan,saved,fit),f=result.edits[0],r=result.results[0];assert.equal(f.operation,'update');assert.equal(f.figureId,'accepted-ring');assert.equal(f.planeId,fit.edits[0].planeId);assert.deepEqual(f.xAxis,fit.edits[0].xAxis);assert.equal(r.constraints.reflectionAxes,4);assert.equal(r.constraints.smooth,true);verifyDecisionFigure(f,r);const broken=structuredClone(f);broken.segments[2][2]+=.01;assert.throws(()=>verifyDecisionFigure(broken,r),/symmetry|matching|continuous/);});

test('smoothing alone preserves the chosen symmetry instead of adding a new one',()=>{const f={kind:'spline',closed:true,origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],segments:[[0,0,.03,0,.07,0,.1,0],[.1,0,.1,.03,.03,.1,0,.1],[0,.1,0,.07,0,.03,0,0]]},r=regularizeSketch(f,{smooth:true,symmetry:'preserve'},{closed:true,symmetry:'none'});assert.equal(r.constraints.symmetry,'none');assert.equal(r.constraints.reflectionAxes,undefined);verifyDecisionFigure(r.edit,{kind:'profile',constraints:r.constraints});assert.notDeepEqual(r.edit.segments,f.segments);});

test('existing-sketch provider path makes one request, strips virtual ink IDs, and keeps archived provenance',async()=>{process.env.OPENAI_API_KEY||='synthetic-test-only';process.env.SESSION_DIR='.runtime/speech-smoothing-review/unit';let count=0;const result=await runExistingSketchEdit(input(),{recordingId:'unit-recording',requestId:crypto.randomUUID(),fetcher:async(url,options)=>{count++;const b=JSON.parse(options.body);assert.equal(b.model,'gpt-6.1-terra');assert.equal(b.reasoning.effort,'none');return{ok:true,json:async()=>({status:'completed',usage:{input_tokens:100,output_tokens:20},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'Smoothing applied',question:null,operations:[operation('f0',{action:'regularize',regularization:{smooth:true,symmetry:'four'}})],additions:[]})}]}]})};}});assert.equal(count,1);assert.equal(result.instructionEdit,true);assert.deepEqual(result.edits[0].strokeIds,[]);assert.deepEqual(result.results[0].sourceStrokeIds,[]);assert.deepEqual(result.results[0].priorStrokeIds,['archived-ink']);assert.equal(result.edits[0].figureId,'accepted-ring');});

test('invalid or stale-looking current figure payloads reject before a provider request',()=>{const a=input();a.figures.push(a.figures[0]);assert.throws(()=>prepareExistingSketchEdit(a),/distinct/);assert.throws(()=>prepareExistingSketchEdit({...input(),prompt:''}),/instruction/);const b=input();b.figures[0].radiusMetres=-1;assert.throws(()=>prepareExistingSketchEdit(b),/dimensions/);});


test('manual vertex editing retains the new four-axis and smooth constraints',()=>{const current=input().figures[0],rounded=regularizeSketch(current,{smooth:true,symmetry:'four'},{closed:true,symmetry:'both'}),f=rounded.edit,index=1,target=[f.segments[index][0]+.004,f.segments[index][1]+.001],changed=editSketchComponent(f,{kind:'profile',constraints:rounded.constraints},{kind:'vertex',index},target);verifyDecisionFigure(changed.figure,{kind:'profile',constraints:changed.constraints});assert.equal(changed.constraints.reflectionAxes,4);assert.equal(changed.constraints.smooth,true);});

test('smoothing an analytic ellipse preserves its canonical native construction',()=>{const a=.06,b=.03,k=4*(Math.sqrt(2)-1)/3,f={kind:'spline',closed:true,origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],segments:[[a,0,a,k*b,k*a,b,0,b],[0,b,-k*a,b,-a,k*b,-a,0],[-a,0,-a,-k*b,-k*a,-b,0,-b],[0,-b,k*a,-b,a,-k*b,a,0]]},r=regularizeSketch(f,{smooth:true,symmetry:'preserve'},{closed:true,symmetry:'both',analytic:true});assert.deepEqual(r.edit.segments,f.segments);verifyDecisionFigure(r.edit,{kind:'ellipse',constraints:r.constraints});});
test('rotated single-axis outline keeps its wide end and narrow stem',()=>{
 const angle=0.7,c=Math.cos(angle),s=Math.sin(angle);
 const xy=[[-.05,-.15],[.05,-.15],[.05,0],[.14,.04],[.14,.15],[-.14,.15],[-.14,.04],[-.05,0]];
 const verts=xy.map(([x,y])=>[x*c-y*s,x*s+y*c]);
 const segments=verts.map((a,i)=>{const b=verts[(i+1)%verts.length];return [0,1/3,2/3,1].flatMap(t=>a.map((v,k)=>v+(b[k]-v)*t));});
 const edit={kind:'spline',id:'outline',closed:true,origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],segments};
 const result=regularizeSketch(edit,{smooth:true,symmetry:'one'});
 verifyDecisionFigure(result.edit,{kind:'profile',constraints:result.constraints});
 const output=result.edit.segments.map(curve=>[0,1].map(k=>result.edit.origin[k]+curve[0]*result.edit.xAxis[k]+curve[1]*result.edit.yAxis[k])).map(([x,y])=>[c*x+s*y,-s*x+c*y]);
 const width=(min,max)=>{const xs=output.filter(p=>p[1]>min&&p[1]<max).map(p=>p[0]);return Math.max(...xs)-Math.min(...xs);};
 assert.ok(Math.abs(width(-.13,-.03)-.1)<.012);
 assert.ok(Math.abs(width(.07,.14)-.28)<.012);
});

test('hollow-cap instructions expose wall thickness and an offset axis without changing the request',async()=>{
 const data=input();data.prompt='Revolve this as a hollow cap with 3 mm walls.';
 const line=(a,b)=>[...a,...a.map((v,k)=>v+(b[k]-v)/3),...a.map((v,k)=>v+2*(b[k]-v)/3),...b];
 data.figures[0]={...data.figures[0],kind:'spline',closed:false,segments:[line([.05,0],[.05,.1]),line([.05,.1],[0,.1])]};
 process.env.OPENAI_API_KEY||='synthetic-test-only';process.env.SESSION_DIR='.runtime/hollow-cap/unit';
 let calls=0;
 const result=await runExistingSketchEdit(data,{fetcher:async(url,options)=>{
  const body=JSON.parse(options.body);
  const properties=body.text.format.schema.properties.solidEdits.items.properties.revolution.anyOf[0].properties;
  assert.ok(properties.wallThicknessMetres);assert.ok(properties.axisOriginUV);
  assert.match(body.instructions,/preserve hollow versus solid/i);
  const response={summary:'Build the requested hollow cap',question:null,operations:[],additions:[],solidEdits:[{name:'Hollow cap',kind:'revolve',loftMode:'ruled',revolution:{axis:'vertical',axisOriginUV:[0,0],wallThicknessMetres:.003,angleDegrees:360},profiles:[{figureId:data.figures[0].id,expectedVersion:data.figures[0].version,depthMetres:null,backDepthMetres:null}]}]};
  if(++calls===1)response.solidEdits[0].revolution.axisOriginUV=[.025,0];
  else assert.match(JSON.stringify(body.input.at(-1)),/crosses the revolve axis/);
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(response)}]}]})};
 }});
 assert.equal(calls,2);
 assert.equal(result.refinement.question,null);
 assert.equal(result.solidEdits[0].revolution.wallThicknessMetres,.003);
});
