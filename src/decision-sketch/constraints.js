import {dot,norm,resample,simplify} from './math.js';
const mod=(i,n)=>(i%n+n)%n;
// Pair the two halves at actual axis crossings rather than an arbitrary pen
// start. Least-squares mirrored samples retain corners before simplification.
export function symmetricOutlineKnots(points,tolerance=.012){
 const crossings=[];
 for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if((a[1]<=0&&b[1]>0)||(a[1]>0&&b[1]<=0)){const t=-a[1]/(b[1]-a[1]);crossings.push({i,p:[a[0]+t*(b[0]-a[0]),0]});}}
 if(crossings.length!==2)return null;
 const [a,b]=crossings,half=(a,b)=>{const p=[a.p];for(let j=a.i+1;j<=(b.i<=a.i?b.i+points.length:b.i);j++)p.push(points[j%points.length]);return [...p,b.p];},p=resample(half(a,b),65),q=resample(half(b,a).reverse(),65),average=p.map((v,i)=>[(v[0]+q[i][0])/2,(v[1]-q[i][1])/2]),knots=simplify(average,tolerance);
 return [...knots,...knots.slice(1,-1).reverse().map(([x,y])=>[x,-y])];
}
export function mirrorCorrespondence(knots,axis='horizontal',closed=true){const n=knots.length,sign=axis==='horizontal'?[1,-1]:[-1,1];if(!closed)return n-1;let best=0,cost=Infinity;for(let k=0;k<n;k++){let sum=0;for(let i=0;i<n;i++){const p=knots[mod(k-i,n)];sum+=(knots[i][0]-p[0]*sign[0])**2+(knots[i][1]-p[1]*sign[1])**2;}if(sum<cost){cost=sum;best=k;}}return best;}
// Orthogonal projection onto selected homogeneous constraints gives the exact
// least-squares solution for these fixed correspondences, including dependent rows.
export function constrainKnots(input,{symmetry='none',closed=false,mirrorOffset,mirrorAxis='horizontal',lines=false,lineEdges=[],align=true,anchors=[],linearAnchors=[]}={}){
 const n=input.length,p=input.flat(),rows=[],row=(terms,rhs=0)=>{const r=Array(n*2).fill(0);for(const [index,value]of terms)r[index]+=value;rows.push({r,rhs});};
 let offset=mirrorOffset??mirrorCorrespondence(input,mirrorAxis,closed),effective=symmetry;
 if(effective==='both'&&n%2)effective='one';
 if(effective!=='none')for(let i=0;i<n;i++){const j=closed?mod(offset-i,n):n-1-i;const sign=effective==='one'&&mirrorAxis==='vertical'?-1:1;row([[2*i,1],[2*j,-sign]]);row([[2*i+1,1],[2*j+1,sign]]);}
 if(effective==='both')for(let i=0;i<n;i++){const j=mod(offset+n/2-i,n);row([[2*i,1],[2*j,1]]);row([[2*i+1,1],[2*j+1,-1]]);}
 if(align)for(let i=0;i<(closed?n:n-1);i++){if(!lines&&!lineEdges.includes(i))continue;const j=(i+1)%n,dx=input[j][0]-input[i][0],dy=input[j][1]-input[i][1],a=Math.atan2(dy,dx),target=Math.round(a/(Math.PI/4))*Math.PI/4;if(Math.abs(a-target)>Math.PI*7/180)continue;const normal=[-Math.sin(target),Math.cos(target)];row([[2*j,normal[0]],[2*i,-normal[0]],[2*j+1,normal[1]],[2*i+1,-normal[1]]]);}
 for(const anchor of anchors){if(!Number.isInteger(anchor.index)||anchor.index<0||anchor.index>=n||!anchor.point?.every(Number.isFinite))throw Error('Invalid knot anchor');row([[anchor.index*2,1]],anchor.point[0]);row([[anchor.index*2+1,1]],anchor.point[1]);}
 for(const a of linearAnchors){if(!Number.isInteger(a.index)||a.index<0||a.index>=n||a.normal?.length!==2||!a.normal.every(Number.isFinite)||!Number.isFinite(a.value))throw Error('Invalid coordinate anchor');row([[a.index*2,a.normal[0]],[a.index*2+1,a.normal[1]]],a.value);}
 const basis=[];for(const {r,rhs}of rows){let v=r.slice(),beta=rhs;for(const b of basis){const c=dot(v,b.vector);v=v.map((x,k)=>x-c*b.vector[k]);beta-=c*b.beta;}const length=norm(v);if(length>1e-8)basis.push({vector:v.map(x=>x/length),beta:beta/length});else if(Math.abs(beta)>1e-7)throw Error('The requested movement conflicts with a locked symmetry/alignment constraint');}
 const q=p.slice();for(const b of basis){const c=dot(p,b.vector)-b.beta;for(let i=0;i<q.length;i++)q[i]-=c*b.vector[i];}
 return {knots:Array.from({length:n},(_,i)=>q.slice(i*2,i*2+2)),symmetry:effective,mirrorOffset:offset,independentConstraints:basis.length,squaredCorrection:q.reduce((s,v,i)=>s+(v-p[i])**2,0)};
}
export function knotsToSegments(knots,{closed=false,lines=false,lineEdges=[]}={}){const n=knots.length,get=i=>knots[closed?mod(i,n):Math.max(0,Math.min(n-1,i))],angle=i=>{const a=get(i-1),b=get(i),c=get(i+1),u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]];return Math.acos(Math.max(-1,Math.min(1,dot(u,v)/(norm(u)*norm(v)||1))));};return Array.from({length:closed?n:n-1},(_,i)=>{const a=get(i),b=get(i+1),previous=get(i-1),next=get(i+2),straight=lines||lineEdges.includes(i)||(angle(i)<.025&&angle(i+1)<.025),c1=straight?a.map((v,k)=>v+(b[k]-v)/3):angle(i)>.75?a:a.map((v,k)=>v+(b[k]-previous[k])/6),c2=straight?a.map((v,k)=>v+2*(b[k]-v)/3):angle(i+1)>.75?b:b.map((v,k)=>v-(next[k]-a[k])/6);return {kind:straight?'line':'spline',coordinates:[...a,...c1,...c2,...b]};});}
