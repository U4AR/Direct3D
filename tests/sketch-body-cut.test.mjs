import test from 'node:test';
import assert from 'node:assert/strict';
import {sketchBodyCut} from '../scripts/sketch-body-cut.mjs';
import {fixture} from './sketch-refinement-fixture.mjs';

test('handle clearance uses the chosen strokes and stops at the body midplane from either side',()=>{
 const {saved,fit}=fixture({view:true}),data=saved.data;
 data.partContext={bodies:[{bodyId:'cap',boundsWorld:{min:[-.1,-.1,-.04],max:[.1,.1,.04]}}]};
 const spec={name:'Handle opening',bodyId:'cap',strokeIds:[data.strokes[0].id],profile:'rounded-opening',depthMetres:null};
 for(const sign of [1,-1]){
  data.strokes[0].view.cameraToWorld[10]=sign;
  const {plane,edit,solid}=sketchBodyCut(spec,data,fit),extent=solid.profiles[0];
  assert.equal(plane.origin[2],0);assert.equal(edit.closed,true);assert.equal(edit.segments.length,4);
  assert.equal(solid.targetBodyId,'cap');
  assert.ok(sign>0?extent.depthMetres>.04&&extent.backDepthMetres===null:extent.depthMetres===0&&extent.backDepthMetres>.04);
 }
 assert.throws(()=>sketchBodyCut({...spec,strokeIds:['missing']},data,fit),/guide/);
 assert.throws(()=>sketchBodyCut({...spec,depthMetres:1},data,fit),/depth/);
});
