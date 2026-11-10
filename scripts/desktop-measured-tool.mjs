import {createHash} from 'node:crypto';
import {measuredDraftPath,fitDraftRange,draftDeviation,regularizeDraftLines,sampleDraftSegment} from '../src/desktop-measured-draft.js';
import {fitDesktopSketch} from '../src/desktop-sketch-fit.js';
import {validateDesktopEdit} from '../src/desktop-edit-contract.js';
import {SKETCH_INTENT_PRIORS} from './sketch-intent-priors.mjs';
export const REGULAR_PRIMITIVE_MAX_DEVIATION_RATIO=.06;
const cache=new WeakMap();
const support=(e,s)=>s.plane||e.frames.find(f=>f.layer==='stroke'&&f.strokeIds?.includes(s.id))?.imageReference?.sketchPlane||e.desktopView?.plane||e.defaultPlane;
export function measuredDesktopDraft(e){
 if(cache.has(e))return cache.get(e);
 const paths=e.strokes.map((s,i)=>{try{const p=measuredDraftPath(s,support(e,s));p.id='p'+i;p.segments.forEach((s,j)=>s.id=p.id+'e'+j);p.primitives=[];
  const span=Math.hypot(...p.bounds.max.map((v,k)=>v-p.bounds.min[k])),gap=Math.hypot(...p.source[0].map((v,k)=>v-p.source.at(-1)[k]));
  // Offer measured regular-shape alternatives for small accidental gaps/tails.
  // The model chooses intent; the default faithful contour stays unchanged.
  if(p.closed||gap<=span*.15)for(const kind of ['circle','rectangle']){try{const f=fitDesktopSketch([s],{plane:p.frame,kind}),v=f.paths[0].primitive,segment={kind,coordinates:[...v.center,...(kind==='circle'?[v.radiusMetres]:[v.widthMetres,v.heightMetres])]},error=draftDeviation(p.source,[segment]);if(error.max<=span*REGULAR_PRIMITIVE_MAX_DEVIATION_RATIO)p.primitives.push({...segment,error});}catch{}}
  p.choices=[];
  for(const candidate of p.primitives)p.choices.push({id:p.id+'c'+p.choices.length,fromSegment:p.segments[0].id,toSegment:p.segments.at(-1).id,kind:candidate.kind,fit:candidate,gain:100});
  const candidates=[];
  for(let first=0;first<p.segments.length;first++)for(let last=first;last<Math.min(p.segments.length,first+4);last++)for(const kind of ['line','arc','spline']){
   const old=p.segments.slice(first,last+1),gain=old.reduce((n,s)=>n+({line:1,arc:1.15,spline:1.7,circle:1,rectangle:1}[s.kind]||1),0)-({line:1,arc:1.15,spline:1.7}[kind]);
   if(gain<.1||old.some(s=>['circle','rectangle'].includes(s.kind)))continue;
   const range=[old[0].range[0],old.at(-1).range[1]],fit=fitDraftRange(p.points.slice(range[0],range[1]+1),kind);
   if(fit&&fit.error.max<=p.toleranceMetres*1.5)candidates.push({fromSegment:old[0].id,toSegment:old.at(-1).id,kind,fit,gain});
  }
  for(const c of candidates.sort((a,b)=>b.gain-a.gain||a.fit.error.max-b.fit.error.max).slice(0,12))p.choices.push({...c,id:p.id+'c'+p.choices.length});
  return p;
 }catch(error){return {id:'p'+i,strokeId:s.id,error:error.message};}});
 const id='draft-'+createHash('sha256').update(JSON.stringify(e.strokes.map(s=>({id:s.id,points:s.points,plane:support(e,s)})))).digest('hex').slice(0,16),draft={id,paths};cache.set(e,draft);return draft;
}
export function measuredDraftContext(draft){return {id:draft.id,policy:'Modify this measured draft using prevalidated choice IDs. Unmentioned segments remain unchanged. Coordinates are measurements, not values you need to regenerate.',paths:draft.paths.map(p=>p.error?{id:p.id,strokeId:p.strokeId,error:p.error}:{id:p.id,strokeId:p.strokeId,frame:p.frame,closed:p.closed,bounds:p.bounds,toleranceMetres:p.toleranceMetres,maxDeviationMetres:p.metrics.max,segments:p.segments.map(({id,kind,coordinates,error})=>({id,kind,coordinates,maxDeviationMetres:error.max})),choices:p.choices.map(({id,fromSegment,toSegment,kind,fit})=>({id,fromSegment,toSegment,kind,maxDeviationMetres:fit.error.max}))})};}
const str={type:'string'};
export const REFINE_MEASURED_TOOL={type:'function',name:'refine_measured_sketch',strict:true,description:'Modify the accurate measuredDraft, not coordinates. changes:[] preserves its connected lines/arcs/curves. Each measuredDraft.paths[].choices entry is a PREVALIDATED local adjustment fitted to original ink: choose its candidateId and name only when useful for intent. All omitted geometry remains unchanged. No arbitrary segment ranges or generated parameters. The harness solves geometry, preserves shared endpoints and verifies contour deviation. engineering gently aligns near-horizontal/vertical/45-degree straight edges; none preserves deliberate angles. Produces an uncommitted editable preview.',parameters:{type:'object',properties:{draftId:str,strokeIds:{type:'array',items:str,minItems:1,maxItems:16},intent:str,regularization:{type:'string',enum:['none','engineering']},changes:{type:'array',maxItems:32,items:{type:'object',properties:{candidateId:str,name:str},required:['candidateId','name'],additionalProperties:false}}},required:['draftId','strokeIds','intent','regularization','changes'],additionalProperties:false}};
export const MEASURED_DRAFT_INSTRUCTIONS=SKETCH_INTENT_PRIORS+`
Use the measured draft as the starting design. Your job is to understand and make SMALL justified modifications, not redraw coordinates from the picture. Use refine_measured_sketch with a concise description of the intended figure and the offered corrections that best express it; retain the measured shape where it already conveys intent. The tool solves the geometry. Select only offered choices by candidateId for a specific useful change: merge a genuinely straight run or choose a measured arc for a circular run. These alternatives have already been solved and checked against the ink; do not invent segment ranges or parameters. Each curved region must follow its measured samples. Never replace an angular silhouette with broad arcs just because a familiar object is often rounded. Prefer a listed whole-path circle or rectangle choice when that primitive matches the intended simple figure; this yields an exact editable primitive rather than several pieces. Candidate primitive alternatives list measured residuals, not guaranteed intent. Preserve distinctive corners, necks, notches, deliberate asymmetry, relative sizes and the entire silhouette. Use engineering regularization for likely horizontal/vertical/45-degree edges, none for deliberate tilted details. An annotated measured-draft image may show segment IDs; compare it with the original ink crop. No image is a license to invent locations. Unmentioned edges stay connected and unchanged. Use free coordinate authoring only for explicit new geometry or a deliberate requested redesign, not automatic sketch cleanup. Keep the original sketch support. Do not add 3D depth without a user request.`;
function envelope(intent,edits){return {summary:intent,assumptions:[],question:null,questionOptions:[],edits,modelEdits:[],solidEdits:[],requestedSketchIds:[],requestedStrokeArchiveIds:[],voiceControl:null,automation:null,continuation:null};}
export function measuredDraftEdits(paths,intent){return paths.flatMap(p=>p.segments.map((s,i)=>{const c=s.coordinates,w=uv=>p.frame.origin.map((v,k)=>v+p.frame.xAxis[k]*uv[0]+p.frame.yAxis[k]*uv[1]);let start=null,end=null;if(s.kind==='arc'){start=c[3];end=c[3]+c[4];if(c[4]<0)[start,end]=[end,start];}
 return {planeId:p.frame.id,construction:false,operation:'create',figureId:null,expectedVersion:null,kind:s.kind,name:s.name||s.kind+' '+s.id,origin:s.kind==='spline'?p.frame.origin:w(c.slice(0,2)),xAxis:p.frame.xAxis,yAxis:p.frame.yAxis,radiusMetres:['circle','arc'].includes(s.kind)?c[2]:null,startAngleDeg:start,endAngleDeg:end,widthMetres:s.kind==='rectangle'?c[2]:null,heightMetres:s.kind==='rectangle'?c[3]:null,end:s.kind==='line'?w(c.slice(2)):null,segments:s.kind==='spline'?[c]:null,closed:s.kind==='circle'||s.kind==='rectangle',extrusionMetres:null,strokeIds:[p.strokeId],dimensionNote:intent};}));}
