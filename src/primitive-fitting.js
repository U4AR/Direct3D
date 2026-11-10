import { fitPlane } from './plane-fitting.js';

// All positions are world-space metres (Y up). Fits are hypotheses, not semantic labels.
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const mul = (a, n) => a.map(x => x * n);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => Math.hypot(...a);
const unit = a => { const n = norm(a); if (n < 1e-12) throw Error('Degenerate direction'); return mul(a, 1/n); };
function canonical(a) { const k = a.map(Math.abs).indexOf(Math.max(...a.map(Math.abs))); return a[k] < 0 ? mul(a, -1) : a; }
function validate(points, count = 2) {
  if (!Array.isArray(points) || points.length < count || points.length > 250000 || points.some(p => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)))
    throw Error(`Expected ${count} to 250000 finite XYZ points in metres`);
}
function sampled(points) { const step = Math.max(1, Math.ceil(points.length/4000)); return points.filter((_, i) => i % step === 0); }
function mean(points) { return mul(points.reduce((s, p) => add(s, p), [0,0,0]), 1/points.length); }
function basis(normal) { const seed = Math.abs(normal[0]) < 0.8 ? [1,0,0] : [0,1,0]; const u = unit(cross(seed, normal)); return { u, v: cross(normal, u) }; }

export function analyzePCA(points) {
  validate(points);
  const sample = sampled(points), centroid = mean(sample);
  const matrix = Array.from({length:3}, () => [0,0,0]);
  const vectors = [[1,0,0],[0,1,0],[0,0,1]];
  for (const point of sample) { const d = sub(point, centroid); for (let i=0;i<3;i++) for(let j=0;j<3;j++) matrix[i][j] += d[i]*d[j]/sample.length; }
  for(let step=0;step<40;step++) {
    let p=0,q=1;
    for(const [i,j] of [[0,1],[0,2],[1,2]]) if(Math.abs(matrix[i][j])>Math.abs(matrix[p][q])) {p=i;q=j;}
    if(Math.abs(matrix[p][q]) < Math.max(1e-24, (matrix[0][0]+matrix[1][1]+matrix[2][2])*1e-14)) break;
    const angle=0.5*Math.atan2(2*matrix[p][q],matrix[q][q]-matrix[p][p]), c=Math.cos(angle),s=Math.sin(angle);
    const app=matrix[p][p],aqq=matrix[q][q],apq=matrix[p][q];
    for(let k=0;k<3;k++) {
      if(k!==p&&k!==q) { const x=matrix[k][p],y=matrix[k][q]; matrix[k][p]=matrix[p][k]=c*x-s*y;matrix[k][q]=matrix[q][k]=s*x+c*y; }
      const x=vectors[k][p],y=vectors[k][q];vectors[k][p]=c*x-s*y;vectors[k][q]=s*x+c*y;
    }
    matrix[p][p]=c*c*app-2*s*c*apq+s*s*aqq;matrix[q][q]=s*s*app+2*s*c*apq+c*c*aqq;matrix[p][q]=matrix[q][p]=0;
  }
  const order=[0,1,2].sort((a,b)=>matrix[b][b]-matrix[a][a]);
  const eigenvalues=order.map(i=>Math.max(0,matrix[i][i]));
  const axes=order.map(i=>canonical(unit(vectors.map(row=>row[i]))));
  axes[2]=unit(cross(axes[0],axes[1])); // right-handed; major direction sign remains deterministic
  const extents=axes.map(axis=>{ let min=Infinity,max=-Infinity; for(const p of points) { const t=dot(sub(p,centroid),axis); min=Math.min(min,t);max=Math.max(max,t); } return {min,max,size:max-min}; });
  const ratios=eigenvalues.map(x=>eigenvalues[0]>1e-20 ? x/eigenvalues[0] : 0);
  const dimensionality=eigenvalues[0]<1e-20 ? 'point' : ratios[1]<0.02 ? 'linear' : ratios[2]<0.02 ? 'planar' : 'volumetric';
  return {centroid,axes,eigenvalues,eigenvalueUnits:'metres squared',extents,dimensionality,eigenvalueRatios:ratios,pointCount:points.length,sampledPoints:sample.length,coordinateSystem:'world Y-up metres',degenerate:dimensionality==='point',directionAmbiguous:ratios[1]>0.9,normalAmbiguous:ratios[2]/Math.max(ratios[1],1e-20)>0.9,note:'PCA is sensitive to outliers; symmetric shapes have ambiguous directions. Dimensionality uses a 0.02 eigenvalue ratio heuristic.'};
}

