import {sketchTaskQuestion,formQuestion,subjectQuestion} from './sketch-task.mjs';
import {readProvider} from './provider-read.mjs';
import {cloudVertexReady} from './vertex-cloud.mjs';
import {vertexDecisions} from './vertex-decisions.mjs';
import {validateSurfaceScene,surfaceProjectionCandidates,surfaceSceneCatalog} from '../src/image-surface-pick.js';
import {planeSupportQuestion,planeProjectionCandidates} from './decision-plane-support.mjs';
import {originPlacementContext,applyOriginPlacement} from './decision-origin-placement.mjs';
import {repairGroupContext,repairSymmetryQuestions,repairAlignmentQuestions,repairSymmetryPolicy} from './decision-repair-policy.mjs';
import {componentRelationContext,applyComponentRelations} from './decision-component-relations.mjs';
import {validateEditContext,editTargetQuestion,selectedDrawingEdits} from './decision-edit-target.mjs';
import {nearbyConnectionContext,applyNearbyConnections} from './decision-connections.mjs';

import {crossPlaneContext,applyCrossPlaneMatches,validatePlaneReferences} from './decision-cross-plane.mjs';

import {matchingDrawingCorrections} from './drawing-example-memory.mjs';

import {linearRunEvidence} from '../src/decision-sketch/alignment.js';

import {traceMergeCandidates,mergeApprovedTraces,strokeChainCandidates,joinApprovedChains} from './decision-trace-groups.mjs';

import {circleFit,rectangleFit,distance,bounds} from '../src/decision-sketch/math.js';

import {findSymmetry} from '../src/decision-sketch/math.js';

import {speechInkContent,speechMetadata} from './speech-ink-image.mjs';
import {renderDecisionInk} from './decision-ink-image.mjs';

// Backend only: OpenAI selects representations; numerical solvers supply coordinates.

import {createHash,randomUUID} from 'node:crypto';

import {mkdir,writeFile} from 'node:fs/promises';

import path from 'node:path';

import {groupStrokes,recognizeGroup,decisionResultEdit} from '../src/decision-sketch/recognize.js';

import {strokeFeatures} from '../src/decision-sketch/features.js';



export const DECISION_RATES={date:'2026-11-04',currency:'USD',inputPerMillion:.10,cacheReadPerMillion:.01,cacheWritePerMillion:.125,outputPerMillion:0,source:'https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability'};

export function decisionCost(usage){

 if(!Number.isFinite(usage?.input_tokens))return {usd:null,usageKnown:false,rates:DECISION_RATES};

 const total=usage.input_tokens,read=Math.min(total,Math.max(0,usage.input_tokens_details?.cached_tokens||0)),write=Math.min(total-read,Math.max(0,usage.input_tokens_details?.cache_write_tokens||0));

 return {usd:((total-read-write)*.10+read*.01+write*.125)/1e6,usageKnown:true,inputTokens:total,cachedTokens:read,cacheWriteTokens:write,rates:DECISION_RATES};

}

export function validateDecisionInput(data){

 validateSurfaceScene(data?.surfaceScene);validatePlaneReferences(data||{});validateEditContext(data||{});

 if(!data||!Array.isArray(data.strokes)||!data.strokes.length||data.strokes.length>32)throw Error('Use 1–32 active strokes in the fitting experiment');

 let count=0;const ids=new Set();for(const s of data.strokes){if(typeof s.id!=='string'||s.id.length>120||ids.has(s.id))throw Error('Strokes need unique IDs');ids.add(s.id);if(!Array.isArray(s.points)||s.points.length<2||s.points.length>20000||s.points.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e4)))throw Error('Use finite XYZ stroke samples');count+=s.points.length;}

 if(count>40000)throw Error('Limit the drawing to 40000 samples');

 if(data.image!==undefined&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data.image)||data.image.length>4000000))throw Error('Use an inline drawing image below 3 MB');

 if(data.prompt!==undefined&&(typeof data.prompt!=='string'||data.prompt.length>4000))throw Error('Instruction exceeds 4000 characters');

 if(data.options?.intent&&!['auto','measured'].includes(data.options.intent))throw Error('Unknown interpretation mode');

 if(data.options){if(!['auto','line','polyline','mixed','circle','ellipse','rectangle','arc','spline'].includes(data.options.representation||'auto')||!['auto','none','one','both'].includes(data.options.symmetry||'auto')||![undefined,'auto',true,false].includes(data.options.closed))throw Error('Unknown fitting option');}

}

