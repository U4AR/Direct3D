import {bounds,simplify} from './decision-sketch/math.js';

const cross = (a,b) => a[0]*b[1]-a[1]*b[0];
const delta = (a,b) => [a[0]-b[0],a[1]-b[1]];
function crossing(points,closed) {
 const count=points.length,edges=closed?count:count-1;
 for(let i=0;i<edges;i++)for(let j=i+2;j<edges;j++){
  if(closed&&i===0&&j===edges-1)continue;
  const a=points[i],b=points[j],u=delta(points[(i+1)%count],a),v=delta(points[(j+1)%count],b);
  const determinant=cross(u,v);
  if(Math.abs(determinant)<1e-15)continue;
  const displacement=delta(b,a),t=cross(displacement,v)/determinant,k=cross(displacement,u)/determinant;
  if(t>=0&&t<=1&&k>=0&&k<=1)return {i,j,point:[a[0]+t*u[0],a[1]+t*u[1]]};
 }
 return null;
}
export function trimSmallLoops(path,tolerance) {
 let hit;
 while((hit=crossing(path,false))){
  const loop=path.slice(hit.i+1,hit.j+1);
  if(loop.some(p=>Math.hypot(...delta(p,hit.point))>tolerance))throw Error('The meridian doubles back across itself. Simplify the crossing before revolving.');
  path.splice(hit.i+1,loop.length,hit.point);
 }
}

