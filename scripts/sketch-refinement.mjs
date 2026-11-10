import {resumeSketchWork} from '../src/sketch-work-history.js';
import {separateBaseGuide} from './sketch-feature-guides.mjs';
import {classifyInstruction} from './sketch-instruction-intent.mjs';
import {decisionCost} from './decision-sketch-api.mjs';
import {sketchTask,verifySketchDeliverable,verifyRequestedOperation} from './sketch-task.mjs';
import {markedArcOperations,markedArcSchema} from './marked-arc.mjs';
import {compileFeaturePlan,featurePlanSchema} from './sketch-feature-plan.mjs';
import {sketchBodyCut} from './sketch-body-cut.mjs';
import {displacedSectionHypothesis} from './parallel-depth-hypotheses.mjs';
import {wireframeCandidates} from './wireframe-sketch.mjs';
import {revolveSection} from '../src/revolve-section.js';
import {hollowRevolveSection} from '../src/hollow-revolve.js';
import {constructSketchPlane} from '../src/plane-construction.js';
import {readFileSync} from 'node:fs';
import {designSymmetricSection} from './symmetric-body-design.mjs';
import {verifyDecisionFigure} from '../src/decision-sketch/harness.js';
import {regularizeSketch} from '../src/sketch-regularization.js';
import {pickImageSurface,surfaceProjectionCandidates,surfaceSceneCatalog} from '../src/image-surface-pick.js';
import {planeProjectionCandidates,capturePlaneEvidence} from './decision-plane-support.mjs';
import {circleFit,bounds,resample,deviation} from '../src/decision-sketch/math.js';
import {projectRecordedStroke} from '../src/view-plane-projection.js';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sendOpenAIResponse} from './openai-provider.mjs';
import {speechInkContent,speechMetadata} from './speech-ink-image.mjs';
import {renderDecisionInk} from './decision-ink-image.mjs';
import {DESKTOP_EDIT_SCHEMA,validateDesktopEdit} from '../src/desktop-edit-contract.js';
import {sketchFrame} from '../src/desktop-sketch-fit.js';
import {viewAlignedPlane} from '../src/desktop-plane-safety.js';
import {recognizeGroup,decisionResultEdit} from '../src/decision-sketch/recognize.js';
import {sampleDraftSegment} from '../src/desktop-measured-draft.js';
const num={type:'number'},str={type:'string'},nullable=x=>({anyOf:[x,{type:'null'}]}),array=n=>({type:'array',items:num,minItems:n,maxItems:n}),object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const frameWorld=(p,f)=>f.origin.map((v,k)=>v+p[0]*f.xAxis[k]+p[1]*f.yAxis[k]),uv=(p,f)=>[f.xAxis,f.yAxis].map(a=>a.reduce((n,v,k)=>n+v*(p[k]-f.origin[k]),0));
export function refinementCost(usage,model='gpt-6.1-terra'){
 const rates={date:'2026-11-05',inputPerMillion:1,cacheReadPerMillion:.05,cacheWritePerMillion:1.25,outputPerMillion:5,source:'https://developers.openai.com/api/docs/models/gpt-6.1-terra'};
 if(model!=='gpt-6.1-terra'||!Number.isFinite(usage?.input_tokens)||!Number.isFinite(usage?.output_tokens))return {usd:null,usageKnown:false,rates};
 const total=usage.input_tokens,read=Math.min(total,Math.max(0,usage.input_tokens_details?.cached_tokens||0)),write=Math.min(total-read,Math.max(0,usage.input_tokens_details?.cache_write_tokens||0));return {usd:((total-read-write)+read*.05+write*1.25+usage.output_tokens*5)/1e6,usageKnown:true,inputTokens:total,cachedTokens:read,cacheWriteTokens:write,outputTokens:usage.output_tokens,rates};
}
export function refinementSchema(fit){const schema=object({summary:str,question:nullable(str),operations:{type:'array',maxItems:32,items:object({referenceId:{type:'string',enum:fit.results.map(r=>r.id)},regularization:nullable(object({smooth:{type:'boolean'},symmetry:{type:'string',enum:['preserve','none','one','horizontal','vertical','both','four']}})),action:{type:'string',enum:['adjust','replace','omit','project','regularize']},translationUV:nullable(array(2)),rotationDegrees:nullable(num),scaleUV:nullable(array(2)),dimensions:nullable(object({radiusMetres:nullable(num),widthMetres:nullable(num),heightMetres:nullable(num),extrusionMetres:nullable(num)})),replacement:nullable(DESKTOP_EDIT_SCHEMA.properties.edits.items),projection:nullable(object({base:{type:'string',enum:['view','plane','surface']},planeId:nullable(str),imagePoint:nullable(array(2)),offsetMetres:num,angleXDegrees:nullable(num),angleYDegrees:nullable(num),throughOrigin:{type:'boolean'},representation:{type:'string',enum:['circle','ellipse','rectangle','line','arc','mixed','spline']},closed:{type:'boolean'}}))})},additions:{type:'array',maxItems:16,items:DESKTOP_EDIT_SCHEMA.properties.edits.items}});schema.properties.bodyDesign=nullable(object({name:str,form:{type:'string',enum:['revolve','extrude']},referenceId:{type:'string',enum:fit.results.map(r=>r.id)},axisDegrees:num,halfOutline:{type:'array',minItems:3,maxItems:30,items:array(2)},thicknessMetres:nullable(num)}));
 schema.required.push('bodyDesign');
 if(fit.wireframes?.length){
  schema.properties.wireframeBody=nullable(object({candidateId:{type:'string',enum:fit.wireframes.map(w=>w.id)},name:str,sectionStyle:{type:'string',enum:['uniform','tapered']},offsetMetres:nullable(num)}));
  schema.required.push('wireframeBody');
 }
 if(fit.solidReferences?.length){schema.properties.solidEdits=structuredClone(DESKTOP_EDIT_SCHEMA.properties.solidEdits);schema.properties.solidEdits.items.properties.profiles.items.properties.figureId={type:'string',enum:fit.solidReferences.map(f=>f.figureId)};schema.required.push('solidEdits');
 if(fit.edits.some(e=>e.kind==='spline'&&e.closed)){
  schema.properties.keepAsDrawn={type:'array',maxItems:32,items:{type:'string',enum:fit.results.map(r=>r.id)},description:'Fitted reference IDs whose intentional asymmetry must be retained during solid construction.'};
  schema.required.push('keepAsDrawn');
 }}return schema;}