const rounded=v=>JSON.parse(JSON.stringify(v,(_,v)=>typeof v==='number'?+v.toFixed(5):v));

const sample=p=>p.filter((_,i)=>i%Math.max(1,Math.ceil(p.length/32))===0||i===p.length-1);

const choices=items=>Object.entries(items).map(([value,description])=>({value,description}));

const primitiveChoices=choices({line:'One straight line.',polyline:'Connected straight edges with corners.',circle:'A full circular ring with pen wobble.',ellipse:'A full oval with visibly unequal axes.',rectangle:'Four intended straight sides and right-angle corners. Correct freehand waviness, sloping edges, small pen hooks and incidental corner rounding. Preserve deliberately rounded ends using mixed.',arc:'One open circular arc.',mixed:'Straight edges with intentional substantial curved portions: slots, rounded ends and fillets. Incidental corner wobble alone does not require mixed.',spline:'An irregular smooth curve; no simpler representation conveys the intended stroke.'});

const choice=(name,instructions,options)=>({type:'choice',name,instructions,choices:options});

export function buildDecisionRequest(data){

 validateDecisionInput(data);

 const groups=groupStrokes(data.strokes,data.plane),questions=[choice('drawing_representation','Consider the complete drawing: which family best conveys the intended geometry? Preserve visible corners, rounded ends and components. Do not confuse a familiar object silhouette with one single primitive.',choices({lines:'Straight edges only.',curves:'Curved elements only.',mixed:'Both straight and curved elements.'}))],features=[];

 const drawingSpan=Math.max(...groups.map(g=>bounds(g.points).span));const chains=strokeChainCandidates(groups);for(const c of chains)questions.push(choice(c.id+'.join','Should provisional groups '+c.joinedGroupIds.join(', ')+' join into ONE intended continuous outline? Endpoints are spatially close; pen order and pauses are unreliable. Join only if their combined image forms one boundary (including a circular hole drawn as several arcs). Keep distinct adjacent components separate. Answer the '+c.id+' shape/closure questions for the proposed combined outline.',choices({join:'These fragments form one intended outline.',independent:'Keep the provisional groups separate.'})));

 data={...data,supportSketches:groups.map(g=>({id:g.id,plane:g.frame,points:g.strokes.flatMap(s=>s.points),sourceStrokeIds:g.strokes.map(s=>s.id)}))};
 for(const g of [...groups,...chains]){const f=strokeFeatures(g.points),mirror=findSymmetry(f.normalized),circle=circleFit(f.normalized);const alignment=linearRunEvidence(f.normalized),rect=rectangleFit(f.normalized);features.push({id:g.id,sketchIds:[...new Set(g.strokes.map(s=>s.desktopSketchId).filter(Boolean))],strokeIds:g.strokes.map(s=>s.id),frame:g.frame,joinedStrokeCount:g.strokes.length,projectionCandidates:planeProjectionCandidates(g,data),surfaceCandidates:surfaceProjectionCandidates(g.strokes,data),repairContext:repairGroupContext(g,data),alignmentEvidence:rounded({planeSupport:alignment.planeSupport,runs:alignment.runs.map(r=>({angleDegrees:r.angle*180/Math.PI,lengthFraction:r.length,rmsFraction:r.rms,planeAligned:r.planeAligned})),note:'Long straight runs vote for plane H/V. Curvature and taper do not determine orientation.'}),rectangleEvidence:rounded({rmsFractionOfDiagonal:rect.rms,maxFractionOfDiagonal:rect.max,angleDegrees:rect.angle*180/Math.PI,widthMetres:rect.width*f.scale,heightMetres:rect.height*f.scale,note:'A candidate, not a forced classification. Four supported sides with small wavy deviations usually intend a rectangle even when a flexible spline fits more closely. Small pen tails/corner rounding are not necessarily fillets.'}),circularEvidence:circle?rounded({radiusMetres:circle.radius*f.scale,rmsFractionOfRadius:circle.rms/circle.radius,maxFractionOfRadius:circle.max/circle.radius,endpointGapFractionOfRadius:distance(f.normalized[0],f.normalized.at(-1))/circle.radius}):null,noiseEvidence:{sampleCount:g.points.length,lengthMetres:g.points.slice(1).reduce((sum,p,i)=>sum+distance(p,g.points[i]),0),spanMetres:f.scale,relativeSpan:f.scale/drawingSpan,note:'Shortness alone is not noise: keep tiny holes, edges and deliberate reference marks. Judge accidental flicks, backtracking scribbles and stray motion against the intended drawing and instruction.'},originUV:f.origin,scaleMetres:f.scale,reflectionCandidate:rounded({axisAngleDegrees:mirror.angle*180/Math.PI,pointInNormalizedUV:mirror.center,reflectedRmsFraction:mirror.score,perpendicularReflectedRmsFraction:mirror.perpendicularScore,note:'A fitted axis candidate, not an imposed constraint. Low reflected RMS compared with drawing diagonal is evidence of approximate symmetry.'}),measurements:rounded(f.values),directionSequence:f.sequence,normalizedPoints:rounded(sample(f.normalized)),strokes:g.strokes.map(s=>{const sf=strokeFeatures(s.uv);return {id:s.id,drawnFromView:s.view,measurements:rounded(sf.values),normalizedPoints:rounded(sample(sf.normalized)),originUV:sf.origin,scaleMetres:sf.scale};})});

  questions.push(choice(g.id+'.intent','Infer the intended drawing from the whole image and the user instruction. Choose generic regularization to remove freehand wobble and simplify supported lines/curves, without replacing the silhouette with an object template. Do not invent a neck, shoulder, rim, handle or other feature. Treat measured points as size/location references and retain the meaningful outline and proportions. Current user instruction (highest priority): '+(data.prompt||'[none]')+'. Prior explicit feedback for matching ink: '+(data.userCorrections||[]).filter(c=>c.sourceStrokeIds.some(id=>g.strokes.some(s=>s.id===id))).map(c=>c.text).join(' | '),choices({measured:'Intentionally precise/freeform geometry: preserve measured features.',regularized_outline:'Simplify the drawn outline using supported straight lines, smooth curves and regularity constraints. No object-specific template.'})),choice(g.id+'.alignment','Should near-horizontal/vertical features align to the ORIGINAL sketch plane U/V axes? Inspect long straight runs in alignmentEvidence. A slightly sloping rim/base drawn freehand usually intends horizontal, with vertical symmetry even when curved sides/taper skew a fitted axis. Prefer plane_aligned when evidence supports this. Choose drawn for a deliberately tilted design or explicit rotated instruction; preserve its pose. Screen camera rotation is irrelevant.',choices({plane_aligned:'Use plane H/V for supported lines and reflection axes. Correct small freehand tilt.',drawn:'Preserve deliberate in-plane rotation; regularize within that drawn frame.'})),choice(g.id+'.role','For the entire original engineering sketch, what is group '+g.id+'? Keep intended boundaries and holes, including tiny holes. Reject accidental flicks, backtracking scribbles and stray motion that do not express a meaningful design feature. A stroke need not produce geometry: accidental means NO CHANGE to the existing sketch. Compare noiseEvidence, the whole image and user intent; do not invent a line or curve just because some points exist. Construction center/reference lines are reference, not holes or filled boundaries. A sparse isolated mark with no coherent attachment, dimensional purpose or intentional feature is noise, not automatically a construction line. Select reference only when a construction axis, dimension or reference line is actually supported. When genuinely ambiguous retain geometry rather than discard a meaningful feature.',choices({geometry:'Intended sketch boundary or feature.',reference:'Intentional construction/reference mark.',accidental:'Reject as noise; leave the sketch unchanged for these strokes.'})),choice(g.id+'.primitive','Select the intended representation for group '+g.id+'. Use measured fit errors as evidence, not the final verdict. Prefer a simple regular shape when supported. Classify the WHOLE JOINED group, not its individual pen segments. Prefer circular arc elements for sustained round lobes, concave circular transitions and rounded ends, using the curve_style choice for a composite outline instead of treating every section as a free spline. A composite outline with several lobes is mixed, not one whole circle. Repeated near-round mechanical holes are normally circles; slight oval wobble alone is not an intended ellipse. Prefer circle when circularEvidence has low radial RMS and the image shows a near-round ring; an unconstrained ellipse fitting slightly better is not sufficient reason to choose ellipse. Keep deliberate open gaps and rounded ends. Prefer rectangle for a four-sided box with wavy sides, slight taper, short endpoint tails or incidental rounded corners. Use mixed only when sustained curved sections or a clearly deliberate fillet/rounded end convey the intent. Exact tracing of small pen errors is not the objective. Use componentRelationCandidates to classify similar repeated details consistently. Do not invent shapes.',primitiveChoices),choice(g.id+'.closure','Should group '+g.id+' be closed? Judge the combined group, not each constituent stroke. A nearly complete boundary made of several strokes is still a closed outline, whether curved, angular or mixed. Small gaps at the start/end or between pen fragments usually reflect pen lifting, not an intended opening. Close them when the whole image supports a continuous boundary. CircularEvidence is only relevant to circular holes; other boundaries do not need to be circular to close. Keep intentionally open paths open.',choices({open:'Intentionally open.',closed:'An intended closed outline.'})),choice(g.id+'.symmetry','Choose reflection symmetry for group '+g.id+' in its own rotated local frame. For a repairContext group, choose none by default: preserve the asymmetric surviving outline, including when joining replacement strokes into a chain. Do not mirror the repaired side to the other side, average the two sides, or move untouched portions. A low reflection error is not permission to redesign a repair. Only an explicit current request for symmetry or a manual one/both symmetry setting permits a new mirror constraint. Reflection means the whole silhouette matches its mirror, including open paths. Use the measured reflectionCandidate: a reflected RMS near 0–0.02 of the diagonal is strong supporting evidence for that axis, even with pen wobble; inspect the image and preserve deliberate asymmetry. Both axes require a good perpendicular reflection too. Reflection is different from rotational symmetry. A rectangle, ellipse or circle has both axes.',choices({none:'No clear reflection symmetry.',one:'One reflection axis.',both:'Two perpendicular reflection axes.'})));

  const support=planeSupportQuestion(g,data);if(support)questions.push(support);
  if(!f.fastStraight)questions.push(choice(g.id+'.curve_style','How should curved sections of '+g.id+' be regularized? For an ordinary freehand CAD sketch use circular as the default, even for an outline with several convex lobes and concave transitions. Numerical residual checks will keep any section that is not suitably circular. Wobbly sampled curvature is pen error, not evidence of intentional freeform curvature. Prefer circular for round lobes, rounded ends, fillets and constant-radius concave sections when supported. Numerical fitters will use bounded circular arcs where possible, preserving lines, silhouette and reflection symmetry. This is a per-section choice: do not turn a multi-lobed outline into one circle. Choose flexible only when the user asks to retain exact/freeform curvature or the design clearly requires a continuously varying mathematical curve. A single analytic ellipse still uses the ellipse primitive; it does not require this composite arc route.',choices({circular:'Default CAD simplification: use circular arc elements where bounded numerical fits support them; retain unmatched sections.',flexible:'Intentionally exact freeform or continuously varying curvature; do not regularize into arcs.'})));
  for(const s of g.strokes){if(g.strokes.length>1)questions.push(choice('stroke.'+s.id+'.role','Does this individual stroke contribute to the intended outline, even though provisional grouping placed it near others? Reject accidental flicks or unrelated scribbles; preserve deliberate boundary fragments, tiny features and references.',choices({geometry:'Intentional stroke fragment.',accidental:'Ignore this stroke as noise; keep the other strokes.'}))); if(g.strokes.length===1||strokeFeatures(s.uv).fastStraight)continue;questions.push(choice('stroke.'+s.id,'Classify only stroke '+s.id+' in the context of the complete image. A curved section of a rounded outline is not automatically a full oval.',primitiveChoices));}

 }

 const mergeCandidates=traceMergeCandidates(groups);for(const pair of mergeCandidates)questions.push(choice(pair.name,'Do groups '+pair.groupIds.join(' and ')+' retrace the SAME intended outline? Merge only noisy repeated pen passes along one intended boundary. Keep deliberate inner/outer walls, grooves, offset profiles, and distinct neighboring features separate, even if close. Examine the shared original drawing as well as each group panel. Use traceMergeCandidates evidence. Noisy interleaved/crossing passes that cover almost the same boundary usually mean pen retracing, not two manufactured edges. A deliberately separate wall/groove has a consistent offset or other clear design evidence. When uncertain keep separate.',choices({same_outline:'Repeated noisy pen passes for one outline; merge into one measured consensus.',independent:'Distinct boundaries/features; retain both.'})));

 const originPlacement=originPlacementContext([...groups,...chains],data);questions.push(...originPlacement.questions,...repairSymmetryQuestions([...groups,...chains],data),...repairAlignmentQuestions([...groups,...chains],data));const componentRelations=componentRelationContext(groups,data);questions.push(...componentRelations.questions);questions.push(...editTargetQuestion(data,[...groups,...chains]));const crossPlane=crossPlaneContext([...groups,...chains],data);questions.push(...crossPlane.questions);const connections=nearbyConnectionContext([...groups,...chains],data);questions.push(...connections.questions);

 const taskQuestion=sketchTaskQuestion(data);
 if(taskQuestion)questions.push(taskQuestion,subjectQuestion,formQuestion);
 const ink=renderDecisionInk([...groups,...chains]);

 const content=[{type:'input_text',text:'First identify the requested deliverable in the CAD workspace. The per-stroke fitting questions describe reference geometry; they do not decide whether the final output should be planar. When the instruction names a physical component and describes its features, the downstream planner builds that body by default. Explicit sketch and drawing requests stay planar. Understand the intended figure, not just the stroke path. Respect editContext.lastErasure in the affected sketch/figure: intentionally erased ink and cut segments are deliberate openings, not pen-lift gaps to reconstruct. Do not heal those removals unless requested; unrelated new shapes still follow ordinary closure rules. Human sketching errors and incidental bends are not CAD features. Simplify supported geometry without imposing a named-object template or adding features. Use measured points as scale, direction and placement references, not as a command to reproduce the exact shape. Interpret this CAD sketch, not handwriting. The current user instruction takes priority over prior corrections. Prior explicit user corrections apply only to their matching active stroke IDs. For new drawings, prefer supported symmetry, equal dimensions, origin/axis centering when already nearby, and horizontal/vertical alignment. These are defaults, not commands that overrule local user edits. Give strong preference to horizontal/vertical rims, bases and straight edges in the ORIGINAL PLANE, plus symmetry, parallel/perpendicular edges and common angles when supported. Curved sides and taper are not evidence that the entire object should tilt. Preserve deliberately rotated designs. Small freehand errors are not deliberate details. Repair overrides generic symmetry priors: for groups with repairContext preserve existing asymmetric geometry and untouched portions; infer how a new stroke repairs the local gap without mirroring, equalizing, recentering, globally realigning or reshaping the rest. A local correction may intentionally break symmetry or slope away from H/V; preserve that exception in the edited region while retaining the surrounding drawing. A joined chain inherits repairContext from its source strokes. Classifying each fragment as asymmetric and then imposing symmetry on the combined chain is incorrect. Ordinary repair/cleanup is not a request to make symmetric. Groups are provisional. Use explicit trace-pair questions to identify repeated passes for one boundary. Otherwise preserve separate groups. Repeated mechanical holes usually have equal circular sizes; preserve deliberate unequal/elliptical features. Preserve intentional fillets and rounded ends; incidental corner wobble is not evidence of a fillet. Recognize repeated or mirrored components as one family, using equal dimensions, horizontal/vertical levels and symmetric offsets when supported. These are separate placed components, not merged strokes. Map each spoken instruction in speechInputs to its associated strokeIds. Other visible ink is context. Do not generate coordinates.\n'+JSON.stringify({partContext:data.partContext,speechInputs:speechMetadata(data.speechInputs),objectSurfaces:surfaceSceneCatalog(data.surfaceScene),editContext:data.editContext,originPlacementCandidates:originPlacement.candidates,componentRelationCandidates:componentRelations.candidates,nearbyConnectionCandidates:connections.candidates,crossPlaneCandidates:crossPlane.candidates,referenceFrames:crossPlane.references.map(r=>({id:r.id,name:r.name,plane:r.frame})),instruction:data.prompt||'',priorExplicitUserCorrections:data.userCorrections,groups:features,traceMergeCandidates:mergeCandidates,proposedChains:chains.map(c=>({id:c.id,groupIds:c.joinedGroupIds})),planarInkPanels:ink.panels,view:data.view})}];

 content.push({type:'input_text',text:'Clean planar projection of the original ink. Use this to recognize shape; panel mappings above locate it in the design frame.'},{type:'input_image',image_url:ink.image,detail:groups.length>2?'high':'low'});



 if(crossPlane.references.length){const refs=crossPlane.references.map(r=>({id:r.id,frame:r.frame,points:r.points.map(p=>[r.frame.xAxis,r.frame.yAxis].map(a=>a.reduce((n,v,k)=>n+(p[k]-r.frame.origin[k])*v,0)))}));for(const r of refs)r.strokes=[{uv:r.points}];const refInk=renderDecisionInk(refs);content.push({type:'input_text',text:'Existing sketch outputs. References are read-only except the explicitly selected editContext target when the edit_selected_drawing decision chooses replacement. Panel-to-world mappings: '+JSON.stringify(refInk.panels)},{type:'input_image',image_url:refInk.image,detail:'low'});}

 if(data.image)content.push({type:'input_image',image_url:data.image,detail:'low'});

 content.push(...speechInkContent(data));
 return {groups,body:{model:'gpt-6-luna',input:[{role:'user',content}],questions:questions.filter((q,i,all)=>all.findIndex(other=>other.name===q.name)===i),prompt_cache_key:'draw3d-sketch-decisions-v1'}};

}