// Derive a thin, closed meridian from the user's open outer contour.
// The source stays editable. The native revolve uses this dependent section.
export function hollowRevolveSection(source,revolution){
 const {axis,axisOriginUV,wallThicknessMetres:thickness}=revolution;
 if(!['horizontal','vertical'].includes(axis)||source.kind!=='spline'||source.closed)throw Error('A hollow revolve needs an open outer meridian and a horizontal or vertical axis');
 const pivot=axisOriginUV||[0,0],axial=axis==='horizontal'?0:1,radial=1-axial;
 const points=[];
 for(const segment of source.segments)for(let i=0;i<24;i++){
  const t=i/24,u=1-t;
  const p=[0,1].map(k=>u**3*segment[k]+3*u*u*t*segment[k+2]+3*u*t*t*segment[k+4]+t**3*segment[k+6]);
  points.push([p[axial]-pivot[axial],p[radial]-pivot[radial]]);
 }
 const end=source.segments.at(-1).slice(6);
 points.push([end[axial]-pivot[axial],end[radial]-pivot[radial]]);
 const extent=bounds(points).span;
 const side=Math.abs(points[0][1])>Math.abs(points.at(-1)[1])?Math.sign(points[0][1]):Math.sign(points.at(-1)[1]);
 for(const p of points)p[1]*=side;
 if(points.some(p=>p[1]<-extent*1e-5))throw Error('The outer contour crosses the revolve axis');
 if(points[0][1]<points.at(-1)[1])points.reverse();
 if(Math.abs(points.at(-1)[1])>Math.max(extent*.005,1e-5))throw Error('The closed end of the cap must meet the revolve axis');
 points.at(-1)[1]=0;
 // Resample at a bounded spacing; this representation is only the derived wall.
 const lengths=[0];
 for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+Math.hypot(...points[i].map((v,k)=>v-points[i-1][k])));
 let edge=1;
 const count=Math.max(24,Math.min(60,points.length-1)),outer=[];
 for(let i=0;i<=count;i++){
  const distance=lengths.at(-1)*i/count;
  while(edge<points.length-1&&lengths[edge]<distance)edge++;
  const t=(distance-lengths[edge-1])/(lengths[edge]-lengths[edge-1]||1);
  outer.push(points[edge-1].map((v,k)=>v+t*(points[edge][k]-v)));
 }
 trimSmallLoops(outer,Math.min(extent*.025,2*thickness));
 // At a pen reversal the normal offset is undefined. Remove a small
 // retraced tip only when its displacement fits within one wall thickness.
 for(let i=1;i<outer.length-1;i++){
  const prev=outer[i-1],p=outer[i],next=outer[i+1],u=delta(p,prev),v=delta(next,p);
  const cosine=(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v));
  if(cosine>-.9)continue;
  const chord=delta(next,prev),t=Math.max(0,Math.min(1,(u[0]*chord[0]+u[1]*chord[1])/(chord[0]**2+chord[1]**2||1)));
  if(Math.hypot(u[0]-t*chord[0],u[1]-t*chord[1])<=Math.min(thickness,extent*.02)){
   outer.splice(i,1);i=Math.max(0,i-2);
  }
 }
 const direction=Math.sign(outer.at(-1)[0]-outer[0][0]);
 if(!direction||!(thickness>0&&thickness<Math.max(...outer.map(p=>p[1]))))throw Error('Wall thickness does not fit the revolved contour');
 const normals=outer.slice(1).map((p,i)=>{
  const dz=p[0]-outer[i][0],dr=p[1]-outer[i][1],len=Math.hypot(dz,dr);
  if(len<1e-10)throw Error('Repeated points in the revolve meridian');
  return [direction*dr/len,-direction*dz/len];
 });
 const inner=outer.map((p,i)=>{
  const a=normals[Math.max(0,i-1)],b=normals[Math.min(normals.length-1,i)];
  const divisor=1+a[0]*b[0]+a[1]*b[1];
  if(divisor<.1)throw Error('Wall offset folds at a sharp corner');
  return p.map((v,k)=>v+thickness*(a[k]+b[k])/divisor);
 });
 // Meet the axis at the inner crown; leave the opposite end open to the cavity.
 let stop=inner.findIndex((p,i)=>i>0&&p[1]<=0);
 if(stop<0){inner.at(-1)[1]=0;stop=inner.length-1;}
 else{
  const a=inner[stop-1],b=inner[stop],t=a[1]/(a[1]-b[1]);
  inner[stop]=[a[0]+t*(b[0]-a[0]),0];
 }
 inner.splice(stop+1);
 if(inner.length<3||inner[0][1]<=0)throw Error('Wall thickness closes the cap opening');
 trimSmallLoops(inner,Math.min(extent*.025,2*thickness));
 let wall=[...outer,...inner.reverse()];
 // Long straight runs otherwise generate dozens of coincident cone faces.
 // Preserve rim and crown on both rails and bound the geometric deviation.
 const tolerance=Math.min(extent*.0002,thickness*.01);
 const compact=[...simplify(outer,tolerance),...simplify(inner,tolerance)];
 if(compact.length>=3&&!crossing(compact,true))wall=compact;
 if(crossing(wall,true))throw Error('The inner and outer walls intersect. Smooth the local fold or revise the wall profile before revolving.');
 const segments=wall.map((a,i)=>{
  const b=wall[(i+1)%wall.length];
  return [...a,...a.map((v,k)=>v+(b[k]-v)/3),...a.map((v,k)=>v+2*(b[k]-v)/3),...b];
 }).filter(s=>Math.hypot(s[6]-s[0],s[7]-s[1])>1e-9);
 const axisVector=axis==='horizontal'?source.xAxis:source.yAxis;
 const radialVector=(axis==='horizontal'?source.yAxis:source.xAxis).map(v=>v*side);
 let volume=0;
 for(const s of segments)volume+=(s[6]-s[0])*(s[1]**2+s[1]*s[7]+s[7]**2)/3;
 return {kind:'spline',closed:true,name:'Hollow revolve wall',segments,
  origin:source.origin.map((v,k)=>v+pivot[0]*source.xAxis[k]+pivot[1]*source.yAxis[k]),
  xAxis:axisVector,yAxis:radialVector,expectedVolumeMetres3:Math.abs(volume)*Math.PI*(revolution.angleDegrees/360)};
}
