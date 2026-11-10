// Small, shared browser/server fitter. Original ink is never replaced or discarded.
import * as T from 'three';
const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function segmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return distance(p,[a[0]+dx*t,a[1]+dy*t]);}
function simplify(p,tolerance){const keep=new Set([0,p.length-1]),stack=[[0,p.length-1]];while(stack.length){const [a,b]=stack.pop();let d=tolerance,k=-1;for(let i=a+1;i<b;i++){const v=segmentDistance(p[i],p[a],p[b]);if(v>d){d=v;k=i;}}if(k>=0){keep.add(k);stack.push([a,k],[k,b]);}}return [...keep].sort((a,b)=>a-b).map(i=>p[i]);}
export function sketchFrame(plane){
 if(!plane||!finite(plane.origin))throw Error('Choose a finite sketch plane origin');
 const x=new T.Vector3(...(plane.xAxis||[1,0,0])),y=new T.Vector3(...(plane.yAxis||[0,1,0]));
 if(!finite(x.toArray())||!finite(y.toArray())||x.length()<1e-9||y.length()<1e-9)throw Error('Invalid sketch plane axes');
 x.normalize();y.addScaledVector(x,-x.dot(y));if(y.length()<1e-8)throw Error('Sketch plane axes are parallel');y.normalize();
 return {id:plane.id||null,origin:[...plane.origin],xAxis:x.toArray(),yAxis:y.toArray(),normal:new T.Vector3().crossVectors(x,y).toArray()};
}
export function fitDesktopSketch(strokes,{plane,view,projection='orthographic',kind='mixed',toleranceMetres,maxSegments=48}={}){
 const started=performance.now(),frame=sketchFrame(plane);
 if(!['orthographic','perspective'].includes(projection)||!['mixed','lines','splines','circle','rectangle'].includes(kind))throw Error('Unknown projection or approximation');
 if(!Number.isInteger(maxSegments)||maxSegments<1||maxSegments>64)throw Error('Use 1–64 segments');
 const origin=new T.Vector3(...frame.origin),x=new T.Vector3(...frame.xAxis),y=new T.Vector3(...frame.yAxis),normal=new T.Vector3(...frame.normal);
 if(projection==='perspective'&&(!view?.cameraToWorld||view.cameraToWorld.length!==16||!view.cameraToWorld.every(Number.isFinite)))throw Error('Perspective projection needs the recorded camera');
 const camera=projection==='perspective'?new T.Vector3().setFromMatrixPosition(new T.Matrix4().fromArray(view.cameraToWorld)):null;
 const orthographicCamera=view?.projectionMatrix?.[15]===1;
 const cameraDirection=orthographicCamera?new T.Vector3(0,0,-1).transformDirection(new T.Matrix4().fromArray(view.cameraToWorld)):null;
 const paths=[];let sourcePointCount=0;
 for(const stroke of strokes){
  if(!Array.isArray(stroke.points)||stroke.points.length<2||stroke.points.length>20000||stroke.points.some(p=>!finite(p)))throw Error('Each stroke needs 2–20000 finite XYZ points');
  sourcePointCount+=stroke.points.length;
  let points=stroke.points.map(p=>{const q=new T.Vector3(...p);if(camera){const ray=cameraDirection||q.clone().sub(camera),base=cameraDirection?q:camera,den=ray.dot(normal),t=origin.clone().sub(base).dot(normal)/den;if(Math.abs(den)<1e-9||!Number.isFinite(t)||!cameraDirection&&t<=0)throw Error('Drawing rays miss this plane; choose another plane');q.copy(base).addScaledVector(ray,t);}else q.addScaledVector(normal,-q.clone().sub(origin).dot(normal));q.sub(origin);return [q.dot(x),q.dot(y)];});
  points=points.filter((p,i)=>!i||distance(p,points[i-1])>1e-9);if(points.length<2)throw Error('Stroke has no length');
  // Bounded work for dense mouse streams; raw samples stay available in session storage.
  if(points.length>512)points=Array.from({length:512},(_,i)=>points[Math.round(i*(points.length-1)/511)]);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),bounds={min:[Math.min(...xs),Math.min(...ys)],max:[Math.max(...xs),Math.max(...ys)]},span=distance(bounds.min,bounds.max);
  const tolerance=toleranceMetres??Math.max(.00015,span*.008);if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>.1)throw Error('Invalid sketch tolerance');
  const closed=points.length>5&&distance(points[0],points.at(-1))<Math.max(tolerance*2,span*.05);
  if(closed)points[points.length-1]=[...points[0]];
  if(kind==='circle'||kind==='rectangle'){
   let center=bounds.min.map((v,i)=>(v+bounds.max[i])/2),radiusMetres,preview;
   if(kind==='circle'){
    const mean=[0,1].map(k=>points.reduce((n,p)=>n+p[k],0)/points.length),q=points.map(p=>[p[0]-mean[0],p[1]-mean[1]]),sum=fn=>q.reduce((n,p)=>n+fn(...p),0);
    const normal=new T.Matrix3().set(sum(x=>4*x*x),sum((x,y)=>4*x*y),sum(x=>2*x),sum((x,y)=>4*x*y),sum((x,y)=>4*y*y),sum((x,y)=>2*y),sum(x=>2*x),sum((x,y)=>2*y),q.length);
    if(Math.abs(normal.determinant())<1e-20)throw Error('A circle needs non-collinear drawing points');
    const fit=new T.Vector3(sum((x,y)=>2*x*(x*x+y*y)),sum((x,y)=>2*y*(x*x+y*y)),sum((x,y)=>x*x+y*y)).applyMatrix3(normal.invert());center=[mean[0]+fit.x,mean[1]+fit.y];radiusMetres=Math.sqrt(fit.z+fit.x*fit.x+fit.y*fit.y);if(!Number.isFinite(radiusMetres)||radiusMetres<=1e-8)throw Error('Degenerate circle');
    preview=Array.from({length:97},(_,i)=>[center[0]+radiusMetres*Math.cos(i*Math.PI/48),center[1]+radiusMetres*Math.sin(i*Math.PI/48)]);
   }else{if(bounds.max.some((v,k)=>v-bounds.min[k]<1e-8))throw Error('A rectangle needs width and height');preview=[[...bounds.min],[bounds.max[0],bounds.min[1]],[...bounds.max],[bounds.min[0],bounds.max[1]],[...bounds.min]];}
   const errors=points.map(p=>kind==='circle'?Math.abs(distance(p,center)-radiusMetres):Math.min(...preview.slice(1).map((b,i)=>segmentDistance(p,preview[i],b))));
   paths.push({strokeId:stroke.id,closed:true,bounds,segments:[],primitive:{kind,center,...(kind==='circle'?{radiusMetres}:{widthMetres:bounds.max[0]-bounds.min[0],heightMetres:bounds.max[1]-bounds.min[1]})},preview,rmsMetres:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),maxErrorMetres:Math.max(...errors),toleranceMetres:tolerance});continue;
  }
  let knots=simplify(points,tolerance);let fitTolerance=tolerance;
  while(knots.length-1>maxSegments){fitTolerance*=1.35;knots=simplify(points,fitTolerance);}
  const segments=[];
  for(let i=0;i<knots.length-1;i++){
   const a=knots[i],b=knots[i+1],previous=knots[Math.max(0,i-1)],next=knots[Math.min(knots.length-1,i+2)];
   // Curved runs have steadily changing tangent directions; sharp corners stay straight.
   const angle=(u,v)=>Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)||1))));
   const tangent=[b[0]-a[0],b[1]-a[1]],before=[a[0]-previous[0],a[1]-previous[1]],after=[next[0]-b[0],next[1]-b[1]];
   const neighbors=[Math.hypot(...before),Math.hypot(...after)].filter(v=>v>1e-9),curveScale=Math.min(...neighbors);
   const smooth=kind==='splines'||kind==='mixed'&&knots.length>4&&Math.hypot(...tangent)<=curveScale*2.5&&((i>0&&angle(before,tangent)<.65)||(i+2<knots.length&&angle(tangent,after)<.65));
   if(smooth){const c1=i===0?a:[a[0]+(b[0]-previous[0])/6,a[1]+(b[1]-previous[1])/6],c2=i+2===knots.length?b:[b[0]-(next[0]-a[0])/6,b[1]-(next[1]-a[1])/6];segments.push({kind:'spline',coordinates:[...a,...c1,...c2,...b]});}
   else segments.push({kind:'line',coordinates:[...a,...b]});
  }
  const preview=[];for(const s of segments){const c=s.coordinates;if(s.kind==='line'){preview.push(c.slice(0,2),c.slice(2));continue;}for(let j=0;j<=8;j++){const t=j/8,u=1-t;preview.push([0,1].map(k=>u*u*u*c[k]+3*u*u*t*c[2+k]+3*u*t*t*c[4+k]+t*t*t*c[6+k]));}}
  const errors=points.map(p=>Math.min(...preview.slice(1).map((q,i)=>segmentDistance(p,preview[i],q))));
  paths.push({strokeId:stroke.id,closed,bounds,segments,preview,rmsMetres:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),maxErrorMetres:Math.max(...errors),toleranceMetres:tolerance});
 }
 return {frame,projection,kind,paths,sourcePointCount,segmentCount:paths.reduce((n,p)=>n+p.segments.length,0),elapsedMs:performance.now()-started};
}
export function compactSketchFit(fit,{geometry=true}={}){return {frame:fit.frame,projection:fit.projection,kind:fit.kind,sourcePointCount:fit.sourcePointCount,segmentCount:fit.segmentCount,elapsedMs:Math.round(fit.elapsedMs),paths:fit.paths.map(({preview,segments,primitive,...p})=>({...p,...(geometry?{segments,primitive}:{segmentKinds:segments.map(s=>s.kind),primitiveKind:primitive?.kind})}))};}
