import {Vector3,Quaternion,Box3} from 'three';

export function sketchAxisCorrection(figures){
 // Line directions repeat every quarter turn. Their fourth-angle mean keeps
 // horizontal and vertical sides of the same outline from cancelling out.
 const plane=figures[0];
 if(!plane||!['plane-front','plane-right','plane-top'].includes(plane.planeId))return [0,0,0];
 const x=new Vector3().fromArray(plane.xAxis),y=new Vector3().fromArray(plane.yAxis),normal=x.clone().cross(y);
 const base=plane.planeId==='plane-right'?new Vector3(0,0,-1):new Vector3(1,0,0),up=normal.clone().cross(base);
 let a=0,b=0,weight=0;
 for(const f of figures.filter(f=>f.planeId===plane.planeId)){
  const edge=f.kind==='line'&&f.end?new Vector3().fromArray(f.end).sub(new Vector3().fromArray(f.origin)):null;
  const directions=edge?[[edge.dot(new Vector3().fromArray(f.xAxis)),edge.dot(new Vector3().fromArray(f.yAxis))]]:f.kind==='rectangle'?[[f.widthMetres,0],[0,f.heightMetres]]:f.kind==='spline'?(f.segments||[]).filter(s=>{
   const dx=s[6]-s[0],dy=s[7]-s[1],len=Math.hypot(dx,dy);return len&&[2,4].every(i=>Math.abs((s[i]-s[0])*dy-(s[i+1]-s[1])*dx)<len*len*.015);
  }).map(s=>[s[6]-s[0],s[7]-s[1]]):[];
  for(const [u,v] of directions){
   const axis=new Vector3().fromArray(f.xAxis).multiplyScalar(u).addScaledVector(new Vector3().fromArray(f.yAxis),v);
   const theta=Math.atan2(axis.dot(up),axis.dot(base)),w=axis.lengthSq();a+=w*Math.cos(4*theta);b+=w*Math.sin(4*theta);weight+=w;
  }
 }
 if(!weight||Math.hypot(a,b)<weight*.55)return [0,0,0];
 return normal.multiplyScalar(-Math.atan2(b,a)*45/Math.PI).toArray();
}

// Place the first independent sketch as a group. The original input stays in
// its capture coordinates for inspection and subsequent model requests.
export function alignInitialDrawing(result,plane,designOrigin){
 if(!result.edits?.length||result.refinement?.question||result.refinement?.state==='failed'||result.solidEdits?.length||
  !['plane-front','plane-top','plane-right'].includes(plane.id)||result.edits.some(f=>f.operation!=='create'||f.planeId!==plane.id||!f.closed))return result;
 const points=result.results.flatMap(r=>r.pathWorld||[]);
 if(!points.length)return result;
 const basis=new Vector3().fromArray(plane.normal);
 const rotation=sketchAxisCorrection(result.edits),degrees=new Vector3().fromArray(rotation).dot(basis);
 const q=new Quaternion().setFromAxisAngle(basis,degrees*Math.PI/180);
 const center=new Box3().setFromPoints(points.map(p=>new Vector3().fromArray(p).applyQuaternion(q))).getCenter(new Vector3());
 const anchor=new Vector3().fromArray(designOrigin);
 anchor.addScaledVector(basis,new Vector3().fromArray(plane.origin).sub(anchor).dot(basis));
 const shift=anchor.sub(center);
 const point=a=>new Vector3().fromArray(a).applyQuaternion(q).add(shift).toArray();
 const direction=a=>new Vector3().fromArray(a).applyQuaternion(q).toArray();
 const copy=structuredClone(result);
 for(const [i,f] of copy.edits.entries()){
  f.origin=point(f.origin);f.xAxis=direction(f.xAxis);f.yAxis=direction(f.yAxis);if(f.end)f.end=point(f.end);
  const r=copy.results[i];r.frame={...r.frame,origin:f.origin,xAxis:f.xAxis,yAxis:f.yAxis};r.pathWorld=r.pathWorld.map(point);
 }
 copy.initialPlacement={planeId:plane.id,rotationDegrees:degrees,translationMetres:shift.toArray()};
 return copy;
}
