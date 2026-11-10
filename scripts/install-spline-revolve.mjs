// Integration for the pinned OpenZCAD browser distribution. The stock revolve
// path builds only primitive faces. Use its existing selected-region builder
// for cubic sections, as the extrusion path already does.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
// The pinned kernel can return a positive but incorrect volume for a revolved
// Bézier face. Use a bounded chord approximation for the solid only. Uniform
// scaling preserves the subdivisions. Source sketches retain their exact cubics.
function buildTurningFace(kernel, curves, toWorld, axis, degrees) {
 const points=[];
 const controls=curves.flatMap(c=>[c.a,...(c.controls||[]),c.b]);
 const span=Math.max(...['x','y'].map(k=>Math.max(...controls.map(p=>p[k]))-Math.min(...controls.map(p=>p[k]))));
 const tolerance=span*0.0004;
 function split(p,depth){
  const first=p[0], last=p.at(-1), dx=last.x-first.x, dy=last.y-first.y, length2=dx*dx+dy*dy;
  const distance=q=>{
   const t=length2?Math.max(0,Math.min(1,((q.x-first.x)*dx+(q.y-first.y)*dy)/length2)):0;
   return Math.hypot(q.x-first.x-t*dx,q.y-first.y-t*dy);
  };
  if(p.slice(1,-1).every(q=>distance(q)<=tolerance)){points.push(first);return;}
  if(depth===14||points.length>512)throw Error('Revolve section exceeds curve resolution');
  const left=[first], right=[last];let row=p;
  while(row.length>1){row=row.slice(1).map((b,i)=>({x:(row[i].x+b.x)/2,y:(row[i].y+b.y)/2}));left.push(row[0]);right.unshift(row.at(-1));}
  split(left,depth+1);split(right,depth+1);
 }
 for(const c of curves)split([c.a,...(c.controls||[]),c.b],0);
 if(points.length<3||points.length>512)throw Error('Revolve needs a bounded closed section');
 const horizontal=axis==='horizontal', radial=p=>horizontal?p.y:p.x, axial=p=>horizontal?p.x:p.y;
 const radii=points.map(radial);
 if(Math.min(...radii)<-span*1e-8 && Math.max(...radii)>span*1e-8)throw Error('The revolve axis crosses the section; choose an axis along or outside the outline');
 let volume=0;const edges=[];
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];
  if(Math.hypot(a.x-b.x,a.y-b.y)<span*1e-10)continue;
  volume+=(axial(b)-axial(a))*(radial(a)**2+radial(a)*radial(b)+radial(b)**2)/3;
  const p=toWorld(a),q=toWorld(b);
  edges.push(kernel.makeLineEdge(p.x,p.y,p.z,q.x,q.y,q.z));
 }
 return {face:kernel.makePlanarFaceFromWire(kernel.makeWire(Uint32Array.from(edges),true)),volume:Math.abs(volume)*Math.PI*degrees/360};
}
export async function installSplineRevolve(root) {
 const asset=path.join(root,'assets/exact-DaAeGT7W.js');
 const code=await readFile(asset,'utf8');
 if(code.includes('draw3dTurningFace'))return;
 const before='let u=XS(e,c.data,l,0,r,t.units),d=n.data.axis';
 const after=`let draw3dTurningFace=c.data.objectKind==="spline"?(${buildTurningFace.toString()})(e,_(eS(t,o,{profile:{all:true,sourceEntityIds:[c.id]}},r)).outer.curves,pt=>Lu(l,pt,0),n.data.axis,qS(n.data.angleDeg,r)):null;
 let u=draw3dTurningFace?draw3dTurningFace.face:XS(e,c.data,l,0,r,t.units),d=n.data.axis`;
 const lineage='lineage:KS(p,c.data)?Ih(';
 const afterRevolve='d.x,d.y,d.z,p);return{solids:[m],lineage:KS';
 if([before,lineage,afterRevolve].some(anchor=>code.split(anchor).length!==2))throw Error('Review spline revolve integration against the updated CAD engine');
 await writeFile(asset,code.replace(before,after).replace(afterRevolve, 'd.x,d.y,d.z,p);if(draw3dTurningFace){const volume=e.volume(m,J);if(!(draw3dTurningFace.volume>0 && Math.abs(volume/draw3dTurningFace.volume-1)<0.035))throw Error("Revolved body volume disagrees with its source section")}return{solids:[m],lineage:KS').replace(lineage,'lineage:draw3dTurningFace?X("sweep","Spline revolve uses geometry-based topology references."):KS(p,c.data)?Ih('));
}
