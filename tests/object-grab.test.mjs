import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {meshContainsPoint,magneticTransform} from '../src/object-grab.js';
const mesh=g=>new T.Mesh(g,new T.MeshBasicMaterial());
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('containment rejects outside points and empty bounding-box corners of rotated curved objects',()=>{
 const m=mesh(new T.SphereGeometry(.1,24,16));m.position.set(1,2,3);m.rotation.set(.2,.7,.1);m.scale.set(2,1,.5);m.updateMatrixWorld(true);
 assert.equal(meshContainsPoint(m,new T.Vector3(1,2,3)),true);
 assert.equal(meshContainsPoint(m,new T.Vector3(.04,.02,.01).applyMatrix4(m.matrixWorld)),true);
 assert.equal(meshContainsPoint(m,new T.Vector3(.09,.09,0).applyMatrix4(m.matrixWorld)),false);
 assert.equal(meshContainsPoint(m,new T.Vector3(2,2,3)),false);
});
test('a hollow CAD-style part cannot be grabbed through its hole',()=>{
 const shape=new T.Shape();shape.moveTo(-.1,-.1);shape.lineTo(.1,-.1);shape.lineTo(.1,.1);shape.lineTo(-.1,.1);shape.closePath();
 const hole=new T.Path();hole.absarc(0,0,.03,0,Math.PI*2,true);shape.holes.push(hole);
 const m=mesh(new T.ExtrudeGeometry(shape,{depth:.04,bevelEnabled:false,curveSegments:24}));m.position.z=-.02;
 assert.equal(meshContainsPoint(m,new T.Vector3(0,0,0)),false);assert.equal(meshContainsPoint(m,new T.Vector3(.07,0,0)),true);
});
test('magnet snaps the actual geometry centre and orthogonal orientation without resizing',()=>{
 const centre=new T.Vector3(.3,.2,-.4),scale=new T.Vector3(2,3,4),q=new T.Quaternion().setFromEuler(new T.Euler(0,T.MathUtils.degToRad(89),0));
 const desiredCenter=new T.Vector3(.001,.4,-.002),p=desiredCenter.clone().sub(centre.clone().multiply(scale).applyQuaternion(q));
 const raw=new T.Matrix4().compose(p,q,scale),result=magneticTransform(raw,centre),after=centre.clone().applyMatrix4(result.matrix),p2=new T.Vector3(),q2=new T.Quaternion(),s2=new T.Vector3();result.matrix.decompose(p2,q2,s2);
 close(after.x,0);close(after.y,.4);close(after.z,0);close(q2.angleTo(new T.Quaternion().setFromEuler(new T.Euler(0,Math.PI/2,0))),0);s2.toArray().forEach((v,i)=>close(v,scale.toArray()[i]));assert.ok(result.labels.includes('X=0'));assert.ok(result.labels.includes('axes'));
});
test('magnet attraction is soft near alignment and leaves distant/free poses unchanged',()=>{
 const q=new T.Quaternion().setFromEuler(new T.Euler(.4,.3,.2)),raw=new T.Matrix4().compose(new T.Vector3(.01,.4,.5),q,new T.Vector3(1,1,1));
 const result=magneticTransform(raw),p=new T.Vector3().setFromMatrixPosition(result.matrix);assert.ok(p.x>0&&p.x<.01);close(p.y,.4);close(p.z,.5);
 const distant=new T.Matrix4().compose(new T.Vector3(.1,.4,.5),q,new T.Vector3(1,1,1));magneticTransform(distant).matrix.elements.forEach((v,i)=>close(v,distant.elements[i]));assert.deepEqual(magneticTransform(raw,new T.Vector3(),false).matrix.elements,raw.elements);
});
