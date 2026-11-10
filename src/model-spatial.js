import * as T from "three";
import {analyzePCA} from "./primitive-fitting.js";
const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const bbox=b=>({min:b.min.toArray(),max:b.max.toArray(),center:b.getCenter(new T.Vector3()).toArray(),size:b.getSize(new T.Vector3()).toArray()});
export function modelFrame(m){
 m.mesh.updateWorldMatrix(true,false);m.mesh.geometry.computeBoundingBox();
 const center=m.mesh.geometry.boundingBox.getCenter(new T.Vector3()),matrix=m.mesh.matrixWorld.clone();
 if(Math.abs(matrix.determinant())<1e-15)throw Error("Object frame is singular");
 return {kind:'object',frameId:'native:'+m.id,modelId:m.id,version:m.version,geometryVersion:m.geometryVersion||1,origin:'stable native geometry zero',units:'metres before instance scale',up:'Y',matrixLayout:'column-major',localToWorld:matrix.toArray(),worldToLocal:matrix.clone().invert().toArray(),nativeToWorld:matrix.toArray(),worldToNative:matrix.clone().invert().toArray(),nativeGeometryToWorld:matrix.toArray(),localBounds:bbox(m.mesh.geometry.boundingBox),localCenter:center.toArray(),worldBounds:bbox(new T.Box3().setFromObject(m.mesh,true)),note:'Canonical design coordinates used by native feature parameters and attached sketch points. Moving or rotating changes only nativeToWorld placement; never rotate or recenter the native feature parameters. Bounds centre is a measurement, not a second modeling origin.'};
}
export function convertFrame(frame,points,from="object",to="world",kind="point"){
 if(!["world","object"].includes(from)||!["world","object"].includes(to)||!["point","vector","normal"].includes(kind)||!Array.isArray(points)||points.some(p=>!finite(p)))throw Error("Invalid frame conversion");
 const matrix=new T.Matrix4().fromArray(from===to?new T.Matrix4().toArray():from==="object"?frame.localToWorld:frame.worldToLocal);
 return points.map(p=>{const v=new T.Vector3(...p);if(kind==="point")return v.applyMatrix4(matrix).toArray();if(kind==="normal")return v.applyMatrix3(new T.Matrix3().getNormalMatrix(matrix)).normalize().toArray();return v.applyMatrix3(new T.Matrix3().setFromMatrix4(matrix)).toArray();});
}
export function measureModels(models,points){
 if(!models.length||!points.length)throw Error("Select models and source strokes");
 const sketch=new T.Box3().setFromPoints(points.map(p=>new T.Vector3(...p))),box=new T.Box3(),sampled=[];
 for(const m of models){m.mesh.updateWorldMatrix(true,false);box.union(new T.Box3().setFromObject(m.mesh,true));const attr=m.mesh.geometry.attributes.position,step=Math.max(1,Math.ceil(attr.count/1500));for(let i=0;i<attr.count;i+=step)sampled.push(new T.Vector3().fromBufferAttribute(attr,i).applyMatrix4(m.mesh.matrixWorld).toArray());}
 const a=bbox(sketch),b=bbox(box),extent=Math.max(...a.size),axes=a.size.map((v,i)=>v>Math.max(.002,extent*.08)&&b.size[i]>1e-8?i:-1).filter(i=>i>=0);
 const ratios=a.size.map((v,i)=>v>1e-8?b.size[i]/v:null),scales=axes.map(i=>a.size[i]/b.size[i]).sort((x,y)=>x-y),scale=scales.length?scales[Math.floor(scales.length/2)]:1;
 const centerErrorMetres=new T.Vector3(...a.center).distanceTo(new T.Vector3(...b.center));
 return {sketchBounds:a,modelBounds:b,modelToSketchSizeRatios:ratios,constrainedAxes:axes.map(i=>"XYZ"[i]),recommendedUniformScale:scale,centerErrorMetres,grossMismatch:axes.some(i=>ratios[i]>2.5||ratios[i]<.25)||centerErrorMetres>Math.max(.03,extent*.75),sketchPCA:analyzePCA(points.filter((_,i)=>i%Math.max(1,Math.ceil(points.length/1500))===0)),modelPCA:analyzePCA(sampled),note:"Thin sketch axes do not constrain intended thickness. PCA sign/direction can be ambiguous and is not semantic orientation. Inspect front/side overlays. Uniform scale preserves proportions; use native edits to fix incorrect proportions."};
}
export function matchMatrix(report,rotationDeg=[0,0,0]){
 if(!finite(rotationDeg))throw Error("Rotation delta must be finite XYZ degrees");
 const q=new T.Quaternion().setFromEuler(new T.Euler(...rotationDeg.map(T.MathUtils.degToRad))),s=report.recommendedUniformScale;
 if(!Number.isFinite(s)||s<=0)throw Error("Invalid fit scale");
 return new T.Matrix4().compose(new T.Vector3(...report.sketchBounds.center),q,new T.Vector3(s,s,s)).multiply(new T.Matrix4().makeTranslation(...report.modelBounds.center.map(v=>-v)));
}

export function placementMatrix(placement={}){return new T.Matrix4().compose(new T.Vector3(...(placement.position||[0,0,0])),new T.Quaternion().setFromEuler(new T.Euler(...(placement.rotationDeg||[0,0,0]).map(T.MathUtils.degToRad))),new T.Vector3(...(placement.scale||[1,1,1])));}
export function transformSpatialParameters(parameters,matrix){
 const p=structuredClone(parameters),v=a=>new T.Vector3(...a),linear=new T.Matrix3().setFromMatrix4(matrix),axes=p.axes||[[1,0,0],[0,1,0],[0,0,1]],vectors=axes.map(a=>v(a).applyMatrix3(linear)),factors=vectors.map(v=>v.length());
 if(p.center)p.center=v(p.center).applyMatrix4(matrix).toArray();if(p.axes)p.axes=vectors.map(v=>v.normalize().toArray());
 if(p.points)p.points=p.points.map(a=>v(a).applyMatrix4(matrix).toArray());if(p.profilePoints)p.profilePoints=p.profilePoints.map(([x,y])=>[x*factors[0],y*factors[1]]);if(p.controlNet)p.controlNet=p.controlNet.map(row=>row.map(a=>v(a).applyMatrix4(matrix).toArray()));
 for(const k of ['sizeMetres','radiiMetres'])if(p[k])p[k]=p[k].map((n,i)=>n*factors[i]);
 for(const [k,i]of [['radiusMetres',0],['heightMetres',1],['depthMetres',2]])if(p[k]!=null)p[k]*=factors[i];return p;
}
