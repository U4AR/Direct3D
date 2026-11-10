import {bounds,distance} from './math.js';
import {fitDraftRange,sampleDraftSegment} from '../desktop-measured-draft.js';
const mod=(i,n)=>(i%n+n)%n;
const line=(a,b)=>({kind:'line',coordinates:[...a,...a.map((v,k)=>v+(b[k]-v)/3),...a.map((v,k)=>v+2*(b[k]-v)/3),...b]});
export function arcCubics([cx,cy,r,start,sweep]){
 const n=Math.max(1,Math.ceil(Math.abs(sweep)/90)),out=[];
 for(let i=0;i<n;i++){const a=(start+sweep*i/n)*Math.PI/180,b=(start+sweep*(i+1)/n)*Math.PI/180,k=4/3*Math.tan((b-a)/4),p=t=>[cx+r*Math.cos(t),cy+r*Math.sin(t)],u=p(a),v=p(b);out.push({kind:'spline',coordinates:[...u,u[0]-k*r*Math.sin(a),u[1]+k*r*Math.cos(a),v[0]+k*r*Math.sin(b),v[1]-k*r*Math.cos(b),...v],circularArc:{center:[cx,cy],radius:r,startAngleDeg:a*180/Math.PI,sweepDeg:(b-a)*180/Math.PI}});}
 return out;
}
// Fit long supported circular runs, with the original endpoints fixed. The
// native mixed profile uses canonical circular Beziers (<=90 degrees per arc).
// Mirrored half-profiles are reflected exactly, rather than fitted separately.
export function circularizeProfile(segments,constraints,{toleranceFraction=.012}={}){
 if(constraints.lines||constraints.symmetry==='both'||segments.length>64)return {segments,constraints};
 const mirror=constraints.closed&&constraints.symmetry==='one'&&segments.length%2===0&&constraints.mirrorOffset%2===0;
 if(constraints.symmetry==='one'&&!mirror)return {segments,constraints};
 const start=mirror?mod(constraints.mirrorOffset/2,segments.length):0,n=mirror?segments.length/2:segments.length,source=Array.from({length:n},(_,i)=>segments[mod(start+i,segments.length)]),samples=source.map(s=>sampleDraftSegment({kind:'spline',coordinates:s.coordinates},10)),span=bounds(samples.flat()).span,tolerance=span*toleranceFraction;
 const costs=Array(n+1).fill(Infinity),previous=[];costs[0]=0;
 for(let j=1;j<=n;j++){
  costs[j]=costs[j-1]+2;previous[j]={i:j-1,pieces:[source[j-1]]};
  for(let i=j-1;i>=Math.max(0,j-16);i--){const part=samples.slice(i,j).flatMap((s,k)=>k?s.slice(1):s),crossesLine=Array.from({length:j-i},(_,k)=>constraints.lineEdges?.includes(mod(start+i+k,segments.length))).some(Boolean);if(j-i>1&&crossesLine)continue;
   const candidates=[];const straight=fitDraftRange(part,'line');if(straight?.error.max<tolerance*.35)candidates.push({cost:1,pieces:[line(part[0],part.at(-1))]});
   if(!crossesLine){const arc=fitDraftRange(part,'arc');if(arc&&Math.abs(arc.coordinates[4])>=25&&Math.abs(arc.coordinates[4])<=240&&arc.error.max<tolerance&&arc.error.rms<tolerance*.65)candidates.push({cost:1.15+.2*arc.error.rms/tolerance,pieces:arcCubics(arc.coordinates)});}
   for(const candidate of candidates)if(costs[i]+candidate.cost<costs[j]){costs[j]=costs[i]+candidate.cost;previous[j]={i,pieces:candidate.pieces};}
  }
 }
 let j=n,out=[];while(j>0){out.unshift(...previous[j].pieces);j=previous[j].i;}
 if(mirror){const reflected=out.slice().reverse().map(s=>{const p=Array.from({length:4},(_,i)=>s.coordinates.slice(i*2,i*2+2)).reverse().flatMap(([x,y])=>[x,-y]);return {...s,coordinates:p,circularArc:s.circularArc?{center:[s.circularArc.center[0],-s.circularArc.center[1]],radius:s.circularArc.radius,startAngleDeg:-(s.circularArc.startAngleDeg+s.circularArc.sweepDeg),sweepDeg:s.circularArc.sweepDeg}:undefined};});out.push(...reflected);}
 if(out.length>64)return {segments,constraints};
 // Pin shared endpoints against floating-point noise at arc boundaries.
 for(let i=1;i<out.length;i++)if(distance(out[i-1].coordinates.slice(6),out[i].coordinates.slice(0,2))<span*1e-7)out[i].coordinates.splice(0,2,...out[i-1].coordinates.slice(6));
 if(constraints.closed&&distance(out.at(-1).coordinates.slice(6),out[0].coordinates.slice(0,2))<span*1e-7)out.at(-1).coordinates.splice(6,2,...out[0].coordinates.slice(0,2));
 const arcs=out.flatMap((s,index)=>s.circularArc?[{segmentIndex:index,...s.circularArc}]:[]);
 return {segments:out,constraints:{...constraints,...(mirror?{mirrorOffset:0}:{}),lineEdges:out.flatMap((s,i)=>s.kind==='line'?[i]:[]),circularArcs:arcs,curveStyle:'circular'}};
}
