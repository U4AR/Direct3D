import {bounds,solve,resample} from './decision-sketch/math.js';
import {symmetricOutlineKnots} from './decision-sketch/constraints.js';
import {sampleDraftSegment} from './desktop-measured-draft.js';
const length=v=>Math.hypot(...v),sub=(a,b)=>a.map((v,k)=>v-b[k]),add=(a,b)=>a.map((v,k)=>v+b[k]);
export function smoothCubicJoins(segments,closed){
 const out=structuredClone(segments),n=out.length;
 for(let i=closed?0:1;i<n;i++){const previous=out[(i+n-1)%n],next=out[i],p=next.slice(0,2);if(length(sub(previous.slice(6),p))>1e-6)throw Error('Smoothing requires connected profile endpoints');const incoming=sub(p,previous.slice(4,6)),outgoing=sub(next.slice(2,4),p),a=length(incoming),b=length(outgoing),fallback=sub(next.slice(6),previous.slice(0,2)),t=a>1e-9&&b>1e-9?add(incoming.map(v=>v/a),outgoing.map(v=>v/b)):fallback,l=length(t);if(l<1e-9)throw Error('A cusp needs an explicit replacement curve');const handle=Math.min(a||Infinity,b||Infinity,length(sub(p,previous.slice(0,2)))/3,length(sub(next.slice(6),p))/3);if(!Number.isFinite(handle)||handle<1e-9)throw Error('Remove degenerate curve segments before smoothing');for(let k=0;k<2;k++){previous[4+k]=p[k]-t[k]/l*handle;next[2+k]=p[k]+t[k]/l*handle;}}
 return out;
}
// Pair samples at equal contour distances on opposite sides. For each cyclic
// correspondence, the best reflection angle has a closed-form least-squares fit.
function mirrorOutline(edit, points, smooth, axis) {
 let n=48;
 const samples=resample(points,n,true);
 const center=axis?[0,0]:[0,1].map(k=>samples.reduce((sum,p)=>sum+p[k],0)/n);
 const local=samples.map(p=>sub(p,center));
 let best;
 for(let offset=0;offset<n;offset+=axis?2:1){
  let cosTerm=0,sinTerm=0;
  for(let i=0;i<n;i++){
   const [x,y]=local[i],[a,b]=local[(offset-i+n)%n];
   cosTerm+=x*a-y*b; sinTerm+=x*b+y*a;
  }
  const score=axis?(axis==='vertical'?-cosTerm:cosTerm):Math.hypot(cosTerm,sinTerm);
  if(!best||score>best.score)best={offset,score,angle:Math.atan2(sinTerm,cosTerm)/2};
 }
 const c=axis?(axis==='vertical'?0:1):Math.cos(best.angle),s=axis?(axis==='vertical'?1:0):Math.sin(best.angle);
 const aligned=local.map(([x,y])=>[x*c+y*s,-x*s+y*c]);
 let knots=aligned.map(([x,y],i)=>{
  const [a,b]=aligned[(best.offset-i+n)%n];
  return [(x+a)/2,(y-b)/2];
 });
 if(axis){
  const inFrame=points.map(([x,y])=>[x*c+y*s,-x*s+y*c]);
  const paired=symmetricOutlineKnots(inFrame,bounds(inFrame).span*.002);
  if(paired&&paired.length>=4&&paired.length<=64){knots=paired;n=paired.length;best.offset=0;}
 }
 const tangent=knots.map((_,i)=>sub(knots[(i+1)%n],knots[(i+n-1)%n]).map(v=>v/6));
 const segments=knots.map((a,i)=>{
  const j=(i+1)%n,b=knots[j],h=smooth?tangent[i]:sub(b,a).map(v=>v/3);
  return [...a,...add(a,h),...sub(b,smooth?tangent[j]:h),...b];
 });
 const {xAxis:x,yAxis:y}=edit;
 if(!axis){
 edit.origin=edit.origin.map((v,i)=>v+x[i]*center[0]+y[i]*center[1]);
 edit.xAxis=x.map((v,i)=>c*v+s*y[i]);edit.yAxis=x.map((v,i)=>-s*v+c*y[i]);
 }
 edit.segments=axis==='vertical'?segments.map(seg=>seg.map((v,i)=>i%2?seg[i-1]:-seg[i+1])):segments;
 return {edit,constraints:{closed:true,symmetry:'one',reflectionAxes:1,mirrorOffset:best.offset,...(axis?{mirrorAxis:axis}:{}),
  aligned:false,smooth,lines:!smooth,lineEdges:[],regularization:{method:'paired-contour-least-squares'}}};
}
// Model-selected geometric regularity, not a classifier or object template.
// Even angular Fourier modes fit a closed radial outline with exact D1/D2/D4
// reflection symmetry; analytic derivatives produce C1 continuous cubics.
export function regularizeSketch(edit,request,previousConstraints={}){
 if(!request||typeof request.smooth!=='boolean'||!['preserve','none','one','horizontal','vertical','both','four'].includes(request.symmetry))throw Error('Choose explicit smoothing and symmetry constraints');const e=structuredClone(edit),c=structuredClone(previousConstraints);
 if(request.symmetry==='preserve'||request.symmetry==='none'){
  if(e.kind==='spline'&&request.smooth&&!c.analytic)e.segments=smoothCubicJoins(e.segments,e.closed);else if(!['spline','circle','arc','line'].includes(e.kind)&&request.smooth)throw Error('Use a curved replacement to round this primitive');if(request.symmetry==='none'){c.symmetry='none';delete c.reflectionAxes;delete c.rotationalOrder;}if(request.smooth){c.smooth=true;c.lines=false;c.lineEdges=[];delete c.circularArcs;delete c.curveStyle;}return {edit:e,constraints:c};
 }
 if(!e.closed)throw Error('Reflection regularization requires a closed outline');
 let points;if(e.kind==='spline')points=e.segments.flatMap(s=>sampleDraftSegment({kind:'spline',coordinates:s},16));else if(e.kind==='circle')points=Array.from({length:97},(_,i)=>[e.radiusMetres*Math.cos(i*Math.PI/48),e.radiusMetres*Math.sin(i*Math.PI/48)]);else if(e.kind==='rectangle')points=[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([x,y])=>[x*e.widthMetres/2,y*e.heightMetres/2]);else throw Error('Use a closed profile for this symmetry');
 const axis=['horizontal','vertical'].includes(request.symmetry)?request.symmetry:null;
 if(axis&&['circle','rectangle'].includes(e.kind))return {edit:e,constraints:{...c,closed:true,symmetry:'both'}};
 if((axis||request.symmetry==='one')&&e.kind==='spline')return mirrorOutline(e,points,request.smooth,axis);
 const center=bounds(points).center,step=request.symmetry==='four'?4:request.symmetry==='both'?2:1,modes=[0,step,step*2],samples=resample(points,192,true).map(p=>sub(p,center)),matrix=Array.from({length:3},()=>[0,0,0]),rhs=[0,0,0];
 for(const p of samples){const theta=Math.atan2(p[1],p[0]),r=length(p),row=modes.map(k=>Math.cos(k*theta));for(let a=0;a<3;a++){rhs[a]+=row[a]*r;for(let b=0;b<3;b++)matrix[a][b]+=row[a]*row[b];}}
 const coefficients=solve(matrix,rhs);if(!coefficients||coefficients[0]<=1e-8)throw Error('The outline has no stable positive radial fit');const variation=Math.abs(coefficients[1])+Math.abs(coefficients[2]),limit=coefficients[0]*.6;if(variation>limit)for(let i=1;i<3;i++)coefficients[i]*=limit/variation;
 const n=16,h=Math.PI*2/n,at=t=>{const r=modes.reduce((s,k,i)=>s+coefficients[i]*Math.cos(k*t),0),dr=modes.reduce((s,k,i)=>s-coefficients[i]*k*Math.sin(k*t),0);return {p:[r*Math.cos(t),r*Math.sin(t)],d:[dr*Math.cos(t)-r*Math.sin(t),dr*Math.sin(t)+r*Math.cos(t)]};},values=Array.from({length:n},(_,i)=>at(i*h));
 e.segments=values.map((a,i)=>{const b=values[(i+1)%n];return [...a.p,...a.p.map((v,k)=>v+a.d[k]*h/3),...b.p.map((v,k)=>v-b.d[k]*h/3),...b.p];});e.origin=e.origin.map((v,k)=>v+center[0]*e.xAxis[k]+center[1]*e.yAxis[k]);e.kind='spline';for(const k of ['radiusMetres','startAngleDeg','endAngleDeg','widthMetres','heightMetres','end'])e[k]=null;
 return {edit:e,constraints:{closed:true,symmetry:request.symmetry==='one'?'one':'both',mirrorOffset:0,reflectionAxes:request.symmetry==='four'?4:request.symmetry==='both'?2:1,rotationalOrder:request.symmetry==='four'?4:request.symmetry==='both'?2:1,smooth:true,lines:false,lineEdges:[],regularization:{method:'radial-least-squares',coefficients,modes,maximumRadialVariationFraction:.6}}};
}
