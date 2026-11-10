import {hollowRevolveSection} from './hollow-revolve.js';
import {validExtrusionDepths} from './extrusion-depths.js';
import {BLENDER_EDIT_SCHEMA,validateBlenderEdits} from './blender-contract.js';
// Shared direct-response contract. Validation checks geometry and versions, never infers intent.
const str={type:'string'},num={type:'number'},vec={type:'array',items:num,minItems:3,maxItems:3};
const nullable=s=>({anyOf:[s,{type:'null'}]});
const properties={planeId:nullable(str),construction:{type:'boolean'},operation:{type:'string',enum:['create','update']},figureId:nullable(str),expectedVersion:nullable({type:'integer'}),kind:{type:'string',enum:['circle','rectangle','line','arc','spline']},name:str,origin:vec,xAxis:vec,yAxis:vec,radiusMetres:nullable(num),startAngleDeg:nullable(num),endAngleDeg:nullable(num),widthMetres:nullable(num),heightMetres:nullable(num),end:nullable(vec),segments:nullable({type:'array',items:{type:'array',items:num,minItems:8,maxItems:8},maxItems:64}),closed:{type:'boolean'},extrusionMetres:nullable(num),strokeIds:{type:'array',items:str},dimensionNote:str};
export const DESKTOP_EDIT_SCHEMA={type:'object',properties:{modelEdits:{type:'array',maxItems:1,items:BLENDER_EDIT_SCHEMA},voiceControl:nullable({type:'string',enum:['enable','pause','stop','retry','record-start','record-stop']}),requestedStrokeArchiveIds:{type:'array',items:str,maxItems:4},requestedSketchIds:{type:'array',items:str,maxItems:16},solidEdits:{type:'array',maxItems:4,items:{type:'object',properties:{revolution:nullable({type:'object',properties:{axis:{type:'string',enum:['endpoints','horizontal','vertical']},angleDegrees:num,axisOriginUV:nullable({type:'array',items:num,minItems:2,maxItems:2}),wallThicknessMetres:nullable(num)},required:['axis','angleDegrees','axisOriginUV','wallThicknessMetres'],additionalProperties:false}),name:str,kind:{type:'string',enum:['extrude','loft','intersect','union','subtract','revolve']},loftMode:{type:'string',enum:['ruled','smooth']},profiles:{type:'array',minItems:1,maxItems:8,items:{type:'object',properties:{figureId:str,expectedVersion:{type:'integer'},depthMetres:nullable(num),backDepthMetres:nullable(num)},required:['figureId','expectedVersion','depthMetres','backDepthMetres'],additionalProperties:false}}},required:['name','kind','loftMode','profiles','revolution'],additionalProperties:false}},summary:str,questionOptions:{type:'array',maxItems:4,items:str},assumptions:{type:'array',items:str},question:nullable(str),automation:nullable({type:'object',properties:{goal:str,reason:str,steps:{type:'array',minItems:1,maxItems:32,items:{type:'object',properties:{id:str,label:str,state:{type:'string',enum:['pending','active','completed']}},required:['id','label','state'],additionalProperties:false}}},required:['goal','reason','steps'],additionalProperties:false}),continuation:nullable({type:'object',properties:{reason:str,nextMove:str},required:['reason','nextMove'],additionalProperties:false}),edits:{type:'array',maxItems:16,items:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}},required:['questionOptions','summary','assumptions','question','automation','continuation','edits','solidEdits','requestedSketchIds','voiceControl','requestedStrokeArchiveIds','modelEdits'],additionalProperties:false};
const finiteVec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const positive=v=>Number.isFinite(v)&&v>0&&v<=100;
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
export function validateDesktopEdit(result,evidence){
 // Provider-authored responses remain capped at 16 in the schema. A compact
 // compose_sketch polyline can expand locally into up to 64 validated line edits.
 if(!result||typeof result!=='object'||typeof result.summary!=='string'||result.summary.length>4000||!Array.isArray(result.assumptions)||result.assumptions.some(x=>typeof x!=='string')||!(result.question===null||typeof result.question==='string')||!Array.isArray(result.edits)||result.edits.length>64)throw Error('Invalid direct drawing response');
 if(result.questionOptions===undefined)result.questionOptions=[];if(!Array.isArray(result.questionOptions)||result.questionOptions.length&&(result.questionOptions.length<2||result.questionOptions.length>4||!result.question||result.questionOptions.some(s=>typeof s!=='string'||!s.trim()||s.length>120)||new Set(result.questionOptions).size!==result.questionOptions.length))throw Error('Selection questions need 2 to 4 distinct options; freeform questions have none');
 if(result.question!==null&&(!result.question.trim()||result.question.length>600))throw Error('Ask one concise question up to 600 characters, or use null');
 if(!only(result,Object.keys(DESKTOP_EDIT_SCHEMA.properties)))throw Error('Unknown response fields');
 if(result.automation===undefined)result.automation=null;
 if(result.automation!==null){const a=result.automation;if(!only(a,['goal','reason','steps'])||!a||typeof a!=='object'||Array.isArray(a)||!['goal','reason'].every(k=>typeof a[k]==='string'&&a[k].trim()&&a[k].length<=1600)||!Array.isArray(a.steps)||!a.steps.length||a.steps.length>32||a.steps.some(s=>!only(s,['id','label','state'])||!s||!['id','label'].every(k=>typeof s[k]==='string'&&s[k].trim()&&s[k].length<=500)||!['pending','active','completed'].includes(s.state))||new Set(a.steps.map(s=>s.id)).size!==a.steps.length)throw Error('Automated mode needs a clear goal, reason and uniquely identified progress steps');}
 if(result.continuation===undefined)result.continuation=null;
 if(result.continuation!==null){const c=result.continuation;if(!only(c,['reason','nextMove'])||!c||typeof c!=='object'||Array.isArray(c)||!['reason','nextMove'].every(k=>typeof c[k]==='string'&&c[k].trim()&&c[k].length<=1200)||result.question)throw Error('An additional move needs a reason and nextMove, with no pending user question');}
 if(result.automation&&!result.question&&!result.continuation&&result.automation.steps.some(s=>s.state!=='completed'))throw Error('An unfinished automated plan must request a next move or ask the user a question');
 if(result.requestedSketchIds===undefined)result.requestedSketchIds=[];
 if(result.solidEdits===undefined)result.solidEdits=[];
 if(result.modelEdits===undefined)result.modelEdits=[];validateBlenderEdits(result.modelEdits,evidence);
 if(result.modelEdits.length&&(result.edits.length||result.solidEdits.length||result.requestedSketchIds?.length||result.requestedStrokeArchiveIds?.length||result.question||result.voiceControl))throw Error('A modeling step must be separate from sketch edits, questions and data recall');
 if(result.voiceControl===undefined)result.voiceControl=null;
 if(result.requestedStrokeArchiveIds===undefined)result.requestedStrokeArchiveIds=[];
 if(result.voiceControl!==null&&(!['enable','pause','stop','retry','record-start','record-stop'].includes(result.voiceControl)||result.edits.length||result.solidEdits.length||result.question||result.continuation))throw Error('Voice controls must not modify geometry or request continuation');
 const recall=result.requestedStrokeArchiveIds;
 if(!Array.isArray(recall)||recall.length>4||new Set(recall).size!==recall.length||recall.some(id=>id==='latest'?!evidence.strokeArchiveCatalog?.length:!evidence.strokeArchiveCatalog?.some(a=>a.id===id)))throw Error('Unknown stroke archive');
 if(recall.length&&(!result.continuation||result.edits.length||result.solidEdits.length||result.question||result.voiceControl))throw Error('recall_strokes requires continuation and no geometry changes');
 if(!Array.isArray(result.solidEdits)||result.solidEdits.length>12)throw Error('Invalid solid edits');
 if(!Array.isArray(result.requestedSketchIds)||result.requestedSketchIds.length>16||new Set(result.requestedSketchIds).size!==result.requestedSketchIds.length||result.requestedSketchIds.some(id=>!evidence.sketchCatalog?.some(s=>s.id===id)))throw Error('Unknown requested sketch output');
 if(result.requestedSketchIds.length&&(!result.continuation||result.edits.length||result.solidEdits.length||result.requestedSketchIds.some(id=>evidence.sketchOutputs?.some(s=>s.sketchId===id))))throw Error('Request missing sketch outputs with continuation and no geometry changes');
 if(result.question&&(result.edits.length||result.solidEdits.length))throw Error('A clarification must not also change geometry');
 const ids=new Set([...evidence.strokes.map(s=>s.id),...(evidence.strokeArchiveCatalog||[]).flatMap(a=>a.strokeIds||[])]),updates=new Set();
 for(const [editIndex,e] of result.edits.entries()){
  if(!only(e,Object.keys(properties)))throw Error('Invalid figure edit');
  if(e.planeId===undefined)e.planeId=e.operation==='update'?evidence.figures.find(f=>f.id===e.figureId)?.planeId??null:evidence.defaultPlane?.id??null;
  if(e.planeId!==null&&(typeof e.planeId!=='string'||evidence.sketchCatalog?.length&&!evidence.sketchCatalog.some(s=>s.plane.id===e.planeId)&&!evidence.referencePlanes?.some(p=>p.id===e.planeId)&&e.planeId!==evidence.defaultPlane?.id))throw Error('Unknown drawing plane');
  if(e.construction===undefined)e.construction=e.operation==='update'?!!evidence.figures.find(f=>f.id===e.figureId)?.construction:false;if(typeof e.construction!=='boolean')throw Error('construction must be boolean');
  if(!e||!['create','update'].includes(e.operation)||!['circle','rectangle','line','arc','spline'].includes(e.kind)||!finiteVec(e.origin)||!finiteVec(e.xAxis)||!finiteVec(e.yAxis)||typeof e.name!=='string'||typeof e.dimensionNote!=='string'||typeof e.closed!=='boolean'||!Array.isArray(e.strokeIds)||e.strokeIds.some(id=>!ids.has(id)))throw Error('Invalid figure parameters or source stroke IDs');
  if(Math.abs(dot(e.xAxis,e.xAxis)-1)>.001||Math.abs(dot(e.yAxis,e.yAxis)-1)>.001||Math.abs(dot(e.xAxis,e.yAxis))>.001)throw Error('Drawing axes must be perpendicular unit vectors');
  if(e.kind==='circle'&&!positive(e.radiusMetres)||e.kind==='rectangle'&&(!positive(e.widthMetres)||!positive(e.heightMetres)))throw Error('Invalid figure dimensions');
  if(e.kind==='line'&&(!finiteVec(e.end)||!positive(Math.hypot(...e.end.map((v,i)=>v-e.origin[i])))))throw Error('Invalid line endpoints');
  if(e.kind==='line'){const n=[e.xAxis[1]*e.yAxis[2]-e.xAxis[2]*e.yAxis[1],e.xAxis[2]*e.yAxis[0]-e.xAxis[0]*e.yAxis[2],e.xAxis[0]*e.yAxis[1]-e.xAxis[1]*e.yAxis[0]];if(Math.abs(dot(e.end.map((v,i)=>v-e.origin[i]),n))>1e-6)throw Error('Line endpoint must lie on the supplied plane');}
  if(e.kind==='arc'&&(!positive(e.radiusMetres)||!Number.isFinite(e.startAngleDeg)||!Number.isFinite(e.endAngleDeg)||!((((e.endAngleDeg-e.startAngleDeg)%360+360)%360)>0)||e.closed))throw Error('An arc needs a positive radius, finite start/end angles with a nonzero counter-clockwise sweep below 360 degrees, and closed:false');
  if(e.kind==='spline'&&(!Array.isArray(e.segments)||!e.segments.length||e.segments.length>64||e.segments.some(s=>!Array.isArray(s)||s.length!==8||!s.every(Number.isFinite))))throw Error('Spline needs finite local-plane cubic Bezier segments: edits['+editIndex+'].segments must be an array of 1 to 64 arrays, each containing exactly eight finite numbers [[x0,y0,x1,y1,x2,y2,x3,y3], ...]. A flat array or comma-separated strings are invalid; preserve the intended curve and correct its coordinate nesting.');
  if(e.extrusionMetres!==null&&(e.construction||!positive(e.extrusionMetres)||['line','arc'].includes(e.kind)||e.kind==='spline'&&!e.closed))throw Error('Extrusion requires a closed profile and positive depth');
  if(e.operation==='update'){const f=evidence.figures.find(f=>f.id===e.figureId);if(!f||f.version!==e.expectedVersion||updates.has(f.id))throw Error('Unknown, stale or repeated figure update');updates.add(f.id);}
  else if(e.figureId!==null||e.expectedVersion!==null)throw Error('New figures must not reference an existing version');
 }
 const consumedTargets=new Set();
 for (const [index,solid] of result.solidEdits.entries()) {
  const modifiesBody=['pocket','join-material','common-material'].includes(solid.kind);
  if (!only(solid,['name','kind','loftMode','profiles','revolution','targetBodyId','toolBodyId']) || (!modifiesBody&&!DESKTOP_EDIT_SCHEMA.properties.solidEdits.items.properties.kind.enum.includes(solid.kind)) || typeof solid.name !== 'string' || !['ruled','smooth'].includes(solid.loftMode)) throw Error('Invalid multi-sketch solid');
  if(modifiesBody){
   const ids=solid.toolBodyId==null?[solid.targetBodyId]:[solid.targetBodyId,solid.toolBodyId];
   for(const id of ids){
    const previous=/^feature-result:(0|[1-9]\d*)$/.exec(id);
    if(consumedTargets.has(id)||(previous?Number(previous[1])>=index:!evidence.solids?.some(s=>s.bodyId===id)))throw Error('Choose a current target body or earlier feature result');
    consumedTargets.add(id);
   }
   if(solid.toolBodyId!=null){
    if(!Array.isArray(solid.profiles)||solid.profiles.length||solid.revolution!=null)throw Error('Body booleans use two bodies without an extrusion');
    continue;
   }
  }else if(solid.targetBodyId!=null||solid.toolBodyId!=null)throw Error('Unexpected solid operands');
  const single = modifiesBody || ['extrude','revolve'].includes(solid.kind);
  const profiles = solid.profiles;
  if (!Array.isArray(profiles) || (single ? profiles.length !== 1 : profiles.length < 2) || profiles.length > 8 || new Set(profiles.map(p=>p?.figureId)).size !== profiles.length) throw Error('Invalid solid profile count');
  const revolution = solid.revolution;
  if (solid.kind === 'revolve') {
   if (!only(revolution,['axis','angleDegrees','axisOriginUV','wallThicknessMetres']) || !['endpoints','horizontal','vertical'].includes(revolution.axis) || !Number.isFinite(revolution.angleDegrees) || revolution.angleDegrees <= 0 || revolution.angleDegrees > 360) throw Error('Specify the revolve axis and an angle up to 360 degrees');
  } else if (revolution != null) throw Error('Unexpected revolve parameters');
  for (const p of profiles) {
   if (!only(p,['figureId','expectedVersion','depthMetres','backDepthMetres'])) throw Error('Unknown solid profile fields');
   const fromNew=/^new-edit:(0|[1-9]\d*)$/.exec(p.figureId);
   const draft=fromNew&&result.edits[Number(fromNew[1])];
   const original = fromNew ? (draft?.operation==='create'?{...draft,version:1}:null) : evidence.figures.find(f=>f.id===p.figureId);
   if (!original || original.version!==p.expectedVersion) throw Error('Solid needs sketch outputs at current versions');
   const profile = result.edits.find(e=>e.operation==='update' && e.figureId===p.figureId) || original;
   if(revolution?.wallThicknessMetres!=null&&(!positive(revolution.wallThicknessMetres)||!['horizontal','vertical'].includes(revolution.axis)))throw Error('Hollow revolve needs positive wall thickness and a sketch axis');
   if(revolution?.axisOriginUV!=null&&(!Array.isArray(revolution.axisOriginUV)||revolution.axisOriginUV.length!==2||!revolution.axisOriginUV.every(Number.isFinite)))throw Error('Invalid revolve axis position');
   const endpointAxis = revolution?.axis==='endpoints'||revolution?.wallThicknessMetres>0;
   const usable = endpointAxis ? profile.kind==='spline' && !profile.closed : ['circle','rectangle'].includes(profile.kind) || profile.kind==='spline' && profile.closed;
   if (profile.construction || !usable) throw Error('Solid needs a closed sketch, or an open spline for an endpoint revolve');
   if (revolution?.wallThicknessMetres) hollowRevolveSection(profile,revolution);
   else if (revolution?.axisOriginUV?.some(v=>v!==0)) throw Error('An offset revolve axis is supported for a hollow meridian. For a filled revolve use a sketch axis through its origin or an endpoint axis.');
   const depthFree = ['loft','revolve'].includes(solid.kind);
   if (depthFree ? p.depthMetres!==null || p.backDepthMetres!==null : !validExtrusionDepths(p.depthMetres,p.backDepthMetres)) throw Error('Invalid solid profile depths');
  }
 }
 return result;
}
