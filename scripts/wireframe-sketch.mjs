const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const distance=(a,b)=>Math.hypot(...sub(a,b));
const uv=(p,f)=>[dot(sub(p,f.origin),f.xAxis),dot(sub(p,f.origin),f.yAxis)];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

function landmarks(f){
 if(f.kind==='rectangle')return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[x*f.widthMetres/2,y*f.heightMetres/2]);
 // Sample a round rim so its two generators can start at arbitrary angles.
 if(f.kind==='circle')return Array.from({length:32},(_,i)=>[Math.cos(i*Math.PI/16)*f.radiusMetres,Math.sin(i*Math.PI/16)*f.radiusMetres]);
 return [];
}

function matchingLandmark(p,a,q,b){
 const pa=uv(p,a),pb=uv(q,b),aa=landmarks(a),bb=landmarks(b);
 let nearest,score=Infinity;
 for(const ka of aa){
  // The corresponding corner can have a different index when the fitted frame is rotated.
  const worldOffset=a.xAxis.map((v,i)=>v*ka[0]+a.yAxis[i]*ka[1]);
  const direction=[dot(worldOffset,b.xAxis),dot(worldOffset,b.yAxis)];
  const kb=bb.reduce((best,k)=>dot(k,direction)>dot(best,direction)?k:best);
  const error=Math.max(distance(ka,pa),distance(kb,pb));
  if(error<score){score=error;nearest=ka;}
 }
 return {score,point:nearest};
}

// Test whether independent strokes actually join corresponding locations on two
// closed outlines. Two nearby or overlapping rectangles alone do not specify depth.
export function wireframeCandidates(data,fit){
 if(data.mode==='edit-existing')return [];
 const ink=new Map((data.strokes||[]).map(s=>[s.id,s]));
 const native=(data.sketchFigures||[]).filter(f=>!f.hidden&&!f.extrusion&&!f.construction).map(f=>({id:f.id,f}));
 const fresh=fit.results.map((r,i)=>({id:'fit:'+r.id,f:fit.edits[i],r}));
 const entries=[...native,...fresh].filter(({f,r})=>!f.construction&&!r?.sourceStrokeIds?.some(id=>{
  const s=ink.get(id);return s?.erasedFrom||s?.intentionallyOpen||s?.drawingTarget?.placementChoice==='keep'||s?.drawingTarget?.kind==='surface';
 }));
 const faces=entries.filter(({f})=>['rectangle','circle'].includes(f.kind));
 const guides=entries.flatMap(entry=>{
  const {r,f}=entry;
  if(f.kind!=='line'&&(f.kind!=='spline'||f.closed))return [];
  const points=r?.sourceStrokeIds?.length===1?ink.get(r.sourceStrokeIds[0])?.points:null;
  const path=points?.length>=2?points:f.kind==='line'?[f.origin,f.end]:[];
  if(path.length<2)return [];
  const start=path[0],end=path.at(-1),delta=sub(end,start),len=Math.hypot(...delta);
  if(len<1e-5||path.some(p=>Math.hypot(...cross(sub(p,start),delta))>len*len*.14))return [];
  return [{...entry,start,end}];
 });
 const candidates=[];
 for(let i=0;i<faces.length;i++)for(const rear of faces.slice(i+1)){
  const front=faces[i],a=front.f,b=rear.f;
  if(a.kind!==b.kind||a.planeId!==b.planeId)continue;
  const normal=cross(a.xAxis,a.yAxis),delta=sub(b.origin,a.origin);
  if(Math.abs(dot(normal,cross(b.xAxis,b.yAxis)))<.995)continue;
  const size=f=>f.kind==='circle'?[2*f.radiusMetres,2*f.radiusMetres]:[f.widthMetres,f.heightMetres].sort((x,y)=>x-y);
  const sizes=size(a),other=size(b),span=Math.max(...sizes),depth=Math.hypot(...delta);
  if(sizes.some((v,k)=>other[k]/v<.66||other[k]/v>1.5)||Math.abs(dot(delta,normal))>span*.015||depth<span*.10||depth>span*3)continue;
  const hits=[],points=[];
  for(const g of guides){
   if(g.f.planeId!==a.planeId)continue;
   const pairs=[matchingLandmark(g.start,a,g.end,b),matchingLandmark(g.end,a,g.start,b)].sort((x,y)=>x.score-y.score);
   if(pairs[0].score>Math.min(span*.16,depth*.33))continue;
   hits.push(g);
   if(points.every(p=>distance(p,pairs[0].point)>span*.22))points.push(pairs[0].point);
  }
  if(points.length<2||![front,rear,...hits].some(e=>e.r))continue;
  const eye=data.view?.cameraToWorld?.slice(8,11)||normal;
  const signedDepth=(dot(eye,normal)>=0?-1:1)*Math.max(.001,Math.round(depth*1000)/1000);
  candidates.push({id:'wire-'+candidates.length,front:front.id,rear:rear.id,guides:hits.map(g=>g.id),distinctJoins:points.length,
   section:a.kind,estimatedOffsetMetres:signedDepth});
 }
 return candidates.sort((a,b)=>b.distinctJoins-a.distinctJoins).slice(0,4);
}
