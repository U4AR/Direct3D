import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Matrix4,Quaternion,Mesh,PlaneGeometry} from 'three';
import {tableContact,flatPalm,flatPalmPair,PalmCalibrationHold,boardReferenceTransform,boardInFront,BOARD_TOP,recoveryAction,nearHandPanelHit} from '../src/xr-calibration.js';
function hand(side,x=side==='left'?-.15:.15,y=.8){
 const points={wrist:{x,y,z:0}},sign=side==='left'?-1:1;
 ['index-finger','middle-finger','ring-finger','pinky-finger'].forEach((finger,f)=>{
  ['phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'].forEach((joint,j)=>points[finger+'-'+joint]={x:x+sign*(f-1.5)*.018,y,z:-.05-j*.022});
 });return points;
}
const pair=()=>({left:hand('left'),right:hand('right')});
test('both downward flat palms yield a table estimate; reject curled, upward, incomplete and noncoplanar hands',()=>{
 const h=pair(),r=flatPalmPair(h);assert.ok(r);assert.ok(r.normal.distanceTo(new Vector3(0,1,0))<1e-6);assert.equal(r.center.y,.792);
 assert.equal(flatPalmPair({left:h.left}),null);
 const bent=pair();bent.left['index-finger-tip'].z=0;assert.equal(flatPalmPair(bent),null);
 const up=hand('right');for(const p of Object.values(up))p.x=-p.x;assert.equal(flatPalm(up,'right'),null);
 assert.equal(flatPalmPair({left:hand('left'),right:hand('right',.15,.86)}),null);
 const missing=hand('right');delete missing['ring-finger-tip'];assert.equal(flatPalm(missing,'right'),null);
});
test('calibration needs a stable continuous hold and requires release before retriggering',()=>{
 const hold=new PalmCalibrationHold(),h=pair();let result;
 for(let t=0;t<=1300;t+=100){result=hold.update(h,t);assert.equal(result.calibration,undefined);}
 assert.ok(hold.update(h,1400).calibration);assert.equal(hold.update(h,1500).calibration,undefined);
 hold.update({},1600);hold.update({},2300);for(let t=2400;t<3800;t+=100)hold.update(h,t);assert.ok(hold.update(h,3800).calibration);
 const moved=new PalmCalibrationHold();for(let t=0;t<=1000;t+=100)moved.update(h,t);const elsewhere={left:hand('left',-.10),right:hand('right',.2)};assert.equal(moved.update(elsewhere,1100).progress,0);assert.equal(moved.update(elsewhere,1400).calibration,undefined);
});
test('tracking gaps restart the dwell and unsteady palms never calibrate',()=>{
 const hold=new PalmCalibrationHold();hold.update(pair(),0);assert.equal(hold.update(pair(),2000).progress,0);
 for(let t=2100;t<6000;t+=100){const x=t%200===0?0:.04;assert.equal(hold.update({left:hand('left',-.15+x),right:hand('right',.15+x)},t).calibration,undefined);}
});
test('reference transform keeps board horizontal despite tilted palms, preserving centre and scale',()=>{
 const center=new Vector3(3,.85,-2),normal=new Vector3(.1,1,.05).normalize(),head=new Vector3(2,1.65,0);
 const {position,orientation}=boardReferenceTransform(center,normal,head),matrix=new Matrix4().compose(position,orientation,new Vector3(1,1,1));
 assert.ok(new Vector3(...BOARD_TOP).applyMatrix4(matrix).distanceTo(center)<1e-9);
 assert.ok(new Vector3(0,1,0).applyQuaternion(orientation).distanceTo(new Vector3(0,1,0))<1e-9);
 const stroke=new Vector3(.1,1.2,-.6),original=stroke.clone();assert.ok(stroke.clone().applyMatrix4(matrix).applyMatrix4(matrix.clone().invert()).distanceTo(original)<1e-9);
 assert.ok(Math.abs(matrix.determinant()-1)<1e-9);
});
test('board recovery follows viewer heading and recovery buttons have isolated hit regions',()=>{
 const pose=new Matrix4().compose(new Vector3(2,1.6,3),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2),new Vector3(1,1,1));const b=boardInFront(pose);
 assert.ok(b.center.distanceTo(new Vector3(1.35,1,3))<1e-9);
 assert.equal(recoveryAction({x:.16,y:.5}),'menu-recover');assert.equal(recoveryAction({x:.5,y:.5}),'board-recenter');assert.equal(recoveryAction({x:.84,y:.5}),'exit-vr');assert.equal(recoveryAction({x:0,y:0}),null);
});

test('near-hand panel targeting respects rotated/scaled panel bounds and physical proximity',()=>{
 const panel=new Mesh(new PlaneGeometry(.8,.5));panel.position.set(2,1,-3);panel.rotation.y=.7;panel.scale.setScalar(.85);panel.updateMatrixWorld(true);
 const finger=panel.localToWorld(new Vector3(.1,.1,.03));const hit=nearHandPanelHit(panel,finger);assert.ok(hit);assert.ok(Math.abs(hit.uv.x-.625)<1e-9);assert.ok(Math.abs(hit.uv.y-.7)<1e-9);
 assert.equal(nearHandPanelHit(panel,panel.localToWorld(new Vector3(.1,.1,.1))),null);assert.equal(nearHandPanelHit(panel,panel.localToWorld(new Vector3(.6,0,0))),null);panel.visible=false;assert.equal(nearHandPanelHit(panel,finger),null);
});

test('table contact projects to tabletop with hysteresis and rejects lift, penetration and missing tracking',()=>{
 const y=BOARD_TOP[1];
 assert.deepEqual(tableContact({x:.2,y:y+.01,z:-.4}),[.2,y,-.4]);
 assert.equal(tableContact({x:0,y:y+.025,z:0}),null);
 assert.ok(tableContact({x:0,y:y+.025,z:0},.008,true));
 assert.equal(tableContact({x:0,y:y+.04,z:0},.008,true),null);
 assert.equal(tableContact({x:0,y:y-.05,z:0}),null);
 assert.equal(tableContact(null),null);
});
