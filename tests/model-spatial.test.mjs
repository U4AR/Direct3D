import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import {modelFrame,convertFrame,measureModels,matchMatrix} from "../src/model-spatial.js";
import {grabDelta,twoHandDelta} from "../src/object-manipulation.js";
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-7,`${a} != ${b}`));
function model(){const mesh=new T.Mesh(new T.BoxGeometry(2,4,1));mesh.position.set(5,2,-3);mesh.rotation.set(.1,.7,.3);mesh.scale.set(2,3,4);mesh.updateMatrixWorld(true);return {id:'part',version:4,mesh};}
test('object/world frames preserve points, vectors and inverse-transpose normals under user transforms',()=>{
 const m=model(),f=modelFrame(m),p=[[.1,.2,.3]];near(convertFrame(f,convertFrame(f,p),'world','object')[0],p[0]);
 const vector=convertFrame(f,[[1,0,0]],'object','world','vector')[0],normal=convertFrame(f,[[0,1,0]],'object','world','normal')[0];assert.ok(Math.abs(new T.Vector3(...vector).dot(new T.Vector3(...normal)))<1e-9);
 const old=convertFrame(f,[[0,0,0]])[0];m.mesh.position.x+=2;m.version++;near(convertFrame(modelFrame(m),[[0,0,0]])[0],old.map((v,i)=>v+(i===0?2:0)));
});
test('oversized assembly is measured and uniformly aligned without changing proportions',()=>{
 const m=model();m.mesh.rotation.set(0,0,0);m.mesh.scale.setScalar(5);m.mesh.updateMatrixWorld(true);
 const points=[[-.1,1,-.05],[.1,1.4,.05],[-.1,1.4,-.05],[.1,1,.05]],before=measureModels([m],points);
 assert.equal(before.grossMismatch,true);m.mesh.applyMatrix4(matchMatrix(before));m.mesh.updateMatrixWorld(true);
 const after=measureModels([m],points);assert.ok(after.centerErrorMetres<1e-8);after.modelToSketchSizeRatios.forEach(v=>assert.ok(Math.abs(v-1)<1e-6));assert.equal(after.grossMismatch,false);
});
test('two-hand delta scales and rotates about hand midpoint; one hand uses full pose',()=>{
 const delta=twoHandDelta(new T.Vector3(-1,0,0),new T.Vector3(1,0,0),new T.Vector3(0,-2,3),new T.Vector3(0,2,3));
 near(new T.Vector3(1,0,0).applyMatrix4(delta).toArray(),[0,2,3]);
 const start=new T.Matrix4().makeTranslation(1,2,3),end=new T.Matrix4().makeTranslation(2,4,6);near(new T.Vector3(1,2,3).applyMatrix4(grabDelta(start,end)).toArray(),[2,4,6]);
 assert.equal(twoHandDelta(new T.Vector3(),new T.Vector3(),new T.Vector3(),new T.Vector3(1,0,0)),null);
});

import {primitiveFromPoints} from "../src/fitted-primitive.js";
test('a primitive on a tilted support plane derives dimensions from strokes and rests flush',()=>{
 const n=new T.Vector3(0,1,1).normalize(),x=new T.Vector3(1,0,0),z=new T.Vector3().crossVectors(x,n),origin=new T.Vector3(2,3,4);
 const points=[[-.2,-.1],[.2,-.1],[.2,.1],[-.2,.1]].map(([a,b])=>origin.clone().addScaledVector(x,a).addScaledVector(z,b).toArray());
 const fit=primitiveFromPoints(points,{shape:'box',supportPlane:{origin:origin.toArray(),normal:n.toArray()},dimensionExpressions:{y:'sx / 4'}});
 assert.ok(Math.abs(fit.size[1]-.1)<1e-7);
 assert.ok(Math.abs(new T.Vector3(...fit.center).sub(origin).dot(n)-fit.size[1]/2)<1e-7);
 const up=new T.Vector3(0,1,0).applyEuler(new T.Euler(...fit.rotationDeg.map(T.MathUtils.degToRad)));assert.ok(up.dot(n)>.999999);
 assert.throws(()=>primitiveFromPoints(points,{shape:'box',dimensionExpressions:{x:'-1'}}),/positive/);
});
