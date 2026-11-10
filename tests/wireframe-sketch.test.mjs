import test from 'node:test';
import assert from 'node:assert/strict';
import {wireframeCandidates} from '../scripts/wireframe-sketch.mjs';
import {withCreationReferences,expandRefinement,buildRefinementRequest} from '../scripts/sketch-refinement.mjs';
import {fixture} from './sketch-refinement-fixture.mjs';

function drawing(kind='rectangle'){
 const {saved,fit}=fixture();
 const plane=saved.data.plane,shift=[.06,.045,0],points=[];
 if(kind==='rectangle')points.push([-.05,-.035,0],[.05,-.035,0],[.05,.035,0],[-.05,.035,0]);
 else for(let i=0;i<32;i++)points.push([.05*Math.cos(i*Math.PI/16),.05*Math.sin(i*Math.PI/16),0]);
 const move=(p,d)=>p.map((v,i)=>v+d[i]),rear=points.map(p=>move(p,shift));
 const paths=[[...points,points[0]],[...rear,rear[0]],[points[0],rear[0]],[rear[points.length/2],points[points.length/2]]];
 const strokes=paths.map((points,i)=>({id:'stroke'+i,points,plane}));
 const edits=strokes.map((s,i)=>({...fit.edits[0],name:i<2?'Section':'Edge',kind:i<2?kind:'line',closed:i<2,
  origin:i===0?[0,0,0]:i===1?shift:s.points[0],end:i>=2?s.points[1]:null,radiusMetres:i<2&&kind==='circle'?.05:null,
  widthMetres:i<2&&kind==='rectangle'?.1:null,heightMetres:i<2&&kind==='rectangle'?.07:null,strokeIds:[s.id]}));
 const results=strokes.map((s,i)=>({...fit.results[0],id:'g'+i,sourceStrokeIds:[s.id],kind:edits[i].kind,
  frame:{...plane,origin:edits[i].origin},constraints:{closed:i<2,symmetry:i<2?'both':'none'},pathWorld:s.points}));
 return {saved:{...saved,data:{...saved.data,strokes,prompt:''}},fit:{...fit,results,edits}};
}
const selected={summary:'Build the connected sections',question:null,operations:[],additions:[],solidEdits:[],
 wireframeBody:{candidateId:'wire-0',name:'Solid',sectionStyle:'uniform',offsetMetres:null}};

for(const kind of ['rectangle','circle'])test('connected '+kind+' sections produce one ruled body with editable parallel sections',()=>{
 const initial=drawing(kind),{saved,fit}=withCreationReferences(initial.saved,initial.fit);
 assert.equal(fit.wireframes.length,1);assert.equal(fit.wireframes[0].distinctJoins,2);
 const request=buildRefinementRequest(saved,fit);
 assert.ok(request.text.format.schema.required.includes('wireframeBody'));
 const out=expandRefinement(selected,saved,fit);
 assert.deepEqual(out.edits.map(e=>e.kind),[kind,kind]);assert.equal(out.solidEdits.length,1);
 assert.deepEqual(out.solidEdits[0].profiles.map(p=>p.figureId),['new-edit:0','new-edit:1']);
 assert.deepEqual(out.edits[1].origin,[0,0,-.075]);
 assert.equal(out.referencePlanes[0].construction.basePlaneId,saved.data.plane.id);
 assert.equal(out.refinement.wireframeBody.derivedPlaneId,out.edits[1].planeId);
 const explicit=expandRefinement({...selected,wireframeBody:{...selected.wireframeBody,offsetMetres:.03}},saved,fit);
 assert.equal(explicit.edits[1].origin[2],.03);
 const flat=expandRefinement({...selected,wireframeBody:null},saved,fit);
 assert.equal(flat.edits.length,4);assert.equal(flat.solidEdits.length,0);
});
test('two outlines, repeated marks at one corner, and explicitly kept planar ink do not infer a solid',()=>{
 const {saved,fit}=drawing();
 assert.deepEqual(wireframeCandidates(saved.data,{results:fit.results.slice(0,2),edits:fit.edits.slice(0,2)}),[]);
 saved.data.strokes[3].points=saved.data.strokes[2].points;
 assert.deepEqual(wireframeCandidates(saved.data,fit),[]);
 saved.data.strokes[1].drawingTarget={placementChoice:'keep'};
 assert.deepEqual(wireframeCandidates(saved.data,fit),[]);
});
test('new connecting strokes can use already accepted native sections',()=>{
 const input=drawing(),{saved,fit}=input;
 saved.data.sketchFigures=fit.edits.slice(0,2).map((e,i)=>({...e,id:'native'+i,version:3}));
 fit.edits=fit.edits.slice(2);fit.results=fit.results.slice(2);saved.data.strokes=saved.data.strokes.slice(2);
 const prepared=withCreationReferences(saved,fit),out=expandRefinement(selected,prepared.saved,prepared.fit);
 assert.equal(out.edits.length,1);assert.equal(out.edits[0].operation,'create');
 assert.deepEqual(out.solidEdits[0].profiles.map(p=>[p.figureId,p.expectedVersion]),[['native0',3],['new-edit:0',1]]);
});
