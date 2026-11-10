import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {DESKTOP_EDIT_SCHEMA,validateDesktopEdit} from '../src/desktop-edit-contract.js';
import {sketchFrame} from '../src/desktop-sketch-fit.js';
import {verifyDecisionFigure} from '../src/decision-sketch/harness.js';
import {editPath,runSketchRefinement,nativeSolidReferences} from './sketch-refinement.mjs';
import {validateSurfaceScene} from '../src/image-surface-pick.js';
const keys=Object.keys(DESKTOP_EDIT_SCHEMA.properties.edits.items.properties);
export function prepareExistingSketchEdit(input){
 const normalize=f=>({...f,closed:['circle','rectangle'].includes(f.kind)||!!f.closed});input={...input,figures:input.figures?.map(normalize),sketchFigures:input.sketchFigures?.map(normalize)};
 if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>4000)throw Error('An instruction is required to edit an existing sketch');
 if(!Array.isArray(input.figures)||!input.figures.length||input.figures.length>8)throw Error('Choose one sketch or up to eight existing figures to edit');
 validateSurfaceScene(input.surfaceScene);
 if(input.image!==undefined&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(input.image)||input.image.length>4000000))throw Error('Use a bounded current drawing image');
 const ids=new Set(),edits=[],results=[],strokes=[],references=[];
 for(const [i,f]of input.figures.entries()){
  if(typeof f.id!=='string'||f.id.length>160||ids.has(f.id)||!Number.isInteger(f.version)||f.version<1)throw Error('Existing sketch figures need distinct IDs and current versions');ids.add(f.id);
  const sourceId='existing:'+f.id,edit=Object.fromEntries(keys.map(k=>[k,f[k]??null]));Object.assign(edit,{operation:'update',figureId:f.id,expectedVersion:f.version,name:f.name||f.kind,construction:!!f.construction,closed:!!f.closed,strokeIds:[sourceId],extrusionMetres:null,dimensionNote:'Current editable geometry before instruction'});
  const frame=sketchFrame({...edit,id:edit.planeId}),source={id:sourceId,points:[[0,0,0],[1,0,0]],plane:frame,view:input.view};
  validateDesktopEdit({summary:'Validate current sketch',assumptions:[],question:null,edits:[edit],modelEdits:[],solidEdits:[],requestedSketchIds:[],requestedStrokeArchiveIds:[],voiceControl:null,automation:null,continuation:null},{strokes:[source],figures:[f],referencePlanes:input.referencePlanes||[],defaultPlane:input.plane});
  const points=editPath(edit),constraints=structuredClone(input.constraints?.find(c=>c.figureId===f.id)?.constraints||{closed:!!f.closed,symmetry:['circle','rectangle'].includes(f.kind)?'both':'none',analytic:['circle','arc'].includes(f.kind)}),kind=f.kind==='spline'?'profile':f.kind;
  if(['circle','rectangle'].includes(f.kind))constraints.closed=true;verifyDecisionFigure(edit,{kind:input.constraints?.find(c=>c.figureId===f.id)?.kind||kind,constraints});
  Object.assign(source,{points});strokes.push(source);edits.push(edit);references.push({id:f.id,name:edit.name,kind:f.kind,plane:frame,points:points.filter((_,j)=>j%Math.max(1,Math.ceil(points.length/128))===0||j===points.length-1)});
  results.push({id:'f'+i,kind,frame,pathWorld:points,sourceStrokeIds:[sourceId],priorStrokeIds:f.strokeIds||[],constraints,metrics:{currentNativeGeometry:true},interpretation:{mode:'instruction-edit',label:edit.name}});
 }
 const available=[...new Map([...(input.sketchFigures||[]),...input.figures].map(f=>[f.id,f])).values()];const solidReferences=nativeSolidReferences(available,input);
 const data={...input,availableFigures:available,solidReferences,mode:'edit-existing',strokes,references,plane:input.plane||results[0].frame,prompt:input.prompt.trim(),editContext:{mode:'cad',targetFigure:input.figures[0]},instructionTargets:input.figures.map(f=>({id:f.id,version:f.version})),instructionSource:input.source||'typed'},id=randomUUID(),fit={id,solidReferences,method:'current-native-sketch-reference',results,edits,cost:{usd:0,usageKnown:true},timings:{totalMs:0},input:{strokeCount:0,groupCount:results.length,nativeTargetCount:results.length}};
 const saved={data,body:{model:'harness-current-native-geometry',input:[{role:'user',content:[{type:'input_text',text:'Current accepted CAD geometry; editing instruction without new ink.'},...(input.image?[{type:'input_image',image_url:input.image,detail:'low'}]:[])]}]}};
 return {saved,fit};
}
export async function runExistingSketchEdit(input,options={}){
 const {saved,fit}=prepareExistingSketchEdit(input),folder=path.resolve(process.env.SESSION_DIR||'sessions','decision-sketches',fit.id);saved.recordingId=options.recordingId;await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'request.json'),JSON.stringify({...saved,at:Date.now()}));await writeFile(path.join(folder,'result.json'),JSON.stringify(fit));await writeFile(path.join(folder,'response.json'),JSON.stringify({stage:'current-native-geometry',providerCalls:0,targets:saved.data.instructionTargets}));
 const result=await runSketchRefinement(saved,fit,options),touched=new Set(result.refinement.operations.filter(o=>o.action!=='omit').map(o=>o.referenceId)),changed=result.results.map((r,i)=>({r,e:result.edits[i]})).filter(({r,e})=>touched.has(r.id)||e.operation==='create');result.results=changed.map(x=>x.r);result.edits=changed.map(x=>x.e);result.noOp=!result.results.length&&!result.solidEdits?.length&&!result.refinement.question;result.instructionEdit=true;result.instructionTargets=saved.data.instructionTargets;
 for(const e of result.edits){if(e.operation==='update'&&!result.instructionTargets.some(f=>f.id===e.figureId&&f.version===e.expectedVersion))throw Error('A sketch correction must update only its current target figures');e.strokeIds=[];}
 for(const r of result.results)r.sourceStrokeIds=[];
 await writeFile(path.join(folder,'refinements',result.refinement.id,'result.json'),JSON.stringify(result));return result;
}
