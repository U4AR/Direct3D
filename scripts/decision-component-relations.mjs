import {bounds,distance,resample,pathDistance,deviation} from '../src/decision-sketch/math.js';
import {sameSketchPlane} from './decision-cross-plane.mjs';
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),uv=(p,f)=>[f.xAxis,f.yAxis].map(a=>dot(p.map((v,k)=>v-f.origin[k]),a)),world=(p,f)=>f.origin.map((v,k)=>v+p[0]*f.xAxis[k]+p[1]*f.yAxis[k]);
const box=g=>bounds(g.points),size=b=>b.max.map((v,k)=>v-b.min[k]);
// Offer bounded relations, then let the same Decisions request choose intent.
// No object labels or free coordinate generation are needed.
export function componentRelationContext(groups,data={}){
 const candidates=[],questions=[];
 if(data.options?.align===false)return {candidates,questions};
 for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
  const a=groups[i],b=groups[j];if(a.joinedGroupIds||b.joinedGroupIds||!sameSketchPlane(a.frame,b.frame)||a.strokes.some(s=>s.intentionallyOpen)||b.strokes.some(s=>s.intentionallyOpen))continue;
  if(a.strokes.some(s=>b.strokes.some(t=>t.id===s.id)))continue;
  const pa=a.points,pb=b.points.map(p=>uv(world(p,b.frame),a.frame)),ba=box(a),bb=bounds(pb),sa=size(ba),sb=size(bb),span=Math.max(ba.span,bb.span);
  if(Math.min(...sa,...sb)<span*.08||distance(ba.center,bb.center)<span*.4||distance(ba.center,bb.center)>span*8||sa.some((v,k)=>Math.min(v,sb[k])/Math.max(v,sb[k])<.68))continue;
  const na=pa.map(p=>p.map((v,k)=>(v-ba.center[k])/sa[k])),nb=pb.map(p=>p.map((v,k)=>(v-bb.center[k])/sb[k])),scores=[null,0,1].map(axis=>{const transformed=nb.map(p=>p.map((v,k)=>axis===k?-v:v)),errors=resample(na,48).map(p=>pathDistance(p,transformed));return {axis,rms:Math.sqrt(errors.reduce((s,v)=>s+v*v,0)/errors.length)};});
  if(Math.min(...scores.map(s=>s.rms))>.10)continue;
  const name='components.'+a.id+'.'+b.id,options=[{value:'independent',description:'Independent sizes, shapes and placement.'},{value:'equal',description:'Same shape and size; retain separately drawn centers.'}];
  const pair={name,groupIds:[a.id,b.id],frame:a.frame,centers:[ba.center,bb.center],sizes:[sa,sb],shapeScores:scores,placements:[]};
  for(const axis of [0,1]){
   const other=1-axis,mid=(ba.center[axis]+bb.center[axis])/2;
   const parents=groups.filter(g=>g!==a&&g!==b&&!g.joinedGroupIds&&sameSketchPlane(g.frame,a.frame)&&!g.strokes.some(s=>a.strokes.some(t=>t.id===s.id)||b.strokes.some(t=>t.id===s.id))).map(g=>({g,b:bounds(g.points.map(p=>uv(world(p,g.frame),a.frame)))})).filter(p=>p.b.span>span*1.5&&[ba,bb].every(b=>b.min.every((v,k)=>v>=p.b.min[k]-span*.1&&b.max[k]<=p.b.max[k]+span*.1))).sort((x,y)=>x.b.span-y.b.span);
   const parent=parents.find(p=>Math.abs(p.b.center[axis]-mid)<span*.2&&Math.abs(ba.center[other]-bb.center[other])<span*.25);
   if(!parent)continue;
   const value=axis===0?'mirror_u':'mirror_v';pair.placements.push({value,axis,parentId:parent.g.id,axisUV:parent.b.center[axis]});options.push({value,description:'Equal mirrored components about '+parent.g.id+' '+(axis===0?'vertical':'horizontal')+' center axis; align the other coordinate.'});
  }
  if(Math.abs(ba.center[1]-bb.center[1])<span*.2)options.push({value:'row',description:'Equal repeated elements aligned on one horizontal row.'});
  if(Math.abs(ba.center[0]-bb.center[0])<span*.2)options.push({value:'column',description:'Equal repeated elements aligned on one vertical column.'});
  candidates.push(pair);questions.push({type:'choice',name,instructions:'Do '+a.id+' and '+b.id+' express repeated or mirrored copies of the same component? Compare the whole drawing, measured shape scores, sizes and placement in componentRelationCandidates. Similar details inside a symmetric outline usually intend equal dimensions and symmetric offsets despite imperfect pen strokes. Prefer the supported parent-centered mirror over merely equal sizes when applicable. Coordinate primitive choices for repeated elements. Preserve deliberate unequal features and user instructions. Never merge the two components into one.',choices:options});
  if(candidates.length>=16)return {candidates,questions};
 }
 return {candidates,questions};
}
function transformResult(source,frame,center,scale,reflection){
 const next=structuredClone(source),origin=uv(source.frame.origin,frame),direction=a=>{const x=dot(a,frame.xAxis),y=dot(a,frame.yAxis);return frame.xAxis.map((v,k)=>v*x*(reflection===0?-1:1)+frame.yAxis[k]*y*(reflection===1?-1:1));};
 next.frame={...source.frame,origin:world(center,frame),xAxis:direction(source.frame.xAxis),yAxis:direction(source.frame.yAxis)};
 const x=next.frame.xAxis,y=next.frame.yAxis;next.frame.normal=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
 next.pathWorld=source.pathWorld.map(p=>{const q=uv(p,frame);return world(q.map((v,k)=>center[k]+(v-origin[k])*scale*(reflection===k?-1:1)),frame);});
 if(next.primitive)for(const key of Object.keys(next.primitive))if(!key.endsWith('Deg'))next.primitive[key]*=scale;
 if(next.constraints.circularArcs)next.constraints.circularArcs=next.constraints.circularArcs.map(a=>({...a,center:a.center.map(v=>v*scale),radius:a.radius*scale}));if(next.knots)next.knots=next.knots.map(p=>p.map(v=>v*scale));if(next.segments)next.segments=next.segments.map(s=>({...s,coordinates:s.coordinates.map(v=>v*scale)}));return next;
}
export function applyComponentRelations(results,context,answers,groups){
 const applied=[],used=new Set();
 for(const c of context.candidates){const answer=answers.find(a=>a.name===c.name),decision=answer?.type==='choice'?answer.choice:null;if(!decision||decision==='independent'||!context.questions.find(q=>q.name===c.name)?.choices.some(o=>o.value===decision)||used.has(c.groupIds[0])||used.has(c.groupIds[1]))continue;
  const pair=c.groupIds.map(id=>results.find(r=>r.id===id));if(pair.some(r=>!r||r.construction||r.repairPolicy?.preserveAsymmetry)||pair[0].kind!==pair[1].kind||pair[0].constraints.closed!==pair[1].constraints.closed)continue;
  const a=pair[0],b=pair[1],source=a.metrics.relativeMax<=b.metrics.relativeMax?a:b,sourceBox=bounds(source.pathWorld.map(p=>uv(p,c.frame))),span=(bounds(a.pathWorld.map(p=>uv(p,c.frame))).span+bounds(b.pathWorld.map(p=>uv(p,c.frame))).span)/2,scale=span/sourceBox.span,centers=pair.map(r=>uv(r.frame.origin,c.frame)),placement=c.placements.find(p=>p.value===decision);let reflection=null;
  if(decision==='row'||decision==='column'){const k=decision==='row'?1:0;centers[0][k]=centers[1][k]=(centers[0][k]+centers[1][k])/2;}
  if(placement){reflection=placement.axis;const parent=results.find(r=>r.id===placement.parentId);if(!parent)continue;const center=bounds(parent.pathWorld.map(p=>uv(p,c.frame))).center,other=1-reflection,d=(centers[1][reflection]-centers[0][reflection])/2;centers[0][reflection]=center[reflection]-d;centers[1][reflection]=center[reflection]+d;centers[0][other]=centers[1][other]=(centers[0][other]+centers[1][other])/2;}
  const proposed=pair.map((r,i)=>{const next=transformResult(source,c.frame,centers[i],scale,source.id!==r.id?reflection:null);next.id=r.id;next.sourceStrokeIds=r.sourceStrokeIds;next.decisions=r.decisions;next.interpretation=r.interpretation;next.warnings=r.warnings.slice();next.constraints.componentRelations=[{referenceId:pair[1-i].id,type:decision,parentId:placement?.parentId,axis:reflection,equalSize:true}];const g=groups.find(g=>g.id===r.id),error=deviation(g.points,next.pathWorld.map(p=>uv(p,g.frame)),next.constraints.closed);next.metrics={...r.metrics,...error,relativeMax:error.max/bounds(g.points).span};return next;});
  if(proposed.some((r,i)=>!Number.isFinite(r.metrics.relativeMax)||r.metrics.relativeMax>Math.max(.12,pair[i].metrics.relativeMax+.045))){pair.forEach(r=>r.warnings.push('Repeated-component relation exceeded the contour budget; independent geometry retained.'));continue;}
  pair.forEach((r,i)=>Object.assign(r,proposed[i]));c.groupIds.forEach(id=>used.add(id));applied.push({groupIds:c.groupIds,type:decision,parentId:placement?.parentId,equalSize:true});
 }
 return applied;
}