function solve(a,b) {
  const n=b.length, rows=a.map((r,i)=>[...r,b[i]]), scale=Math.max(...a.flat().map(Math.abs));
  if(!scale) throw Error('Degenerate fit');
  for(let i=0;i<n;i++) {
    let pivot=i;for(let j=i+1;j<n;j++) if(Math.abs(rows[j][i])>Math.abs(rows[pivot][i])) pivot=j;
    if(Math.abs(rows[pivot][i])<scale*1e-12) throw Error('Degenerate or ill-conditioned fit');
    [rows[pivot],rows[i]]=[rows[i],rows[pivot]];
    const d=rows[i][i];for(let k=i;k<=n;k++) rows[i][k]/=d;
    for(let j=0;j<n;j++) if(j!==i) { const f=rows[j][i];for(let k=i;k<=n;k++) rows[j][k]-=f*rows[i][k]; }
  }
  return rows.map(r=>r[n]);
}
function leastSquares(rows,values) { const n=rows[0].length,a=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0);for(let k=0;k<rows.length;k++) for(let i=0;i<n;i++) {b[i]+=rows[k][i]*values[k];for(let j=0;j<n;j++) a[i][j]+=rows[k][i]*rows[k][j];}return solve(a,b); }
function circle3([a,b,c]) {
  const ab=sub(b,a),ac=sub(c,a),n=cross(ab,ac),nn=dot(n,n);
  if(nn<1e-24) throw Error('Collinear circle points');
  const center=add(a,mul(add(mul(cross(ac,n),dot(ab,ab)),mul(cross(n,ab),dot(ac,ac))),1/(2*nn)));
  const normal=canonical(unit(n));return {center,normal,radiusMetres:norm(sub(a,center)),...basis(normal)};
}
function circleRefine(points) {
  const pca=analyzePCA(points);if(pca.dimensionality==='linear'||pca.degenerate) throw Error('Circle region is collinear');
  const normal=pca.axes[2],u=pca.axes[0],v=pca.axes[1],o=pca.centroid;
  const coords=points.map(p=>[dot(sub(p,o),u),dot(sub(p,o),v)]);
  const [x,y,k]=leastSquares(coords.map(([x,y])=>[2*x,2*y,1]),coords.map(([x,y])=>x*x+y*y));
  const radiusMetres=Math.sqrt(x*x+y*y+k);if(!Number.isFinite(radiusMetres)||radiusMetres<1e-9) throw Error('Degenerate circle radius');
  return {center:add(o,add(mul(u,x),mul(v,y))),normal,u,v,radiusMetres};
}
function sphereFit(points) {
  const origin=mean(points),d=points.map(p=>sub(p,origin));
  const [x,y,z,k]=leastSquares(d.map(p=>[2*p[0],2*p[1],2*p[2],1]),d.map(p=>dot(p,p)));
  const radiusMetres=Math.sqrt(x*x+y*y+z*z+k);if(!Number.isFinite(radiusMetres)||radiusMetres<1e-9) throw Error('Degenerate sphere radius');
  return {center:add(origin,[x,y,z]),radiusMetres};
}
const distances={
  line:(p,m)=>norm(cross(sub(p,m.origin),m.direction)),
  plane:(p,m)=>Math.abs(dot(sub(p,m.origin),m.normal)),
  circle:(p,m)=>{const d=sub(p,m.center),h=dot(d,m.normal);return Math.hypot(h,Math.hypot(dot(d,m.u),dot(d,m.v))-m.radiusMetres);},
  sphere:(p,m)=>Math.abs(norm(sub(p,m.center))-m.radiusMetres),
  cylinder:(p,m)=>Math.abs(norm(cross(sub(p,m.origin),m.direction))-m.radiusMetres),
};
function consensus(points,model,distance,threshold) { const indices=[];let error=0;for(let i=0;i<points.length;i++) {const d=distance(points[i],model);if(d<=threshold) {indices.push(i);error+=d*d;}}return {model,indices,error}; }
function better(a,b) {return !b||a.indices.length>b.indices.length||(a.indices.length===b.indices.length&&a.error<b.error);}
function ransac(points,n,make,refine,distance,threshold,iterations) {
  let seed=730201,best=null;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let trial=0;trial<iterations;trial++) {
    const indices=new Set();while(indices.size<n) indices.add(Math.floor(random()*points.length));
    try {const candidate=consensus(points,make([...indices].map(i=>points[i])),distance,threshold);if(better(candidate,best)) best=candidate;} catch { /* Degenerate samples cannot define a primitive. */ }
  }
  if(!best||best.indices.length<n) throw Error('No stable primitive found; choose a smaller coherent region or another primitive');
  for(let i=0;i<2;i++) {try {const candidate=consensus(points,refine(best.indices.map(j=>points[j])),distance,threshold);if(better(candidate,best)) best=candidate;else break;}catch{break;}}
  return best.model;
}
function lineFit(points) {const pca=analyzePCA(points);if(pca.degenerate) throw Error('Coincident line points');return {origin:pca.centroid,direction:pca.axes[0]};}
function cylinderFit(points,threshold,iterations,axisDirection) {
  const pca=analyzePCA(points);if(pca.degenerate) throw Error('Degenerate cylinder selection');
  const axes=axisDirection?[unit(axisDirection)]:pca.axes;
  let best=null;
  for(const direction of axes) {
    const {u,v}=basis(direction),origin=pca.centroid;
    const projected=points.map(p=>[dot(sub(p,origin),u),dot(sub(p,origin),v),0]);
    try {
      const circle=ransac(projected,3,circle3,circleRefine,distances.circle,threshold,iterations);
      const model={origin:add(origin,add(mul(u,circle.center[0]),mul(v,circle.center[1]))),direction:canonical(direction),radiusMetres:circle.radiusMetres};
      const candidate=consensus(points,model,distances.cylinder,threshold);if(better(candidate,best)) best=candidate;
    }catch{/* A candidate axis may collapse the circular cross section. */}
  }
  if(!best) throw Error('No stable cylinder section found');return best.model;
}

