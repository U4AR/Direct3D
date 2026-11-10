import {sketchFrame} from './desktop-sketch-fit.js';
const fingerprint=s=>JSON.stringify([s.points,s.plane||s.drawingPlane]);
const samePlane=(a,b)=>Math.abs(a.normal.reduce((s,v,k)=>s+v*b.normal[k],0))>1-1e-6&&Math.abs(a.normal.reduce((s,v,k)=>s+v*(a.origin[k]-b.origin[k]),0))<1e-5;
export function cacheDecisionDrafts(result,strokes){
 return result.results.flatMap((r,i)=>{const source=strokes.filter(s=>r.sourceStrokeIds.includes(s.id));if(!source.length||source.length!==r.sourceStrokeIds.length)return [];const sourcePlane=source[0].plane||source[0].drawingPlane,referencePlane=result.referencePlanes?.find(p=>p.id===r.frame.id)||(sourcePlane&&samePlane(sketchFrame(sourcePlane),sketchFrame(r.frame))?sourcePlane:r.frame);return [{referencePlane:structuredClone(referencePlane),result:structuredClone(r),edit:structuredClone(result.edits[i]),sources:source.map(s=>({id:s.id,fingerprint:fingerprint(s),plane:structuredClone(s.plane||s.drawingPlane)}))}];});
}
export function splitDecisionDrafts(evidence,cached){
 const active=sketchFrame(evidence.defaultPlane),valid=cached.filter(c=>(c.edit.operation!=='update'||evidence.figures?.some(f=>f.id===c.edit.figureId&&f.version===c.edit.expectedVersion))&&c.sources.every(s=>evidence.strokes.some(raw=>raw.id===s.id&&fingerprint(raw)===s.fingerprint))),retained=valid.filter(c=>!samePlane(sketchFrame(c.result.frame),active)||evidence.editContext?.mode==='drawing'&&evidence.editContext.targetStrokeIds?.length&&!c.sources.some(s=>evidence.editContext.targetStrokeIds.includes(s.id))),ids=new Set(retained.flatMap(c=>c.sources.map(s=>s.id)));
 return {strokes:evidence.strokes.filter(s=>!ids.has(s.id)),retained,references:retained.slice(-24).map(c=>{const r=c.result,path=r.pathWorld,step=Math.max(1,Math.ceil(path.length/128));return {id:r.id,name:(c.sources[0].plane?.name||c.sources[0].plane?.id||'Sketch')+' / '+r.kind+' '+r.sourceStrokeIds[0].slice(0,8),kind:r.kind,captureDirection:evidence.strokes.find(s=>r.sourceStrokeIds.includes(s.id)&&s.view?.cameraToWorld)?.view.cameraToWorld.slice(8,11),plane:c.referencePlane||c.sources[0].plane||r.frame,points:path.filter((_,i)=>i%step===0||i===path.length-1)};})};
}
export function combineDecisionDrafts(result,retained){
 const next=structuredClone(result),names=new Map(next.results.filter(r=>!r.retainedDraft).map(r=>[r.id,next.id+':'+r.id]));
 for(const r of next.results){r.id=names.get(r.id)||r.id;for(const c of [...(r.constraints.connections||[]),...(r.constraints.componentRelations||[])]){c.referenceId=names.get(c.referenceId)||c.referenceId;if(c.parentId)c.parentId=names.get(c.parentId)||c.parentId;}}
 for(const solid of next.solidEdits||[])for(const profile of solid.profiles){
  const match=/^new-edit:(\d+)$/.exec(profile.figureId);
  if(match)profile.figureId='new-edit:'+(retained.length+Number(match[1]));
 }
 next.results=[...retained.map(c=>({...structuredClone(c.result),retainedDraft:true})),...next.results];next.edits=[...retained.map(c=>structuredClone(c.edit)),...next.edits];next.referencePlanes=[...new Map([...retained.map(c=>c.referencePlane).filter(p=>p?.id),...(next.referencePlanes||[])].map(p=>[p.id,p])).values()];next.input={...next.input,retainedDraftCount:retained.length};return next;
}
// A rejected stray stroke must not cause unchanged geometry to drift on a new fit.
export function reuseNoiseDrafts(result,cached,strokes,{sameInstruction=true}={}){
 const ignored=new Set((result.ignoredGroups||[]).flatMap(g=>g.sourceStrokeIds));
 if(!ignored.size||!sameInstruction)return result;
 const valid=cached.filter(c=>c.sources.every(s=>strokes.some(raw=>raw.id===s.id&&fingerprint(raw)===s.fingerprint))),known=new Set(valid.flatMap(c=>c.sources.map(s=>s.id)));
 if(!strokes.every(s=>ignored.has(s.id)||known.has(s.id)))return result;
 return {...result,noOp:true,reusedAfterNoise:true,results:valid.map(c=>({...structuredClone(c.result),retainedDraft:true})),edits:valid.map(c=>structuredClone(c.edit))};
}
