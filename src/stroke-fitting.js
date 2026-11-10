import {analyzePCA, fitPrimitive} from './primitive-fitting.js';
import {fitCurve} from '../scripts/constrained-curve.mjs';
const sub=(a,b)=>a.map((x,i)=>x-b[i]),add=(a,b)=>a.map((x,i)=>x+b[i]),mul=(a,s)=>a.map(x=>x*s),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),len=a=>Math.hypot(...a),dist=(a,b)=>len(sub(a,b));
const quantile=(a,q)=>{const s=[...a].sort((a,b)=>a-b);return s[Math.floor((s.length-1)*q)];};
export function resampleStroke(input,count=128){
 const p=input.filter((p,i)=>!i||dist(p,input[i-1])>1e-9);if(p.length<2)return p;
 const d=[0];for(let i=1;i<p.length;i++)d.push(d[i-1]+dist(p[i],p[i-1]));
 let j=1;return Array.from({length:count},(_,i)=>{const t=d.at(-1)*i/(count-1);while(j<d.length-1&&d[j]<t)j++;return add(p[j-1],mul(sub(p[j],p[j-1]),(t-d[j-1])/(d[j]-d[j-1])));});
}
function segmentDistance(p,a,b){const d=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),d)/Math.max(1e-20,dot(d,d))));return dist(p,add(a,mul(d,t)));}
function pathError(p,path){return Math.min(...path.slice(1).map((b,i)=>segmentDistance(p,path[i],b)));}
function scorePath(points,path,tolerance){
 const errors=points.map(p=>pathError(p,path));const reverse=resampleStroke(path,96).map(p=>pathError(p,points));
 const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);
 return {rmsMetres:rms(errors),p95Metres:quantile(errors,.95),maxMetres:Math.max(...errors),reverseRmsMetres:rms(reverse),coverage:errors.filter(x=>x<=tolerance).length/errors.length,score:Math.max(rms(errors),rms(reverse))};
}
function rectangle(points,pca){
 const {centroid:o,axes:[u,v]}=pca,xy=points.map(p=>[dot(sub(p,o),u),dot(sub(p,o),v)]);let best;
 // Bounded template alignment in the fitted plane. Evaluate the whole boundary, not just its bounding box.
 for(let k=0;k<180;k++){
  const a=k*Math.PI/360,c=Math.cos(a),s=Math.sin(a),q=xy.map(([x,y])=>[x*c+y*s,-x*s+y*c]);
  const lo=[0,1].map(i=>quantile(q.map(p=>p[i]),.01)),hi=[0,1].map(i=>quantile(q.map(p=>p[i]),.99));
  const corners=[[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]],[lo[0],lo[1]]];
  const cost=q.reduce((sum,p)=>sum+pathError(p,corners)**2,0)/q.length;
  if(!best||cost<best.cost)best={cost,c,s,lo,hi,corners};
 }
 const {c,s,lo,hi}=best;return {path:best.corners.map(([x,y])=>add(o,add(mul(u,x*c-y*s),mul(v,x*s+y*c)))),parameters:{center:add(o,add(mul(u,(lo[0]+hi[0])/2*c-(lo[1]+hi[1])/2*s),mul(v,(lo[0]+hi[0])/2*s+(lo[1]+hi[1])/2*c))),size:[hi[0]-lo[0],hi[1]-lo[1]],normal:pca.axes[2]}};
}
function regularPolygon(points,pca,sides){
 const {centroid:o,axes:[u,v]}=pca,xy=points.map(p=>[dot(sub(p,o),u),dot(sub(p,o),v)]);
 const radius=Math.max(...xy.map(p=>Math.hypot(...p)));let best;
 const make=p=>{const v=Array.from({length:sides},(_,i)=>[p[0]+p[2]*Math.cos(p[3]+2*Math.PI*i/sides),p[1]+p[2]*Math.sin(p[3]+2*Math.PI*i/sides)]);return [...v,v[0]];};
 const cost=p=>{const v=make(p);let total=0;for(const [x,y]of xy){let best=Infinity;for(let i=0;i<sides;i++){const [ax,ay]=v[i],dx=v[i+1][0]-ax,dy=v[i+1][1]-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));best=Math.min(best,(x-ax-t*dx)**2+(y-ay-t*dy)**2);}total+=best;}return total/xy.length;};
 for(let k=0;k<12;k++){let p=[0,0,radius,k*2*Math.PI/sides/12],e=cost(p),delta=[radius*.08,radius*.08,radius*.08,Math.PI/sides/12];
  for(let n=0;n<20;n++){let changed=false;for(let j=0;j<4;j++)for(const sign of [-1,1]){const q=[...p];q[j]+=sign*delta[j];if(q[2]<=0)continue;const f=cost(q);if(f<e){p=q;e=f;changed=true;}}if(!changed)delta=delta.map(d=>d*.5);}
  if(!best||e<best.cost)best={cost:e,p};
 }
 return {path:make(best.p).map(([x,y])=>add(o,add(mul(u,x),mul(v,y)))),parameters:{sides,radiusMetres:best.p[2],center:add(o,add(mul(u,best.p[0]),mul(v,best.p[1]))),normal:pca.axes[2]}};
}
export function fitStroke(input,{toleranceMetres,curveDegree=3}={}){
 const start=performance.now();
 if(!Array.isArray(input)||input.length<2||input.length>20000||input.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw Error('Expected 2–20000 finite XYZ stroke points in metres');
 if(!Number.isInteger(curveDegree)||curveDegree<1||curveDegree>7)throw Error('Curve degree must be 1–7');
 const points=resampleStroke(input,128);if(points.length<2)return {version:1,status:'degenerate',selected:null,candidates:[],message:'Stroke is too small to fit'};const pca=analyzePCA(points),span=Math.hypot(...pca.extents.map(e=>e.size));
 if(span<1e-5)return {version:1,status:'degenerate',selected:null,candidates:[],message:'Stroke is too small to fit'};
 const tolerance=toleranceMetres??Math.max(.0005,Math.min(.012,span*.025));
 if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>.1)throw Error('Fit tolerance must be 0–0.1 metres');
 const closed=dist(points[0],points.at(-1))<span*.12,planar=Math.sqrt(pca.eigenvalues[2])<tolerance*.65,candidates=[];
 const push=(kind,path,parameters,complexity=0)=>{const errors=scorePath(points,path,tolerance);candidates.push({kind,path,parameters,errors,accepted:errors.coverage>=.90&&errors.score<tolerance&&errors.p95Metres<tolerance*1.7,rank:errors.score+complexity*tolerance*.04});};
 try{const f=fitPrimitive(points,{kind:'line',thresholdMetres:tolerance,iterations:64});push('line',f.model.endpoints,f.model);}catch{}
 if((planar||pca.dimensionality==='planar')&&closed&&pca.eigenvalueRatios[1]>.03){
  try{const f=fitPrimitive(points,{kind:'circle',thresholdMetres:tolerance,iterations:96}),m=f.model;push('circle',Array.from({length:97},(_,i)=>add(m.center,add(mul(m.u,m.radiusMetres*Math.cos(i*2*Math.PI/96)),mul(m.v,m.radiusMetres*Math.sin(i*2*Math.PI/96))))),m,1);}catch{}
  const r=rectangle(points,pca);push('rectangle',r.path,r.parameters,2);
  // Only run polygon searches when circle/rectangle are not already convincing.
  if(!candidates.some(c=>c.accepted&&c.errors.score<tolerance*.55))for(const sides of [3,5,6,7,8]){const r=regularPolygon(points,pca,sides);push('polygon',r.path,r.parameters,sides);}
 }
 const accepted=candidates.filter(c=>c.accepted).sort((a,b)=>a.rank-b.rank);let selected=accepted[0];
 const surfaceHypotheses=[];
 if(!planar&&pca.eigenvalueRatios[1]>.04){for(const kind of ['sphere','cylinder'])try{const f=fitPrimitive(points,{kind,thresholdMetres:tolerance,iterations:64});surfaceHypotheses.push({...f,inlierIndices:undefined,note:'Surface hypothesis only. One ordered stroke does not establish a closed solid; preserve the fitted 3D curve until user intent calls for a surface.'});}catch{}}
 if(!selected){
  let fit;
  for(const controlCount of [Math.max(curveDegree+1,6),Math.max(curveDegree+1,10),16,24]){
   const anchor=p=>planar?sub(p,mul(pca.axes[2],dot(sub(p,pca.centroid),pca.axes[2]))):p;
   const constraints={...(closed?{closed:true,closedTangent:true}:{anchors:[{t:0,point:anchor(points[0])},{t:1,point:anchor(points.at(-1))}]}),...(planar?{plane:{origin:pca.centroid,normal:pca.axes[2]}}:{})};
   fit=fitCurve(points,{degree:curveDegree,controlCount,fairnessWeight:.0000001,robustThresholdMetres:tolerance,constraints});
   if(fit.diagnostics.rmsMetres<=tolerance*.8)break;
  }
  const path=fit.samples.map(p=>Array.isArray(p)?p:p.point),errors=scorePath(points,path,tolerance);
  selected={kind:planar?'spline2d':'spline3d',path,parameters:fit.curve,errors,accepted:errors.score<tolerance,diagnostics:fit.diagnostics};
 }
 return {version:1,algorithmRevision:4,status:selected.accepted?'fitted':'approximate',selected,candidates:candidates.sort((a,b)=>a.rank-b.rank).map(({path,...c})=>c),surfaceHypotheses,pca,closed,planar,planeRmsMetres:Math.sqrt(pca.eigenvalues[2]),toleranceMetres:tolerance,units:'metres',coordinateSystem:'world Y-up',rawPointCount:input.length,elapsedMs:performance.now()-start,note:'Deterministic local geometric fit, no design-intent inference and no AI. The selected kind describes numerical fit only; the modeling AI decides intended geometry from the raw drawing and user instructions. Raw stroke retained. Residuals are sampled distances, not a proof of intent; dimensionality/closure and acceptance use explicit heuristics.'};
}