export function fitPrimitive(points, {kind='plane',thresholdMetres=0.005,iterations=192,axisDirection}={}) {
  if(!Object.hasOwn(distances,kind)) throw Error('Primitive kind must be line, plane, circle, sphere, or cylinder');
  const minimum={line:2,plane:3,circle:3,sphere:4,cylinder:6}[kind];validate(points,minimum);
  if(!Number.isFinite(thresholdMetres)||thresholdMetres<=0||thresholdMetres>10) throw Error('thresholdMetres must be positive and at most 10');
  if(!Number.isInteger(iterations)||iterations<16||iterations>512) throw Error('iterations must be an integer from 16 to 512');
  if(axisDirection&&(!Array.isArray(axisDirection)||axisDirection.length!==3||!axisDirection.every(Number.isFinite))) throw Error('axisDirection must be a finite XYZ vector');
  const sample=sampled(points),distance=distances[kind];let model,method='deterministic RANSAC with least-squares inlier refinement';
  if(kind==='plane') { const fit=fitPlane(sample,{thresholdMetres});model=fit.raw.frame; }
  if(kind==='line') model=ransac(sample,2,p=>({origin:p[0],direction:canonical(unit(sub(p[1],p[0])))}),lineFit,distance,thresholdMetres,iterations);
  if(kind==='circle') model=ransac(sample,3,circle3,circleRefine,distance,thresholdMetres,iterations);
  if(kind==='sphere') model=ransac(sample,4,sphereFit,sphereFit,distance,thresholdMetres,iterations);
  if(kind==='cylinder') {model=cylinderFit(sample,thresholdMetres,iterations,axisDirection);method=axisDirection?'provided-axis transverse circle RANSAC':'PCA-axis hypotheses with transverse circle RANSAC (limited axis estimate)';}
  const inlierIndices=[];let sum=0,max=0,inlierSum=0,inlierMax=0;
  for(let i=0;i<points.length;i++) {const d=distance(points[i],model);if(!Number.isFinite(d)) throw Error('Non-finite fit residual');sum+=d*d;max=Math.max(max,d);if(d<=thresholdMetres) {inlierIndices.push(i);inlierSum+=d*d;inlierMax=Math.max(inlierMax,d);}}
  if(inlierIndices.length<minimum) throw Error('Too few inliers support the fitted primitive');
  if(kind==='line'||kind==='cylinder') {let min=Infinity,max=-Infinity;for(const i of inlierIndices) {const t=dot(sub(points[i],model.origin),model.direction);min=Math.min(min,t);max=Math.max(max,t);}model.extentMetres=[min,max];model.endpoints=[add(model.origin,mul(model.direction,min)),add(model.origin,mul(model.direction,max))];}
  return {kind,model,method,coordinateSystem:'world Y-up metres',thresholdMetres,pointCount:points.length,sampledPoints:sample.length,iterations:kind==='plane'?192:iterations,inlierIndices,inlierCount:inlierIndices.length,coverage:inlierIndices.length/points.length,errors:{rmsMetres:Math.sqrt(sum/points.length),maxMetres:max,inlierRmsMetres:Math.sqrt(inlierSum/inlierIndices.length),inlierMaxMetres:inlierMax},degenerate:false,note:kind==='cylinder'?'Cylinder axis is only a provided direction or one of three PCA candidates; this is not unrestricted cylinder RANSAC. Partial arcs, uneven sampling, and outliers can bias direction. Residuals concern the infinite lateral surface, not end caps.':'A geometric hypothesis; inspect coverage, residuals, selected stroke ranges, and multiple views before choosing an extrusion, revolve, or contour. PCA and primitive fits do not determine user intent.'};
}
