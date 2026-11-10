import {placementMatrix,transformSpatialParameters} from './model-spatial.js';
import {MASK_SELECTION_SCHEMA,MASK_REPORT_SCHEMA,validateMaskReport} from './spatial-mask-contract.js';
import {validateMaskSelection} from './spatial-mask-fit.js';
// Shared browser/server validation for direct VR edits. Geometry checks never infer intent.
import {DESKTOP_EDIT_SCHEMA,validateDesktopEdit} from './desktop-edit-contract.js';
import {createSurface} from './surface-math.js';
const str={type:'string'},num={type:'number'},vec={type:'array',items:num,minItems:3,maxItems:3};
const nullable=s=>({anyOf:[s,{type:'null'}]});
export const SPATIAL_KINDS=['cuboid','spheroid','cylinder','circle3d','spline3d','splineSurface','plane','rectangle3d','extrusion','ellipsoid','ellipse3d','line3d','polyline3d','profileExtrusion','revolved','sweep'];
const parameterProperties={profilePoints:nullable({type:'array',items:{type:'array',items:num,minItems:2,maxItems:2},minItems:2,maxItems:128}),angleDeg:nullable(num),profileFigureId:nullable(str),profileVersion:nullable({type:'integer'}),profileKind:nullable({type:'string',enum:['circle3d','rectangle3d']}),planeFigureId:nullable(str),depthMetres:nullable(num),center:nullable(vec),axes:nullable({type:'array',items:vec,minItems:3,maxItems:3}),sizeMetres:nullable(vec),radiiMetres:nullable(vec),radiusMetres:nullable(num),heightMetres:nullable(num),points:nullable({type:'array',items:vec,minItems:2,maxItems:128}),closed:nullable({type:'boolean'}),controlNet:nullable({type:'array',items:{type:'array',items:vec,minItems:4,maxItems:10},minItems:4,maxItems:10}),knotsU:nullable({type:'array',items:num,maxItems:14}),knotsV:nullable({type:'array',items:num,maxItems:14})};
const editProperties={coordinateReference:nullable({type:'object',properties:{modelId:str,expectedVersion:{type:'integer'}},required:['modelId','expectedVersion'],additionalProperties:false}),maskFit:nullable(MASK_SELECTION_SCHEMA),maskFitReport:nullable(MASK_REPORT_SCHEMA),operation:{type:'string',enum:['create','update']},figureId:nullable(str),expectedVersion:nullable({type:'integer'}),candidateId:nullable(str),kind:{type:'string',enum:SPATIAL_KINDS},name:str,parameters:nullable({type:'object',properties:parameterProperties,required:Object.keys(parameterProperties),additionalProperties:false}),strokeIds:{type:'array',items:str,maxItems:128},dimensionNote:str};
export const SPATIAL_EDIT_SCHEMA={type:'object',properties:{...Object.fromEntries(['summary','assumptions','questionOptions','question','automation','continuation','voiceControl','requestedStrokeArchiveIds','modelEdits'].map(k=>[k,DESKTOP_EDIT_SCHEMA.properties[k]])),edits:{type:'array',maxItems:16,items:{type:'object',properties:editProperties,required:Object.keys(editProperties),additionalProperties:false}}}};
SPATIAL_EDIT_SCHEMA.required=Object.keys(SPATIAL_EDIT_SCHEMA.properties);SPATIAL_EDIT_SCHEMA.additionalProperties=false;
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
const finite=v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=10000);
const positive=x=>Number.isFinite(x)&&x>=.00001&&x<=100;
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
export function validateSpatialParameters(kind,p){
 if(!SPATIAL_KINDS.includes(kind)||!only(p,Object.keys(parameterProperties)))throw Error('Unknown spatial geometry or parameter fields');
 if(['cuboid','spheroid','cylinder','circle3d','plane','rectangle3d','extrusion','ellipsoid','ellipse3d','profileExtrusion','revolved'].includes(kind)){
  if(!finite(p.center)||!Array.isArray(p.axes)||p.axes.length!==3||p.axes.some(a=>!finite(a)||Math.abs(dot(a,a)-1)>.001)||Math.abs(dot(p.axes[0],p.axes[1]))>.001||Math.abs(dot(p.axes[0],p.axes[2]))>.001||Math.abs(dot(p.axes[1],p.axes[2]))>.001)throw Error('Spatial primitives need a finite center and orthonormal axes');
  const [a,b,c]=p.axes,cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];if(dot(cross,c)<.999)throw Error('Spatial axes must be right-handed');
  if(['plane','rectangle3d'].includes(kind)&&(!finite(p.sizeMetres)||!p.sizeMetres.slice(0,2).every(positive)||p.sizeMetres[2]!==0))throw Error('Plane/rectangle needs positive X/Y sizes and zero Z thickness');
  if(kind==='extrusion'&&(!['circle3d','rectangle3d'].includes(p.profileKind)||typeof p.profileFigureId!=='string'||!Number.isInteger(p.profileVersion)||!positive(p.depthMetres)||p.profileKind==='circle3d'&&!positive(p.radiusMetres)||p.profileKind==='rectangle3d'&&(!finite(p.sizeMetres)||!p.sizeMetres.slice(0,2).every(positive))))throw Error('Extrusion needs a versioned closed profile and positive depth');
  if(kind==='cuboid'&&(!finite(p.sizeMetres)||!p.sizeMetres.every(positive)))throw Error('Cuboid needs three positive full sizes');
  if(kind==='spheroid'&&(!finite(p.radiiMetres)||!p.radiiMetres.every(positive)||Math.abs(p.radiiMetres[0]-p.radiiMetres[2])>1e-6))throw Error('Spheroid needs positive radii with equal X/Z equatorial radii');
  if(kind==='circle3d'&&!positive(p.radiusMetres))throw Error('3D circle needs a positive radius');
  if(kind==='cylinder'&&(!positive(p.radiusMetres)||!positive(p.heightMetres)))throw Error('Cylinder needs positive radius and full height');
 }
 if(kind==='ellipsoid'&&(!finite(p.radiiMetres)||!p.radiiMetres.every(positive)))throw Error('Ellipsoid needs three positive radii');
 if(kind==='ellipse3d'&&(!finite(p.radiiMetres)||!p.radiiMetres.slice(0,2).every(positive)||p.radiiMetres[2]!==0))throw Error('Ellipse needs positive X/Y radii and zero Z');
 if(['profileExtrusion','revolved'].includes(kind)){if(!Array.isArray(p.profilePoints)||p.profilePoints.length<(kind==='profileExtrusion'?3:2)||p.profilePoints.length>128||p.profilePoints.some(v=>!Array.isArray(v)||v.length!==2||v.some(x=>!Number.isFinite(x)||Math.abs(x)>100)))throw Error('Profile needs finite local XY points');if(kind==='profileExtrusion'&&!positive(p.depthMetres))throw Error('Profile extrusion needs positive depth');if(kind==='revolved'&&(!(p.angleDeg>0&&p.angleDeg<=360)||p.profilePoints.some(p=>p[0]<0)))throw Error('Revolution needs positive angle and nonnegative radii');}
 if(kind==='sweep'&&!positive(p.radiusMetres))throw Error('Sweep needs a measured positive tube radius');
 if(['line3d','polyline3d','sweep'].includes(kind)&&(!Array.isArray(p.points)||p.points.length<2||p.points.length>128||p.points.some(v=>!finite(v))||typeof p.closed!=='boolean'||!p.points.some(v=>Math.hypot(...v.map((x,i)=>x-p.points[0][i]))>1e-6)))throw Error('Path needs distinct finite points and closed flag');
 if(kind==='spline3d'&&(!Array.isArray(p.points)||p.points.length<2||p.points.length>128||p.points.some(v=>!finite(v))||typeof p.closed!=='boolean'||!p.points.some(v=>Math.hypot(...v.map((x,i)=>x-p.points[0][i]))>1e-6)))throw Error('3D spline needs 2 to 128 distinct finite interpolation points and closed flag');
 if(kind==='spline3d'&&p.closed&&new Set(p.points.map(p=>JSON.stringify(p))).size<3)throw Error('A closed 3D curve needs at least three distinct points');
 if(kind==='splineSurface'){const s=createSurface({kind:'control-net',...p}),points=s.controlNet.flat();if(points.some(p=>!finite(p)))throw Error('Surface control coordinates out of range');const vectors=points.map(p=>p.map((v,i)=>v-points[0][i])),a=vectors.reduce((best,v)=>dot(v,v)>dot(best,best)?v:best,[0,0,0]);if(!vectors.some(b=>Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])>1e-12))throw Error('Surface control net is collapsed to a point or line');}
 return p;
}
export function resolveSpatialParameters(e,evidence){
 const current=evidence.figures.find(f=>f.id===e.figureId),candidate=e.candidateId===null?null:evidence.spatialFit?.candidates.find(c=>c.id===e.candidateId);
 if(e.candidateId!==null&&(!candidate||candidate.kind!==e.kind))throw Error('Unknown or mismatched spatial candidate');
 let base=candidate?.parameters||(e.operation==='update'&&current?.kind===e.kind?current.parameters:{});
 if(candidate&&e.coordinateReference){const reference=evidence.models.find(m=>m.id===e.coordinateReference.modelId);base=transformSpatialParameters(base,placementMatrix(reference).invert());}else if(candidate&&e.operation==='update'&&current?.placement)base=transformSpatialParameters(base,placementMatrix(current.placement).invert());
 if(e.parameters!==null&&!only(e.parameters,Object.keys(parameterProperties)))throw Error('Invalid spatial parameter overrides');
 const p={...structuredClone(base),...Object.fromEntries(Object.entries(e.parameters||{}).filter(([,v])=>v!==null))};
 if(p.planeFigureId){const plane=evidence.figures.find(f=>f.id===p.planeFigureId&&f.kind==='plane');if(!plane)throw Error('Unknown reference plane');if(!p.center)p.center=structuredClone(plane.parameters.center);if(!p.axes)p.axes=structuredClone(plane.parameters.axes);}
 if(e.kind==='extrusion'){
  const profile=evidence.figures.find(f=>f.id===p.profileFigureId);
  if(!profile||profile.version!==p.profileVersion||!['circle3d','rectangle3d'].includes(profile.kind))throw Error('Unknown or stale closed extrusion profile');
  const profileParameters=profile.placement?transformSpatialParameters(profile.parameters,placementMatrix(profile.placement)):profile.parameters;
  Object.assign(p,{profileKind:profile.kind,center:structuredClone(profileParameters.center),axes:structuredClone(profileParameters.axes),radiusMetres:profileParameters.radiusMetres??null,sizeMetres:profileParameters.sizeMetres??null});
 }
 return validateSpatialParameters(e.kind,p);
}
export function validateSpatialEdit(result,evidence){
 if(!only(result,Object.keys(SPATIAL_EDIT_SCHEMA.properties)))throw Error('Unknown spatial response fields');
 // Reuse the shared plan/question/continuation checks without desktop geometry rules.
 const envelope={...result,edits:[],solidEdits:[],requestedSketchIds:[]};validateDesktopEdit(envelope,{...evidence,figures:[]});
 if(!Array.isArray(result.edits)||result.edits.length>16||(result.question||result.voiceControl||result.requestedStrokeArchiveIds?.length||result.modelEdits?.length)&&result.edits.length)throw Error('Invalid spatial edits or edits accompanying a question');
 const ids=new Set([...evidence.strokes.map(s=>s.id),...(evidence.strokeArchiveCatalog||[]).flatMap(a=>a.strokeIds||[])]),updates=new Set();
 for(const e of result.edits){
  if(!only(e,Object.keys(editProperties))||!['create','update'].includes(e.operation)||!SPATIAL_KINDS.includes(e.kind)||typeof e.name!=='string'||!e.name.trim()||e.name.length>300||typeof e.dimensionNote!=='string'||e.dimensionNote.length>2000||!Array.isArray(e.strokeIds)||e.strokeIds.some(id=>!ids.has(id)))throw Error('Invalid spatial edit or source stroke IDs');
  if(e.operation==='update'){const f=evidence.figures.find(f=>f.id===e.figureId);if(!f||f.version!==e.expectedVersion||updates.has(f.id))throw Error('Unknown, stale or repeated spatial figure update');updates.add(f.id);}else if(e.figureId!==null||e.expectedVersion!==null)throw Error('New spatial figures must not reference a version');
  if(e.coordinateReference){const r=e.coordinateReference,m=evidence.models?.find(m=>m.id===r.modelId),current=evidence.figures.find(f=>f.id===e.figureId);if(!only(r,['modelId','expectedVersion'])||!m||m.hidden||m.version!==r.expectedVersion||current?.modelId===m.id)throw Error('Unknown, stale or self-referencing spatial coordinate frame');let parent=m;const seen=new Set();while(parent?.coordinateParent){if(seen.has(parent.id)||parent.coordinateParent.modelId===current?.modelId)throw Error('Cyclic spatial coordinate frame');seen.add(parent.id);parent=evidence.models.find(m=>m.id===parent.coordinateParent.modelId);}}
  if(e.maskFit){validateMaskSelection(e.maskFit,evidence);if(e.maskFitReport)validateMaskReport(e.maskFitReport,e.maskFit,evidence);}
  resolveSpatialParameters(e,evidence);
 }
 return result;
}
