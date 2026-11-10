import test from 'node:test';
import assert from 'node:assert/strict';
import {composeSketchEdit} from '../scripts/compose-sketch-tool.mjs';
import {compactDesktopInput,newDesktopContext} from '../scripts/desktop-context.mjs';
const plane={id:'side',origin:[2,3,4],xAxis:[0,0,-1],yAxis:[0,1,0]};
const evidence={workspace:'desktop',version:1,defaultPlane:plane,referencePlanes:[plane],strokes:[{id:'ink',plane,points:[[2,3,4],[2,3,3.9],[2,3.1,3.8]],fit:{selected:{kind:'spline2d'}}}],frames:[],figures:[],models:[]};
const entity=(kind,coordinates,rest={})=>({kind,coordinates,name:kind,closed:false,figureId:null,expectedVersion:null,...rest});
const compose=(entities,extra={})=>composeSketchEdit({call:{arguments:JSON.stringify({intent:'Body with rounded feature',strokeIds:['ink'],planeId:'side',entities,...extra})},run:{},evidence});
test('semantic composition preserves reference frame and produces native lines and arcs in one move',()=>{
 const {edit}=compose([entity('polyline',[0,0,.2,0,.25,.1]),entity('arc',[.25,.15,.05,-90,90])]);
 assert.deepEqual(edit.edits.map(e=>e.kind),['line','line','arc']);
 assert.deepEqual(edit.edits[1].origin,[2,3,3.8]);assert.deepEqual(edit.edits[1].end,[2,3.1,3.75]);
 assert.equal(edit.edits[2].radiusMetres,.05);assert.equal(edit.continuation,null);
 assert.ok(edit.edits.every(e=>e.strokeIds[0]==='ink'&&e.extrusionMetres===null));
});
test('intentional noncircular splines retain their exact controls, and edits update current IDs',()=>{
 evidence.figures=[{id:'existing',version:3,kind:'spline'}];
 const {edit}=compose([entity('spline',[[0,0,.1,.1,.2,.1,.3,0]],{figureId:'existing',expectedVersion:3})]);
 assert.deepEqual(edit.edits[0].segments,[[0,0,.1,.1,.2,.1,.3,0]]);assert.equal(edit.edits[0].operation,'update');
 assert.throws(()=>compose([entity('line',[0,0,.1,0],{figureId:'existing',expectedVersion:2})]),/stale/);
 evidence.figures=[];
});
test('invalid or oversized compositions never return a partially valid edit',()=>{
 assert.throws(()=>compose([entity('arc',[0,0,-.1,0,180])]),/arc/);
 assert.throws(()=>compose([entity('polyline',Array.from({length:132},(_,i)=>i*.01))]),/maximum 64/);
 assert.throws(()=>compose([entity('line',[0,0,.1,0])],{strokeIds:['missing']}),/source/);
 assert.throws(()=>compose([entity('spline',[0,0,1,1,2,2,3])]),/nested cubic/);
});
test('default context includes bounded measured line/curve coordinates, not a spline classification',()=>{
 const packet=JSON.parse(compactDesktopInput(newDesktopContext(),evidence,{prompt:'Clean the drawing'})[0].content[0].text);
 const ref=packet.evidence.measuredDraft.paths[0];
 assert.deepEqual(ref.frame.origin,plane.origin);assert.ok(ref.segments.length);
 assert.ok(ref.segments.every(s=>s.coordinates.length===4||s.coordinates.length===8));
 assert.equal(packet.evidence.inkCatalog[0].approximation,undefined);
 assert.ok(!JSON.stringify(packet).includes('spline2d'));assert.equal(packet.inputBudget.rawPointsInContext,0);
});

test('three-anchor arcs calculate a true circle locally in either drawing direction',()=>{
 for(const coords of [[0,0,.05,.05,.1,0],[.1,0,.05,.05,0,0]]){
  const e=compose([entity('arc3',coords)]).edit.edits[0];assert.equal(e.kind,'arc');assert.ok(Math.abs(e.radiusMetres-.05)<1e-10);assert.ok(Math.abs(e.origin[2]-3.95)<1e-10);assert.equal(e.startAngleDeg,0);assert.equal(e.endAngleDeg,180);
 }
 assert.throws(()=>compose([entity('arc3',[0,0,.05,0,.1,0])]),/collinear/);
});
