import {bounds,distance,deviation} from '../src/decision-sketch/math.js';
import {repairGroupContext} from './decision-repair-policy.mjs';
const uv=(p,f)=>[f.xAxis,f.yAxis].map(a=>a.reduce((n,v,k)=>n+v*(p[k]-f.origin[k]),0));
export function originPlacementContext(groups,data){
 const candidates=[],questions=[];if(data.options?.align===false)return {candidates,questions};
 for(const g of groups){if(repairGroupContext(g,data))continue;const b=bounds(g.points);if(distance(g.points[0],g.points.at(-1))>b.span*.15)continue;
  const tolerance=Math.max(.0001,b.span*.025),axes=b.center.flatMap((v,k)=>Math.abs(v)<=tolerance?[k]:[]);if(!axes.length)continue;
  const name=g.id+'.origin_placement',choices=[{value:'independent',description:'Keep the deliberately drawn offset.'}];for(const k of axes)choices.push({value:k===0?'center_u':'center_v',description:'Center on plane '+(k===0?'vertical (U=0)':'horizontal (V=0)')+' origin axis.'});if(axes.length===2)choices.push({value:'center_origin',description:'Center this whole figure on the sketch-plane origin.'});
  candidates.push({groupId:g.id,frame:g.frame,toleranceMetres:tolerance,centerUV:b.center,axes,name});questions.push({type:'choice',name,instructions:'For this NEW figure, prefer origin/axis centering when the drawing is already within the small tolerance in originPlacementCandidates and this expresses normal CAD intent. Do not move intentionally offset components, features positioned relative to other geometry, or repair strokes. Proximity is evidence, not permission for a large translation; independent preserves the measured placement.',choices});
 }
 return {candidates,questions};
}
export function applyOriginPlacement(results,context,answers,groups=[]){
 const placed=[];for(const c of context.candidates){const r=results.find(r=>r.id===c.groupId),answer=answers.find(a=>a.name===c.name&&a.type==='choice')?.choice;if(!r?.constraints.closed||!answer||answer==='independent'||!context.questions.find(q=>q.name===c.name)?.choices.some(o=>o.value===answer))continue;
  const axes=answer==='center_origin'?[0,1]:[answer==='center_u'?0:1],center=bounds(r.pathWorld.map(p=>uv(p,c.frame))).center;if(axes.some(k=>Math.abs(center[k])>c.toleranceMetres*1.5))continue;
  const delta=c.frame.origin.map((_,k)=>-axes.reduce((n,i)=>n+center[i]*(i===0?c.frame.xAxis[k]:c.frame.yAxis[k]),0));r.frame.origin=r.frame.origin.map((v,k)=>v+delta[k]);r.pathWorld=r.pathWorld.map(p=>p.map((v,k)=>v+delta[k]));const group=groups.find(g=>g.id===r.id);if(group){const error=deviation(group.points,r.pathWorld.map(p=>uv(p,group.frame)),true);r.metrics={...r.metrics,...error,relativeMax:error.max/bounds(group.points).span};}r.constraints.originPlacement={planeId:c.frame.id,axes,translationMetres:delta};placed.push({groupId:r.id,...r.constraints.originPlacement});
 }return placed;
}
