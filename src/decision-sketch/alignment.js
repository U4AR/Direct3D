import {bounds,resample,lineFit,distance} from './math.js';

// Only long, measurably straight runs vote for a design frame. Curved sides,
// taper and bounding-box proportions must not rotate an otherwise upright sketch.
export function linearRunEvidence(points,{closed=false}={}){
 const span=bounds(points).span,p=resample(points,80,closed),n=p.length,work=closed?[...p,...p]:p,candidates=[];
 for(let i=0;i<n-2;i++)for(let j=i+3;j<Math.min(work.length,i+Math.floor(n*.7));j++){
  const length=distance(work[i],work[j]);if(length<span*.22)continue;
  const fit=lineFit(work.slice(i,j+1));if(fit.max>span*.006||fit.rms>span*.003)continue;
  const angle=fit.angle,nearest=Math.round(angle/(Math.PI/2))*Math.PI/2;
  candidates.push({start:i,end:j,length,angle,rms:fit.rms,max:fit.max,planeAligned:Math.abs(angle-nearest)<Math.PI/18,points:[work[i],work[j]]});
 }
 const runs=[],used=new Set();for(const c of candidates.sort((a,b)=>b.length-a.length)){
  const ids=Array.from({length:c.end-c.start},(_,k)=>(c.start+k)%n);if(ids.filter(i=>used.has(i)).length>ids.length*.15)continue;
  runs.push(c);ids.forEach(i=>used.add(i));if(runs.length===8)break;
 }
 const total=runs.reduce((s,r)=>s+r.length,0),support=runs.filter(r=>r.planeAligned).reduce((s,r)=>s+r.length,0);
 return {runs,planeSupport:total?support/total:0,planeAligned:total>span*.3&&support/total>.6};
}

// Match profile edges to measured straight runs; do not flatten curves merely
// because their tangent happens to be horizontal or vertical.
export function matchingLineEdges(knots,runs,{closed=false,tolerance=.025}={}){
 const segmentDistance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1);return t<-.06||t>1.06?Infinity:Math.abs((p[0]-a[0])*dy-(p[1]-a[1])*dx)/Math.hypot(dx,dy);};
 return Array.from({length:closed?knots.length:knots.length-1},(_,i)=>i).filter(i=>runs.some(r=>[knots[i],knots[(i+1)%knots.length]].every(p=>segmentDistance(p,...r.points)<(r.planeAligned?tolerance:.006))));
}

// Once the decision selects plane alignment, flatten small departures around
// supported long H/V runs before finding corners. This avoids preserving a pen
// bump as an extra feature or turning the entire profile to follow that bump.
export function regularizePlaneRuns(points,runs){
 const box=bounds(points);
 const targets=runs.filter(r=>r.planeAligned).map(r=>{const angle=Math.round(r.angle/(Math.PI/2))*Math.PI/2,k=Math.abs(Math.cos(angle))>.5?1:0,along=1-k,level=(r.points[0][k]+r.points[1][k])/2;const coverage=Math.abs(r.points[1][along]-r.points[0][along])/(box.max[along]-box.min[along]||1),major=coverage>.65&&r.length>.4;return {k,along,level,extension:major?.6:.08,min:Math.min(...r.points.map(p=>p[along])),max:Math.max(...r.points.map(p=>p[along])),length:r.length,tolerance:major?.075:.012};});
 return points.map(p=>{const target=targets.filter(t=>p[t.along]>=t.min-t.length*t.extension&&p[t.along]<=t.max+t.length*t.extension&&Math.abs(p[t.k]-t.level)<t.tolerance).sort((a,b)=>Math.abs(p[a.k]-a.level)-Math.abs(p[b.k]-b.level))[0];if(!target)return p;const q=p.slice();q[target.k]=target.level;return q;});
}
