import {figureWorld,figureUV} from './sketch-component-edit.js';
const lerp=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t),distance=(a,b)=>Math.hypot(...a.map((v,k)=>v-b[k]));
const cubicPoint=(s,t)=>[0,1].map(k=>(1-t)**3*s[k]+3*(1-t)**2*t*s[k+2]+3*(1-t)*t*t*s[k+4]+t**3*s[k+6]);
function split(s,t){const p=Array.from({length:4},(_,i)=>s.slice(i*2,i*2+2)),a=lerp(p[0],p[1],t),b=lerp(p[1],p[2],t),c=lerp(p[2],p[3],t),d=lerp(a,b,t),e=lerp(b,c,t),m=lerp(d,e,t);return [[...p[0],...a,...d,...m],[...m,...e,...c,...p[3]]];}
export function cubicRange(s,a,b){const prefix=b<1?split(s,b)[0]:s;return a>0?split(prefix,a/b)[1]:prefix.slice();}
const lineCubic=(a,b)=>[...a,...lerp(a,b,1/3),...lerp(a,b,2/3),...b];
function pointSegment(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
export function brushTouches(p,brush,radius){if(brush.length===1)return distance(p,brush[0])<=radius;for(let i=1;i<brush.length;i++)if(pointSegment(p,brush[i-1],brush[i])<=radius)return true;return false;}
function edges(f){
 if(f.kind==='circle'||f.kind==='arc'){const start=f.kind==='circle'?0:f.startAngleDeg,sweep=f.kind==='circle'?360:((f.endAngleDeg-start)%360+360)%360;return [{kind:'arc',start,sweep,point:t=>[f.radiusMetres*Math.cos((start+sweep*t)*Math.PI/180),f.radiusMetres*Math.sin((start+sweep*t)*Math.PI/180)]}];}
 const straight=(a,b)=>({kind:'line',coordinates:lineCubic(a,b),point:t=>lerp(a,b,t)});
 if(f.kind==='line')return [straight([0,0],figureUV(f.end,f))];
 if(f.kind==='rectangle'){const x=f.widthMetres/2,y=f.heightMetres/2,p=[[-x,-y],[x,-y],[x,y],[-x,y]];return p.map((a,i)=>straight(a,p[(i+1)%4]));}
 return f.segments.map(s=>({kind:'spline',coordinates:s,point:t=>cubicPoint(s,t)}));
}
// Cut in screen space, but retain analytic arcs/lines and exact Bezier
// subcurves in their original plane. Pixels are never used as CAD coordinates.
export function trimSketchFigure(f,brush,radius,project){
 if(!brush.length||brush.length>512||!Number.isFinite(radius)||radius<1||radius>100||brush.some(p=>p.length!==2||!p.every(Number.isFinite)))throw Error('Invalid eraser path');
 const output=[];let changed=false;
 for(const edge of edges(f)){
  const pixel=t=>project(figureWorld(edge.point(t),f)),samples=Array.from({length:17},(_,i)=>pixel(i/16));
  if(samples.some(p=>!p||!p.every(Number.isFinite)))return {changed:false,pieces:[structuredClone(f)]};
  const hull=edge.coordinates?Array.from({length:4},(_,i)=>project(figureWorld(edge.coordinates.slice(i*2,i*2+2),f))):[],boundSamples=[...samples,...hull];
  const min=[0,1].map(k=>Math.min(...brush.map(p=>p[k]))-radius),max=[0,1].map(k=>Math.max(...brush.map(p=>p[k]))+radius),outside=[0,1].some(k=>boundSamples.every(p=>p[k]<min[k])||boundSamples.every(p=>p[k]>max[k]));
  const length=samples.slice(1).reduce((s,p,i)=>s+distance(p,samples[i]),0),n=Math.min(2048,Math.max(32,Math.ceil(length/Math.max(1,radius/3)))),hit=t=>brushTouches(pixel(t),brush,radius),ranges=[];
  if(outside)ranges.push([0,1]);else{
   let previous=hit(0),start=previous?null:0;changed||=previous;
   for(let i=1;i<=n;i++){const t=i/n,current=hit(t);changed||=current;if(current!==previous){let a=(i-1)/n,b=t;for(let j=0;j<16;j++){const mid=(a+b)/2;if(hit(mid)===previous)a=mid;else b=mid;}const boundary=(a+b)/2;if(current){if(start!==null)ranges.push([start,boundary]);start=null;}else start=boundary;}previous=current;}
   if(start!==null)ranges.push([start,1]);
  }
  for(const [a,b]of ranges){if((b-a)*length<.05)continue;output.push(edge.kind==='arc'?{kind:'arc',start:edge.start+edge.sweep*a,sweep:edge.sweep*(b-a),a:edge.point(a),b:edge.point(b)}:{kind:edge.kind,coordinates:cubicRange(edge.coordinates,a,b),a:edge.point(a),b:edge.point(b)});}
 }
 if(!changed)return {changed:false,pieces:[structuredClone(f)]};
 const paths=[];for(const e of output){const last=paths.at(-1);if(last&&distance(last.at(-1).b,e.a)<1e-8)last.push(e);else paths.push([e]);}
 const closed=['circle','rectangle'].includes(f.kind)||f.kind==='spline'&&f.closed;
 if(closed&&paths.length>1&&distance(paths.at(-1).at(-1).b,paths[0][0].a)<1e-8){const last=paths.pop();paths[0]=[...last,...paths[0]];}
 if(paths.length>32||paths.some(p=>p.length>64))throw Error('Use a shorter eraser pass');
 const pieces=paths.map(path=>{const p={...structuredClone(f),closed:false,extrusion:undefined,dimensionNote:'Trimmed with CAD eraser; open boundaries remain editable'};
  if(path.every(e=>e.kind==='arc')){p.kind='arc';p.startAngleDeg=path[0].start;p.endAngleDeg=p.startAngleDeg+path.reduce((s,e)=>s+e.sweep,0);delete p.segments;}
  else if(path.length===1&&path[0].kind==='line'){p.kind='line';p.origin=figureWorld(path[0].a,f);p.end=figureWorld(path[0].b,f);delete p.segments;}
  else{p.kind='spline';p.segments=path.map(e=>e.coordinates);delete p.end;}
  return p;
 });return {changed:true,pieces};
}