const constructionPolicy="Before a solid feature, make its driving silhouette geometrically symmetric when intended. Use regularize with horizontal or vertical to lock reflection in the current sketch axes. For a revolve use the matching local axis. For a designed rotational object bodyDesign mirrors its half-outline automatically. Indicate intentional asymmetric sections in keepAsDrawn; respect local repairs, open meridians, off-axis holes and explicit instructions. When partContext is present, its bodies are committed, editable reference parts. New ink starts another component by default. Reuse their placement and edges for alignment. Modify a committed part only when the user selects or requests that edit. Use speechInputs to resolve each spoken instruction against its own strokeIds, linked figureIds and view. Use these associations for local changes and preserve other features. For a full symmetric silhouette use the axis of symmetry, never the rim or baseline chord unless explicitly requested. An Update line is a newer instruction for the same work in progress. Apply all compatible requirements and use the newest value for conflicts. With new ink, fit: IDs refer to newly fitted sections at version 1; native IDs refer to existing editable sketches. A new reference line can guide a revolve of an existing outline. hollowAxisOptions are geometrically tested axes and opening positions, ranked by how naturally the crown meets the axis. For an explicit hollow/revolve request use the most plausible option given the image and instruction, state your assumed axis/opening, and proceed. An unspecified end or axis alone does not require a question for a reversible preview. Keep explicit dimensions authoritative. Follow the user's explicit requirements. Preserve hollow versus solid, opening, thickness, orientation and chosen dimensions. Do not ask permission to substitute the opposite design when a capability is missing. Infer ordinary dimensions and axes from the supplied image and existing geometry, state reasonable defaults briefly, and execute. Ask only when essential missing information cannot reasonably be inferred. After the user answers, carry it out without asking again. For a hollow revolved cap from an OPEN outer spline meridian, use solidEdits kind=revolve with revolution={axis:horizontal|vertical,axisOriginUV:[u,v],angleDegrees:360,wallThicknessMetres:thickness}. Choose the axis through the common crown endpoint of mirrored curves, use ONE side profile (do not revolve both mirrored sides), and set both depth fields null. The harness creates a dependent inward-offset wall section, keeps the rim open, closes the crown, and revolves it into a hollow body. It supports this directly without a separate shell tool. Default thickness to 3 mm when unspecified and compatible with scale, explaining the estimate. Use null wallThicknessMetres/axisOriginUV for ordinary solid revolves.";
export const REFINEMENT_INSTRUCTIONS=`You edit a user's CAD sketch after an initial numerical fitting step. The original drawing images and spoken/typed user instruction are authoritative. Initial fits are editable references for size, location, orientation and continuity, not ground truth for the intended shape. Carry out the user's request now. Start from the fitted outline. Use the image and instruction to decide which features to change. If a symmetric version of this drawing is requested, retain the relative lengths, widths, narrow portions and transitions of that outline. Use one-axis regularization when one mirror axis is intended. Keep useful fitted geometry; do not regenerate every coordinate. Do not undo a sensible closure or regularity decision merely to trace pen-lift gaps, tails or wobble. Preserve an opening when it is intentional, especially explicit erased/open repair lineage. Prefer a short adjust/project operation to replacing an entire outline when it achieves the goal. Omitted operations mean KEEP the fitted figure. When mode=edit-existing, the CURRENT native geometry and latest instruction are authoritative; there is no new raw ink. Update the existing figure identity, not an additional duplicate, and preserve its current plane/pose/dimensions unless asked to change them. Use action=regularize with regularization={smooth:true,symmetry:preserve|none|one|horizontal|vertical|both|four} for numerical smoothing/symmetry. This reuses current geometry without emitting control coordinates. symmetry=four enforces FOUR reflection axes (two axial plus two diagonals), and C1 joins; both means only two perpendicular axes. Preserve symmetry when only smoothing was requested. Use this operation when it suits the requested closed outline rather than claiming smoothness or symmetry without geometric enforcement. A smoothing request must actually remove unintended kinks with tangent-continuous cubic joins, including the closing seam; merely calling a segmented profile a spline is not smoothing it. Honor explicit symmetry requests rather than preserving a previous weaker symmetry. Four reflection axes mean axial plus diagonal symmetry; do not report four axes when only one or two remain. Use a complete replacement when needed, with connected local-plane cubics. When the user requests a 3D/CAD model, use solidReferences and sketchCatalog together, including other planes and selectedSketchIds, not just the active 2D editing target. Reuse existing native profiles by figureId and expectedVersion; NEVER redraw them to construct a solid. Return solidEdits with kind extrude (one closed profile with positive depthMetres), loft (2–8 ordered parallel/sequential sections, null depth values, smooth or ruled loftMode), intersect (perpendicular/orthographic silhouette views extruded forward/backward and intersected), union or subtract (extruded profiles, first profile is the base). Choose from the image, plane positions/normals, dimensions and speech, not a text keyword classifier. Do not loft perpendicular orthographic views as sequential sections. Order loft sections by their positions along the section normal. Choose depths to span the supplied extents when they imply depth; mention consequential estimates and ask only when design ambiguity cannot reasonably be resolved. Preserve source sketch IDs, locations, dimensions and construction/reference lines. For revolve, choose kind=revolve, ONE profile, both depths null, revolution={axis,angleDegrees}. Full turn defaults to 360. For an open spline side outline drawn on one side of its endpoint chord, choose axis=endpoints: the harness closes the section along that chord and revolves around it. A full revolution of a closed silhouette can use its in-plane horizontal or vertical symmetry axis even when the ink straddles it. Its two radial halves are combined. For an unspecified axis use mirrorErrorByRevolveAxis (lower means better silhouette reflection) and the orientation of the crown/base in the image. Honor the axis if the user specified it. A partial revolution requires a one-sided section. State the axis assumption. For other kinds revolution=null. For compound requests such as smooth then revolve, emit the sketch operation and the dependent solid together using its ORIGINAL expectedVersion; the harness applies them in order. Questions must have empty operations, additions and solidEdits. Do not create 3D for ordinary sketch cleanup/smoothing. Existing solids and their source links are supplied: preserve them and avoid making duplicate bodies. Omitted sketch operations KEEP those sketches without rewriting them. Return compact JSON; use surface inspection only when necessary. Do not output hidden reasoning text.
Use adjust for local-UV translation/rotation/scaling or explicit dimensions. Use replace only when the reference's representation must change; supply complete validated local-plane geometry. Use project to reproject the ORIGINAL source strokes using their recorded drawing views onto a view-aligned or named parallel-offset plane, then numerically fit the representation you choose. Use projectionCandidates to compare plausible supports numerically. Camera orbit is an observation viewpoint. Prefer a related existing sketch plane or an offset parallel to it for additional sections; choose a screen-facing or tilted design plane only when the geometry or user instruction supports it. For a parallel section use project with base=plane and the referenced sketch planeId. With throughOrigin=false its offset is measured from that named plane. With throughOrigin=true measure from designOrigin. If consequential depth cannot be inferred, ask for the offset. For a round, nearly closed mechanical feature, prefer a circular representation on a plane parallel to nearby sketches when its circular error is low, instead of tracing a stretched oval/spline in the capture plane. Preserve the capture support by default. An isolated circle or small detail inside an outline normally belongs on the outline plane. Camera orbit and a slightly tilted view do not establish a new support. A common-center depth hypothesis or improved circular residual alone cannot identify depth. Move to another support only when image, instruction, section relationships or attachment provide positive spatial evidence, especially in a substantially oblique/side view; otherwise keep the current plane. The supportDecision is only a cheap hint; use its confidence and compare candidates rather than blindly following it. Candidate offsets are estimated placements, not specified dimensions. Evaluate parallelDepthHypotheses before keeping all new loops at zero depth. For oblique/side drawings, common-axis alignment with an earlier section may explain a second loop at another height; use the supplied offset rather than projecting straight back to the capture plane. The original POV is the evidence for that spatial relationship; separate normalized planar panels erase it. Circle residuals are invariant under parallel-plane scaling and cannot establish depth. A selected plane is strong orientation evidence, not a hard zero-offset rule for all subsequent strokes, unless the user explicitly says to stay on the exact plane/depth. A zero-offset project merely refits on the same plane; it does NOT resolve a depth placement error. Preserve genuine coplanar details/holes and local repairs. Don't move earlier sections just to accommodate new ink. Preserve genuinely open gaps and intentional ovals. A circle drawn in perspective or on the wrong capture plane may look elliptical: infer support, depth and circle-vs-oval from the actual image, viewing angle, nearby geometry and instruction, rather than blindly keeping an ellipse. Do not mistake a genuine requested oval for perspective distortion. For sketches on objects, choose projection base=surface and imagePoint=[x,y] normalized to [0,1] from the ORIGINAL DRAWING VIEWPORT image (top-left [0,0], bottom-right [1,1], not the planar ink/fit panels). The harness raycasts the nearest visible exact face at that pixel, supplies its object-local frame and fits original ink there. You can alternatively use a surfaceCandidates id in planeId, or call select_image_surface to inspect the hit before editing. Prefer the direct surface projection for latency; use the tool only when inspection matters. An explicitly clicked face is strong evidence; otherwise infer attachment from image, speech and proximity. Surface offset is signed along the actual outward face normal from the picked face; throughOrigin MUST be false. Never use the global origin for a surface offset. A curved face returns a TANGENT plane at the picked point, not a surface wrap. If the user wants ink to follow curved geometry, ask for/route to native surface modeling rather than flattening it into this planar sketch. Preserve the existing body and unrelated faces. Projection base=view uses the original drawing camera's right/up/normal axes; base=plane uses a named plane or the source plane. offsetMetres is signed along its normal. throughOrigin anchors the new plane at the DESIGN origin; otherwise the source fit's origin. Prefer simple whole-millimetre offsets when the user has not specified an exact offset and this does not change placement intent. Never move an existing reference plane or its existing drawings to fix new ink. The projected plane and sketch are separate editable outputs. Do not project back through the camera or edge-on.
Normal new-drawing preferences: simple circles/arcs/lines, supported symmetry, H/V, equal repeated dimensions and nearby origin alignment. LOCAL REPAIR EXCEPTIONS: preserve deliberate asymmetry, slope, placement and untouched portions. Do not mirror a user's local correction, globally center it or realign it without an explicit request. Preserve constraints on unchanged/rigidly transformed fits; a local replacement may intentionally relax those constraints. Do not add unrelated 3D shapes. extrusionMetres is available for an explicitly requested extrusion of a closed profile. Additional new line/arc/circle/rectangle/spline primitives can be returned in additions. Use exact metres, orthonormal world axes and LOCAL-plane cubic arrays of eight finite numbers. Reuse source stroke IDs from the references. Existing accepted objects are read-only except the explicitly selected target already represented as an update. A question has no operations/additions; ask only for consequential ambiguity you cannot reasonably resolve. If the fitting already meets the request, operations/additions may both be empty. Noise-only input needs no model edit.`;
export const EXISTING_SKETCH_INSTRUCTIONS=`Edit or build CAD from the current accepted sketches according to the user's spoken/typed instruction. Current native geometry, units/metres, frames, IDs and versions are authoritative. The viewport image shows the user's current perspective; the separate planar image shows measured native references. Return compact JSON, without reasoning prose. Omitted operations KEEP a sketch without rewriting it. Preserve unrelated parts, current dimensions/planes and deliberate local asymmetry unless asked to change them. Ask one question only for consequential ambiguity you cannot resolve reasonably.
For ordinary 2D edits, use fittedReferences IDs: adjust patches local UV transforms/dimensions; regularize numerically smooths/sets symmetry; replace supplies complete connected local-plane cubic arrays (eight finite numbers each); project changes the sketch's support using recorded rays. Keep the existing figure identity. Use regularize={smooth:true,symmetry:preserve|none|one|horizontal|vertical|both|four} instead of rewriting controls when possible. Smooth-only preserves symmetry. Four enforces axial AND diagonal reflections with C1 joins; both means two perpendicular axes. A spline is not necessarily smooth: remove unwanted tangent discontinuities, including the closed seam. Preserve deliberate openings, corners and local repair exceptions. Additional geometry belongs in additions, only when requested.
For an explicitly requested 3D result, reuse solidReferences by figureId and expectedVersion. All supplied native sketches are available, including inactive planes. selectedSketchIds and sketchCatalog identify preferred inputs. Reuse native profile IDs. Prepare the selected driving sketch first when the drawn form calls for symmetry. solidEdits kinds: extrude uses ONE closed profile, nonnegative depthMetres along its world normal and optional nonnegative backDepthMetres in the opposite direction. For a backward-only extrusion set depthMetres exactly 0 and backDepthMetres to the requested depth. Never invent a small forward distance; loft joins 2–8 ordered sequential cross-sections with null depth fields, loftMode smooth or ruled; intersect extrudes perpendicular/orthographic silhouette views then intersects; union/subtract combine extruded profiles (first is the base for subtract). Order loft sections by spatial position along their normals. Do not loft perpendicular view silhouettes as sequential sections. Use the measured extents/plane spacing for depth where appropriate; explain important estimates. For revolve, choose kind=revolve, ONE profile, both depths null, revolution={axis,angleDegrees}. Full turn defaults to 360. For an open spline side outline drawn on one side of its endpoint chord, choose axis=endpoints: the harness closes the section along that chord and revolves around it. A full revolution of a closed silhouette can use its in-plane horizontal or vertical symmetry axis even when the ink straddles it. Its two radial halves are combined. For an unspecified axis use mirrorErrorByRevolveAxis (lower means better silhouette reflection) and the orientation of the crown/base in the image. Honor the axis if the user specified it. A partial revolution requires a one-sided section. State the axis assumption. For other kinds revolution=null. For compound requests such as smooth then revolve, emit the sketch operation and the dependent solid together using its ORIGINAL expectedVersion; the harness applies them in order. Questions must have empty operations, additions and solidEdits. Preserve source sketches and existing solids; their dependency links are provided. Do not create 3D for mere sketch cleanup. Unsupported or unresolved construction needs a concise question, not an invented body.
Project base=plane uses planeId; base=view uses original drawing axes. throughOrigin anchors at designOrigin, otherwise source origin. Signed offset is along the target normal. A selected capture plane favors orientation, but oblique views can imply another depth; compare parallelDepthHypotheses rather than assuming offset zero. base=surface with normalized imagePoint [x,y] (top-left [0,0], bottom-right [1,1]) raycasts the current viewport to the exact nearest face, throughOrigin MUST be false, offset starts at that face. select_image_surface optionally inspects that same pixel; avoid this extra round trip unless useful. Curved hits give tangent planes, not wrapped sketches. Numerical fit/support hints are references, not overrides of user intent. Do not use planar-panel pixels as viewport pixels.`;
export const IMAGE_SURFACE_TOOL={type:'function',name:'select_image_surface',description:'Read-only: pick a point on the ORIGINAL drawing viewport image and return the nearest visible object face, exact hit/tangent plane, object-local frame, version and whether the surface is planar. Coordinates are normalized [x,y] top-left [0,0] bottom-right [1,1]. No geometry changes. Use direct projection base=surface with imagePoint to avoid this round trip when no inspection is needed.',strict:true,parameters:object({imagePoint:array(2)})};
const bodySkill=readFileSync(new URL('../agent-skills/build-from-sketches/SKILL.md',import.meta.url),'utf8').replace(/^---[\s\S]*?---\s*/,'');
const spatialDrawingInstructions = `For new ink, read the original drawing as a whole. A pictorial drawing of a solid is itself a request for an editable 3D preview, even with no speech. The capture plane is the paper the user drew on, not proof that every depicted edge is coplanar. Use repeated displaced faces with corresponding connecting edges, visible side walls, curved rims with generators, axis lines or related views as evidence for depth and choose the appropriate native construction. For a supplied wireframeCandidates match supported by the image, return wireframeBody with its candidateId, a short name, uniform sections unless taper is deliberate, and null offsetMetres to use the measured estimate. The harness keeps the front face and puts the rear sketch on a real parallel plane and lofts one body; connector ink gives depth evidence. Leave operations, additions, solidEdits empty and bodyDesign null for this construction. A remark that a sketch can be on another plane supports this interpretation. Infer an editable depth and proceed. Explicit depth overrides the estimate (signed along the front normal). Single outlines, standalone lines, unconnected overlapping shapes, construction drawings and local repairs stay 2D absent other evidence. Honor explicit sketch-only and plane-edit instructions.`;
const designInstructions = `When the user asks to MAKE an object inspired by a drawing (including "make a symmetric [object] that looks like this"), act as its CAD designer. Design a distinct physical body. Use the original image and fit for proportions, position and salient features. A request to clean or symmetrize the sketch itself remains a 2D edit. For a new rotationally symmetric designed body use bodyDesign.form=revolve with thicknessMetres=null. The halfOutline is a meridian rotated 360 degrees about the design axis. For a symmetric plate choose form=extrude with positive thickness. Never implement a requested revolve as a thin plate. Use the stroke IDs attached to each utterance when designing the landmarks. For a new symmetric profiled body use bodyDesign with empty operations/additions/solidEdits. Choose a functional silhouette with your own landmarks, transitions and a plausible thickness, preserving recognizable features. State any thickness assumption. axisDegrees is the design axis CCW from initialEdit.xAxis toward yAxis. halfOutline is an ordered half-boundary of [axialPosition,halfWidth], normalized in that rotated fit bounding box: axial -1 to +1 and width 1 at the widest side, zero only at both axis endpoints. Local reversals near notches are allowed. Your landmarks define the new shape; the harness mirrors and builds it. Otherwise bodyDesign=null. When revolving an existing profile unchanged, use solidEdits.revolve. For a hollow revolve use its wall feature. For an explicit loft or sketch-only edit use the corresponding operations.`;
// A face-on stroke on an explicitly selected plane is a section reference
// when a later stroke is drawn from a new oblique viewpoint.
function earlierPlacementAnchor(result,data){
 if(data.prompt?.trim()||data.mode==='edit-existing')return false;
 const last=data.strokes.at(-1);
 if(!last||result.sourceStrokeIds.includes(last.id))return false;
 const incidence=s=>{
  const m=s.view?.cameraToWorld,n=s.plane?.normal;
  return m?.length===16&&n?Math.abs(n.reduce((sum,v,k)=>sum+v*m[k+8],0)):null;
 };
 const angle=incidence(last);
 if(angle===null||angle>=Math.cos(Math.PI/7))return false;
 const earlier=data.strokes.filter(s=>result.sourceStrokeIds.includes(s.id));
 return earlier.length>0&&earlier.every(s=>s.drawingTarget?.explicit&&incidence(s)>.98);
}
function revolveAxisEvidence(figure){
 if(figure.kind!=='spline'||!figure.closed||figure.construction)return undefined;
 const points=resample(editPath(figure).map(p=>uv(p,figure)),64,true),span=bounds(points).span;
 return Object.fromEntries(['horizontal','vertical'].map((axis,i)=>{
  const reflected=points.map(([u,v])=>i?[-u,v]:[u,-v]);
  return [axis,Number((deviation(reflected,points,true).rms/span).toFixed(4))];
 }));
}
function hollowAxisOptions(f){
 if(f.kind!=='spline'||f.closed||f.construction)return undefined;
 const first=f.segments[0],last=f.segments.at(-1);
 const ends=[first.slice(0,2),last.slice(6)];
 const tangents=[first.slice(2,4),last.slice(4,6)].map((control,i)=>control.map((v,k)=>v-ends[i][k]));
 const options=[];
 for(const [end,pivot] of ends.entries())for(const [radial,axis] of ['vertical','horizontal'].entries()){
  const openingRadius=Math.abs(ends[1-end][radial]-pivot[radial]);
  const thickness=Math.min(.003,openingRadius*.12);
  if(thickness<1e-6)continue;
  const revolution={axis,axisOriginUV:pivot,angleDegrees:360,wallThicknessMetres:thickness};
  try{hollowRevolveSection(f,revolution);}catch{continue;}
  const t=tangents[end],alignment=Math.abs(t[radial])/(Math.hypot(...t)||1);
  options.push({...revolution,openingRadius,openEndUV:ends[1-end],crownTangentAlignment:alignment});
 }
 return options.sort((a,b)=>b.crownTangentAlignment-a.crownTangentAlignment);
}
export function nativeSolidReferences(available,input){
 const keys=Object.keys(DESKTOP_EDIT_SCHEMA.properties.edits.items.properties);
 if(available.length>24)throw Error('Use up to 24 native sketch outputs');const solidReferences=[];
 for(const f of available){if(typeof f.id!=='string'||f.id.length>160||!Number.isInteger(f.version)||f.version<1)throw Error('Sketch references need valid current IDs and versions');const e=Object.fromEntries(keys.map(k=>[k,f[k]??null]));Object.assign(e,{operation:'update',figureId:f.id,expectedVersion:f.version,name:f.name||f.kind,construction:!!f.construction,closed:!!f.closed,strokeIds:[],extrusionMetres:null,dimensionNote:''});validateDesktopEdit({summary:'Native solid reference',assumptions:[],question:null,edits:[e],modelEdits:[],solidEdits:[],requestedSketchIds:[],requestedStrokeArchiveIds:[],voiceControl:null,automation:null,continuation:null},{strokes:[],figures:[f],defaultPlane:input.plane,referencePlanes:input.referencePlanes||[]});const points=editPath(e),normal=sketchFrame(e).normal,bounds={min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))};solidReferences.push({figureId:f.id,expectedVersion:f.version,name:f.name||f.kind,kind:f.kind,closed:!!f.closed,construction:!!f.construction,sketchId:f.desktopSketchId,nativeSketchId:f.sketchId,nativeObjectId:f.objectId,planeId:f.planeId,origin:f.origin,xAxis:f.xAxis,yAxis:f.yAxis,normal,bounds,radiusMetres:f.radiusMetres,widthMetres:f.widthMetres,heightMetres:f.heightMetres,existingExtrusion:f.extrusion,mirrorErrorByRevolveAxis:revolveAxisEvidence(f),hollowAxisOptions:hollowAxisOptions(f)});}
 return solidReferences;
}
export function buildRefinementRequest(saved,fit,{instruction=saved.data.prompt||''}={}){
 if(!fit.results?.length||fit.results.length!==fit.edits.length)throw Error('No valid fitted figures to refine');if(typeof instruction!=='string'||instruction.length>4000)throw Error('Instruction exceeds 4000 characters');
 const data={...saved.data,supportSketches:fit.results.map(r=>({id:r.id,plane:r.frame,points:r.pathWorld,sourceStrokeIds:r.sourceStrokeIds}))},designOrigin=data.designOrigin||[0,1.15,-.6],fitted=fit.results.map((r,i)=>({id:r.id,initialEdit:Object.fromEntries(Object.entries(fit.edits[i]).filter(([k,v])=>v!==null&&!['dimensionNote','construction'].includes(k))),supportDecision:r.supportDecision,capturePlaneEvidence:capturePlaneEvidence(data.strokes.filter(s=>r.sourceStrokeIds.includes(s.id)),data.plane,data.view),constraints:Object.fromEntries(Object.entries(r.constraints).filter(([k])=>!['circularArcs','independentConstraints','leastSquares','mirrorOffset'].includes(k))),repairPolicy:r.repairPolicy,initialFitError:{rms:r.metrics.rms,max:r.metrics.max,relativeMax:r.metrics.relativeMax},sourceStrokeIds:r.sourceStrokeIds,surfaceCandidates:surfaceProjectionCandidates(data.strokes.filter(s=>r.sourceStrokeIds.includes(s.id)),data),projectionCandidates:planeProjectionCandidates({id:r.id,frame:sketchFrame(r.frame),points:r.pathWorld.map(p=>uv(p,r.frame)),strokes:data.strokes.filter(s=>r.sourceStrokeIds.includes(s.id))},data)})),renderGroups=fit.results.map(r=>{const points=r.pathWorld.map(p=>uv(p,r.frame));return {id:r.id,frame:r.frame,points,strokes:[{uv:points}]};}),ink=renderDecisionInk(renderGroups);
 const content=[{type:'input_text',text:JSON.stringify({requestedDeliverable:sketchTask(fit),localizedMaterialChanges:fit.localFeatures,resumedGuides:data.resumedGuides,previousWorkOnTargets:data.previousWorkOnTargets,failedPreview:data.cadFailure,partContext:data.partContext,speechInputs:speechMetadata(data.speechInputs),mode:data.mode||'new-ink',instructionTargets:data.instructionTargets,measuredPlaneOffsets:fit.offsets,wireframeCandidates:fit.wireframes?.length?fit.wireframes:undefined,userInstruction:instruction||'Interpret the whole drawing. Build an editable 3D body when the drawing depicts a solid; otherwise refine the planar sketch.',units:'metres',designOrigin,objectSurfaces:surfaceSceneCatalog(data.surfaceScene),solidReferences:data.solidReferences,acceptedMeridians:data.mode==='edit-existing'?undefined:data.availableFigures?.filter(f=>f.kind==='spline'&&!f.closed).map(f=>({id:f.id,endsUV:[f.segments[0].slice(0,2),f.segments.at(-1).slice(6)],segments:f.segments.length<=12?f.segments:undefined})),sketchCatalog:data.sketchCatalog,selectedSketchIds:data.selectedSketchIds,existingSolids:data.existingSolids,plane:data.plane,view:data.view,editContext:data.editContext,referencePlanes:data.referencePlanes||[],acceptedSketchReferences:(data.references||[]).map(r=>({id:r.id,name:r.name,kind:r.kind,plane:r.plane,points:r.points.filter((_,i)=>i%Math.max(1,Math.ceil(r.points.length/16))===0||i===r.points.length-1)})),fittedReferences:fitted,fittedImagePanels:ink.panels,sourceViews:data.strokes.map(s=>({id:s.id,plane:s.plane,view:s.view||data.view,drawingTarget:s.drawingTarget,erasedFrom:s.erasedFrom,intentionallyOpen:s.intentionallyOpen}))},(_,v)=>typeof v==='number'?+v.toFixed(6):v)}];
 const originalContent=saved.body.input.flatMap(m=>m.content||[]);
 const sheetIndex=originalContent.findIndex(p=>p.text?.startsWith('Spoken sketch details in capture order'));
 const originals=(sheetIndex<0?originalContent:originalContent.slice(0,sheetIndex)).filter(p=>p.type==='input_image');
 for(const part of originals.slice(0,3)){
  content.push({type:'input_text',text:part.image_url===data.image?'ORIGINAL DRAWING VIEWPORT. Use normalized coordinates on this image for surface picking.':'Planar sketch reference with its own crop and scale.'},part);
 }
 content.push({type:'input_text',text:data.mode==='edit-existing'?'CURRENT native sketch geometry (reference for in-place editing):':'INITIAL NUMERICAL FIT (reference, not user ink):'},{type:'input_image',image_url:ink.image,detail:'low'});
 content.push(...speechInkContent(data));
 const wireframeRefs=new Set((fit.wireframes||[]).flatMap(w=>[w.front,w.rear,...w.guides]));
 const materialFeature=!!data.partContext?.bodies?.length&&sketchTask(fit)==='material_feature';
 const placementGroups=data.mode==='edit-existing'||materialFeature||sketchTask(fit)==='new_body'?[]:fit.results.filter(r=>{
  const ink=data.strokes.filter(s=>r.sourceStrokeIds.includes(s.id));
  const obliqueReview=(fit.results.length>1||data.references?.length)&&capturePlaneEvidence(ink,data.plane,data.view).some(e=>e.viewAngleFromNormalDegrees>=30);
  return !wireframeRefs.has('fit:'+r.id)&&!earlierPlacementAnchor(r,data)&&ink.length&&ink.every(s=>s.drawingTarget?.placementChoice!=='keep')&&
   (['parallel_offset','view_parallel','object_surface','inclined'].includes(r.supportDecision?.label)||r.supportDecision?.label?.startsWith('plane:')||obliqueReview||fit.offsets?.[r.id]||ink.some(s=>s.drawingTarget?.captureOnly));
 });
 const placementInstruction=placementGroups.length?'\nReview support hypotheses and oblique-view sections; the cheap Decisions classifier can incorrectly suggest moving OR incorrectly keep a separate section: '+JSON.stringify(placementGroups.map(r=>[r.id,r.supportDecision]))+'. Decide keep/project/ask using the original image, speech, the capture plane and the geometry. Keeping the current plane is a complete valid result even when the classifier said parallel_offset or inclined. Start with the selected plane as the default. Ordinary circles/details inside a larger outline usually share that outline plane. A mildly tilted camera, a nicer circular fit, overlapping outlines, or an algebraic common-center depth candidate alone cannot establish a different plane. Parallel projections preserve circular residuals, so circularity alone cannot infer offset. For a substantially oblique or side view, use positive spatial evidence of separate sections/attachment to propose another plane. Two comparable whole section outlines, drawn from different viewpoints, with similar footprint/shape, a coherent common axis and visible separation or overlapping boundaries form combined spatial evidence for separate heights; propose the parallel offset in this case without requiring a spoken height. An explicitly chosen capture plane establishes its orientation but does not lock a later section to zero depth. Small internal details lack this comparable-section evidence. If both interpretations fit equally well, keep the current support unless the user explicitly requests a different support; ask only for consequential missing placement information. Return placementAssessments with a short evidence-based reason for each reviewed reference. For choice=project set the corresponding operation action to project and supply projection, even when also smoothing the shape. For choice=keep leave projection null and preserve the support. If project is justified, estimate offset and local angleXDegrees/angleYDegrees, keeping angles zero for parallel sections. The user confirms that proposal. Keep earlier supported sections fixed. Read-only placement anchors: '+JSON.stringify(fit.results.filter(r=>earlierPlacementAnchor(r,data)).map(r=>r.id))+'.':'';
 const schema=refinementSchema(fit);
 const arcSchema=data.mode!=='edit-existing'&&instruction.trim()?markedArcSchema(fit):null;
 if(arcSchema){schema.properties.markedArc=nullable(arcSchema);schema.required.push('markedArc');}
 if(data.partContext?.bodies?.some(b=>b.boundsWorld)||data.strokes.length){
  schema.properties.featurePlan=nullable(featurePlanSchema(data));
  schema.required.push('featurePlan');
 }
 if(placementGroups.length){
  schema.properties.placementAssessments={type:'array',maxItems:32,items:object({referenceId:{type:'string',enum:fit.results.map(r=>r.id)},choice:{type:'string',enum:['keep','project','ask']},reason:str})};
  schema.required.push('placementAssessments');
 }

 const tier=data.apiSpeed??'default';
 if(!['default','priority','ultrafast'].includes(tier))throw Error('Unknown CAD API speed');
 const model=tier==='ultrafast'?'gpt-6.1-sol':placementGroups.length?'gpt-6-luna':process.env.DRAW3D_SKETCH_REFINEMENT_MODEL||'gpt-6.1-terra';
 return {...(data.surfaceScene?.models?.length&&!materialFeature?{tools:[IMAGE_SURFACE_TOOL],parallel_tool_calls:false}:{}),model,service_tier:tier,reasoning:{effort:model==='gpt-6.1-sol'?'low':'none'},instructions:(data.mode==='edit-existing'?EXISTING_SKETCH_INSTRUCTIONS:REFINEMENT_INSTRUCTIONS)+(data.cadFailure?' The previous preview was rolled back. Inspect failedPreview.reason and the nativeStatus per feature. Reuse verified base parameters including its axis and wall thickness. Revise the failed tool before changing a working base. Change the responsible profile, order, extent or operand while preserving the original instructions. Do not repeat the failed plan.':'')+(materialFeature?' The current task is a material feature on a known body. Use featurePlan with the named existing body and its measured mesh section. The spoken ink panels locate the applicable guides. For one-sided material, add along the indicated guides only; do not repeat around the body. An open guide can produce a rib with widthMetres=null and depthMetres=null for scale-based editable estimates. A centered shallow extrusion about the guide is appropriate for a thin ridge; visible-half spans half the body. Use an estimated feature width/depth for a reversible preview when not specified. Do not request a face pick or a measurement merely to estimate rib size.':'')+(arcSchema?' Use markedArc for an intended arc or semicircle with localized contour edits. Select its host, and map each notch or bulge to the guide indicated by that spoken panel. The guides change the host boundary and are consumed. A notch goes inward, a bulge outward. Choose angular or rounded from the ink. Use semicircle-preserve-endpoints when the sketch indicates the whole intended span, or semicircle-preserve-radius when extending the existing curvature around marks whose positions matter. Use closeWithDiameter only for a closed outline. Leave operations empty for the host and consumed guides. A plain semicircle plus independent curves does not implement local boundary features.':'')+'\nThe user delegates routine design choices. Execute all compatible operations in this preview. Infer unstated dimensions and tool direction from measured guides; for a localized notch use the indicated visible side unless both sides are requested. Never ask the user to run a modeling operation, split a request, operate the UI, or confirm an editable default. Ask a design question only when plausible alternatives materially conflict and nothing in the input distinguishes them.'+'\n'+constructionPolicy+'\n'+designInstructions+'\n'+bodySkill+placementInstruction+'\n'+spatialDrawingInstructions+(schema.properties.featurePlan?' Treat completed bodies as geometry references. Execute the current instruction independently of their creation history. For adding material to a named body with drawing guides, use featurePlan directly. Known body IDs, guide planes, captured side and nearest mesh section already locate ribs. Surface inspection is optional and only useful when the specific face matters. For material changes to existing bodies use featurePlan. Each named sketch selects only its relevant guide strokeIds. Use ellipse for rounded clearance, outline for a single perimeter, or rib for an open stroke indicating material along an edge. A rib follows the guide and joins to the nearest target section on the sketch plane. Build ordered named features. Each consumes its sketch and either creates a new-body (target null), joins, cuts, or intersects. For an existing or previously built tool solid set toolBody to its ID and sketch=null; for a sketched extrusion set toolBody=null. If a wide opening could disconnect a thin shell, join the reinforcement first so it provides a bridge. Target a visible body ID first and refer to the previous feature id for subsequent edits to that body. Use opposed-pockets for matching cuts on both sides of a shell: preserves a central web and accepts an optional depth per side. Use through-all only for an explicitly continuous passage, visible-half for a one-sided cut, centered for a rib straddling the sketch, forward/backward for a directional extrusion. Depth and rib width are in metres; null estimates from scale. Carry out EVERY compatible spoken update in the same plan, binding later strokes to later instructions. A request for both handle clearance and adding material needs both a cut and a join. Do not defer one. A feature sketch can also reference an existing closed figureId, or added:0 for the first new dimensioned sketch in additions, added:1 for the second, etc. Use additions for purpose-built profiles when drawing guides are absent. Leave operations and placementAssessments empty. For a new revolved or hollow revolved body plus local edits, supply its named full revolve in solidEdits and target its name or feature-result:0 in featurePlan. Build the base, cuts and joins together. Otherwise leave solidEdits empty. Otherwise use featurePlan=null.':''),
 input:[{role:'user',content}],max_output_tokens:8192,text:{format:{type:'json_schema',name:'fitted_sketch_edit',strict:true,schema}},prompt_cache_key:'draw3d-fitted-refinement-v1'};
}
export function editPath(edit){const f=sketchFrame(edit),p=edit.kind==='circle'?Array.from({length:97},(_,i)=>[edit.radiusMetres*Math.cos(i*Math.PI/48),edit.radiusMetres*Math.sin(i*Math.PI/48)]):edit.kind==='rectangle'?[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([x,y])=>[x*edit.widthMetres/2,y*edit.heightMetres/2]):edit.kind==='arc'?sampleDraftSegment({kind:'arc',coordinates:[0,0,edit.radiusMetres,edit.startAngleDeg,((edit.endAngleDeg-edit.startAngleDeg)%360+360)%360]}):edit.kind==='line'?[[0,0],uv(edit.end,f)]:edit.segments.flatMap(s=>sampleDraftSegment({kind:'spline',coordinates:s},16));return p.map(p=>frameWorld(p,f));}
function adjusted(base,op){
 const e=structuredClone(base),t=op.translationUV||[0,0],s=op.scaleUV||[1,1],a=(op.rotationDegrees||0)*Math.PI/180;if(t.length!==2||s.length!==2||![...t,...s,a].every(Number.isFinite)||s.some(v=>v<=0||v>100))throw Error('Use finite local transforms and positive scales');
 if(['circle','arc'].includes(e.kind)&&Math.abs(s[0]-s[1])>1e-8)throw Error('Circular elements need uniform scaling; use replace for an ellipse');const old=sketchFrame(e),end=e.end&&uv(e.end,old);e.origin=frameWorld(t,old);e.xAxis=old.xAxis.map((v,k)=>v*Math.cos(a)+old.yAxis[k]*Math.sin(a));e.yAxis=old.yAxis.map((v,k)=>v*Math.cos(a)-old.xAxis[k]*Math.sin(a));if(e.radiusMetres!==null)e.radiusMetres*=s[0];if(e.widthMetres!==null)e.widthMetres*=s[0];if(e.heightMetres!==null)e.heightMetres*=s[1];if(e.segments)e.segments=e.segments.map(p=>p.map((v,k)=>v*s[k%2]));if(end)e.end=frameWorld(end.map((v,k)=>v*s[k]),e);
 for(const [key,value]of Object.entries(op.dimensions||{}))if(value!==null){if(!Number.isFinite(value)||value<=0||value>100)throw Error('Dimensions must be positive metres');if(key==='radiusMetres'&&!['circle','arc'].includes(e.kind)||['widthMetres','heightMetres'].includes(key)&&e.kind!=='rectangle')throw Error('Dimension does not belong to this representation');e[key]=value;}return e;
}
function projectReference(base,r,op,data,planes){
 const spec=op.projection;if(!spec||!['view','plane','surface'].includes(spec.base)||!Number.isFinite(spec.offsetMetres)||Math.abs(spec.offsetMetres)>100)throw Error('Projection needs a finite signed plane offset');const strokes=data.strokes.filter(s=>r.sourceStrokeIds.includes(s.id));if(!strokes.length)throw Error('Projection source ink is unavailable');const view=strokes[0].view||data.view;if(!view)throw Error('Projection requires the original calibrated drawing view');
 if(spec.base!=='plane'&&(spec.angleXDegrees||spec.angleYDegrees))throw Error('Use a named base plane for local tilt angles');
 const id='projection-'+randomUUID();
 const source=(data.referencePlanes||[]).find(p=>p.id===spec.planeId)||(data.references||[]).find(p=>p.plane?.id===spec.planeId)?.plane||data.plane;
 if(spec.base==='plane'&&(!source||spec.planeId&&source.id!==spec.planeId))throw Error('Unknown projection plane');
 const anchor=spec.base==='plane'?source.origin:r.frame.origin;
 const origin=spec.throughOrigin?(data.designOrigin||[0,1.15,-.6]):anchor;
 let frame;
 if(spec.base==='surface'){if(spec.throughOrigin)throw Error('A surface offset must be anchored at the picked face, not the design origin');const support=spec.imagePoint?pickImageSurface(data.surfaceScene,data.view,spec.imagePoint):(data.resolvedSurfaces||[]).find(s=>s.id===spec.planeId)||surfaceProjectionCandidates(strokes,data).find(s=>s.id===spec.planeId);if(!support)throw Error('Choose a surface image point or a known surface candidate');const f=sketchFrame(support.frame);frame={...f,id,name:support.name+(spec.offsetMetres?' ('+Number((spec.offsetMetres*1000).toFixed(3))+' mm)':''),anchor:f.origin.slice(),origin:f.origin.map((v,k)=>v+f.normal[k]*spec.offsetMetres),surfaceAttachment:{...support,offsetMetres:spec.offsetMetres}};}else if(spec.base==='view')frame=viewAlignedPlane(view,origin,{id,name:spec.offsetMetres?'View plane ('+Number((spec.offsetMetres*1000).toFixed(3))+' mm)':'Projected view plane',offsetMetres:spec.offsetMetres});else{const f=constructSketchPlane({...source,origin},{offsetMetres:spec.offsetMetres,angleXDegrees:spec.angleXDegrees??0,angleYDegrees:spec.angleYDegrees??0});frame={...f,id,name:'Projected plane ('+Number((spec.offsetMetres*1000).toFixed(3))+' mm)'};}
 const prepared=strokes.map(s=>projectRecordedStroke(s,frame,data.view)),group={id:r.id,frame,strokes:prepared,points:prepared.flatMap(s=>s.uv)},closed=spec.closed,kind=spec.representation;let result=recognizeGroup(group,{representation:kind,closed,symmetry:r.repairPolicy?.preserveAsymmetry?'none':'auto',align:!r.repairPolicy?.preservePlacement,abstraction:'simplified',decisions:{primitive:{label:kind},closure:{label:closed?'closed':'open'},symmetry:{label:r.repairPolicy?.preserveAsymmetry?'none':'none'},representation:{label:'mixed'},curveStyle:{label:'circular'},strokes:prepared.map(s=>({id:s.id,primitive:{label:kind}}))}});
 if(kind==='circle'&&result.kind!=='circle'){const circle=circleFit(group.points),span=bounds(group.points).span;if(circle&&circle.radius>1e-6&&circle.rms/circle.radius<.30&&circle.max/span<.18){const f={...frame,origin:frameWorld(circle.center,frame)};result={id:r.id,kind:'circle',frame:f,primitive:{radius:circle.radius},sourceStrokeIds:strokes.map(s=>s.id),constraints:{closed:true,symmetry:'both',analytic:true},pathWorld:Array.from({length:97},(_,i)=>frameWorld([circle.radius*Math.cos(i*Math.PI/48),circle.radius*Math.sin(i*Math.PI/48)],f)),metrics:{rms:circle.rms,max:circle.max,relativeMax:circle.max/span},warnings:['Model-selected circular primitive regularizes imperfect projected ink.']};}}
 if(['circle','ellipse','rectangle'].includes(kind)&&result.kind!==kind)throw Error('Projected ink does not support the requested '+kind+' within the numerical fitting tolerance');planes.push(frame);const edit=decisionResultEdit(result);Object.assign(edit,{operation:base.operation,figureId:base.figureId,expectedVersion:base.expectedVersion,name:base.name,extrusionMetres:op.dimensions?.extrusionMetres??base.extrusionMetres,dimensionNote:'Reprojected original drawing onto '+frame.name});return {edit,result};
}
// Prepare only driving profiles. The model can specify a different regularization,
// retain deliberate asymmetry, or design an entirely new mirrored profile.
function prepareSections(plan,fit,data){
 if(plan.bodyDesign||plan.featurePlan||plan.question||data.options?.symmetry==='none')return plan;
 const operations=[...plan.operations];
 for(const [i,r] of fit.results.entries()){
  const e=fit.edits[i],c=r.constraints;
  if(e.kind!=='spline'||!e.closed||e.construction||c.analytic||c.symmetry==='both'||c.symmetry==='one'||
     c.connections?.length||r.repairPolicy?.preserveAsymmetry||plan.keepAsDrawn?.includes(r.id))continue;
  const op=operations.find(o=>o.referenceId===r.id);
  const solid=plan.solidEdits?.find(s=>s.profiles.some(p=>p.figureId===('fit:'+r.id)||p.figureId===e.figureId));
  if(!solid&&!op?.dimensions?.extrusionMetres)continue;
  const alignedAxis=solid?.revolution?.axis;
  if(op?.action==='regularize'&&op.regularization?.symmetry==='one'&&['horizontal','vertical'].includes(alignedAxis)&&!solid.revolution.axisOriginUV?.some(v=>v!==0)){
   operations[operations.indexOf(op)]={...op,regularization:{...op.regularization,symmetry:alignedAxis}};
   continue;
  }
  if(op&&(op.action!=='adjust'||op.rotationDegrees||op.translationUV||op.scaleUV||op.dimensions?.widthMetres||op.dimensions?.heightMetres))continue;
  const rev=solid?.revolution;
  if(rev&&(rev.axis==='endpoints'||rev.wallThicknessMetres||rev.axisOriginUV?.some(v=>v!==0)))continue;
  const error=revolveAxisEvidence(e),axis=rev?.axis||(error.horizontal<=error.vertical?'horizontal':'vertical');
  if(!(error[axis]<=.06))continue;
  const regularization={symmetry:axis,smooth:!c.lines&&!c.lineEdges?.length};
  const prepared={...op,action:'regularize',referenceId:r.id,regularization};
  if(op)operations[operations.indexOf(op)]=prepared;else operations.push(prepared);
 }
 return {...plan,operations};
}
function planWireframe(spec,plan,data,fit,planes){
 const candidate=fit.wireframes?.find(w=>w.id===spec.candidateId);
 if(!candidate||!['uniform','tapered'].includes(spec.sectionStyle)||!spec.name?.trim()||spec.name.length>120)throw Error('Choose a measured wireframe and name the solid');
 if(plan.bodyDesign||plan.solidEdits?.length||plan.operations.length||plan.additions.length)throw Error('wireframeBody builds both sections and the solid; omit duplicate operations');
 const get=id=>id.startsWith('fit:')?fit.edits[fit.results.findIndex(r=>'fit:'+r.id===id)]:data.sketchFigures.find(f=>f.id===id);
 const base=get(candidate.front),rear=get(candidate.rear);
 const offset=spec.offsetMetres??candidate.estimatedOffsetMetres;
 if(!Number.isFinite(offset)||Math.abs(offset)<.00001||Math.abs(offset)>100)throw Error('Wireframe depth must be a finite nonzero distance in metres');
 const support=(data.referencePlanes||[]).find(p=>p.id===base.planeId)||{...base,id:base.planeId};
 const plane={...constructSketchPlane(support,{offsetMetres:offset}),id:'wireframe-'+randomUUID(),name:spec.name+' rear plane'};
 planes.push(plane);
 const ids=candidate.guides.filter(id=>id.startsWith('fit:')).map(id=>id.slice(4));
 const guideStrokes=fit.results.filter(r=>ids.includes(r.id)).flatMap(r=>r.sourceStrokeIds);
 const keys=Object.keys(DESKTOP_EDIT_SCHEMA.properties.edits.items.properties);
 const section=Object.fromEntries(keys.map(k=>[k,base[k]??null]));
 Object.assign(section,{operation:'create',figureId:null,expectedVersion:null,planeId:plane.id,name:spec.name+' rear section',
  origin:base.origin.map((v,k)=>v+plane.normal[k]*offset),strokeIds:[...new Set([...(candidate.rear.startsWith('fit:')?rear.strokeIds:[]),...guideStrokes])],
  construction:false,closed:true,extrusionMetres:null,dimensionNote:'Parallel section, offset '+Math.round(offset*1000)+' mm'});
 if(spec.sectionStyle==='tapered'){
  if(section.kind==='rectangle'){
   const swapped=Math.abs(base.xAxis.reduce((sum,v,k)=>sum+v*rear.xAxis[k],0))<.5;
   section.widthMetres=swapped?rear.heightMetres:rear.widthMetres;section.heightMetres=swapped?rear.widthMetres:rear.heightMetres;
  }else section.radiusMetres=rear.radiusMetres;
 }
 const operations=ids.map(referenceId=>({action:'omit',referenceId}));
 const additions=[];
 let rearId=candidate.rear;
 if(rearId.startsWith('fit:'))operations.push({action:'replace',referenceId:rearId.slice(4),replacement:section});
 else {additions.push(section);rearId='fit:added-0';}
 const profiles=[candidate.front,rearId].map(figureId=>({figureId,expectedVersion:figureId.startsWith('fit:')?1:base.version,depthMetres:null,backDepthMetres:null}));
 return {...plan,operations,additions,solidEdits:[{kind:'loft',name:spec.name,loftMode:'ruled',profiles}],
  wireframeBody:{...spec,derivedPlaneId:plane.id,offsetMetres:offset,estimated:spec.offsetMetres==null||Math.abs(offset-candidate.estimatedOffsetMetres)<.000001,front:candidate.front,rear:candidate.rear,guides:candidate.guides}};
}
// A full revolution sweeps each meridian point around the local axis.
function linkedFeatureBase(solid,fit,data){
 const profile=solid.profiles?.[0],id=profile?.figureId;
 const index=fit.results.findIndex(r=>'fit:'+r.id===id);
 const source=fit.edits[index]||(data.availableFigures||data.sketchFigures||[]).find(f=>f.id===id);
 if(solid.kind==='extrude'&&source&&solid.profiles.length===1){
  const front=profile.depthMetres,back=profile.backDepthMetres??0;
  if(!Number.isFinite(front)||!Number.isFinite(back)||front<0||back<0||front+back<=0)throw Error('A linked extrusion needs positive total depth.');
  const normal=sketchFrame(source).normal;
  const ends=editPath(source).flatMap(p=>[-back,front].map(z=>p.map((v,k)=>v+z*normal[k])));
  return {solid,bounds:{min:[0,1,2].map(k=>Math.min(...ends.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...ends.map(p=>p[k])))}};
 }
 const rev=solid.revolution;
 if(solid.kind!=='revolve'||solid.profiles?.length!==1||!source||rev?.angleDegrees!==360)
  throw Error('A linked base requires a valid extrusion or a full revolution of one profile.');
 const derived=revolveSection(source,rev);
 const path=editPath(derived||source);
 const axis=derived?.xAxis||(rev.axis==='vertical'?source.yAxis:source.xAxis);
 const pivot=derived?.origin||frameWorld(rev.axisOriginUV||[0,0],source);
 const min=[Infinity,Infinity,Infinity],max=min.map(()=>-Infinity);
 for(const point of path){
  const delta=point.map((v,k)=>v-pivot[k]);
  const axial=delta.reduce((n,v,k)=>n+axis[k]*v,0);
  const radius=Math.hypot(...delta.map((v,k)=>v-axial*axis[k]));
  for(let k=0;k<3;k++){
   const center=pivot[k]+axis[k]*axial,extent=radius*Math.sqrt(Math.max(0,1-axis[k]**2));
   min[k]=Math.min(min[k],center-extent);max[k]=Math.max(max[k],center+extent);
  }
 }
 // On a full revolution the reflected meridian is its opposite section.
 const reflected=path.map(p=>{
  const axial=p.reduce((sum,v,i)=>sum+(v-pivot[i])*axis[i],0);
  return p.map((v,i)=>2*(pivot[i]+axial*axis[i])-v);
 });
 return {solid,bounds:{min,max},meridians:[path,reflected],revolveAxis:{origin:pivot,direction:axis}};
}
function designedSection(spec,references,summary){
 const base=references.get(spec.referenceId);
 if(!base)throw Error('Unknown body design reference');
 const edit=designSymmetricSection(spec,base.edit,base.result.pathWorld.map(p=>uv(p,base.edit)));
 edit.dimensionNote=summary.slice(0,180);
 const result={id:'design',kind:'profile',frame:sketchFrame({...edit,id:edit.planeId}),pathWorld:editPath(edit),sourceStrokeIds:edit.strokeIds,
  constraints:{closed:true,symmetry:'one',mirrorOffset:0,smooth:true},metrics:{modelCreated:true},interpretation:{mode:'designed-body',label:edit.name}};
 return {edit,result};
}
export function expandRefinement(plan,saved,fit){
 if(!plan||typeof plan.summary!=='string'||plan.summary.length>2000||!(plan.question===null||typeof plan.question==='string')||!Array.isArray(plan.operations)||plan.operations.length>32||!Array.isArray(plan.additions)||plan.additions.length>16)throw Error('Invalid model refinement plan');if (plan.question?.trim()) {
  // A question pauses the entire transaction. The original model response stays in the audit log.
  plan = {...plan, operations:[], additions:[], solidEdits:[], bodyDesign:null,wireframeBody:null};
 }
 if(plan.markedArc&&!plan.question){
  if(plan.bodyDesign||plan.wireframeBody||plan.featurePlan||plan.bodyCut)throw Error('Choose one construction for the marked outline.');
  const contour=markedArcOperations(plan,fit,saved.data);
  plan={...plan,operations:[...contour,...plan.operations]};
 }
 plan=prepareSections(plan,fit,saved.data);
 const data=saved.data,planes=[],map=new Map(fit.results.map((r,i)=>[r.id,{result:structuredClone(r),edit:structuredClone(fit.edits[i])}])),touched=new Set();
 if(plan.wireframeBody)plan=planWireframe(plan.wireframeBody,plan,data,fit,planes);
 let designedRevolve;
 if(plan.bodyDesign&&plan.featurePlan&&!plan.question){
  if(plan.bodyCut||plan.wireframeBody||plan.solidEdits?.length||plan.operations.length)throw Error('The authored body already supplies the first feature.');
  const spec=plan.bodyDesign,{edit,result:section}=designedSection(spec,map,plan.summary),id=section.id;
  edit.extrusionMetres=null;
  const profile={figureId:'fit:'+id,expectedVersion:1,depthMetres:spec.form==='revolve'?null:spec.thicknessMetres,backDepthMetres:null};
  const solid={kind:spec.form,name:spec.name,loftMode:'ruled',profiles:[profile],...(spec.form==='revolve'?{revolution:{axis:'horizontal',angleDegrees:360,axisOriginUV:null,wallThicknessMetres:null}}:{})};
  fit={...fit,edits:[...fit.edits,edit],results:[...fit.results,section]};map.set(id,{edit,result:section});
  plan={...plan,bodyDesign:null,solidEdits:[solid]};
 }
 if(plan.featurePlan&&!plan.question){
  if(plan.bodyCut||plan.bodyDesign||plan.wireframeBody||plan.operations.length)throw Error('Use the feature plan for all linked operations');
  const originals=data.availableFigures||[];
  for(const solid of plan.solidEdits||[]){
   const profile=solid.profiles?.[0],source=originals.find(f=>f.id===profile?.figureId);
   if(!source?.strokeIds?.length)continue;
   const cleaned=separateBaseGuide(source,plan.featurePlan.sketches,data.strokes);
   if(cleaned===source)continue;
   const i=fit.edits.findIndex(e=>e.figureId===source.id);
   if(i<0)continue;
   const edit={...fit.edits[i],operation:'create',figureId:null,expectedVersion:null,strokeIds:cleaned.strokeIds,segments:cleaned.segments};
   const id='base-'+i,entry={edit,result:{...fit.results[i],id,pathWorld:editPath(edit),sourceStrokeIds:edit.strokeIds,priorStrokeIds:undefined,segments:edit.segments.map(coordinates=>({kind:'spline',coordinates})),knots:edit.segments.map(s=>s.slice(0,2)),constraints:{closed:false,symmetry:'none'}}};
   fit={...fit,edits:[...fit.edits,edit],results:[...fit.results,entry.result]};
   map.set(id,entry);profile.figureId='fit:'+id;
  }
  const baseRefs=new Set((plan.solidEdits||[]).flatMap(s=>s.profiles.map(p=>p.figureId)));
  const edits=fit.edits.map((source,i)=>{
   const entry=map.get(fit.results[i].id);
   if(!baseRefs.has('fit:'+entry.result.id)||source.operation!=='create')return source;
   const edit=separateBaseGuide(source,plan.featurePlan.sketches,data.strokes);
   if(edit!==source){
    entry.edit=edit;
    entry.result={...entry.result,pathWorld:editPath(edit),sourceStrokeIds:edit.strokeIds,segments:edit.segments.map(coordinates=>({kind:'spline',coordinates})),knots:edit.segments.map(s=>s.slice(0,2)),constraints:{closed:false,symmetry:'none'}};
   }
   return edit;
  });
  const bases=(plan.solidEdits||[]).map(s=>linkedFeatureBase(s,{...fit,edits},data));
  const retained=new Set(bases.flatMap(b=>b.solid.profiles.map(p=>p.figureId)));
  const compiled=compileFeaturePlan(plan.featurePlan,data,fit,plan.additions,bases);
  planes.push(...compiled.planes);
  plan={...plan,operations:fit.results.filter(r=>!retained.has('fit:'+r.id)).map(r=>({referenceId:r.id,action:'omit'})),additions:compiled.additions,solidEdits:compiled.solidEdits,featurePlaneIds:compiled.planes.map(p=>p.id)};
 }
 if(plan.bodyCut&&!plan.question){
  if(plan.bodyDesign||plan.wireframeBody||plan.solidEdits?.length)throw Error('Use a single existing-body cut for this operation');
  const cut=sketchBodyCut(plan.bodyCut,data,fit);planes.push(cut.plane);
  plan={...plan,operations:fit.results.map(r=>({referenceId:r.id,action:'omit'})),additions:[cut.edit],solidEdits:[cut.solid],bodyCut:{...plan.bodyCut,planeId:cut.plane.id}};
 }
 if(plan.bodyDesign){
  if(plan.operations.length||plan.additions.length||plan.solidEdits?.length)throw Error('A new body design uses its reference without modifying it; leave other operations empty');
  const section=designedSection(plan.bodyDesign,map,plan.summary),e=section.edit;
  if(plan.bodyDesign.form==='revolve')designedRevolve={kind:'revolve',name:e.name,loftMode:'ruled',
   profiles:[{figureId:'new-edit:0',expectedVersion:1,depthMetres:null,backDepthMetres:null}],
   revolution:{axis:'horizontal',angleDegrees:360,axisOriginUV:null,wallThicknessMetres:null}};
  // Retain the measured fit in the audit record. Existing native figures are read-only here.
  map.clear();
  map.set(section.result.id,section);
 }
 for(const op of plan.operations){const entry=map.get(op.referenceId);if(!entry||touched.has(op.referenceId))throw Error('Unknown or repeated fitted reference');touched.add(op.referenceId);if(op.action==='omit'){map.delete(op.referenceId);continue;}let e,projected,regularized;
  if(op.action==='regularize'){regularized=regularizeSketch(entry.edit,op.regularization,entry.result.constraints);e=regularized.edit;if(op.dimensions?.extrusionMetres)e.extrusionMetres=op.dimensions.extrusionMetres;}else if(op.action==='project'){projected=projectReference(entry.edit,entry.result,op,data,planes);e=adjusted(projected.edit,op);}else if(op.action==='replace'){if(!op.replacement)throw Error('Replacement needs complete geometry');e={...structuredClone(op.replacement),operation:entry.edit.operation,figureId:entry.edit.figureId,expectedVersion:entry.edit.expectedVersion,strokeIds:op.replacement.strokeIds?.length?op.replacement.strokeIds:entry.edit.strokeIds};}else if(op.action==='adjust')e=adjusted(entry.edit,op);else throw Error('Unknown refinement operation');
  e.dimensionNote=plan.summary.slice(0,180);
const previous=entry.result,kind=projected?.result.kind||(op.action==='adjust'?previous.kind:['circle','rectangle','line','arc'].includes(e.kind)?e.kind:'profile'),constraints=regularized?.constraints||(op.action==='adjust'?structuredClone(previous.constraints):projected?.result.constraints||{closed:e.closed,symmetry:['circle','rectangle'].includes(e.kind)?'both':'none',lines:false,lineEdges:[]});if(op.action==='adjust'&&op.scaleUV){delete constraints.circularArcs;if(op.scaleUV[0]!==op.scaleUV[1])constraints.aligned=false;}
  entry.edit=e;entry.result={...(projected?.result||previous),id:previous.id,kind,frame:sketchFrame({...e,id:e.planeId}),pathWorld:editPath(e),sourceStrokeIds:e.strokeIds,primitive:['circle','arc'].includes(e.kind)?{radius:e.radiusMetres,...(e.kind==='arc'?{startAngleDeg:e.startAngleDeg,sweepDeg:((e.endAngleDeg-e.startAngleDeg)%360+360)%360}:{})}:e.kind==='rectangle'?{width:e.widthMetres,height:e.heightMetres}:undefined,segments:e.kind==='spline'?e.segments.map(coordinates=>({kind:'spline',coordinates})):undefined,knots:e.kind==='spline'?e.segments.map(s=>s.slice(0,2)):undefined,constraints,metrics:{initialFitError:previous.metrics,modelEdited:true},interpretation:{mode:'model-refined',label:e.name||kind},repairPolicy:previous.repairPolicy};
 }
 for(const [i,original]of plan.additions.entries()){const e=structuredClone(original);if(!e.strokeIds?.length)e.strokeIds=data.strokes.map(s=>s.id);if(e.operation!=='create')throw Error('Additional geometry must be a new figure');map.set('added-'+i,{edit:structuredClone(e),result:{id:'added-'+i,kind:e.kind==='spline'?'profile':e.kind,frame:sketchFrame({...e,id:e.planeId}),pathWorld:editPath(e),sourceStrokeIds:e.strokeIds,constraints:{closed:e.closed,symmetry:['circle','rectangle'].includes(e.kind)?'both':'none'},metrics:{modelCreated:true},interpretation:{mode:'model-refined',label:e.name}}});}
 const entries=plan.question?[]:[...map.values()].filter(e=>data.mode!=='edit-existing'||touched.has(e.result.id)||e.edit.operation==='create'),edits=entries.map(e=>e.edit),result={...structuredClone(fit),results:entries.map(e=>e.result),edits,referencePlanes:planes,solidEdits:designedRevolve?[designedRevolve]:structuredClone(plan.solidEdits||[]),noOp:!entries.length&&!plan.solidEdits?.length&&!plan.question,refinement:{summary:plan.summary,question:plan.question,operations:plan.operations,...(plan.featurePlaneIds?{featurePlaneIds:plan.featurePlaneIds}:{}),...(plan.bodyCut&&!plan.question?{bodyCut:plan.bodyCut}:{}),...(plan.wireframeBody?{wireframeBody:plan.wireframeBody}:{})}};
 for(const solid of result.solidEdits)for(const p of solid.profiles){
  if(!p.figureId.startsWith('fit:'))continue;
  const i=entries.findIndex(entry=>'fit:'+entry.result.id===p.figureId&&entry.edit.operation==='create');
  if(i<0)throw Error('Cannot use an omitted fitted profile for a solid');
  p.figureId='new-edit:'+i;
 }
 const evidence={solids:data.existingSolids,strokes:data.strokes,figures:data.availableFigures||(data.editContext?.targetFigure?[data.editContext.targetFigure]:[]),defaultPlane:data.plane,referencePlanes:[...(data.referencePlanes||[]),...planes],models:[]};for(let i=0;i<edits.length;i++)verifyDecisionFigure(edits[i],result.results[i]);validateDesktopEdit({summary:plan.summary,assumptions:[],question:plan.question,edits,modelEdits:[],solidEdits:result.solidEdits,requestedSketchIds:[],requestedStrokeArchiveIds:[],voiceControl:null,automation:null,continuation:null},evidence);
 for(const solid of result.solidEdits){
  if(solid.kind!=='revolve')continue;
  const id=solid.profiles[0].figureId,profile=id.startsWith('new-edit:')?edits[Number(id.slice(9))]:
   edits.find(e=>e.figureId===id)||evidence.figures.find(f=>f.id===id);
  if(profile)revolveSection(profile,solid.revolution);
 }
 return result;
}
export function withCreationReferences(saved,fit){
 if(saved.data.mode==='edit-existing')return {saved,fit};
 const available=saved.data.sketchFigures||[];
 const native=nativeSolidReferences(available,saved.data);
 const drafts=fit.results.flatMap((r,i)=>{
  const e=fit.edits[i];
  if(e.construction||e.operation!=='create'||['arc','line'].includes(e.kind))return [];
  return [{figureId:'fit:'+r.id,mirrorErrorByRevolveAxis:revolveAxisEvidence(e),expectedVersion:1,hollowAxisOptions:hollowAxisOptions(e),kind:e.kind,closed:!!e.closed,origin:e.origin,xAxis:e.xAxis,yAxis:e.yAxis}];
 });
 const solidReferences=[...native,...drafts];
 const supportSketches=fit.results.map(r=>({id:r.id,plane:r.frame,points:r.pathWorld,sourceStrokeIds:r.sourceStrokeIds}));
 const offsets={};
 for(const r of fit.results){
  const group={id:r.id,strokes:saved.data.strokes.filter(s=>r.sourceStrokeIds.includes(s.id))};
  if(!group.strokes.length)continue;
  const proposal=displacedSectionHypothesis(group,{...saved.data,supportSketches},group.strokes[0].plane||saved.data.plane);
  if(proposal)offsets[r.id]=proposal;
 }

 return {saved:{...saved,data:{...saved.data,availableFigures:available,solidReferences}},fit:{...fit,solidReferences,offsets,wireframes:wireframeCandidates(saved.data,fit)}};
}
// For a quiet placement-only turn, Decisions already interpreted the image.
export function measuredPlacementPlan(data,fit){
 if(data.prompt?.trim()||data.speechInputs?.length||fit.wireframes?.length||data.mode==='edit-existing'||fit.results.length>2)return null;
 const targets=fit.results.filter(r=>fit.offsets?.[r.id]&&r.supportDecision?.label==='parallel_offset');
 if(targets.length!==1)return null;
 const r=targets[0],candidate=fit.offsets[r.id];
 if(!r.constraints?.closed)return null;
 const representation=['circle','ellipse','rectangle','spline'].includes(r.kind)?r.kind:'mixed';
 return {summary:'Proposed parallel plane, '+Math.round(candidate.offsetMetres*1000)+' mm from the drawing plane.',question:null,
  operations:[{referenceId:r.id,action:'project',projection:{base:'plane',planeId:candidate.planeId,throughOrigin:false,offsetMetres:candidate.offsetMetres,
   angleXDegrees:0,angleYDegrees:0,closed:true,representation}}],additions:[],solidEdits:[],
  placementAssessments:[{referenceId:r.id,choice:'project',reason:'The image decision and measured displaced section agree.'}]};
}
export async function runSketchRefinement(saved,fit,{fetcher=fetch,recordingId,requestId=randomUUID(),instruction,signal}={}){
 const history=saved.data.previousWorkOnTargets||[];
 const previous=resumeSketchWork(instruction||saved.data.prompt,history);
 const resumed=previous?.outcome==='sketch'&&previous.requestedDeliverable!=='sketch'&&!saved.data.partContext?.bodies?.length?previous:null;
 if(resumed){
  instruction=resumed.instruction+'\nCurrent instruction: '+(instruction||saved.data.prompt);
  const guides=(resumed.guides||[]).filter(s=>!saved.data.strokes.some(old=>old.id===s.id));
  saved={...saved,data:{...saved.data,strokes:[...saved.data.strokes,...guides],resumedGuides:guides.map(s=>({id:s.id,plane:s.plane?.id,points:s.points.filter((_,i)=>i%Math.ceil(s.points.length/8)===0||i===s.points.length-1)}))}};
 }
 if(history.length)saved={...saved,data:{...saved.data,previousWorkOnTargets:history.map(({guides,...work})=>work)}};
 ({saved,fit}=withCreationReferences(saved,fit));
 const started=performance.now(),folder=path.resolve(process.env.SESSION_DIR||'sessions','decision-sketches',fit.id,'refinements',requestId);await mkdir(folder,{recursive:true});
 const measured=instruction?.trim()?null:measuredPlacementPlan(saved.data,fit);
 if(measured){
  let direct;
  try{direct=expandRefinement(measured,saved,fit);}catch{/* A poorly conditioned projection can still be interpreted with the original image. */}
  if(direct){
   Object.assign(direct.refinement,{id:requestId,method:'measured-offset',placementAssessments:measured.placementAssessments,offsetEstimates:fit.offsets,modelRequests:0,totalMs:performance.now()-started,estimatedCostUSD:0});
   await writeFile(path.join(folder,'request.json'),JSON.stringify({recordingId,fitId:fit.id,at:Date.now(),method:'measured-offset',plan:measured}));
   await writeFile(path.join(folder,'result.json'),JSON.stringify(direct));return direct;
  }
 }
 if(!process.env.OPENAI_API_KEY)throw Error('The backend OpenAI key is not configured');
 const describedPart=fit.decisions?.some(a=>a.name==='instruction_subject'&&a.choice==='part');
 let intentCost,solidCommand;
 if(saved.data.creationMode!=='sketch'&&(saved.data.creationMode==='instruction'||saved.data.creationMode==='build'&&saved.data.partContext?.bodies?.length||describedPart||saved.data.speechInputs?.length>1||saved.data.mode==='edit-existing'&&saved.data.previousWorkOnTargets?.length)){
  const content=saved.body?.input?.[0]?.content||[];
  const inkLabel=content.findIndex(p=>p.type==='input_text'&&p.text.startsWith('Clean planar projection'));
  const inkImage=inkLabel>=0?content[inkLabel+1]?.image_url:undefined;
  const intent=await classifyInstruction(resumed?{...saved.data,previousWorkOnTargets:[]}:saved.data,resumed?.instruction||instruction||saved.data.prompt,{inkImage,apiKey:process.env.OPENAI_API_KEY,fetcher,signal,
   record:(name,value)=>writeFile(path.join(folder,name+'.json'),JSON.stringify(value))});
  fit={...fit,instructionTask:intent.choice,localFeatures:intent.localFeatures};
  solidCommand=intent.solidCommand;intentCost=decisionCost(intent.usage);
 }
 const authorized=saved.data.creationMode==='instruction'&&!!saved.data.userBuildInstruction?.trim()&&['build','extrude','revolve','hollow_revolve'].includes(solidCommand);
 const build=saved.data.creationMode==='build'||authorized;
 const drawing=saved.data.creationMode==='sketch'||saved.data.creationMode==='instruction'&&!authorized;
 if(drawing)fit={...fit,instructionTask:'sketch'};
 if(build&&!['material_feature','new_body','finish_body','redesign_body'].includes(sketchTask(fit)))fit={...fit,instructionTask:saved.data.partContext?.bodies?.length?'finish_body':'new_body'};
 const body=buildRefinementRequest(saved,fit,{instruction});
 body.instructions+=' Preserve drawn placement on its support. The design origin is a reference, not a destination. For a revolve, use the requested construction axis or a supported profile-local axis. An open half-profile of a cap usually runs from an outer rim to the crown at the rotation axis; do not relocate it to center its bounding box.';
 if(authorized&&['extrude','revolve','hollow_revolve'].includes(solidCommand))body.instructions+=' Required operation for this turn: '+solidCommand+'. Use the referenced measured profile; repair only the geometry needed by the kernel. For a hollow revolved cap use its wall section or revolve an already closed thin-wall section. An estimated wall thickness is acceptable when unspecified.';
 if(build)body.instructions+=' Create 3D is authorization, not an instruction to duplicate the existing solid. For finish_body use the existing named body and its native sections; use figure IDs directly as feature sketches. For redesign_body author a genuinely new shape: bodyDesign uses the reference only for frame and scale. When attaching further features use featurePlan targeting feature-result:0. Preserve the independent source drawing. A request to ignore the drawing takes priority over fitting it.';
 if(build&&saved.data.partContext?.bodies?.length){
  const ids=saved.data.partContext.bodies.map(b=>b.bodyId);
  body.text.format.schema.properties.replaceBodyId={type:['string','null'],enum:[null,...ids]};
  body.text.format.schema.required.push('replaceBodyId');
  body.instructions+=' Set replaceBodyId to the original body ID when designing its replacement, including a new main shape in place of an existing main body. An additional independent part or material edits to the current body use null. Only a verified newly authored body can retire an original.';
 }
 if(drawing){
  body.instructions+=' The workspace is currently in drawing mode. Keep the editable 2D profiles on their requested planes. Defer all solid creation and material edits to the Create 3D action. Preserve the drawing when only the future solid is described. No clarification is needed about generating a solid in this mode.';
  const schema=body.text.format.schema;
  const deferred=['bodyDesign','bodyCut','wireframeBody','featurePlan','solidEdits'];
  for(const key of deferred)delete schema.properties[key];
  schema.required=schema.required.filter(key=>!deferred.includes(key));
 }
 if(saved.data.directRecovery&&body.tools)body.tool_choice='none';
 await writeFile(path.join(folder,'request.json'),JSON.stringify({recordingId,fitId:fit.id,at:Date.now(),body}));
 try{
  const turns=[],resolvedSurfaces=[],usages=[];let current=body,raw,result,attemptedRepair=false,questionReviewed=false,probes=0;
  const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000);
  // Two optional raycasts, a final structured plan, and one validation repair.
  for(let turn=0;turn<5;turn++){
   let wire;const response=await sendOpenAIResponse(fetcher,{...current,onWireRequest:r=>{wire=r;return writeFile(path.join(folder,turn?'wire-'+turn+'.json':'wire.json'),JSON.stringify(r));}},deadline);raw=await response.json();
   await writeFile(path.join(folder,turn?'response-'+turn+'.json':'response.json'),JSON.stringify(raw));
   if(!response.ok)throw Error('Sketch refinement HTTP '+response.status+': '+(raw.error?.message||'provider failure'));
   if(raw.status==='incomplete')throw Error('Sketch refinement incomplete: '+raw.incomplete_details?.reason);
   usages.push(raw.usage);const calls=(raw.output||[]).filter(o=>o.type==='function_call');const trace={request:wire?.body||current,response:raw,tools:[]};turns.push(trace);
   if(calls.length){
    const outputs=[];
    for(const call of calls){let output;try{if(probes>=2||attemptedRepair)throw Error('Use the supplied measurements for the final plan');probes++;if(call.name!=='select_image_surface')throw Error('Unknown sketch inspection tool');const args=JSON.parse(call.arguments);if(Object.keys(args).some(k=>k!=='imagePoint'))throw Error('Use only imagePoint');output=pickImageSurface(saved.data.surfaceScene,saved.data.view,args.imagePoint);resolvedSurfaces.push(output);}catch(e){output={error:e.message,recovery:'Use a measured surfaceCandidates hit or the named target body and guide plane for a sketched feature. Only pick again if another face measurement is essential.'};}
     trace.tools.push({name:call.name,arguments:call.arguments,output});outputs.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(output)});
    }
    await writeFile(path.join(folder,'turns.json'),JSON.stringify(turns));current={...body,input:[...current.input,...raw.output,...outputs]};
    if(probes>=2||attemptedRepair){
     current.tool_choice='none';
     current.input.push({role:'user',content:'Return the final structured plan using these measurements, the target body and sketch guides. If an essential measurement is missing, ask one specific question.'});
    }
    continue;
   }
   const output=raw.output?.filter(o=>o.type==='message').flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');if(!output)throw Error('Model returned no refinement JSON');
   try {
    const plan=JSON.parse(output);
    if(plan.question?.trim()&&!questionReviewed){
     questionReviewed=true;
     trace.review='Check the need for clarification before showing a question';
     const schema=structuredClone(body.text.format.schema);
     schema.properties.clarificationReason={type:['string','null'],enum:[null,'conflicting-requirements','ambiguous-target','missing-essential-design-choice','technical-limitation']};
     schema.required.push('clarificationReason');
     current={...body,...(body.tools?{tool_choice:'none'}:{}),text:{format:{...body.text.format,schema}},
      input:[...current.input,{role:'assistant',content:output},{role:'user',content:'Review the drawing, current instruction, and CAD capabilities before interrupting. Complete the edit now with reversible estimates if possible. A full revolve in solidEdits can feed cuts and joins in featurePlan. Pick the indicated visible side for local features. Return clarificationReason=null when proceeding. Ask only for an indispensable design choice that cannot be inferred. For a technical limitation describe it in summary, set clarificationReason=technical-limitation and question=null. Do not delegate CAD actions to the user.'}]};
     continue;
    }
    if(questionReviewed&&plan.clarificationReason==='technical-limitation'){
     const technical=Error('CAD could not complete the requested feature with the available operations.');
     technical.technicalLimitation=true;
     throw technical;
    }
    if(body.text.format.schema.properties.placementAssessments&&Array.isArray(plan.operations)){
     const anchors=new Set(fit.results.filter(r=>earlierPlacementAnchor(r,saved.data)).map(r=>r.id));
     plan.operations=plan.operations.filter(op=>!anchors.has(op.referenceId));
    }
    // A complete projection plus an explicit project assessment states the
    // intended move even if the model leaves the action set to regularize.
    if(Array.isArray(plan.placementAssessments)){
     for(const op of plan.operations||[]){
      if(op.action==='regularize'&&op.projection&&plan.placementAssessments.some(a=>a.referenceId===op.referenceId&&a.choice==='project')){
       (trace.normalizedActions??=[]).push({referenceId:op.referenceId,from:op.action,to:'project'});
       op.action='project';
      }
     }
    }
    result=expandRefinement(plan,{...saved,data:{...saved.data,resolvedSurfaces}},fit);
    verifySketchDeliverable(sketchTask(fit),result,fit.localFeatures);
    if(authorized)verifyRequestedOperation(solidCommand,plan,result,saved.data.availableFigures);
    if((plan.replaceBodyId||sketchTask(fit)==='redesign_body')&&!plan.question){
     if(!plan.bodyDesign&&plan.replaceBodyId)throw Error('Author the replacement with bodyDesign before replacing the original body.');
     const driver=fit.edits[fit.results.findIndex(r=>r.id===plan.bodyDesign?.referenceId)]?.figureId;
     const current=new Set((saved.data.partContext?.bodies||[]).map(b=>b.bodyId));
     const linked=(saved.data.existingSolids||[]).filter(b=>current.has(b.bodyId)&&(plan.replaceBodyId?b.bodyId===plan.replaceBodyId:b.figureIds?.includes(driver)));
     if(plan.replaceBodyId&&!linked.length)throw Error('Select an existing editable CAD body for replacement.');
     if(linked.length>=1)result.replacesBody={id:linked[0].bodyId,featureId:linked[0].featureId,projectId:linked[0].projectId};
    }
    if(saved.data.cadFailure){
     result.refinement.recoveryOf=saved.data.cadFailure.refinementId;
     if(!plan.question){
      const kinds=new Set(result.solidEdits.map(f=>f.kind));
      for(const f of saved.data.cadFailure.features)if(['join-material','pocket','common-material'].includes(f.kind)&&!kinds.has(f.kind))throw Error('The revised plan omits the requested '+f.kind+' operation');
     }
    }
    if(Array.isArray(plan.placementAssessments)){
     for(const assessment of plan.placementAssessments){
      const projects=plan.operations.some(op=>op.referenceId===assessment.referenceId&&op.action==='project');
      if(assessment.choice==='keep'&&projects)throw Error('Placement review keeps '+assessment.referenceId+' on the capture support, but an operation projects it. Remove the inconsistent projection.');
      if(assessment.choice==='project'&&!projects&&!plan.question)throw Error('Placement review proposes another plane without a projection. Provide the proposal or choose keep.');
     }
     result.refinement.placementAssessments=plan.placementAssessments;
    }
    break;
   } catch(error) {
    trace.validationError=error.message;
    await writeFile(path.join(folder,'turns.json'),JSON.stringify(turns));
    if(error.technicalLimitation || attemptedRepair || turn===4 || deadline.aborted) throw error;
    attemptedRepair=true;
    current={...current,...(body.tools?{tool_choice:'none'}:{}),input:[...current.input,{role:'assistant',content:output},{role:'user',content:'CAD validation rejected the proposed plan before any edits: '+error.message+'. Return a corrected plan for the same instruction using the supplied current geometry. If essential design information is missing, return one question and empty edits.'}]};
   }
  }
  if(!result)throw Error('Model returned no final sketch refinement');
  await writeFile(path.join(folder,'turns.json'),JSON.stringify(turns));
  const usage=usages.every(u=>Number.isFinite(u?.input_tokens)&&Number.isFinite(u?.output_tokens))?usages.reduce((sum,u)=>({input_tokens:sum.input_tokens+u.input_tokens,output_tokens:sum.output_tokens+u.output_tokens,input_tokens_details:{cached_tokens:sum.input_tokens_details.cached_tokens+(u.input_tokens_details?.cached_tokens||0),cache_write_tokens:sum.input_tokens_details.cache_write_tokens+(u.input_tokens_details?.cache_write_tokens||0)},output_tokens_details:{reasoning_tokens:sum.output_tokens_details.reasoning_tokens+(u.output_tokens_details?.reasoning_tokens||0)}}),{input_tokens:0,output_tokens:0,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}):undefined;
  result.requestedDeliverable=sketchTask(fit);
  if(saved.data.creationMode==='instruction')result.solidAuthorization=authorized?solidCommand:'wait';
  const servedTier=raw.service_tier||body.service_tier;
  const costEstimate=servedTier==='default'?refinementCost(usage,body.model):{usd:null,usageKnown:false,note:'Premium service pricing is not included in the Standard estimate'};
  result.refinement={...result.refinement,offsetEstimates:fit.offsets,requestedTier:body.service_tier,servedTier:raw.service_tier??null,id:requestId,model:body.model,reasoning:body.reasoning.effort,usage,modelRequests:turns.length,toolCalls:turns.flatMap(t=>t.tools),totalMs:performance.now()-started,inputImages:body.input[0].content.filter(c=>c.type==='input_image').length,estimatedCostUSD:costEstimate.usd,costEstimate};
  const modelCost=result.refinement.estimatedCostUSD;result.cost={usd:Number.isFinite(fit.cost?.usd)&&modelCost!==null?fit.cost.usd+modelCost:null,usageKnown:!!fit.cost?.usageKnown&&modelCost!==null,estimated:true,fitUSD:fit.cost?.usd,refinementUSD:modelCost,note:'Dated Standard rate estimate, including all inspection turns, cache reads and 30-minute cache writes; hosting/audio/regional premiums excluded'};if(intentCost){
   result.refinement.taskClassificationUSD=intentCost.usd;
   if(result.cost.usageKnown&&intentCost.usageKnown)result.cost.usd+=intentCost.usd;
   else{result.cost.usd=null;result.cost.usageKnown=false;}
  }
  await writeFile(path.join(folder,'result.json'),JSON.stringify(result));return result;
 }catch(e){await writeFile(path.join(folder,'failure.json'),JSON.stringify({message:e.message,totalMs:performance.now()-started}));throw e;}
}
