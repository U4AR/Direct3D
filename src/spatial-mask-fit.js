import {Matrix4,Vector3,Euler,Quaternion} from 'three';
import {fitSpatialSketch,spatialFeatures,spatialFitResidual} from './spatial-fitting.js';
export const MASK_KINDS=['cuboid','cylinder','spheroid'];
const vec=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const sq=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export function maskProjector(frame){
 const v=frame?.view;if(!v||![v.cameraToWorld,v.projectionMatrix].every(m=>Array.isArray(m)&&m.length===16&&m.every(Number.isFinite)))throw Error('Mask needs a current calibrated scene image');
 const world=new Matrix4().fromArray(v.cameraToWorld);if(Math.abs(world.determinant())<1e-12)throw Error('Mask camera is singular');
 const camera=world.clone().invert(),projection=new Matrix4().fromArray(v.projectionMatrix);if(Math.abs(projection.determinant())<1e-12)throw Error('Mask projection is singular');
 return p=>{const q=new Vector3(...p).applyMatrix4(camera);if(q.z>=-1e-7)return null;q.applyMatrix4(projection);if(![q.x,q.y,q.z].every(Number.isFinite)||q.z < -1||q.z>1)return null;return [(q.x+1)/2,(1-q.y)/2];};
}
export function insideMask(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
const area=poly=>Math.abs(poly.reduce((s,p,i)=>{const q=poly[(i+1)%poly.length];return s+p[0]*q[1]-q[0]*p[1];},0))/2;
export function validateMaskSelection(spec,evidence){
 if(!spec||!['strokes','scene','both'].includes(spec.source)||!Array.isArray(spec.masks)||!spec.masks.length||spec.masks.length>3||spec.adjustOrientation!==undefined&&typeof spec.adjustOrientation!=='boolean'||spec.figureIds!==undefined&&(!Array.isArray(spec.figureIds)||spec.figureIds.some(id=>!evidence.figures.some(f=>f.id===id))))throw Error('Invalid mask fitting selection');
 const seen=new Set();return spec.masks.map(mask=>{
  const frame=evidence.frames.find(f=>f.id===mask.frameId);if(!frame||!(frame.content==='user-ink'||frame.layer==='stroke'||frame.layer==='drawing'||frame.layer.startsWith('spatial-'))||seen.has(mask.frameId))throw Error('Unknown, stale or duplicate mask image ID');seen.add(mask.frameId);
  const poly=mask.polygon;if(!Array.isArray(poly)||poly.length<3||poly.length>64||poly.some(p=>!Array.isArray(p)||p.length!==2||p.some(x=>!Number.isFinite(x)||x<0||x>1))||area(poly)<1e-6)throw Error('Mask polygon needs 3–64 normalized top-left image coordinates and positive area');
  // Reject crossing boundaries instead of fitting an ambiguous self-intersecting region.
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<poly.length;i++)for(let j=i+2;j<poly.length;j++){if(i===0&&j===poly.length-1)continue;const a=poly[i],b=poly[(i+1)%poly.length],c=poly[j],d=poly[(j+1)%poly.length];if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)throw Error('Mask polygon crosses itself');}
  return {frame,polygon:poly,project:maskProjector(frame)};
 });
}
function hull(points){const p=points.filter(Boolean).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(p.length<3)return p;const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const a=[],b=[];for(const q of p){while(a.length>1&&cross(a.at(-2),a.at(-1),q)<=1e-12)a.pop();a.push(q);}for(const q of p.slice().reverse()){while(b.length>1&&cross(b.at(-2),b.at(-1),q)<=1e-12)b.pop();b.push(q);}return a.slice(0,-1).concat(b.slice(0,-1));}
function boundary(poly,n=32){const lengths=poly.map((p,i)=>Math.sqrt(sq(p,poly[(i+1)%poly.length]))),total=lengths.reduce((a,b)=>a+b,0);if(!total)return poly;return Array.from({length:n},(_,i)=>{let at=i/n*total,j=0;while(j<lengths.length-1&&at>lengths[j])at-=lengths[j++];const p=poly[j],q=poly[(j+1)%poly.length],t=at/Math.max(1e-12,lengths[j]);return p.map((v,d)=>v+(q[d]-v)*t);});}
function distance2(p,poly){let best=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],d=[b[0]-a[0],b[1]-a[1]],t=Math.max(0,Math.min(1,((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/Math.max(1e-20,sq(a,b))));best=Math.min(best,sq(p,[a[0]+t*d[0],a[1]+t*d[1]]));}return best;}
export function primitiveMaskPoints(kind,p){
 const points=[];if(kind==='cuboid'){for(let i=0;i<8;i++)points.push(p.sizeMetres.map((s,d)=>(i>>d&1?1:-1)*s/2));}
 else if(kind==='cylinder'){for(let i=0;i<40;i++)for(const y of [-p.heightMetres/2,p.heightMetres/2])points.push([p.radiusMetres*Math.cos(i*Math.PI/20),y,p.radiusMetres*Math.sin(i*Math.PI/20)]);}
 else if(kind==='spheroid'){for(let a=0;a<=12;a++)for(let b=0;b<24;b++)points.push([p.radiiMetres[0]*Math.sin(a*Math.PI/12)*Math.cos(b*Math.PI/12),p.radiiMetres[1]*Math.cos(a*Math.PI/12),p.radiiMetres[2]*Math.sin(a*Math.PI/12)*Math.sin(b*Math.PI/12)]);}
 return points.map(q=>p.center.map((v,d)=>v+p.axes.reduce((s,a,i)=>s+a[d]*q[i],0)));
}
function overlap(poly,target){if(poly.length<3)return 0;const all=poly.concat(target),lo=[0,1].map(d=>Math.max(0,Math.min(...all.map(p=>p[d])))),hi=[0,1].map(d=>Math.min(1,Math.max(...all.map(p=>p[d]))));let intersection=0,union=0;for(let y=0;y<28;y++)for(let x=0;x<28;x++){const p=[lo[0]+(x+.5)/28*(hi[0]-lo[0]),lo[1]+(y+.5)/28*(hi[1]-lo[1])],a=insideMask(p,poly),b=insideMask(p,target);if(a&&b)intersection++;if(a||b)union++;}return union?intersection/union:0;}
function finiteSeed(kind,p){return p&&vec(p.center)&&Array.isArray(p.axes)&&p.axes.length===3&&p.axes.every(vec)&&(kind==='cuboid'?vec(p.sizeMetres)&&p.sizeMetres.every(v=>v>=.00001&&v<=100):kind==='cylinder'?p.radiusMetres>=.00001&&p.radiusMetres<=100&&p.heightMetres>=.00001&&p.heightMetres<=100:vec(p.radiiMetres)&&p.radiiMetres.every(v=>v>=.00001&&v<=100));}
export function fitSpatialMask({kind,seed,selection,evidence,strokeIds=[],placement}){
 const start=performance.now();if(!MASK_KINDS.includes(kind))throw Error('Mask fitting supports cuboid, cylinder or spheroid; the model must choose the intended kind');
 const views=validateMaskSelection(selection,evidence),hit=(p,strokeId)=>views.every(v=>{if(strokeId&&v.frame.layer==='stroke'&&!v.frame.strokeIds?.includes(strokeId))return false;const q=v.project(p);return q&& (insideMask(q,v.polygon)||distance2(q,v.polygon)<.000025);});
 const selected=[],ranges=[];if(selection.source!=='scene')for(const s of evidence.strokes){if(strokeIds.length&&!strokeIds.includes(s.id))continue;let run=null;for(let i=0;i<s.points.length;i++){if(hit(s.points[i],s.id)){selected.push(s.points[i]);if(run&&run.end===i-1)run.end=i;else{run={strokeId:s.id,start:i,end:i};ranges.push(run);}}}}
 if(selection.source==='strokes'&&!selected.length)throw Error('This mask selects no original drawing samples; select the intended ink region instead of an existing object silhouette');
 const figures=[];if(selection.source!=='strokes')for(const s of evidence.maskSceneSamples||[]){if(selection.figureIds?.length&&!selection.figureIds.includes(s.figureId))continue;const points=s.points.filter(p=>hit(p));if(points.length){selected.push(...points);figures.push(s.figureId);}}
 let p=structuredClone(seed||{});
 if(!finiteSeed(kind,p)){if(selected.length<6)throw Error('Mask has too little 3D support: supply an explicit center, axes and dimensions, or another view');const support=selected.filter((_,i)=>i%Math.max(1,Math.ceil(selected.length/4096))===0),grouped=[{id:'masked-support',points:support,spatialRole:'edge'}];const candidate=fitSpatialSketch(grouped,{weights:evidence.featureWeights}).candidates.find(c=>c.kind===kind);if(!candidate)throw Error('Masked support does not constrain this shape; provide explicit seed dimensions');p=structuredClone(candidate.parameters);}
 const axes=p.axes;if(axes.some(a=>Math.abs(dot(a,a)-1)>.001)||Math.abs(dot(axes[0],axes[1]))>.001||Math.abs(dot(axes[0],axes[2]))>.001||Math.abs(dot(axes[1],axes[2]))>.001)throw Error('Mask fit seed needs orthonormal axes');
 const keys=kind==='cuboid'?['sizeMetres']:kind==='cylinder'?['radiusMetres','heightMetres']:['radiiMetres'];
 p=Object.fromEntries(['center','axes',...keys].map(k=>[k,p[k]]));
 if(views.length===1&&!selected.length)throw Error('A single image mask cannot determine depth without 3D stroke/scene support');
 const transform=placement?new Matrix4().compose(new Vector3(...(placement.position||[0,0,0])),new Quaternion().setFromEuler(new Euler(...(placement.rotationDeg||[0,0,0]).map(v=>v*Math.PI/180))),new Vector3(...(placement.scale||[1,1,1]))):new Matrix4();
 const original=structuredClone(p),weights={corner:8,edge:4,surface:1,...evidence.featureWeights};
 const inverse=transform.clone().invert(),inkPaths=selection.source==='scene'?[]:ranges.map((r,i)=>{const source=evidence.strokes.find(s=>s.id===r.strokeId);return {id:r.strokeId+':'+i,spatialRole:source.spatialRole||'edge',points:source.points.slice(r.start,r.end+1).map(p=>new Vector3(...p).applyMatrix4(inverse).toArray())};}).filter(s=>s.points.length>=2);
 const inkFeatures=inkPaths.length?spatialFeatures(inkPaths,{weights}):null,inkScale=Math.max(.01,inkFeatures?.span||1);

 const target=views.map(v=>({...v,boundary:boundary(v.polygon)}));
 const evaluate=(p,full=false)=>{
  const points=primitiveMaskPoints(kind,p).map(q=>new Vector3(...q).applyMatrix4(transform).toArray());let total=0;const metrics=[];
  for(const v of target){const shape=hull(points.map(v.project));if(shape.length<3)return {loss:Infinity,metrics:[]};const edge=(v.boundary.reduce((s,q)=>s+distance2(q,shape),0)+boundary(shape).reduce((s,q)=>s+distance2(q,v.polygon),0))/64;
   const corner=kind==='cuboid'?v.polygon.reduce((s,q)=>s+Math.min(...shape.map(r=>sq(q,r))),0)/v.polygon.length:0;
   const iou=overlap(shape,v.polygon),loss=(weights.edge*edge+weights.corner*corner*.12+weights.surface*(1-iou)*.001)/(weights.edge+weights.corner*.12+weights.surface);
   total+=loss;if(full)metrics.push({frameId:v.frame.id,edgeRmsPixels:Math.sqrt(edge)*(v.frame.imageSize?.[0]||384),silhouetteIoU:iou,projectedContour:shape});
  }
  // Keep dimensions/depth anchored where masks do not constrain them.
  const drift=p.center.reduce((s,v,i)=>s+(v-original.center[i])**2,0);
  const inkError=inkFeatures?spatialFitResidual(inkFeatures,kind,p).weightedRmsMetres:null;
  return {loss:(inkFeatures?.04:1)*total/target.length+(inkError===null?0:(inkError/inkScale)**2)+drift*.00001,metrics,inkError};
 };
 const initial=evaluate(p,true),span=Math.max(...(p.sizeMetres||p.radiiMetres?.map(r=>r*2)||[p.radiusMetres*2,p.heightMetres])),dimensions=kind==='cuboid'?[['sizeMetres',0],['sizeMetres',1],['sizeMetres',2]]:kind==='cylinder'?[['radiusMetres',null],['heightMetres',null]]:[['radiiMetres',0],['radiiMetres',1]],dofs=[['center',0],['center',1],['center',2],...dimensions];let best=initial.loss,step=span*.12,evaluations=1;
 for(let round=0;round<9;round++){let improved=false;for(const [key,index]of dofs)for(const sign of [-1,1]){const q=structuredClone(p);if(index===null)q[key]+=step*sign;else q[key][index]+=step*sign;if(kind==='spheroid')q.radiiMetres[2]=q.radiiMetres[0];if(!finiteSeed(kind,q))continue;const loss=evaluate(q).loss;evaluations++;if(loss+1e-12<best){p=q;best=loss;improved=true;}}
  if(selection.adjustOrientation&&round<5)for(const axis of [[1,0,0],[0,1,0],[0,0,1]])for(const sign of [-1,1]){const q=structuredClone(p),r=new Matrix4().makeRotationAxis(new Vector3(...axis),sign*.06/(1+round));q.axes=q.axes.map(a=>new Vector3(...a).transformDirection(r).toArray());const loss=evaluate(q).loss;evaluations++;if(loss+1e-12<best){p=q;best=loss;improved=true;}}
  if(!improved)step*=.5;
 }
 const final=evaluate(p,true);if(!Number.isFinite(final.loss))throw Error('No valid projected fit for these masks');
 return {parameters:p,report:{tool:'fit_mask',kind,masks:selection.masks,source:selection.source,selectedStrokeIds:[...new Set(ranges.map(r=>r.strokeId))],selectedFigureIds:figures,ranges:ranges.slice(0,256),selectedPointCount:selected.length,initialLoss:initial.loss,finalLoss:final.loss,initialSourceRmsMetres:initial.inkError,finalSourceRmsMetres:final.inkError,metrics:final.metrics,elapsedMs:Math.round(performance.now()-start),evaluations,warnings:views.length===1?['One view cannot independently determine depth; existing 3D support and seed depth anchor this fit.']:[]}};
}