function selected(answers,name,fallback,warnings){const a=answers.find(a=>a.name===name);if(a?.type==='choice')return {label:a.choice,confidence:a.confidence,probabilities:a.probabilities};warnings.push('No usable decision for '+name+'; preserved a flexible measured representation.');return {label:fallback,refused:a?.type==='refusal'};}

export function fitDecisionResponse(data,groups,response){

 if(!Array.isArray(response.answers))throw Error('Decisions API returned no answers');

 const joined=joinApprovedChains(groups,response.answers),merged=mergeApprovedTraces(joined.groups,response.answers),warnings=[],whole=selected(response.answers,'drawing_representation','mixed',warnings),ignoredGroups=[],results=merged.groups.map(original=>{const rejected=original.strokes.filter(s=>response.answers.find(a=>a.name==='stroke.'+s.id+'.role')?.choice==='accidental');for(const s of rejected)ignoredGroups.push({id:original.id+':'+s.id,sourceStrokeIds:[s.id],reason:'Model rejected accidental stroke'});const kept=original.strokes.filter(s=>!rejected.includes(s));if(!kept.length)return null;let g=original;if(rejected.length){const rebuilt=groupStrokes(kept,data.plane);g={...original,strokes:kept,points:rebuilt.flatMap(g=>g.points)};}const role=response.answers.find(a=>a.name===g.id+'.role')?.choice||'geometry';if(role==='accidental'){ignoredGroups.push({id:g.id,sourceStrokeIds:g.strokes.map(s=>s.id),reason:'Model marked accidental'});return null;}const primitive=selected(response.answers,g.id+'.primitive','mixed',warnings),closure=selected(response.answers,g.id+'.closure','open',warnings),symmetry=selected(response.answers,g.id+'.symmetry','none',warnings),strokes=g.strokes.map(s=>({id:s.id,primitive:strokeFeatures(s.uv).fastStraight?{label:'line',fastPath:true}:g.strokes.length===1?primitive:g.retraced?selected(response.answers,groups.find(original=>original.strokes.some(raw=>raw.id===s.id)).id+'.primitive','mixed',warnings):selected(response.answers,'stroke.'+s.id,'mixed',warnings)}));

  const explicitGeometry=data.options?.representation&&data.options.representation!=='auto'||data.options?.closed===false||data.options?.symmetry&& !['auto','one'].includes(data.options.symmetry);const intent=data.options?.intent==='measured'||explicitGeometry?'measured':response.answers.find(a=>a.name===g.id+'.intent')?.choice||'measured',alignment=response.answers.find(a=>a.name===g.id+'.alignment')?.choice||'auto';

  const repairPolicy=repairSymmetryPolicy(g,data,response),modelSymmetry=symmetry.label;if(repairPolicy.preserveAsymmetry)symmetry.label='none';const simplified=intent!=='measured',result=recognizeGroup(g,{...data.options,...(repairPolicy.preserveAsymmetry?{symmetry:'none'}:{}),alignment:repairPolicy.preservePlacement?'drawn':alignment,...(repairPolicy.preservePlacement?{align:false}:{}),abstraction:simplified?'simplified':undefined,decisions:{primitive,closure,symmetry,curveStyle:{label:response.answers.find(a=>a.name===g.id+'.curve_style')?.choice||'flexible'},representation:whole,strokes}});result.interpretation={mode:simplified?'simplified':'measured',label:result.kind==='profile'?(simplified?'Simplified outline':'Measured outline'):result.kind[0].toUpperCase()+result.kind.slice(1)};const supportAnswer=response.answers.find(a=>a.name===g.id+'.support_plane');result.supportDecision=supportAnswer?.type==='choice'?{label:supportAnswer.choice,confidence:supportAnswer.confidence}:{label:'current'};if(repairPolicy.repair){result.repairPolicy={...repairPolicy,modelSymmetry,appliedSymmetry:result.constraints.symmetry};result.constraints.repairPreservesAsymmetry=!!repairPolicy.preserveAsymmetry;}result.construction=role==='reference';return result;

 }).filter(Boolean);

 const originPlacements=applyOriginPlacement(results,originPlacementContext([...groups,...strokeChainCandidates(groups)],data),response.answers,[...groups,...strokeChainCandidates(groups)]);
 const crossPlaneMatches=applyCrossPlaneMatches(results,crossPlaneContext([...groups,...strokeChainCandidates(groups)],data),response.answers,[...groups,...strokeChainCandidates(groups)]);

 const connections=applyNearbyConnections(results,nearbyConnectionContext([...groups,...strokeChainCandidates(groups)],data),response.answers,[...groups,...strokeChainCandidates(groups)]);

 const componentRelations=applyComponentRelations(results,componentRelationContext(groups,data),response.answers,merged.groups);
 const edits=results.map(decisionResultEdit);selectedDrawingEdits(data,results,edits,response);
 return {originPlacements,noOp:!results.length&&ignoredGroups.length>0,componentRelations,connections,crossPlaneMatches,version:2,model:'gpt-6-luna',method:'OpenAI Decisions API + numerical fitting',traceMerges:merged.approved,joinedChains:joined.approved,ignoredGroups,results,edits,warnings,decisions:response.answers};

}

