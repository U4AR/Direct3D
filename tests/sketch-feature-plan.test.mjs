import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './sketch-refinement-fixture.mjs';
import {compileFeaturePlan} from '../scripts/sketch-feature-plan.mjs';
import {expandRefinement} from '../scripts/sketch-refinement.mjs';

function setup(){
 const {saved,fit}=fixture({view:true}),body={bodyId:'cap',boundsWorld:{min:[-.1,-.1,-.1],max:[.1,.1,.1]}};
 saved.data.partContext={bodies:[body]};saved.data.existingSolids=[body];
 const guide={id:'guide',name:'Opening',strokeIds:['ring'],profile:'circle',widthMetres:null};
 const feature=(id,operation,target,extent='forward')=>({id,name:id,sketch:'guide',toolBody:null,operation,target,extent,depthMetres:.02});
 const plan=features=>({sketches:[guide],features});
 return {saved,fit,guide,feature,plan};
}
test('two opposed cuts leave a central web and subsequent features use the last result',()=>{
 const {saved,fit,feature,plan}=setup();
 const r=expandRefinement({summary:'Opposed pockets and boss',question:null,additions:[],operations:[],
  featurePlan:plan([feature('open','cut','cap','opposed-pockets'),feature('boss','join','open','centered')])},saved,fit);
 assert.deepEqual(r.solidEdits.map(s=>[s.kind,s.targetBodyId]),[['pocket','cap'],['pocket','feature-result:0'],['join-material','feature-result:1']]);
 const [a,b]=r.edits;
 assert.equal(a.kind,'circle');assert.equal(b.radiusMetres,a.radiusMetres);
 const pa=r.solidEdits[0].profiles[0],pb=r.solidEdits[1].profiles[0];
 assert.ok(Math.abs(a.origin[2]+(b.origin[2]+pb.depthMetres))<1e-8);assert.ok(a.origin[2]+pa.depthMetres<b.origin[2]);
});
test('independent tool solid and target can be combined, with shared sketches reused',()=>{
 const {saved,fit,feature,plan}=setup();
 const f=[feature('boss','new-body',null),feature('tool','new-body',null),{...feature('merge','join','boss'),toolBody:'tool',sketch:null}];
 const r=compileFeaturePlan(plan(f),saved.data,fit);assert.equal(r.additions.length,1);
 assert.deepEqual(r.solidEdits[2],{kind:'join-material',name:'merge',loftMode:'ruled',targetBodyId:'feature-result:0',toolBodyId:'feature-result:1',profiles:[]});
 for(const bad of ['missing','tool','boss'])assert.throws(()=>compileFeaturePlan(plan([...f,feature('late','cut',bad)]),saved.data,fit),/current body/);
});
test('a dimensioned, model-authored closed sketch can drive multiple steps without ink',()=>{
 const {saved,fit,feature,plan}=setup();saved.data.strokes=[];
 const drawing={...fit.edits[0],strokeIds:[]};
 const r=expandRefinement({summary:'Dimensioned boss',question:null,operations:[],additions:[drawing],featurePlan:{sketches:[],features:[{...feature('add','join','cap'),sketch:'added:0'}]}},saved,fit);
 assert.equal(r.edits.length,1);assert.equal(r.solidEdits[0].profiles[0].figureId,'new-edit:0');
});

test('a rib crossing the target wall produces a simple closed extrusion profile',()=>{
 const {saved,fit,guide,feature}=setup(),data=saved.data;
 data.strokes[0].points=Array.from({length:60},(_,i)=>[.008*Math.sin(i/7),i*.002-.06,0]);
 data.surfaceScene={models:[{nativeId:'cap',positions:[0,-.1,-.01,0,.1,-.01,0,.1,.01,0,-.1,.01],indices:[0,1,2,0,2,3]}]};
 const plan={sketches:[{...guide,profile:'rib',widthMetres:.004}],features:[feature('reinf','join','cap','centered')]};
 const {segments}=compileFeaturePlan(plan,data,fit).additions[0];
 const side=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 assert.ok(segments.length>=4);
 for(const [i,s] of segments.entries()){
  const a=s.slice(0,2),b=s.slice(-2);assert.deepEqual(b,segments[(i+1)%segments.length].slice(0,2));
  for(const t of segments.slice(i+1)){
   const c=t.slice(0,2),d=t.slice(-2);
   assert.ok(side(a,b,c)*side(a,b,d)>=0||side(c,d,a)*side(c,d,b)>=0,'rib edges cross');
  }
 }
});

test('a named hollow revolve can drive a one-sided pocket in the same edit',()=>{
 const {fit,saved,plan,feature}=setup();
 const source=fit.edits[0];
 const outer={...source,kind:'spline',closed:false,radiusMetres:null,name:'Outer wall',segments:[[.05,0,.05,.02,.03,.055,0,.055]]};
 fit.results[0]={...fit.results[0],kind:'profile',constraints:{closed:false,symmetry:'none'}};
 fit.edits[0]=outer;
 const base={kind:'revolve',name:'Shell',loftMode:'smooth',profiles:[{figureId:'fit:g0',expectedVersion:1,depthMetres:null,backDepthMetres:null}],revolution:{axis:'vertical',axisOriginUV:[0,.055],angleDegrees:360,wallThicknessMetres:.003}};
 const result=expandRefinement({summary:'Make a shell with a local pocket',question:null,operations:[],additions:[],solidEdits:[base],featurePlan:plan([feature('notch','cut','Shell','visible-half')])},saved,fit);
 assert.deepEqual(result.solidEdits.map(s=>s.kind),['revolve','pocket']);
 assert.equal(result.edits[0].closed,false);
 assert.equal(result.solidEdits[0].profiles[0].figureId,'new-edit:0');
 assert.equal(result.solidEdits[1].targetBodyId,'feature-result:0');
 assert.ok(result.solidEdits[1].profiles[0].depthMetres>.04);
});

test('a feature guide grouped with a meridian stays local when the planner gives it its own role',async()=>{
 const {separateBaseGuide}=await import('../scripts/sketch-feature-guides.mjs');
 const {fit}=setup();
 const source={...fit.edits[0],kind:'spline',closed:false,strokeIds:['wall','mark'],segments:[[0,0,.01,.01,.02,.02,.03,.02]]};
 const strokes=[{id:'wall',points:[[0,0,0],[.01,.015,0],[.03,.02,0]]},{id:'mark',points:[[.02,.01,0],[.021,.03,0]]}];
 const cleaned=separateBaseGuide(source,[{strokeIds:['mark']}],strokes);
 assert.deepEqual(cleaned.strokeIds,['wall']);const end=cleaned.segments.at(-1);assert.ok(Math.hypot(end[6]-.03,end[7]-.02)<1e-10);
 assert.deepEqual(source.strokeIds,['wall','mark']);
 assert.equal(separateBaseGuide(source,[],strokes),source);
});

test('outline clips a small crossing at the pen join but rejects two substantial loops',()=>{
 const {saved,fit,guide,feature}=setup();
 const compile=points=>{
  saved.data.strokes[0].points=points.map(([x,y])=>[x*.01,y*.01,0]);
  return compileFeaturePlan({sketches:[{...guide,profile:'outline'}],features:[feature('boss','new-body',null)]},saved.data,fit);
 };
 const repaired=compile([[0,0],[4,0],[4,3],[0,3],[0,-.2],[.3,.1]]);
 assert.ok(repaired.additions[0].segments.length>=3);
 assert.throws(()=>compile([[0,0],[3,3],[0,3],[3,0],[0,0]]),/multiple substantial loops/);
});
