import {decisionSketchCatalog,validateDecisionSketchEdits} from './decision-sketch/harness.js';
import {drawingView} from './sketch-projection.js';
import {fittingContext} from './fitting-context.js';
import {contextualFeatures} from './contextual-fitting.js';
import {contextChangedError} from './drawing-concurrency.js';
import {presentCreationStep} from './creation-steps.js';
import {validateDesktopEdit} from './desktop-edit-contract.js';
export async function prepareDesktopEvidence({studio,store,reference,context,promptId,requestedSketchIds=[],neutral=false}){
 if(studio.desktopAppearance&&!neutral)return studio.desktopAppearance.neutral(()=>prepareDesktopEvidence({studio,store,reference,context,promptId,requestedSketchIds,neutral:true}));
 const inputView=drawingView(studio);
 const initialContext=await context(),before=snapshot(store,studio);
 const strokes=store.session.strokes.filter(s=>!s.hidden);
 if(strokes.length>128)throw Error('This drawing has more than 128 active strokes; hide completed drawings before the next AI edit.');
 const packets=[];
 // Fit all selected strokes and capture every original drawing with its own recorded view.
 for(let i=0;i<strokes.length;i+=16)packets.push(await reference({strokeIds:strokes.slice(i,i+16).map(s=>s.id),promptId,perStrokeImages:true}));
 if(!packets.length)packets.push(await reference({strokeIds:[],promptId,perStrokeImages:true}));
 if(snapshot(store,studio)!==before)throw contextChangedError('drawing');
 const ctx=initialContext,revision=store.session.revision;
 const sketchCatalog=studio.desktopSketches?.catalog()||[],outputIds=[...new Set([...(studio.desktopSketches?.selectedIds||[]),studio.desktopSketches?.activeId,...requestedSketchIds].filter(Boolean))],sketchOutputs=outputIds.filter(id=>sketchCatalog.some(s=>s.id===id)).map(id=>studio.desktopSketches.output(id));
 const fitting=fittingContext(studio.surfaceModels?.()||[],strokes,ctx.selectedSurface?.modelId||studio.objects?.selectedIds?.[0]),regularization=null;
 const evidence={editContext:studio.desktopEditing?.context(),decisionSketches:decisionSketchCatalog(store.session,studio.desktopDrawing.summary()),workspace:'desktop',referencePlanes:structuredClone(store.session.desktopPlanes||[]),desktopView:{view:inputView,plane:structuredClone(studio.surface?.selected?.frame||studio.desktopPlane),note:'Per-stroke images retain the actual view used to draw. Current inspection view may differ; use each frame imageReference for pixels, origins, plane mapping and part-frame conversion.'},lastDeterministicCAD:structuredClone(store.session.lastDeterministicCAD),liveApproximation:studio.liveShapes?.evidence,surfaceFeatureIntent:studio.liveShapes?.featureIntent,regularization,contextualFeatures:contextualFeatures(strokes,fitting,regularization?.toleranceMetres),creationTimeline:structuredClone(store.session.creationTimeline||[]),supervision:studio.aiSupervision?.evidence()||{level:store.session.aiSupervision||'balanced'},sketchCatalog,selectedSketchIds:studio.desktopSketches?.selectedIds||[],sketchOutputs:sketchOutputs.map(({image,...o})=>o),solids:store.session.desktopSolids||[],version:1,sketchRevision:revision,units:'metres',coordinateSystem:'world Y-up',defaultPlane:studio.desktopPlane||{origin:[0,0,-.6],xAxis:[1,0,0],yAxis:[0,1,0],normal:[0,0,1]},selectedSurface:ctx.selectedSurface,selection:ctx.desktopSelection,workflow:ctx.strokeWorkflow,selectedFigureId:studio.desktopEditing?studio.desktopEditing.context().targetFigure?.id||null:studio.desktopDrawing.selectedId,figures:studio.desktopDrawing.summary(),models:ctx.models,coordinateFrames:ctx.coordinateFrames,frames:[...packets.flatMap(p=>p.frames),...sketchOutputs.map(o=>({layer:'sketch-output',sketchId:o.sketchId,name:o.name,plane:o.plane,strokeIds:o.strokeIds,image:o.image}))],strokes:packets.flatMap(p=>p.strokes).map(s=>({...s,started:strokes.find(raw=>raw.id===s.id).started,ended:strokes.find(raw=>raw.id===s.id).ended,points:structuredClone(strokes.find(raw=>raw.id===s.id).points),drawingTarget:structuredClone(strokes.find(raw=>raw.id===s.id).drawingTarget),drawingIntent:structuredClone(strokes.find(raw=>raw.id===s.id).drawingIntent),objectAttachment:structuredClone(strokes.find(raw=>raw.id===s.id).objectAttachment)})),conversation:store.session.transcripts.slice(-8).map(t=>({text:t.text,source:t.source})),outputPreference:document.querySelector('#desktop-output')?.value||'auto'};
 // The snapshot is created after asynchronous fitting/capture, then checked again before applying.
 evidence.sourceSnapshot=snapshot(store,studio);
 return evidence;
}
function snapshot(store,studio){return JSON.stringify({plane:studio.desktopPlane,sketches:studio.desktopSketches?.catalog(),solids:store.session.desktopSolids,strokes:store.session.strokes.filter(s=>!s.hidden).map(s=>({id:s.id,points:s.points,surface:s.surface})),figures:studio.desktopDrawing.summary(),models:studio.surfaceModels?.().map(m=>({id:m.id,version:m.version,hidden:m.hidden}))});}
export function localDesktopEvidence(studio,store){return {solids:structuredClone(store.session.desktopSolids||[]),decisionSketches:decisionSketchCatalog(store.session,studio.desktopDrawing.summary()),editContext:studio.desktopEditing?.context(),version:1,workspace:'desktop',sketchRevision:store.session.revision,units:'metres',defaultPlane:structuredClone(studio.desktopPlane),referencePlanes:structuredClone(store.session.desktopPlanes||[]),sketchCatalog:studio.desktopSketches?.catalog()||[],figures:studio.desktopDrawing.summary(),models:studio.surfaceModels?.()||[],strokes:store.session.strokes.filter(s=>!s.hidden).map(s=>({...structuredClone(s),plane:structuredClone(s.drawingPlane||s.plane||(s.surface?.frame?{...s.surface.frame,id: 'surface-capture:'+s.surface.modelId+':'+(s.surface.faceIndex??0)}:studio.desktopPlane))})),frames:[],sourceSnapshot:snapshot(store,studio)};}
export function assertDesktopCurrent(studio,store,evidence){if(snapshot(store,studio)!==evidence.sourceSnapshot)throw contextChangedError('drawing or model');}
export async function applyDesktopEdit({studio,store,edit,evidence,record=()=>{},cancelled=()=>false,dispatch,runId}){
 validateDesktopEdit(edit,evidence);
 validateDecisionSketchEdits(edit,evidence);
 if(cancelled())throw Error('AI edit stopped before application');
 assertDesktopCurrent(studio,store,evidence);
 if(edit.question)return {appliedCount:0};
 // Validate the entire response before the first native mutation. Native engine errors are reported without automatic AI retries.
 for(const e of edit.edits)studio.desktopDrawing.validate(e);
 const results=[];
 for(const e of edit.edits){
  if(cancelled())throw Error('Stopped; already applied figures remain editable');
  const args=Object.fromEntries(Object.entries(e).filter(([key,value])=>value!==null&&!['operation','extrusionMetres'].includes(key)));
  if(e.operation==='update'&&!e.strokeIds.length)delete args.strokeIds;
  args.expectedSketchRevision=store.session.revision;
  await presentCreationStep(studio,store,'Drawing '+e.kind+' · '+e.name,{phase:'applying',kind:e.kind,parameters:args},record);if(cancelled())throw Error('Creation interrupted before drawing');
  const result=await (dispatch||studio.desktopDrawing.dispatch)(e.operation==='update'?'drawing_update':'drawing_create',args);
  await presentCreationStep(studio,store,'Applied sketch '+e.name,{phase:'applied',kind:e.kind,figureId:result.figure.id},record);
  if(e.extrusionMetres!==null){await presentCreationStep(studio,store,'Extruding '+e.name,{phase:'applying',kind:'extrusion',figureId:result.figure.id,depthMetres:e.extrusionMetres},record);if(cancelled())throw Error('Stopped before extrusion; the profile remains editable');Object.assign(result,await studio.desktopDrawing.extrude(result.figure.id,e.extrusionMetres));}
  results.push(result);record('Verified native '+e.kind+' · '+(result.solidCreated?'solid extrusion':'2D sketch'),{figureId:result.figure.id,dimensionsMetres:result.dimensionsMetres,solidCreated:result.solidCreated});
 }
 const featureOutputs=[];
 for(const solid of edit.solidEdits){if(cancelled())throw Error('Stopped before multi-sketch modeling');const resolved = structuredClone(solid);
  for(const key of ['targetBodyId','toolBodyId'])if(resolved[key]?.startsWith('feature-result:'))resolved[key]=featureOutputs[Number(resolved[key].slice(15))];
  for (const profile of resolved.profiles) {
   const draft=/^new-edit:(\d+)$/.exec(profile.figureId);
   const applied = draft?results[Number(draft[1])]:results.find(r => r.figure?.id === profile.figureId);
   if(draft)profile.figureId=applied.figure.id;
   if (applied) profile.expectedVersion = applied.figure.version;
  }
  await presentCreationStep(studio,store,'Building '+solid.name,{phase:'applying',kind:solid.kind,profiles:resolved.profiles,revolution:resolved.revolution},record);
  if(cancelled())throw Error('Stopped before CAD construction');
  const result=await studio.desktopDrawing.createSolid(resolved);featureOutputs.push(result.solid.bodyId);results.push(result);await presentCreationStep(studio,store,'Verified native solid from sketch outputs',{phase:'applied',kind:solid.kind,solidId:result.solid.id,modelIds:result.modelIds},record);}
 const review={operationTrace:structuredClone(store.session.creationTimeline||[]),state:'awaiting_feedback',kind:results.some(r=>r.solidCreated)?'model':'drawing',figureIds:results.filter(r=>r.figure).map(r=>r.figure.id),modelIds:results.flatMap(r=>r.modelIds||[]),models:results.flatMap(r=>r.models||[]),strokeIds:[],sourceStrokeIds:[...new Set(edit.edits.flatMap(e=>e.strokeIds))],summary:edit.summary,uncertainties:edit.assumptions};
 if(results.length)studio.desktopAppearance?.focus(review,runId);
 await store.flush();return {review,appliedCount:results.length};
}