export async function runSketchDecisions(data,{fetcher=fetch,apiKey=process.env.OPENAI_API_KEY,signal,recordingId,save=true}={}){

 if(!apiKey&&!cloudVertexReady())throw Error('The backend OpenAI API key is not configured');

 const started=performance.now();validateDecisionInput(data);const corrections=await matchingDrawingCorrections(data,{recordingId});const {groups,body}=buildDecisionRequest({...data,userCorrections:corrections}),id=randomUUID(),folder=path.resolve(process.env.SESSION_DIR||'sessions','decision-sketches',id);

 const saveJSON=async(name,value)=>{if(save){await mkdir(folder,{recursive:true});await writeFile(path.join(folder,name+'.json'),JSON.stringify(value));}};

 await saveJSON('request',{recordingId,data,body,at:Date.now()});

 let response;

 try{const sent=performance.now();
  if(!apiKey&&cloudVertexReady())response=await vertexDecisions(body,{fetcher,signal});
  else try{const {http,raw}=await readProvider(fetcher,'https://api.openai.com/v1/decisions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)},async http=>({http,raw:await http.text()}),{stage:'Sketch interpretation'});try{response=JSON.parse(raw);}catch{throw Error('Decisions API returned a non-JSON response (HTTP '+http.status+'); request saved, no geometry changed');}if(!http.ok){const error=Error('Decisions API request failed (HTTP '+http.status+'); '+(response.error?.code||'check backend access'));error.status=http.status;throw error;}}
  catch(error){if(signal?.aborted||!cloudVertexReady()||error.status&&![408,429,500,502,503,504].includes(error.status))throw error;response=await vertexDecisions(body,{fetcher,signal});}
  await saveJSON('response',response);

  const apiMs=performance.now()-sent,result=fitDecisionResponse(data,groups,response),report={...result,...(response.provider==='vertex-cloud'?{model:response.model,method:'Google Cloud fallback + numerical fitting'}:{}),id,usage:response.usage,cost:decisionCost(response.usage),timings:{apiMs,fitMs:performance.now()-sent-apiMs,totalMs:performance.now()-started},input:{matchedUserCorrections:corrections.length,groupCount:groups.length,strokeCount:data.strokes.length,questionCount:body.questions.length,imageCount:body.input.flatMap(m=>m.content).filter(p=>p.type==='input_image').length},recordingId};await saveJSON('result',report);return report;

 }catch(e){await saveJSON('failure',{message:e.message,usage:response?.usage,cost:decisionCost(response?.usage),elapsedMs:performance.now()-started});throw e;}

}

export const decisionInputHash=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');