export function refineMeasuredEdit({call,run,evidence}){
 const a=JSON.parse(call.arguments),draft=measuredDesktopDraft(evidence);
 if(a.draftId!==draft.id)throw Error('Measured draft changed; use the current measuredDraft.id');
 if(!Array.isArray(a.strokeIds)||!a.strokeIds.length||a.strokeIds.length>16||new Set(a.strokeIds).size!==a.strokeIds.length||a.strokeIds.some(id=>!draft.paths.some(p=>p.strokeId===id&&!p.error)))throw Error('Select current measurable strokes');
 if(typeof a.intent!=='string'||!a.intent.trim()||a.intent.length>500||!['none','engineering'].includes(a.regularization)||!Array.isArray(a.changes)||a.changes.length>32)throw Error('Invalid measured draft adjustment');
 const paths=draft.paths.filter(p=>a.strokeIds.includes(p.strokeId)).map(p=>({...p,segments:p.segments.map(s=>({...s}))})),used=new Set(),rejected=[];
 for(const selection of a.changes){
  const choice=paths.flatMap(p=>p.choices).find(c=>c.id===selection.candidateId);if(!choice)throw Error('Choose a prevalidated current candidateId; arbitrary coordinate/range edits are unavailable for automatic cleanup');
  const change={...choice,name:selection.name};
  const p=paths.find(p=>p.segments.some(s=>s.id===change.fromSegment));if(!p)throw Error('Unknown source segment '+change.fromSegment);
  const original=draft.paths.find(v=>v.id===p.id),first=original.segments.findIndex(s=>s.id===change.fromSegment),last=original.segments.findIndex(s=>s.id===change.toSegment);
  if(last<first)throw Error('Choose consecutive segments in original drawing order');
  const ids=original.segments.slice(first,last+1).map(s=>s.id);if(ids.some(id=>used.has(id)))throw Error('Overlapping draft changes');ids.forEach(id=>used.add(id));
  const range=[original.segments[first].range[0],original.segments[last].range[1]],part=original.points.slice(range[0],range[1]+1);
  let fit;if(['circle','rectangle'].includes(change.kind))fit=first===0&&last===original.segments.length-1?original.primitives.find(s=>s.kind===change.kind):null;else fit=fitDraftRange(part,change.kind);
  if(!fit||fit.error.max>(['circle','rectangle'].includes(change.kind)?Math.hypot(...p.bounds.max.map((v,k)=>v-p.bounds.min[k]))*REGULAR_PRIMITIVE_MAX_DEVIATION_RATIO:p.toleranceMetres*1.5)){rejected.push({fromSegment:change.fromSegment,toSegment:change.toSegment,kind:change.kind,reason:'Proposed primitive does not follow the original contour within measured tolerance; kept the measured range',maxDeviationMetres:fit?.error.max});continue;}
  const at=p.segments.findIndex(s=>s.id===change.fromSegment);p.segments.splice(at,ids.length,{...fit,id:change.fromSegment,range,name:change.name});
 }
 if(a.regularization==='engineering')for(const p of paths)if(p.segments.every(s=>!['circle','rectangle'].includes(s.kind)))p.segments=regularizeDraftLines(p);
 for(const p of paths){const original=draft.paths.find(v=>v.id===p.id),limit=p.segments.length===1&&['circle','rectangle'].includes(p.segments[0].kind)?Math.hypot(...p.bounds.max.map((v,k)=>v-p.bounds.min[k]))*REGULAR_PRIMITIVE_MAX_DEVIATION_RATIO:Math.max(p.toleranceMetres*1.5,original.metrics.max+1e-9);if(draftDeviation(p.source,p.segments).max>limit){p.segments=original.segments;rejected.push({pathId:p.id,reason:'Combined changes exceeded whole-contour tolerance; retained the original measured path'});}}
 const edits=measuredDraftEdits(paths,a.intent),edit=envelope(a.intent,edits);if(rejected.length){edit.summary='Kept the measured contour; '+rejected.length+' proposed fit(s) exceeded tolerance.';edit.assumptions=['Kept measured geometry for '+rejected.length+' proposed change(s) that exceeded the contour tolerance.'];}
 if(run.automation){edit.automation=run.automation;edit.continuation={reason:'Continue the active task',nextMove:'Use the measured sketch result and finish the original goal.'};}
 validateDesktopEdit(edit,evidence);
 return {edit,result:{name:'refine_measured_sketch',draftId:draft.id,geometryChanged:true,applied:true,rejectedChanges:rejected,paths:paths.map(p=>({strokeId:p.strokeId,segments:p.segments.length,toleranceMetres:p.toleranceMetres,deviation:draftDeviation(p.source,p.segments)}))}};
}

