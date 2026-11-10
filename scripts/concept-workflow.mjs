// Server-only concept review; no CAD mutation before explicit user confirmation.
import {readProvider} from './provider-read.mjs';
import {cloudVertexReady,vertexTranscript} from './vertex-cloud.mjs';
import {createHash,randomUUID} from 'node:crypto';
export const CONCEPT_MODE=()=>process.env.DRAW3D_CREATION_WORKFLOW==='concepts';
export const CONCEPT_IMAGE_MODEL=()=>process.env.DRAW3D_CONCEPT_IMAGE_MODEL||'gpt-image-2.5-flare';
const image=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export function conceptSignature(e){return createHash('sha256').update(JSON.stringify({strokes:e.strokes.map(s=>({id:s.id,points:s.points,surface:s.surface,objectAttachment:s.objectAttachment})),models:e.models?.map(m=>({id:m.id,version:m.version,position:m.position,rotationDeg:m.rotationDeg,scale:m.scale})),selectedSurface:e.selectedSurface})).digest('hex');}
export function conceptReferences(e){const frames=e.frames.filter(f=>image.test(f.image||''));const preferred=[...frames.filter(f=>/^native-scene-/.test(f.layer)),...frames.filter(f=>/^spatial-(front|top|right)$/.test(f.layer)),...frames.filter(f=>/^model-(front|top|right)$/.test(f.layer)),...frames.filter(f=>f.layer==='drawing')];return [...new Map([...preferred,...frames].map(f=>[f.id||f.layer,f])).values()].slice(0,8);}
const options=[{label:'Closest to your sketch',direction:'Conservative interpretation. Preserve drawn silhouette, proportions, topology, rounded ends, part count and relative placement.'},{label:'Regular CAD interpretation',direction:'A second plausible interpretation: resolve ambiguity with symmetry, perpendicularity, equal repeated sizes and simple regular shapes, preserving explicit intent and drawn parts.'},{label:'Alternative interpretation',direction:'A meaningfully different plausible interpretation of ambiguous depth, joins or component structure. Preserve the request and scale; do not add unrelated features just to differ.'}];
const publicJob=j=>({recoveredFrom:j.recoveredFrom,sceneChanged:j.sceneChanged,sourcePrompt:j.sourcePrompt,id:j.id,status:j.status,prompt:j.prompt,createdAt:j.createdAt,imageModel:j.imageModel,selected:j.selected,confirmedAt:j.confirmedAt,error:j.error,events:j.events.slice(-30),candidates:j.candidates});
async function providerJSON(response){const data=await response.json();if(!response.ok)throw Error('OpenAI '+response.status+': '+(data.error?.message||'request failed'));return data;}
async function readTranscript(response,onTranscript) {
 if (!response.ok || !response.headers?.get?.('content-type')?.includes('text/event-stream')) {
  return (await providerJSON(response)).text || '';
 }
 const decoder=new TextDecoder();
 let buffer='',partial='',final;
 function consume(line) {
  if(!line.startsWith('data:'))return;
  const payload=line.slice(5).trim();
  if(!payload||payload==='[DONE]')return;
  const event=JSON.parse(payload);
  if(event.type==='transcript.text.delta'){partial+=event.delta||'';onTranscript?.(partial);}
  if(event.type==='transcript.text.done')final=event.text;
  if(event.type==='error'||event.error)throw Error(event.error?.message||event.message||'Transcription stream failed');
 }
 for await(const chunk of response.body){
  buffer+=decoder.decode(chunk,{stream:true});
  const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(consume);
 }
 consume(buffer+decoder.decode());
 if(typeof final!=='string')throw Object.assign(Error('Transcription stream ended before the final transcript'),{transient:true});
 return final;
}
export async function transcribeConceptAudio(inputs,{fetcher=fetch,signal,sketchSpeech=false,onTranscript,onRetry}={}){
 if(!process.env.OPENAI_API_KEY&&cloudVertexReady())return vertexTranscript(inputs,{fetcher,signal,onTranscript});
 if(!Array.isArray(inputs)||inputs.length>8)throw Error('Invalid concept audio inputs');const parts=[];
 for(const a of inputs){if(a?.mimeType!=='audio/wav'||typeof a.audio!=='string'||a.audio.length>12000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(a.audio))throw Error('Invalid concept WAV recording');
 const form=new FormData();form.set('model',process.env.DRAW3D_TRANSCRIPTION_MODEL||'gpt-transcribe');form.set('file',new Blob([Buffer.from(a.audio,'base64')],{type:'audio/wav'}),'instruction.wav');
 if(sketchSpeech)form.set('prompt','This is a spoken CAD session. Vocabulary may include extrude, extrusion, revolve, loft, fillet and chamfer. Preserve ordinary speech as spoken.');
 if(onTranscript)form.set('stream','true');
 const data=await readProvider(fetcher,'https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},body:form,signal:signal||AbortSignal.timeout(60000)},response=>readTranscript(response,onTranscript),{stage:'Transcription',onRetry});if(data.trim())parts.push(data.trim());}return parts.join('\n');
}
export class ConceptWorkflow {
 constructor({fetcher=fetch}={}){this.jobs=new Map();this.fetcher=fetcher;}
 note(j,message){j.events.push({at:Date.now(),message});}
 start(owner,{prompt,evidence,requestContext=null}){
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>12000)throw Error('Describe the drawn object before generating concepts');if(!evidence?.strokes?.length&&!evidence?.models?.some(m=>!m.hidden)&&!evidence?.figures?.length)throw Error('Draw a figure or create CAD before generating concepts');
  const refs=conceptReferences(evidence);if(refs.length<(evidence.workspace==='vr'?3:1))throw Error('Concept review needs at least three drawing views in VR');this.cancel(owner);
  const j={id:randomUUID(),createdAt:Date.now(),status:'generating',prompt,signature:conceptSignature(evidence),imageModel:CONCEPT_IMAGE_MODEL(),selected:null,requestContext,events:[],controller:new AbortController(),candidates:options.map((o,i)=>({id:i,label:o.label,status:'generating'}))};this.jobs.set(owner,j);this.note(j,'Sketch captured from '+refs.length+' views · generating three alternatives in parallel');
  const metrics={units:evidence.units,coordinateSystem:evidence.coordinateSystem,strokes:evidence.strokes.map(s=>({id:s.id,bounds:s.points.reduce((b,p)=>({min:p.map((v,i)=>Math.min(v,b.min[i])),max:p.map((v,i)=>Math.max(v,b.max[i]))}),{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}),role:s.spatialRole})),models:evidence.models?.filter(m=>!m.hidden).map(m=>({id:m.id,name:m.name,worldBounds:m.worldBounds,features:m.blender?.features?.map(f=>({operation:f.operation,parameters:f.parameters}))})),selection:evidence.modeling?.selection,views:refs.map(f=>({layer:f.layer,view:f.view}))};
  j.completion=Promise.allSettled(options.map(async(o,i)=>{const c=j.candidates[i],start=performance.now();try{
   const body={model:j.imageModel,images:refs.map(f=>({image_url:f.image})),n:1,size:'1024x1024',quality:'low',output_format:'jpeg',output_compression:80,background:'opaque',prompt:`Create ONE clear isometric industrial-design concept of the object this person is trying to draw. Inputs are DIFFERENT VIEWS OF THE SAME 3D SKETCH and scene, not separate objects. User instruction (design data): ${JSON.stringify(prompt)}. Candidate ${i+1}: ${o.direction} The current CAD is the starting point. Show the requested FINAL product, retaining unchanged parts and dimensions. A removable lid/cap remains distinct from its container, with an understandable seam.\nUse shaded neutral CAD solids with dark edges on a light plain background, full object centered, no text, collage, UI, hands or dimensions. Preserve functional intent; do not trace accidental wobble. Keep distinct wheels/supports/parts distinct, never enclose unrelated strokes in one spheroid. Deterministic fits suggest only scale and direction; infer actual shape from images and words. Existing objects are context, not permission to redesign them. The application already generates three separate candidate cards. This API call must show EXACTLY ONE complete product and ONE design variant, never a contact sheet, repeated product, triptych or multiple alternative handles, even if the quoted user instruction requests three alternatives. A requested handle must be usable, with a grip opening, not a solid protrusion. Illustrative proposal only. Coordinate/size reference: ${JSON.stringify(metrics).slice(0,18000)}`};
   const data=await providerJSON(await this.fetcher('https://api.openai.com/v1/images/edits',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.OPENAI_API_KEY},body:JSON.stringify(body),signal:AbortSignal.any([j.controller.signal,AbortSignal.timeout(120000)])}));const b64=data.data?.[0]?.b64_json;if(!b64||!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)||b64.length>12000000)throw Error('Image model returned no usable concept');if(j.controller.signal.aborted)return;
   Object.assign(c,{status:'ready',image:'data:image/jpeg;base64,'+b64,elapsedMs:Math.round(performance.now()-start)});this.note(j,'Candidate '+(i+1)+' ready · '+c.elapsedMs+' ms');
  }catch(e){if(j.controller.signal.aborted)return;c.status='failed';c.error=String(e.message).split(process.env.OPENAI_API_KEY||'__no_key__').join('[REDACTED]');this.note(j,'Candidate '+(i+1)+' failed · '+c.error);}})).then(()=>{if(j.status==='generating'){j.status=j.candidates.some(c=>c.status==='ready')?'awaiting_selection':'failed';this.note(j,j.status==='failed'?'Concept generation failed · retry with saved drawing':'Choose a concept, then confirm to start modeling');}});return publicJob(j);
 }
 restore(owner,{snapshot,evidence,recordingId}){
  if(!snapshot||snapshot.version!==1||snapshot.recordingId!==recordingId||!recordingId||typeof snapshot.prompt!=='string'||snapshot.prompt.length>12000)throw Error('Saved concept review is not in this recording');
  const old=snapshot.job,originalGoal=String(snapshot.originalGoal||snapshot.goalPrompts?.map(p=>p.text||'').join('\n')||snapshot.prompt).trim();if(!originalGoal||originalGoal.length>12000||!old||!Array.isArray(old.candidates)||old.candidates.length!==3)throw Error('Saved review needs its original goal and three candidate cards');
  let bytes=0;const candidates=old.candidates.map((c,i)=>{if(c.id!==i||typeof c.label!=='string'||c.label.length>160)throw Error('Invalid saved candidate card');if(c.status==='ready'){if(typeof c.image!=='string'||!image.test(c.image)||c.image.length>12000000)throw Error('Saved candidate image is unavailable');bytes+=c.image.length;return {id:i,label:c.label,status:'ready',image:c.image,elapsedMs:c.elapsedMs};}return {id:i,label:c.label,status:'failed',error:'Image generation was interrupted. Generate alternatives to replace this card.'};});if(bytes>26000000||!candidates.some(c=>c.status==='ready'))throw Error('No completed saved candidate image can be restored');
  const signature=conceptSignature(evidence);let sceneChanged=true;try{sceneChanged=conceptSignature(snapshot.evidence)!==signature;}catch{}
  this.cancel(owner);const selected=Number.isInteger(old.selected)&&candidates[old.selected]?.status==='ready'?old.selected:null,j={id:randomUUID(),createdAt:Date.now(),status:'awaiting_selection',prompt:originalGoal,sourcePrompt:snapshot.prompt,signature,imageModel:old.imageModel||CONCEPT_IMAGE_MODEL(),selected,requestContext:null,recoveredFrom:old.id,sceneChanged,events:[],controller:new AbortController(),candidates};this.jobs.set(owner,j);this.note(j,sceneChanged?'Saved alternatives restored; scene/input changed. Review the images and explicitly confirm again, or regenerate.':'Saved alternatives restored. Choose and explicitly confirm before modeling.');return publicJob(j);
 }
 get(owner,id){const j=this.jobs.get(owner);if(!j||id&&j.id!==id)throw Error('Concept review expired; generate candidates again');return j;}
 status(owner,id){return publicJob(this.get(owner,id));}
 select(owner,{id,candidateId}){const j=this.get(owner,id);if(!['generating','awaiting_selection'].includes(j.status)||!j.candidates.some(c=>c.id===candidateId&&c.status==='ready'))throw Error('Choose a completed candidate');j.selected=candidateId;this.note(j,'Candidate '+(candidateId+1)+' selected · waiting for confirmation');return publicJob(j);}
 confirm(owner,{id,evidence}){const j=this.get(owner,id);if(!['generating','awaiting_selection'].includes(j.status)||j.selected===null||j.candidates[j.selected]?.status!=='ready')throw Error('Select a completed concept before confirming');if(j.signature!==conceptSignature(evidence))throw Error('The drawing or object placement changed; regenerate concepts before confirming');j.status='confirmed';j.confirmedAt=Date.now();this.note(j,'Confirmed · Creating design '+(j.selected+1));return publicJob(j);}
 consume(owner,id,evidence,prompt,confirmedOnly=false){const j=this.get(owner,id);if(j.status!=='confirmed'||!confirmedOnly&&j.signature!==conceptSignature(evidence)||j.prompt!==prompt)throw Error('Confirm a concept for the current drawing and instruction before modeling');j.status='building';const c=j.candidates[j.selected];return {id:j.id,candidateId:c.id,label:c.label,image:c.image,prompt:j.prompt,confirmedAt:j.confirmedAt,imageModel:j.imageModel};}
 consumeForRun(owner,id,run){const j=this.get(owner,id);if(j.status!=='confirmed'||j.requestContext?.runId!==run.id||j.requestContext?.toolCallId!==run.edit?.visualizationRequest?.toolCallId)throw Error('Confirm the visualization requested by this modeling move');return this.consume(owner,id,{strokes:[]},j.prompt,true);}
 cancel(owner){const j=this.jobs.get(owner);if(j){j.controller.abort();if(j.status!=='building')j.status='cancelled';}}
}
export const conceptWorkflow=new ConceptWorkflow();
