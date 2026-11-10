import {evaluateExpression} from "../src/math-expression.js";
const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(a,s)=>a.map(x=>x*s);
const length=a=>Math.hypot(...a);
const unit=a=>{if(!finite(a)||length(a)<1e-10)throw Error("Plane normal must be a finite nonzero vector");return mul(a,1/length(a));};
const plane=p=>{if(!finite(p.origin))throw Error("Plane needs a finite origin");return {origin:p.origin,normal:unit(p.normal)};};
export function basis(curve,t){
 const {kind,degree,controlCount:n,knots}=curve;
 if(kind==="polynomial")return Array.from({length:n},(_,i)=>t**i);
 if(kind==="functions")return curve.terms.map(expression=>{const v=evaluateExpression(expression,{t});if(typeof v!=="number"||!Number.isFinite(v))throw Error("Basis must return a finite scalar");return v;});
 if(t===1)return Array.from({length:n},(_,i)=>i===n-1?1:0);
 let b=Array.from({length:n+degree},(_,i)=>knots[i]<=t&&t<knots[i+1]?1:0);
 for(let p=1;p<=degree;p++)b=Array.from({length:n+degree-p},(_,i)=>{const a=knots[i+p]-knots[i],c=knots[i+p+1]-knots[i+1];return(a?(t-knots[i])*b[i]/a:0)+(c?(knots[i+p+1]-t)*b[i+1]/c:0);});
 return b;
}
export function curveRows(curve,t){
 const b=basis(curve,t),mirror=curve.symmetry?basis(curve,1-t):null,n=curve.controlCount;
 const rows=Array.from({length:3},()=>Array(n*3).fill(0));
 for(let i=0;i<n;i++)for(let out=0;out<3;out++)for(let c=0;c<3;c++){
  const r=curve.symmetry?((out===c?1:0)-2*curve.symmetry.normal[out]*curve.symmetry.normal[c]):0;
  rows[out][i*3+c]=mirror?.length ? .5*((out===c?b[i]:0)+r*mirror[i]):(out===c?b[i]:0);
 }
 if(curve.plane){const normal=curve.plane.normal;return rows.map((row,c)=>row.map((v,j)=>v-normal[c]*rows.reduce((s,r,k)=>s+normal[k]*r[j],0)));}
 return rows;
}
export function evaluateCurve(curve,t){
 if(!Number.isFinite(t)||t<0||t>1)throw Error("Curve parameter must be in [0,1]");
 const coefficients=curve.coefficients.flat();return curveRows(curve,t).map((r,i)=>dot(r,coefficients)+curve.origin[i]);
}
function derivativeRows(curve,t){const h=1e-5,a=Math.max(0,t-h),b=Math.min(1,t+h),ra=curveRows(curve,a),rb=curveRows(curve,b);return rb.map((r,c)=>r.map((v,i)=>(v-ra[c][i])/(b-a)));}
function constraints(curve){
 const rows=[],targets=[],push=(r,v)=>{rows.push(...r);targets.push(...v);};
 for(const a of curve.constraints.anchors||[]){if(!finite(a.point)||!Number.isFinite(a.t)||a.t<0||a.t>1)throw Error("Invalid curve anchor");push(curveRows(curve,a.t),sub(a.point,curve.origin));}
 for(const a of curve.constraints.tangents||[]){if(!finite(a.vector)||!Number.isFinite(a.t)||a.t<0||a.t>1)throw Error("Invalid tangent");push(derivativeRows(curve,a.t),a.vector);}
 if(curve.constraints.closed)push(curveRows(curve,0).map((r,c)=>sub(r,curveRows(curve,1)[c])),[0,0,0]);
 if(curve.constraints.closedTangent)push(derivativeRows(curve,0).map((r,c)=>sub(r,derivativeRows(curve,1)[c])),[0,0,0]);
 return {rows,targets};
}
function elimination(rows,targets,n){
 const a=rows.map((r,i)=>[...r,targets[i]]),pivots=[];let k=0;
 for(let col=0;col<n&&k<a.length;col++){
  let best=k;for(let j=k+1;j<a.length;j++)if(Math.abs(a[j][col])>Math.abs(a[best][col]))best=j;
  if(Math.abs(a[best][col])<1e-9)continue;
  [a[k],a[best]]=[a[best],a[k]];const d=a[k][col];a[k]=a[k].map(v=>v/d);
  for(let j=0;j<a.length;j++)if(j!==k){const f=a[j][col];a[j]=a[j].map((v,i)=>v-f*a[k][i]);}
  pivots.push(col);k++;
 }
 for(let j=k;j<a.length;j++)if(Math.abs(a[j][n])>1e-7)throw Error("Incompatible constraints; relax an anchor, tangent, symmetry or plane");
 const free=Array.from({length:n},(_,i)=>i).filter(i=>!pivots.includes(i)),x=Array(n).fill(0);
 pivots.forEach((p,i)=>x[p]=a[i][n]);
 const z=free.map(f=>{const v=Array(n).fill(0);v[f]=1;pivots.forEach((p,i)=>v[p]=-a[i][f]);return v;});
 return {x,z,rank:pivots.length};
}
function solve(a,b){const n=b.length,m=a.map((r,i)=>[...r,b[i]]);for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[p][i]))p=j;if(Math.abs(m[p][i])<1e-15)throw Error("Ill-conditioned fit; lower degree or simplify basis");[m[i],m[p]]=[m[p],m[i]];const d=m[i][i];for(let k=i;k<=n;k++)m[i][k]/=d;for(let j=i+1;j<n;j++){const f=m[j][i];for(let k=i;k<=n;k++)m[j][k]-=f*m[i][k];}}const x=Array(n).fill(0);for(let i=n-1;i>=0;i--)x[i]=m[i][n]-m[i].slice(i+1,n).reduce((s,v,k)=>s+v*x[i+k+1],0);return x;}
export function fitCurve(input,a={}){
 if(!Array.isArray(input)||input.length<3||input.length>20000||input.some(p=>!finite(p)))throw Error("Fit needs 3-20000 finite world-metre points in stroke order");
 const stride=Math.max(1,Math.ceil(input.length/1000)),points=input.filter((_,i)=>i%stride===0||i===input.length-1);
 const degree=a.degree??3,kind=a.kind??"bspline",n=kind==="functions"?a.terms?.length:kind==="polynomial"?degree+1:a.controlCount??Math.max(degree+1,10);
 if(!["bspline","polynomial","functions"].includes(kind)||!Number.isInteger(degree)||degree<1||degree>7||!Number.isInteger(n)||n<2||n>24||(kind==="bspline"&&n<=degree))throw Error("Use degree 1-7, 2-24 coefficients, and more B-spline controls than degree");
 if(kind==="functions"&&a.terms.some(t=>typeof t!=="string"||t.length>256))throw Error("Use bounded safe basis expressions in t");
 const c={kind,degree,order:degree+1,controlCount:n,terms:a.terms,knots:kind==="bspline"?[...Array(degree+1).fill(0),...Array.from({length:n-degree-1},(_,i)=>(i+1)/(n-degree)),...Array(degree+1).fill(1)]:undefined,constraints:structuredClone(a.constraints||{}),units:"metres",parameterization:"normalized chord length"};
 c.symmetry=c.constraints.symmetryPlane?plane(c.constraints.symmetryPlane):null;c.plane=c.constraints.plane?plane(c.constraints.plane):null;
 if(c.symmetry&&c.plane){const d=Math.abs(dot(c.symmetry.normal,c.plane.normal));if(d>1e-8&&(Math.abs(d-1)>1e-8||Math.abs(dot(sub(c.symmetry.origin,c.plane.origin),c.plane.normal))>1e-8))throw Error("The fitted plane must be invariant under the symmetry reflection (perpendicular or coincident planes)");}
 c.origin=c.symmetry?[...c.symmetry.origin]:points.reduce((s,p)=>add(s,mul(p,1/points.length)),[0,0,0]);
 if(c.plane)c.origin=sub(c.origin,mul(c.plane.normal,dot(sub(c.origin,c.plane.origin),c.plane.normal)));
 const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+length(sub(points[i],points[i-1])));if(lengths.at(-1)<1e-8)throw Error("Degenerate stroke");
 const ts=lengths.map(v=>v/lengths.at(-1)),cr=constraints(c),{x,z,rank}=elimination(cr.rows,cr.targets,n*3);
 const fairness=a.fairnessWeight??.001,huber=a.robustThresholdMetres??.01;
 if(!Number.isFinite(fairness)||fairness<0||fairness>10||!Number.isFinite(huber)||huber<=0)throw Error("Invalid fairness or robust threshold");
 let coeff=x,weights=points.map(()=>1);
 for(let iteration=0;iteration<4;iteration++){
  const rows=[],targets=[],addRows=(rs,vs,w)=>rs.forEach((r,k)=>{rows.push(mul(r,w));targets.push(vs[k]*w);});
  points.forEach((p,i)=>addRows(curveRows(c,ts[i]),sub(p,c.origin),Math.sqrt(weights[i]/points.length)));
  if(fairness)for(let j=1;j<32;j++){const t=j/32,h=1/32,prev=curveRows(c,t-h),mid=curveRows(c,t),next=curveRows(c,t+h);addRows(mid.map((r,k)=>r.map((v,i)=>(prev[k][i]-2*v+next[k][i])/(h*h))),[0,0,0],Math.sqrt(fairness/31));}
  const normal=z.map(()=>z.map(()=>0)),rhs=z.map(()=>0);
  rows.forEach((r,i)=>{const q=z.map(v=>dot(r,v)),v=targets[i]-dot(r,x);q.forEach((u,j)=>{rhs[j]+=u*v;q.forEach((w,k)=>normal[j][k]+=u*w);});});
  for(let j=0;j<z.length;j++){normal[j][j]+=1e-10;}
  const solution=z.length?solve(normal,rhs):[];coeff=x.map((v,i)=>v+z.reduce((s,col,j)=>s+col[i]*solution[j],0));c.coefficients=Array.from({length:n},(_,i)=>coeff.slice(i*3,i*3+3));
  weights=points.map((p,i)=>Math.min(1,huber/Math.max(1e-12,length(sub(p,evaluateCurve(c,ts[i]))))));
 }
 const errors=points.map((p,i)=>length(sub(p,evaluateCurve(c,ts[i])))),samples=Array.from({length:257},(_,i)=>evaluateCurve(c,i/256));
 const residual=cr.rows.map((r,i)=>Math.abs(dot(r,coeff)-cr.targets[i]));if(residual.some(v=>v>1e-6))throw Error("Constraint solve exceeded tolerance");
 return {curve:c,samples,diagnostics:{sourceCount:input.length,fittedCount:points.length,rmsMetres:Math.sqrt(errors.reduce((s,v)=>s+v*v,0)/errors.length),maxMetres:Math.max(...errors),constraintMaxResidual:Math.max(0,...residual),constraintRank:rank,robustDownweightedCount:weights.filter(v=>v<.999).length,fairnessWeight:fairness,note:"Residuals use chord-length correspondence, not closest-point distance. Symmetry is exact C(1-t)=reflection(C(t)); choose stroke start/order accordingly. Tangent constraints use finite differences in normalized t. A curve is not a solid."}};
}