export function assessMeasuredEdit(evidence,edit){
 const draft=measuredDesktopDraft(evidence);
 return draft.paths.filter(p=>!p.error).map(p=>{
  const worldPaths=(edit.edits||[]).filter(e=>e.strokeIds?.includes(p.strokeId)).flatMap(e=>{
   const world=uv=>e.origin.map((v,k)=>v+e.xAxis[k]*uv[0]+e.yAxis[k]*uv[1]);
   if(e.kind==='line')return [[e.origin,e.end]];
   const primitives=e.kind==='spline'?(e.segments||[]).map(c=>({kind:'spline',coordinates:c})): [{kind:e.kind,coordinates:e.kind==='circle'?[0,0,e.radiusMetres]:e.kind==='rectangle'?[0,0,e.widthMetres,e.heightMetres]:[0,0,e.radiusMetres,e.startAngleDeg,((e.endAngleDeg-e.startAngleDeg)%360+360)%360]}];
   return primitives.map(s=>sampleDraftSegment(s).map(world));
  });
  const toUV=w=>[p.frame.xAxis,p.frame.yAxis].map(axis=>axis.reduce((n,v,k)=>n+(w[k]-p.frame.origin[k])*v,0));
  const segments=worldPaths.flatMap(path=>path.slice(1).map((b,i)=>({kind:'line',coordinates:[...toUV(path[i]),...toUV(b)]})));
  return {strokeId:p.strokeId,spanMetres:Math.hypot(...p.bounds.max.map((v,k)=>v-p.bounds.min[k])),toleranceMetres:p.toleranceMetres,base:p.metrics,result:segments.length?draftDeviation(p.source,segments):null};
 });
}
