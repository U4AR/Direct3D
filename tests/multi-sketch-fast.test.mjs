import test from 'node:test';import assert from 'node:assert/strict';
import {prepareExistingSketchEdit,runExistingSketchEdit} from '../scripts/existing-sketch-edit.mjs';
import {buildRefinementRequest,expandRefinement} from '../scripts/sketch-refinement.mjs';
const plane={id:'front',origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],normal:[0,0,1]};
export function multiSketchFixture(){const base={id:'base-circle',version:2,kind:'circle',name:'Base',planeId:'front',desktopSketchId:'sketch-base',sketchId:'native-base',objectId:'object-base',origin:[0,0,0],xAxis:plane.xAxis,yAxis:plane.yAxis,radiusMetres:.04,closed:true,construction:false},top={...base,id:'top-circle',version:3,name:'Upper',planeId:'upper',desktopSketchId:'sketch-top',sketchId:'native-top',objectId:'object-top',origin:[0,0,.08],radiusMetres:.02},upper={...plane,id:'upper',origin:[0,0,.08]},input={prompt:'Create a 3D CAD model joining these two drawings.',source:'speech',figures:[top],sketchFigures:[base,top],plane:upper,referencePlanes:[plane,upper],selectedSketchIds:['sketch-base','sketch-top'],sketchCatalog:[{id:'sketch-base',plane,selected:true},{id:'sketch-top',plane:upper,selected:true}]};return {input,base,top};}
export const solidPlan=(base,top,kind='loft')=>({summary:'Create CAD from the existing sketch outputs',question:null,operations:[],additions:[],solidEdits:[{name:'Sketch-based solid',kind,loftMode:'ruled',profiles:[base,...(kind==='extrude'?[]:[top])].map(f=>({figureId:f.id,expectedVersion:f.version,depthMetres:kind==='loft'?null:.03,backDepthMetres:kind==='loft'?null:0}))}]});

test('model sees all native sketches and their frames even though only the upper sketch is active',()=>{const{input,base,top}=multiSketchFixture(),{saved,fit}=prepareExistingSketchEdit(input),body=buildRefinementRequest(saved,fit),context=JSON.parse(body.input[0].content[0].text);assert.equal(context.solidReferences.length,2);assert.deepEqual(context.selectedSketchIds,input.selectedSketchIds);assert.deepEqual(context.solidReferences.find(r=>r.figureId===top.id).origin,[0,0,.08]);assert.equal(context.solidReferences.find(r=>r.figureId===base.id).nativeSketchId,'native-base');assert.equal(context.fittedReferences.length,1);assert.deepEqual(body.text.format.schema.properties.solidEdits.items.properties.profiles.items.properties.figureId.enum,[base.id,top.id]);});

test('compact loft reuses both native figures without emitting any sketch edits',()=>{const{input,base,top}=multiSketchFixture(),{saved,fit}=prepareExistingSketchEdit(input),result=expandRefinement(solidPlan(base,top),saved,fit);assert.equal(result.noOp,false);assert.deepEqual(result.edits,[]);assert.equal(result.solidEdits[0].kind,'loft');assert.deepEqual(result.solidEdits[0].profiles.map(p=>p.figureId),[base.id,top.id]);assert.deepEqual(input.figures[0].origin,[0,0,.08]);});

test('extrusion uses one closed native profile; stale, open and construction profiles are rejected',()=>{const{input,base,top}=multiSketchFixture(),{saved,fit}=prepareExistingSketchEdit(input),result=expandRefinement(solidPlan(base,top,'extrude'),saved,fit);assert.equal(result.solidEdits[0].profiles.length,1);const bad=solidPlan(base,top);bad.solidEdits[0].profiles[0].expectedVersion=999;assert.throws(()=>expandRefinement(bad,saved,fit),/current versions/);const c=multiSketchFixture();c.base.construction=true;const p=prepareExistingSketchEdit(c.input);assert.throws(()=>expandRefinement(solidPlan(c.base,c.top),p.saved,p.fit),/closed sketch/);const line={...base,id:'line',kind:'line',closed:false,end:[.1,0,0]};input.sketchFigures=[line,top];const q=prepareExistingSketchEdit(input);assert.throws(()=>expandRefinement(solidPlan(line,top),q.saved,q.fit),/closed sketch/);});

test('multi-sketch solid command uses one model request and retains the profile references',async()=>{process.env.OPENAI_API_KEY||='synthetic-test-only';process.env.SESSION_DIR='.runtime/multi-sketch-fast/unit';const{input,base,top}=multiSketchFixture();let calls=0;const result=await runExistingSketchEdit(input,{recordingId:'unit-multi',requestId:crypto.randomUUID(),fetcher:async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.reasoning.effort,'none');assert.equal(JSON.parse(body.input[0].content[0].text).solidReferences.length,2);return{ok:true,json:async()=>({status:'completed',usage:{input_tokens:1000,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(solidPlan(base,top))}]}]})};}});assert.equal(calls,1);assert.equal(result.noOp,false);assert.equal(result.edits.length,0);assert.equal(result.solidEdits[0].profiles.length,2);});
test('a mixed question and edit becomes a clarification without applying partial geometry',()=>{
 const {input,base,top}=multiSketchFixture(),{saved,fit}=prepareExistingSketchEdit(input);
 const plan=solidPlan(base,top);
 plan.question='Which section should be the base?';
 plan.operations=[{referenceId:'f0',action:'regularize',regularization:{smooth:true,symmetry:'preserve'}}];
 const result=expandRefinement(plan,saved,fit);
 assert.equal(result.refinement.question,plan.question);
 assert.deepEqual(result.edits,[]);assert.deepEqual(result.solidEdits,[]);assert.deepEqual(result.refinement.operations,[]);
});
test('invalid solid plan receives validation feedback before one corrected response',async()=>{
 const {input,base,top}=multiSketchFixture(),valid=solidPlan(base,top),invalid=structuredClone(valid);
 invalid.solidEdits[0].profiles[0].expectedVersion++;
 let calls=0;
 process.env.OPENAI_API_KEY||='synthetic-only';
 process.env.SESSION_DIR='.runtime/multi-sketch-fast/unit';
 const result=await runExistingSketchEdit(input,{fetcher:async(url,options)=>{
  calls++;
  if(calls===2)assert.match(JSON.parse(options.body).input.at(-1).content,/current versions/);
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(calls===1?invalid:valid)}]}]})};
 }});
 assert.equal(calls,2);assert.equal(result.refinement.modelRequests,2);assert.equal(result.solidEdits[0].profiles[0].expectedVersion,base.version);
});
