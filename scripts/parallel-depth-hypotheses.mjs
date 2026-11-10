import {projectRecordedStroke} from '../src/view-plane-projection.js';
import {sketchFrame} from '../src/desktop-sketch-fit.js';
import {bounds,circleFit,distance,deviation,resample} from '../src/decision-sketch/math.js';
const dot=(a,b)=>a.reduce((n,v,k)=>n+v*b[k],0),sub=(a,b)=>a.map((v,k)=>v-b[k]),world=(p,f)=>f.origin.map((v,k)=>v+p[0]*f.xAxis[k]+p[1]*f.yAxis[k]);
const center=points=>{const c=circleFit(points);return c&&c.rms/Math.max(c.radius,1e-9)<.25?c.center:bounds(points).center;};
// Pictorial depth can be drawn obliquely even when its edges do not follow a
// calibrated vanishing direction. Compare contours in one plane before asking
// the decision model whether the displacement means depth or planar spacing.
export function displacedSectionHypothesis(group,data,frame){
 if(data.options?.detectOffsets===false||data.editContext?.targetFigure||group.strokes.some(s=>s.erasedFrom||s.intentionallyOpen||s.drawingTarget?.placementChoice==='keep'||s.drawingTarget?.kind==='surface'))return null;
 const f=sketchFrame(frame),toUV=p=>[f.xAxis,f.yAxis].map(axis=>dot(sub(p,f.origin),axis));
 const current=group.strokes.flatMap(s=>s.points||[]).map(toUV);
 if(current.length<6)return null;
 const box=bounds(current),view=group.strokes[0]?.view||data.view,eye=view?.cameraToWorld?.slice(8,11);
 if(!eye||Math.abs(dot(eye,f.normal))>Math.cos(8*Math.PI/180)||distance(current[0],current.at(-1))>box.span*.21)return null;
 const siblings=data.supportSketches||[],index=siblings.findIndex(s=>s.id===group.id);
 const prior=[...(index<0?[]:siblings.slice(0,index)).reverse(),...(data.references||[])].slice(0,12);
 const shape=(points,box)=>resample(points,48,true).map(p=>sub(p,box.center).map(v=>v/box.span));
 const outline=shape(current,box);
 let best;
 for(const ref of prior){
  if(!ref.points?.length||ref.plane?.id!==f.id||ref.sourceStrokeIds?.some(id=>group.strokes.some(s=>s.id===id)))continue;
  const prev=ref.points.map(toUV),r=bounds(prev);
  if(r.span<1e-5||distance(prev[0],prev.at(-1))>.21*r.span||box.span/r.span<.72||box.span/r.span>1.38)continue;
  const shift=distance(r.center,box.center);
  if(shift<box.span*.13||shift>box.span*.95||[0,1].some(k=>Math.min(r.max[k],box.max[k])<Math.max(r.min[k],box.min[k])))continue;
  const trace=shape(prev,r),error=Math.max(deviation(trace,outline,true).rms,deviation(outline,trace,true).rms);
  if(error>.065)continue;
  const recorded=ref.captureDirection;
  const earlier=Array.isArray(recorded)&&recorded.length===3&&recorded.every(Number.isFinite)&&Math.abs(Math.hypot(...recorded)-1)<.01?
   recorded:(data.strokes||[]).find(s=>ref.sourceStrokeIds?.includes(s.id))?.view?.cameraToWorld?.slice(8,11);
  const changed=earlier&&dot(earlier,eye)<Math.cos(7*Math.PI/180);
  if(!changed&&Math.abs(dot(eye,f.normal))>Math.cos(22*Math.PI/180))continue;
  if(!best||error<best.normalizedContourError)best={reason:'displaced-similar-section',referenceId:ref.id,base:'plane',planeId:f.id,throughOrigin:false,
   offsetMetres:(dot(eye,f.normal)>=0?-1:1)*Math.max(.001,Math.round(shift*1000)/1000),normalizedContourError:error,viewChanged:!!changed,
   note:'Editable pictorial depth estimate from the contour-center displacement. Offer a parallel plane if the repeated contour depicts another face; deliberate flat layouts stay coplanar.'};
 }
 return best??null;
}
// Offset zero cannot be inferred from ink captured on a plane: it only says
// where mouse rays were recorded. Offer axis-alignment depth hypotheses from
// earlier/accepted geometry. Selection remains with the decision/edit model.
export function parallelDepthHypotheses(group,data,frame){
 if(data.options?.detectOffsets===false||group.strokes.some(s=>s.erasedFrom||s.intentionallyOpen)||data.editContext?.targetFigure)return [];
 const f=sketchFrame(frame),origin=data.designOrigin||[0,1.15,-.6],span=bounds(group.points).span;if(span<1e-5)return [];
 const sourceIds=new Set(group.strokes.map(s=>s.id)),siblings=data.supportSketches||[],index=siblings.findIndex(r=>r.id===group.id),references=[...(index>=0?siblings.slice(0,index).reverse():[]),...(data.references||[])].filter(r=>!(r.sourceStrokeIds||[]).some(id=>sourceIds.has(id))).slice(0,8),hypotheses=[];
 function projected(offset){const target={...f,origin:origin.map((v,k)=>v+offset*f.normal[k])},points=group.strokes.flatMap(s=>projectRecordedStroke(s,target,data.view).uv);return {points,center:center(points),circle:circleFit(points),target};}
 for(const r of references)try{
  const rf=sketchFrame(r.plane);if(Math.abs(dot(f.normal,rf.normal))<.995||!r.points?.length)continue;
  const refPoints=r.points.map(p=>[f.xAxis,f.yAxis].map(a=>dot(sub(p,origin),a))),anchor=center(refPoints),refOffset=dot(sub(rf.origin,origin),f.normal),at=projected(refOffset),step=Math.max(.001,span*.25),other=projected(refOffset+step),slope=other.center.map((v,k)=>(v-at.center[k])/step),den=dot(slope,slope);
  if(den<.01||distance(at.center,anchor)>span*1.5)continue;
  const offset=Math.round((refOffset+dot(sub(anchor,at.center),slope)/den)*1000)/1000,separation=offset-refOffset;if(Math.abs(separation)<Math.max(.002,span*.025)||Math.abs(separation)>span*4||Math.abs(offset)>10)continue;
  const fit=projected(offset),residual=distance(fit.center,anchor),before=distance(at.center,anchor);if(residual>Math.max(.002,span*.12)||before-residual<span*.05)continue;
  hypotheses.push({reason:'parallel-section-common-axis',referenceId:r.id,base:'plane',planeId:f.id,offsetMetres:offset,throughOrigin:true,referenceOffsetMetres:refOffset,separationMetres:separation,centerAlignmentErrorMetres:residual,zeroSeparationErrorMetres:before,estimatedRadiusMetres:fit.circle?.radius,referenceCenterWorld:world(anchor,{...f,origin:origin.map((v,k)=>v+refOffset*f.normal[k])}),note:'Optional depth hypothesis: original drawing rays intersect a parallel plane whose section center aligns with the earlier figure along its normal. Supports stacked/coaxial sections seen obliquely. It is not permission to move an intentionally coplanar detail, repair, or explicitly depth-locked sketch. Circle fit error alone cannot decide parallel-plane depth.'});
 }catch{}
 return hypotheses.sort((a,b)=>a.centerAlignmentErrorMetres-b.centerAlignmentErrorMetres).slice(0,2);
}
