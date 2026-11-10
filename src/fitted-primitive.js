import * as T from "three";
import {analyzePCA} from "./primitive-fitting.js";
import {evaluateExpression} from "./math-expression.js";
import {planeFrame} from "./sketch-projection.js";
export function primitiveFromPoints(points,a={}){
 const pca=analyzePCA(points),center=new T.Vector3(...pca.centroid);
 let x=new T.Vector3(1,0,0),y=new T.Vector3(0,1,0),z=new T.Vector3(0,0,1);
 const support=a.supportPlane,orientation=a.orientation||"world";
 if(support||orientation==="plane"){
  const frame=planeFrame(support||{origin:pca.centroid,normal:pca.axes[2],up:pca.axes[1]});
  x.fromArray(frame.xAxis);y.fromArray(frame.normal);z.crossVectors(x,y).normalize();
 }else if(orientation==="pca"){
  y.fromArray(pca.axes[0]);x.fromArray(pca.axes[1]);z.crossVectors(x,y).normalize();
 }else if(orientation!=="world")throw Error("Unknown primitive orientation");
 const axes=[x,y,z],local=points.map(p=>axes.map(axis=>new T.Vector3(...p).sub(center).dot(axis))),min=local.reduce((v,p)=>v.map((n,i)=>Math.min(n,p[i])),[Infinity,Infinity,Infinity]),max=local.reduce((v,p)=>v.map((n,i)=>Math.max(n,p[i])),[-Infinity,-Infinity,-Infinity]);
 let size=min.map((v,i)=>max[i]-v);const extent=Math.max(...size);if(extent<1e-6)throw Error("Stroke has no measurable extent");
 const measured=[...size],bindings={sx:size[0],sy:size[1],sz:size[2],p0:pca.extents[0].size,p1:pca.extents[1].size,p2:pca.extents[2].size};
 const inferred=[];size=size.map((v,i)=>{if(a.dimensionExpressions?.["xyz"[i]])return evaluateExpression(a.dimensionExpressions["xyz"[i]],bindings);if(v<extent*.02){inferred.push("xyz"[i]);return a.thicknessMetres??extent*.1;}return v;});
 if(size.some(v=>!Number.isFinite(v)||v<=0||v>100))throw Error("Primitive dimensions must be finite positive metres up to 100m");
 if(a.shape==="sphere")size=Array(3).fill(Math.max(...size));
 if(a.shape==="cylinder"){size[0]=size[2]=Math.max(size[0],size[2]);}
 const c=center.clone();axes.forEach((axis,i)=>c.addScaledVector(axis,(min[i]+max[i])/2));
 if(support){const normal=y,origin=new T.Vector3(...support.origin);c.addScaledVector(normal,-c.clone().sub(origin).dot(normal)+size[1]/2);}
 return {center:c.toArray(),size,rotationDeg:new T.Euler().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z)).toArray().slice(0,3).map(T.MathUtils.radToDeg),pca,measuredExtents:measured,inferredThicknessAxes:inferred,orientation,supportPlane:support||null,units:"metres",note:"Dimensions derive from selected strokes in the chosen frame. Missing thin-axis thickness defaults to 10% of span unless explicitly supplied. PCA plane/axes are geometric candidates, not semantic certainty."};
}
