import polygonClipping from 'polygon-clipping';
import {hollowRevolveSection,trimSmallLoops} from './hollow-revolve.js';
 // Re-express the open curve in a frame whose horizontal axis joins its endpoints.
 // The derived CAD section closes on that axis; the editable source stays open.
 function endpointSection(source) {
  const start = source.segments[0].slice(0,2), end = source.segments.at(-1).slice(6);
  const dx=end[0]-start[0], dy=end[1]-start[1], length=Math.hypot(dx,dy);
  if (length<1e-6) throw Error('The two endpoints are too close to define a revolve axis');
  const u=dx/length, v=dy/length;
  const segments=source.segments.map(segment=>{
   const transformed=[];
   for (let i=0;i<8;i+=2) {
    const x=segment[i]-start[0], y=segment[i+1]-start[1];
    transformed.push(u*x+v*y,-v*x+u*y);
   }
   return transformed;
  });
  segments[0][0]=segments[0][1]=segments.at(-1)[7]=0;
  segments.at(-1)[6]=length;
  segments.push([length,0,2*length/3,0,length/3,0,0,0]);
  return {kind:'spline',closed:true,name:'Revolve section',segments,
   origin:source.origin.map((n,i)=>n+source.xAxis[i]*start[0]+source.yAxis[i]*start[1]),
   xAxis:source.xAxis.map((n,i)=>u*n+v*source.yAxis[i]),
   yAxis:source.xAxis.map((n,i)=>-v*n+u*source.yAxis[i])};
 }
function sample(segments){
 const points=[];
 for(const s of segments)for(let i=0;i<16;i++){
  const t=i/16,u=1-t;
  points.push([0,1].map(k=>u**3*s[k]+3*u*u*t*s[k+2]+3*u*t*t*s[k+4]+t**3*s[k+6]));
 }
 return [...points,segments.at(-1).slice(6)];
}
function line(a,b){
 return [...a,...a.map((v,k)=>(2*v+b[k])/3),...b.map((v,k)=>(v*2+a[k])/3),...b];
}
function extent(points){
 return Math.max(...[0,1].map(k=>{const v=points.map(p=>p[k]);return Math.max(...v)-Math.min(...v);}));
}
function distanceToSegment(p,a,b){
 const dx=b[0]-a[0],dy=b[1]-a[1];
 const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
 return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);
}
function simplify(points,tol){
 const a=points[0],b=points.at(-1);let far=tol,index=-1;
 for(let i=1;i<points.length-1;i++){const d=distanceToSegment(points[i],a,b);if(d>far){far=d;index=i;}}
 return index<0?[a,b]:[...simplify(points.slice(0,index+1),tol).slice(0,-1),...simplify(points.slice(index),tol)];
}
function meridianSegments(path,span){
 trimSmallLoops(path,span*.022);
 const points=simplify(path,span*.0004);
 return points.map((p,i)=>line(p,points[(i+1)%points.length])).filter(s=>Math.hypot(s[0]-s[6],s[1]-s[7])>span*1e-9);
}
// At a full turn, both sides occupy the same angular range. Their union in
// (axial distance, radius) is the swept section, including any radial recess.
function foldedSection(points,span){
 // Use a scale-relative integer grid so coincident edges at the axis agree
 // after reflection, even when the original sketch frame is rotated.
 const scale=1e6/span;
 const ring=points.map(([z,r])=>[Math.round(z*scale),Math.round(r*scale)]);
 const reflected=ring.map(([z,r])=>[z,-r]);
 const xs=ring.map(p=>p[0]),lo=Math.min(...xs)-1,hi=Math.max(...xs)+1;
 const top=Math.max(...ring.map(p=>Math.abs(p[1])))+1;
 const half=[[[lo,0],[hi,0],[hi,top],[lo,top]]];
 const folded=polygonClipping.intersection(polygonClipping.union([ring],[reflected]),half);
 if(folded.length!==1||folded[0].length!==1)
  throw Error('This revolve needs multiple section loops; use separate profiles or choose another axis');
 return folded[0][0].slice(0,-1).map(([z,r])=>[z/scale,r/scale]);
}
// A mirrored driving sketch already contains an exact meridian. Verify all four
// Bezier controls against the opposite half, including the orientation of the seam.
function mirroredMeridian(segments, vertical, pivot, epsilon){
 const n=segments.length;
 if(n%2)return null;
 const aligned=segments.map(segment=>{
  const out=[];
  for(let k=0;k<8;k+=2){
   const u=segment[k]-pivot[0],v=segment[k+1]-pivot[1];
   out.push(...(vertical?[v,u]:[u,v]));
  }
  return out;
 });
 for(let i=0;i<n;i++){
  if(Math.abs(aligned[i][1])>epsilon||Math.abs(aligned[(i+n/2)%n][1])>epsilon)continue;
  const half=[];
  for(let k=0;k<n/2;k++){
   const a=aligned[(i+k)%n],b=aligned[(i+n-1-k)%n];
   if([0,2,4,6].some(j=>a[j+1]<-epsilon||Math.abs(a[j]-b[6-j])>epsilon||Math.abs(a[j+1]+b[7-j])>epsilon))break;
   half.push(a);
  }
  if(half.length===n/2)return [...half,line(half.at(-1).slice(6),half[0].slice(0,2))];
 }
 return null;
}
export function revolveSection(source,rev){
 if(rev.wallThicknessMetres)return hollowRevolveSection(source,rev);
 if(rev.axis==='endpoints'){
  const section=endpointSection(source),points=sample(section.segments.slice(0,-1)),span=extent(points);
  const prior=points.length;trimSmallLoops(points,span*.022);
  if(points.length!==prior)section.segments=meridianSegments(points,span);
  return section;
 }
 if(source.kind!=='spline'||!source.closed)return null;
 const vertical=rev.axis==='vertical',pivot=rev.axisOriginUV||[0,0];
 const p=sample(source.segments).slice(0,-1).map(([u,v])=>vertical?[v-pivot[1],u-pivot[0]]:[u-pivot[0],v-pivot[1]]);
 const span=extent(p),eps=span*1e-8;
 if(!p.some(a=>a[1]>eps)||!p.some(a=>a[1]<-eps))return null;
 if(rev.angleDegrees!==360)throw Error('A partial revolve needs a section on one side of its axis');
 const segments=mirroredMeridian(source.segments,vertical,pivot,eps)||meridianSegments(foldedSection(p,span),span);
 return {kind:'spline',closed:true,name:'Revolve meridian',segments,
  origin:source.origin.map((v,i)=>v+source.xAxis[i]*pivot[0]+source.yAxis[i]*pivot[1]),
  xAxis:vertical?source.yAxis:source.xAxis,yAxis:vertical?source.xAxis:source.yAxis};
}
