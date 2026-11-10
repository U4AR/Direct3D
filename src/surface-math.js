import { evaluateExpression } from "./math-expression.js";
import { ShapeUtils, Vector2, Vector3 } from 'three';
const vec=p=>new Vector3(...p);
const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const clone=x=>structuredClone(x);
const clamp=x=>Math.max(0,Math.min(1,x));
export function clampedKnots(count) {
  if(!Number.isInteger(count)||count<4||count>10) throw Error('Cubic surface dimensions must each have 4 to 10 controls');
  return [0,0,0,0,...Array.from({length:count-4},(_,i)=>(i+1)/(count-3)),1,1,1,1];
}
function basis(count,knots,t,derivative=false){
  const x=Math.min(1-1e-13,Math.max(0,t)),memo=new Map();
  function n(i,p){const key=i+':'+p;if(memo.has(key))return memo.get(key);let y;
    if(!p)y=knots[i]<=x&&x<knots[i+1]?1:0;
    else {const a=knots[i+p]-knots[i],b=knots[i+p+1]-knots[i+1];y=(a?(x-knots[i])/a*n(i,p-1):0)+(b?(knots[i+p+1]-x)/b*n(i+1,p-1):0);}
    memo.set(key,y);return y;
  }
  return Array.from({length:count},(_,i)=>{if(!derivative)return n(i,3);const a=knots[i+3]-knots[i],b=knots[i+4]-knots[i+1];return(a?3/a*n(i,2):0)-(b?3/b*n(i+1,2):0);});
}
function validateNet(net){if(!Array.isArray(net)||net.length<4||net.length>10||!Array.isArray(net[0])||net[0].length<4||net[0].length>10||net.some(row=>!Array.isArray(row)||row.length!==net[0].length||row.some(p=>!finite(p))))throw Error('controlNet must be rectangular [u][v][xyz], 4 to 10 controls per axis, finite world metres');}
function validateKnots(knots,count){if(!Array.isArray(knots)||knots.length!==count+4||knots.some((x,i)=>!Number.isFinite(x)||x<0||x>1||(i&&x<knots[i-1]))||knots.slice(0,4).some(x=>x!==0)||knots.slice(-4).some(x=>x!==1)||knots.slice(4,-4).some(x=>x<=0||x>=1))throw Error('Use nondecreasing clamped cubic knots normalized 0..1');const inner=knots.slice(4,-4);if(inner.some(x=>inner.filter(y=>y===x).length>3))throw Error('Interior cubic knot multiplicity cannot exceed three');}
function solve(matrix,rhs){const n=rhs.length,a=matrix.map((row,i)=>[...row,rhs[i]]);for(let i=0;i<n;i++){let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;if(Math.abs(a[pivot][i])<1e-13)throw Error('Surface solve is singular; add regularization or broader stroke coverage');[a[i],a[pivot]]=[a[pivot],a[i]];const d=a[i][i];for(let k=i;k<=n;k++)a[i][k]/=d;for(let j=0;j<n;j++)if(j!==i){const f=a[j][i];for(let k=i;k<=n;k++)a[j][k]-=f*a[i][k];}}return a.map(row=>row[n]);}
function resample(path,count){if(!Array.isArray(path)||path.length<2||path.some(p=>!finite(p)))throw Error('Section/profile needs at least two finite XYZ points');const lengths=[0];for(let i=1;i<path.length;i++)lengths.push(lengths.at(-1)+vec(path[i]).distanceTo(vec(path[i-1])));if(lengths.at(-1)<1e-8)throw Error('Degenerate section/profile');return Array.from({length:count},(_,j)=>{const d=lengths.at(-1)*j/(count-1);let i=1;while(i<lengths.length-1&&lengths[i]<d)i++;const t=(d-lengths[i-1])/(lengths[i]-lengths[i-1]||1);return path[i-1].map((x,k)=>x+(path[i][k]-x)*t);});}
function interpolatingNet(samples){const nu=samples.length,nv=samples[0].length,ku=clampedKnots(nu),kv=clampedKnots(nv);const au=Array.from({length:nu},(_,i)=>basis(nu,ku,i/(nu-1))),av=Array.from({length:nv},(_,i)=>basis(nv,kv,i/(nv-1)));const temp=clone(samples),out=clone(samples);for(let j=0;j<nv;j++)for(let c=0;c<3;c++){const values=solve(au,samples.map(row=>row[j][c]));for(let i=0;i<nu;i++)temp[i][j][c]=values[i];}for(let i=0;i<nu;i++)for(let c=0;c<3;c++){const values=solve(av,temp[i].map(p=>p[c]));for(let j=0;j<nv;j++)out[i][j][c]=values[j];}return out;}
export function createSurface(a={}) {
  let controlNet,metadata={kind:a.kind||'control-net'};
  if(a.kind==='equation'){
    const nu=a.uSamples??6,nv=a.vSamples??6;clampedKnots(nu);clampedKnots(nv);
    const ur=a.uRange??[0,1],vr=a.vRange??[0,1],parameters=a.parameters??{};
    if([ur,vr].some(r=>!Array.isArray(r)||r.length!==2||r.some(x=>!Number.isFinite(x))||r[0]===r[1]))throw Error('Equation domains need distinct finite bounds');
    if(!parameters||Array.isArray(parameters)||typeof parameters!=='object'||Object.values(parameters).some(x=>typeof x!=='number'||!Number.isFinite(x)))throw Error('Equation parameters must be finite numeric bindings');
    const expressions=[a.x,a.y,a.z];if(expressions.some(x=>typeof x!=='string'))throw Error('Equation needs x, y and z scalar expressions');
    const at=(u,v)=>{const bindings={...parameters,u:ur[0]+u*(ur[1]-ur[0]),v:vr[0]+v*(vr[1]-vr[0])};const p=expressions.map(e=>evaluateExpression(e,bindings));if(!finite(p))throw Error('Equation coordinates must evaluate to finite scalars');return p;};
    const samples=Array.from({length:nu},(_,i)=>Array.from({length:nv},(_,j)=>at(i/(nu-1),j/(nv-1))));
    controlNet=interpolatingNet(samples);metadata={kind:'equation',x:a.x,y:a.y,z:a.z,uRange:ur,vRange:vr,parameters:clone(parameters),note:'Editable cubic approximation of sampled equations. Surface UV is normalized 0..1; equation domains are recorded separately.'};
  }else if(a.kind==='loft'){
    if(!Array.isArray(a.sections)||a.sections.length<2||a.sections.length>10)throw Error('Loft needs 2 to 10 ordered section polylines');
    const nv=a.profileSamples??6;clampedKnots(nv);let sections=a.sections.map(s=>resample(s,nv));
    if(sections.length<4){const count=sections.length,sampleCount=count===3?5:4;sections=Array.from({length:sampleCount},(_,i)=>{const t=i*(count-1)/(sampleCount-1),k=Math.min(count-2,Math.floor(t));return sections[k].map((p,j)=>p.map((x,c)=>x+(sections[k+1][j][c]-x)*(t-k)));});}
    controlNet=interpolatingNet(sections);metadata={kind:'loft',sectionCount:a.sections.length,note:'Interpolates resampled section points, with cubic interpolation between sections. Sparse curves may overshoot; inspect sample geometry.'};
  }else if(a.kind==='revolve'){
    if(!finite(a.axisOrigin)||!finite(a.axisDirection)||vec(a.axisDirection).length()<1e-8)throw Error('Revolve needs a finite origin and nonzero axisDirection');
    const angle=a.angleDeg??360;if(!Number.isFinite(angle)||Math.abs(angle)<1||Math.abs(angle)>360)throw Error('Revolve angle must be 1 to 360 degrees in magnitude');
    const nu=a.angularSamples??10,nv=a.profileSamples??6;clampedKnots(nu);clampedKnots(nv);
    const profile=resample(a.profile,nv),axis=vec(a.axisDirection).normalize(),origin=vec(a.axisOrigin);
    const samples=Array.from({length:nu},(_,i)=>profile.map(p=>vec(p).sub(origin).applyAxisAngle(axis,angle*Math.PI/180*i/(nu-1)).add(origin).toArray()));
    controlNet=interpolatingNet(samples);metadata={kind:'revolve',axisOrigin:clone(a.axisOrigin),axisDirection:axis.toArray(),angleDeg:angle,note:'Cubic interpolating approximation of revolution, not an exact rational circular surface; full-turn seam is geometrically coincident but not welded.'};
  }else if(!a.kind||a.kind==='control-net'){controlNet=clone(a.controlNet);}else throw Error('Unsupported surface kind');
  validateNet(controlNet);const knotsU=a.knotsU??clampedKnots(controlNet.length),knotsV=a.knotsV??clampedKnots(controlNet[0].length);validateKnots(knotsU,controlNet.length);validateKnots(knotsV,controlNet[0].length);
  return {id:crypto.randomUUID(),version:1,name:a.name||'Spline surface',degreeU:3,degreeV:3,controlNet,knotsU:clone(knotsU),knotsV:clone(knotsV),metadata,trim:null};
}
function weights(s,u,v){const bu=basis(s.controlNet.length,s.knotsU,u),bv=basis(s.controlNet[0].length,s.knotsV,v);return bu.flatMap(a=>bv.map(b=>a*b));}
export function evaluateSurface(s,u,v){
  if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1)throw Error('Surface UV must be in 0..1');
  const nu=s.controlNet.length,nv=s.controlNet[0].length,bu=basis(nu,s.knotsU,u),bv=basis(nv,s.knotsV,v),du=basis(nu,s.knotsU,u,true),dv=basis(nv,s.knotsV,v,true),point=[0,0,0],dU=[0,0,0],dV=[0,0,0];
  for(let i=0;i<nu;i++)for(let j=0;j<nv;j++)for(let c=0;c<3;c++){const p=s.controlNet[i][j][c];point[c]+=p*bu[i]*bv[j];dU[c]+=p*du[i]*bv[j];dV[c]+=p*bu[i]*dv[j];}
  const normal=vec(dU).cross(vec(dV));return {point,dU,dV,normal:normal.length()>1e-12?normal.normalize().toArray():null,u,v};
}
export function closestSurfaceUV(surface,point,{grid=10,seed}={}){
  let best=seed?{uv:seed,distance:vec(evaluateSurface(surface,...seed).point).distanceTo(vec(point))}:{uv:[0,0],distance:Infinity};
  if(!seed)for(let i=0;i<=grid;i++)for(let j=0;j<=grid;j++){const uv=[i/grid,j/grid],distance=vec(evaluateSurface(surface,...uv).point).distanceTo(vec(point));if(distance<best.distance)best={uv,distance};}
  let uv=[...best.uv];for(let k=0;k<12;k++){
    const e=evaluateSurface(surface,...uv),a=vec(e.dU),b=vec(e.dV),r=vec(point).sub(vec(e.point)),aa=a.dot(a)+1e-12,ab=a.dot(b),bb=b.dot(b)+1e-12,det=aa*bb-ab*ab;if(det<1e-18)break;
    const x=(r.dot(a)*bb-r.dot(b)*ab)/det,y=(r.dot(b)*aa-r.dot(a)*ab)/det;
    let improved=false;for(const factor of [1,.5,.25,.125]){const candidate=[clamp(uv[0]+x*factor),clamp(uv[1]+y*factor)],distance=vec(evaluateSurface(surface,...candidate).point).distanceTo(vec(point));if(distance<best.distance){best={uv:candidate,distance};uv=candidate;improved=true;break;}}if(!improved)break;
  }return best;
}
export function closestSurfaceFeature(s,p,{boundary=false,corner=false,seed}={}){if(!boundary&&!corner)return closestSurfaceUV(s,p,{seed});let best={distance:Infinity};const at=uv=>{const distance=vec(evaluateSurface(s,...uv).point).distanceTo(vec(p));if(distance<best.distance)best={uv,distance};};if(corner)[[0,0],[0,1],[1,0],[1,1]].forEach(at);else{for(let j=0;j<=24;j++){const t=j/24;[[0,t],[1,t],[t,0],[t,1]].forEach(at);}let step=1/24;for(let k=0;k<5;k++){const uv=best.uv;for(const sign of [-1,1])at(uv[0]===0||uv[0]===1?[uv[0],clamp(uv[1]+sign*step)]:[clamp(uv[0]+sign*step),uv[1]]);step/=2;}}return best;}
const errorStats=(distances,threshold)=>{const inside=distances.filter(d=>d<=threshold),stats=a=>({count:a.length,rmsMetres:a.length?Math.sqrt(a.reduce((s,d)=>s+d*d,0)/a.length):null,maxMetres:a.length?Math.max(...a):null});return {all:stats(distances),inliers:stats(inside),inlierThresholdMetres:threshold,inlierFraction:inside.length/distances.length};};
export function fitSurface(surface,points,{iterations=3,fairnessWeight=.02,anchorWeight=.001,inlierThresholdMetres=.01,lockedControlPoints=[],pointWeights,boundaryMask,cornerMask}={}){
  if(!Array.isArray(points)||points.length<3||points.length>800||points.some(p=>!finite(p)))throw Error('Fit needs 3 to 800 finite stroke samples');
  if(!Number.isInteger(iterations)||iterations<1||iterations>8||!Number.isFinite(fairnessWeight)||fairnessWeight<0||fairnessWeight>10||!Number.isFinite(anchorWeight)||anchorWeight<=0||anchorWeight>10||!Number.isFinite(inlierThresholdMetres)||inlierThresholdMetres<=0)throw Error('Invalid surface fitting settings');
  if(pointWeights&&(!Array.isArray(pointWeights)||pointWeights.length!==points.length||pointWeights.some(w=>!Number.isFinite(w)||w<=0)))throw Error('pointWeights must match the points and be positive');
  for(const mask of [boundaryMask,cornerMask])if(mask&&(!Array.isArray(mask)||mask.length!==points.length||mask.some(v=>typeof v!=='boolean')))throw Error('Surface feature masks must match the points');
  const pw=pointWeights||points.map(()=>1),weightTotal=pw.reduce((a,b)=>a+b,0);
  const locate=(s,p,i,seed)=>closestSurfaceFeature(s,p,{boundary:boundaryMask?.[i],corner:cornerMask?.[i],seed});
  const original=surface.controlNet.flat(),count=original.length,nv=surface.controlNet[0].length,nu=surface.controlNet.length;
  if(!Array.isArray(lockedControlPoints)||lockedControlPoints.some(i=>!Number.isInteger(i)||i<0||i>=count))throw Error('Locked control indices are row-major u*V+v');
  const locks=new Set(lockedControlPoints),free=Array.from({length:count},(_,i)=>i).filter(i=>!locks.has(i));if(!free.length)throw Error('At least one control point must remain free');
  let current=clone(surface),nearest=points.map((p,i)=>locate(current,p,i)),history=[];const baseline=errorStats(nearest.map(n=>n.distance),inlierThresholdMetres);
  for(let iteration=0;iteration<iterations;iteration++){
    const rows=points.map((p,i)=>({w:weights(current,...nearest[i].uv),target:p,weight:pw[i]/weightTotal}));
    for(let i=0;i<count;i++){const w=Array(count).fill(0);w[i]=1;rows.push({w,target:original[i],weight:anchorWeight/count});}
    const smooth=(ids)=>{const w=Array(count).fill(0);ids.forEach((id,i)=>w[id]=[1,-2,1][i]);rows.push({w,target:[0,1,2].map(c=>ids.reduce((s,id,i)=>s+original[id][c]*[1,-2,1][i],0)),weight:fairnessWeight/count});};
    for(let u=0;u<nu;u++)for(let v=0;v<nv;v++){if(u&&u<nu-1)smooth([(u-1)*nv+v,u*nv+v,(u+1)*nv+v]);if(v&&v<nv-1)smooth([u*nv+v-1,u*nv+v,u*nv+v+1]);}
    const matrix=Array.from({length:free.length},()=>Array(free.length).fill(0)),rhs=Array.from({length:3},()=>Array(free.length).fill(0));
    for(const row of rows){const target=row.target.map((x,c)=>x-[...locks].reduce((s,i)=>s+row.w[i]*original[i][c],0));for(let i=0;i<free.length;i++){const a=row.w[free[i]]*row.weight;if(!a)continue;for(let j=0;j<free.length;j++)matrix[i][j]+=a*row.w[free[j]];for(let c=0;c<3;c++)rhs[c][i]+=a*target[c];}}
    const coords=rhs.map(r=>solve(matrix,r)),proposal=clone(current);free.forEach((id,k)=>proposal.controlNet[Math.floor(id/nv)][id%nv]=coords.map(c=>c[k]));
    const before=nearest.reduce((s,n,i)=>s+pw[i]*n.distance*n.distance,0);let accepted=false;
    for(const fraction of [1,.5,.25]){const candidate=clone(current);candidate.controlNet=current.controlNet.map((row,u)=>row.map((p,v)=>p.map((x,c)=>x+(proposal.controlNet[u][v][c]-x)*fraction)));
      const projected=points.map((p,i)=>locate(candidate,p,i,nearest[i].uv)),error=projected.reduce((s,n,i)=>s+pw[i]*n.distance*n.distance,0);
      if(error<before-1e-16){current=candidate;nearest=projected;accepted=true;history.push({iteration:iteration+1,rmsMetres:Math.sqrt(error/points.length),stepFraction:fraction});break;}}
    if(!accepted)break;
  }
  current.version=surface.version+1;const diagnostics={baseline,final:errorStats(nearest.map(n=>n.distance),inlierThresholdMetres),iterations:history,fairnessWeight,anchorWeight,lockedControlPoints:[...locks],weightedRmsMetres:Math.sqrt(nearest.reduce((sum,n,i)=>sum+pw[i]*n.distance*n.distance,0)/weightTotal),boundaryPointCount:boundaryMask?.filter(Boolean).length||0,cornerPointCount:cornerMask?.filter(Boolean).length||0,maxControlDisplacementMetres:Math.max(...current.controlNet.flat().map((p,i)=>vec(p).distanceTo(vec(original[i])))),note:'Closest-point alternating least squares; regularization preserves original control-net second differences. Fit only observed samples; unobserved regions remain hypotheses.'};current.lastFit=diagnostics;return {surface:current,diagnostics};
}
const cross2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function clipTriangle(polygon,clip){let out=polygon;for(let i=0;i<3;i++){const a=clip[i],b=clip[(i+1)%3],input=out;out=[];for(let j=0;j<input.length;j++){const p=input[j],q=input[(j+1)%input.length],dp=cross2(a,b,p),dq=cross2(a,b,q),insideP=dp>=-1e-12,insideQ=dq>=-1e-12;if(insideP)out.push(p);if(insideP!==insideQ){const t=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}}}return out;}
export function trimSurface(surface,{uvPolygon,worldPolygon,maxProjectionDistanceMetres=.05}={}){
  if((uvPolygon!==undefined)===(worldPolygon!==undefined))throw Error('Supply one UV polygon or world-plane polygon');
  let errors=[];if(worldPolygon){if(!Array.isArray(worldPolygon)||worldPolygon.length<3||worldPolygon.length>256||worldPolygon.some(p=>!finite(p)))throw Error('World trim polygon needs 3 to 256 XYZ vertices');if(!Number.isFinite(maxProjectionDistanceMetres)||maxProjectionDistanceMetres<=0)throw Error('Invalid trim projection tolerance');const projections=worldPolygon.map(p=>closestSurfaceUV(surface,p));errors=projections.map(p=>p.distance);if(Math.max(...errors)>maxProjectionDistanceMetres)throw Error('Trim boundary is too far from surface; inspect or explicitly increase maxProjectionDistanceMetres');uvPolygon=projections.map(p=>p.uv);}
  if(!Array.isArray(uvPolygon)||uvPolygon.length<3||uvPolygon.length>256||uvPolygon.some(p=>!Array.isArray(p)||p.length!==2||p.some(x=>!Number.isFinite(x)||x<0||x>1)))throw Error('UV trim polygon needs 3 to 256 points within 0..1');
  let polygon=clone(uvPolygon);if(Math.hypot(...polygon[0].map((x,i)=>x-polygon.at(-1)[i]))<1e-10)polygon.pop();
  for(let i=0;i<polygon.length;i++)for(let j=i+2;j<polygon.length;j++){if(i===0&&j===polygon.length-1)continue;const a=polygon[i],b=polygon[(i+1)%polygon.length],c=polygon[j],d=polygon[(j+1)%polygon.length];if(cross2(a,b,c)*cross2(a,b,d)<0&&cross2(c,d,a)*cross2(c,d,b)<0)throw Error('Trim polygon self-intersects in UV; split the region');}
  const area=polygon.reduce((s,p,i)=>s+p[0]*polygon[(i+1)%polygon.length][1]-p[1]*polygon[(i+1)%polygon.length][0],0)/2;if(Math.abs(area)<1e-10)throw Error('Trim polygon has zero UV area');if(area<0)polygon.reverse();
  const result=clone(surface);result.version++;result.trim={uvPolygon:polygon,worldPolygon:worldPolygon?clone(worldPolygon):undefined,projectionMaxMetres:errors.length?Math.max(...errors):0,note:'Boundary mapped to UV by closest points. Piecewise linear UV trim approximates a world-plane outline; inspect folds and projection error.'};return result;
}
export function sampleSurface(surface,{uSegments=24,vSegments=24}={}){
  if(!Number.isInteger(uSegments)||!Number.isInteger(vSegments)||uSegments<2||vSegments<2||uSegments>64||vSegments>64)throw Error('Surface segment counts must be 2 to 64');
  const vertices=[],normals=[],uvs=[],indices=[],seen=new Map(),triangleSeen=new Set();
  const add=p=>{const key=p.map(x=>Math.round(x*1e10)).join(':');if(seen.has(key))return seen.get(key);const e=evaluateSurface(surface,...p),i=vertices.length/3;vertices.push(...e.point);normals.push(...(e.normal||[0,0,0]));uvs.push(...p);seen.set(key,i);return i;};
  const polygon=surface.trim?.uvPolygon,clips=polygon?ShapeUtils.triangulateShape(polygon.map(p=>new Vector2(...p)),[]).map(t=>{const tri=t.map(i=>polygon[i]);return cross2(...tri)<0?[tri[0],tri[2],tri[1]]:tri;}):null;
  for(let i=0;i<uSegments;i++)for(let j=0;j<vSegments;j++){
    const a=[i/uSegments,j/vSegments],b=[(i+1)/uSegments,j/vSegments],c=[(i+1)/uSegments,(j+1)/vSegments],d=[i/uSegments,(j+1)/vSegments];
    for(const triangle of [[a,b,c],[a,c,d]])for(const face of clips?clips.map(clip=>clipTriangle(triangle,clip)):[triangle])for(let k=1;k<face.length-1;k++){
      if(Math.abs(cross2(face[0],face[k],face[k+1]))<1e-13)continue;const ids=[add(face[0]),add(face[k]),add(face[k+1])],key=[...ids].sort((a,b)=>a-b).join(':');if(!triangleSeen.has(key)){indices.push(...ids);triangleSeen.add(key);}
    }
  }
  if(vertices.length/3>30000)throw Error('Trim tessellation too dense; reduce segments or polygon complexity');
  return {vertices,normals,uvs,indices,diagnostics:{vertexCount:vertices.length/3,triangleCount:indices.length/3,uSegments,vSegments,trimmed:!!polygon,note:'Open surface triangle mesh; no wall thickness or caps. Derivative normals are provided for patterned placement. Trimming approximates curved boundaries at this tessellation density.'}};
}
