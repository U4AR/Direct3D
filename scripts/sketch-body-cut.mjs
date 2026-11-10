import {randomUUID} from 'node:crypto';
import {sketchFrame} from '../src/desktop-sketch-fit.js';
import {resample} from '../src/decision-sketch/math.js';

const dot=(a,b)=>a.reduce((sum,v,k)=>sum+v*b[k],0);
const add=(a,b,k)=>a.map((v,i)=>v+b[i]*k);
const extent=values=>[Math.min(...values),Math.max(...values)];
export function sketchBodyCut(spec,data,fit){
 const body=data.partContext?.bodies.find(b=>b.bodyId===spec.bodyId);
 const strokes=spec.strokeIds?.map(id=>data.strokes.find(s=>s.id===id));
 if(!body?.boundsWorld||!strokes?.length||strokes.some(s=>!s?.points?.length)||!spec.name?.trim())throw Error('Choose a visible target body and current guide strokes');
 const f=sketchFrame(strokes[0].plane||data.plane),eye=(strokes[0].view||data.view)?.cameraToWorld?.slice(8,11);
 if(!eye||Math.abs(dot(f.normal,eye))<.15)throw Error('The guide plane is edge-on to the drawing view');
 const {min,max}=body.boundsWorld,corners=[min[0],max[0]].flatMap(x=>[min[1],max[1]].flatMap(y=>[min[2],max[2]].map(z=>[x,y,z])));
 const toward=dot(eye,f.normal)>0?1:-1,n=f.normal.map(v=>v*toward),[far,near]=extent(corners.map(p=>dot(p,n)));
 const margin=Math.max(.0001,(near-far)*.01);
 const inside=spec.depthMetres==null?(near+far)/2:near-spec.depthMetres;
 if(!Number.isFinite(inside)||inside>=near||inside<far-1e-7)throw Error('Choose a positive depth within the target body');
 const points=strokes.flatMap(s=>s.points),[u,v]=[f.xAxis,f.yAxis].map(axis=>extent(points.map(p=>dot(p,axis))));
 if(u[1]-u[0]<.0001||v[1]-v[0]<.0001)throw Error('The cut guide needs two measurable dimensions');
 const cx=(u[0]+u[1])/2,cy=(v[0]+v[1])/2,rx=(u[1]-u[0])/2,ry=(v[1]-v[0])/2;
 const origin=add(add(n.map(x=>x*inside),f.xAxis,cx),f.yAxis,cy),plane={...f,id:'cut-'+randomUUID(),name:spec.name+' plane',origin};
 const K=.5522847498307936;
 let segs;
 if(spec.profile==='guide-outline'){
  if(strokes.length!==1)throw Error('Use one boundary for guide-outline, or a rounded envelope for several guides');
  const uv=points.map(p=>[dot(p,f.xAxis)-cx,dot(p,f.yAxis)-cy]);
  const p=resample(uv,13);
  if(Math.hypot(p[0][0]-p.at(-1)[0],p[0][1]-p.at(-1)[1])<.025*Math.max(rx,ry))p.pop();
  segs=p.map((a,i)=>{const b=p[(i+1)%p.length],prev=p[(i+p.length-1)%p.length],next=p[(i+2)%p.length];
   return [...a,...a.map((x,k)=>x+(b[k]-prev[k])/6),...b.map((x,k)=>x-(next[k]-a[k])/6),...b];});
 }else if(spec.profile==='rounded-opening'){
  segs=[[1,0,1,K,K,1,0,1],[0,1,-K,1,-1,K,-1,0],[-1,0,-1,-K,-K,-1,0,-1],[0,-1,K,-1,1,-K,1,0]].map(s=>s.map((x,k)=>x*(k%2?ry:rx)));
 }else throw Error('Unknown opening profile');
 const edit={...fit.edits[0],operation:'create',figureId:null,expectedVersion:null,kind:'spline',closed:true,construction:false,planeId:plane.id,
 name:spec.name+' profile',origin,xAxis:f.xAxis,yAxis:f.yAxis,segments:segs,end:null,widthMetres:null,heightMetres:null,radiusMetres:null,startAngleDeg:null,endAngleDeg:null,extrusionMetres:null,strokeIds:strokes.map(s=>s.id)};
 const depth=near-inside+margin;
 return {plane,edit,solid:{kind:'pocket',name:spec.name,targetBodyId:body.bodyId,loftMode:'ruled',profiles:[{figureId:'fit:added-0',expectedVersion:1,depthMetres:toward>0?depth:0,backDepthMetres:toward<0?depth:null}]}};
}
