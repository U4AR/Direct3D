import {sketchFrame} from '../src/desktop-sketch-fit.js';

import {bounds,deviation} from '../src/decision-sketch/math.js';

import {linearRunEvidence} from '../src/decision-sketch/alignment.js';



const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),sub=(a,b)=>a.map((v,k)=>v-b[k]);

const world=(p,f)=>f.origin.map((v,k)=>v+p[0]*f.xAxis[k]+p[1]*f.yAxis[k]);

const uv=(p,f)=>[f.xAxis,f.yAxis].map(a=>dot(sub(p,f.origin),a));

const extent=(points,axis)=>{const p=points.map(p=>dot(p,axis)),min=Math.min(...p),max=Math.max(...p);return {min,max,center:(min+max)/2,size:max-min};};

const canonical=a=>{const n=Math.hypot(...a),p=a.map(v=>v/n),k=p.map(Math.abs).indexOf(Math.max(...p.map(Math.abs)));return p[k]<0?p.map(v=>-v):p;};

export function sameSketchPlane(a,b){return Math.abs(dot(a.normal,b.normal))>1-1e-6&&Math.abs(dot(sub(a.origin,b.origin),a.normal))<1e-5;}

function sharedAxes(a,b){const x=[a.normal[1]*b.normal[2]-a.normal[2]*b.normal[1],a.normal[2]*b.normal[0]-a.normal[0]*b.normal[2],a.normal[0]*b.normal[1]-a.normal[1]*b.normal[0]];return Math.hypot(...x)>.01?[canonical(x)]:[canonical(a.xAxis),canonical(a.yAxis)];}

export function validatePlaneReferences(data){

 if(data.references===undefined)return;

 if(!Array.isArray(data.references)||data.references.length>24)throw Error('Use at most 24 cross-plane references');

 const ids=new Set();for(const r of data.references){if(typeof r.id!=='string'||r.id.length>160||ids.has(r.id))throw Error('Cross-plane references need unique IDs');ids.add(r.id);const f=sketchFrame(r.plane);if(!Array.isArray(r.points)||r.points.length<2||r.points.length>256||r.points.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e4)))throw Error('Use bounded finite world-space reference paths');if(r.points.some(p=>Math.abs(dot(sub(p,f.origin),f.normal))>.001))throw Error('Reference path must lie on its stated plane');}

}

export function crossPlaneContext(groups,data){

 if(data.options?.align===false)return {questions:[],candidates:[],references:[]};
 const active=sketchFrame(data.plane||data.strokes.at(-1).plane),refs=[...groups.map(g=>({id:g.id,name:g.id,frame:g.frame,points:g.points.map(p=>world(p,g.frame)),sourceStrokeIds:g.strokes.map(s=>s.id)})),...(data.references||[]).map(r=>({...r,frame:sketchFrame(r.plane),name:String(r.name||r.id).slice(0,100)}))],questions=[],candidates=[];

 const targets=refs.filter(r=>!sameSketchPlane(r.frame,active));

 const levels=new Map();

 function featureLevels(ref,axis){const key=ref.id+JSON.stringify(axis);if(levels.has(key))return levels.get(key);const b=extent(ref.points,axis),local=ref.points.map(p=>uv(p,ref.frame)),box=bounds(local),normalized=local.map(p=>p.map((v,k)=>(v-box.center[k])/box.span)),runs=linearRunEvidence(normalized).runs;const result=[{feature:'min',value:b.min},{feature:'max',value:b.max},{feature:'center',value:b.center}];for(const [i,r]of runs.entries()){const p=r.points.map(p=>world(p.map((v,k)=>box.center[k]+v*box.span),ref.frame)),a=dot(p[0],axis),c=dot(p[1],axis);if(Math.abs(a-c)<b.size*.025&&Math.min(Math.abs(a-b.min),Math.abs(a-b.max),Math.abs(a-b.center))>b.size*.06)result.push({feature:'edge_'+i,value:(a+c)/2});}levels.set(key,result);return result;}

 for(const g of groups.filter(g=>sameSketchPlane(g.frame,active)).slice(-8)){

  const source=g.points.map(p=>world(p,g.frame)),axes=[];

  for(const ref of targets)for(const axis of sharedAxes(g.frame,ref.frame)){

   const a=extent(source,axis),b=extent(ref.points,axis);

   const span=Math.max(a.size,b.size,bounds(g.points).span,.001),scale=b.size/Math.max(a.size,1e-12);

   const push=(relation,feature,sourceFeature,shift,scale,score)=>{let bucket=axes.find(b=>Math.abs(dot(b.axis,axis))>.999);if(!bucket){bucket={axis,choices:[]};axes.push(bucket);}bucket.choices.push({referenceId:ref.id,referenceName:ref.name,referencePlaneId:ref.frame.id,sourceStrokeIds:ref.sourceStrokeIds,relation,feature,sourceFeature,shiftMetres:shift,scale,score,axisWorld:axis,sourceExtent:a,targetExtent:b,targetLevel:featureLevels(ref,axis).find(l=>l.feature===feature)?.value});};

   if(a.size>1e-5&&b.size>1e-5&&scale>=.65&&scale<=1.5&&Math.abs(a.center-b.center)<span*.3)push('extent',null,null,b.center-a.center,scale,(Math.abs(a.min-b.min)+Math.abs(a.max-b.max))/span);

   for(const target of featureLevels(ref,axis))for(const feature of a.size>1e-5?['min','max','center']:['center']){const shift=target.value-a[feature];if(Math.abs(shift)>span*.16)continue;push('level',target.feature,feature,shift,1,Math.abs(shift)/span+.18+(target.feature===feature?0:.12));}

  }

  for(const [i,bucket]of axes.slice(0,2).entries()){

   const chosen=bucket.choices.sort((a,b)=>a.score-b.score).slice(0,8);if(!chosen.length)continue;

   const name=g.id+'.cross_plane_'+i;

   const options=chosen.map((c,j)=>({...c,value:'match_'+j,groupId:g.id,question:name}));candidates.push(...options);

   questions.push({type:'choice',name,instructions:'Does this new view of group '+g.id+' correspond to an existing outline or FEATURE on another plane? Shared world direction '+JSON.stringify(bucket.axis)+'. Use the images, original plane frames and crossPlaneCandidates to identify corresponding heights/widths, endpoints, centers or straight feature levels. The user may be adding another view of the same part without typed instructions; compare nearby projected levels and prefer supported correspondence rather than assuming every plane is a separate object. Different views need not have the same silhouette. Under close user guidance, a new plane usually adds a view/detail to this design. When projected extents are near the same position and agree within about 15%, favor matching their common extent unless there is evidence of a separate part or an intentional offset. Choose an extent only for the same whole feature; choose a single level for a partial detail. Keep unrelated parts, intended offsets and separate features independent. No matching is mandatory. Existing other-plane geometry is a reference and must not move.',choices:[{value:'independent',description:'Keep this dimension/position independent; no supported correspondence.'},...options.map(c=>({value:c.value,description:c.relation==='extent'?'Match shared extent to '+c.referenceName+' ('+c.referencePlaneId+'); scale '+c.scale.toFixed(3)+', shift '+(c.shiftMetres*1000).toFixed(1)+' mm.':'Align '+c.sourceFeature+' to '+c.referenceName+' / '+c.feature+' ('+c.referencePlaneId+'); shift '+(c.shiftMetres*1000).toFixed(1)+' mm.'}))]});

  }

 }

 return {questions,candidates,references:refs.filter(r=>(data.references||[]).some(s=>s.id===r.id))};

}



function transformResult(f,axis,scale,delta){

 const local=[dot(axis,f.frame.xAxis),dot(axis,f.frame.yAxis)],aligned=local.map(Math.abs).findIndex(v=>v>1-1e-6),uniform=aligned<0||['circle','arc','line'].includes(f.kind),sx=uniform||aligned===0?scale:1,sy=uniform||aligned===1?scale:1,origin=f.frame.origin.slice(),next=origin.map((v,k)=>v+axis[k]*delta);

 const map=p=>{const q=uv(p,f.frame);return next.map((v,k)=>v+q[0]*sx*f.frame.xAxis[k]+q[1]*sy*f.frame.yAxis[k]);};

 f.pathWorld=f.pathWorld.map(map);f.frame={...f.frame,origin:next};

 if(f.segments)f.segments=f.segments.map(s=>({...s,coordinates:s.coordinates.map((v,k)=>v*(k%2?sy:sx))}));if(f.knots)f.knots=f.knots.map(p=>[p[0]*sx,p[1]*sy]);

 if(f.primitive)for(const key of Object.keys(f.primitive)){if(key.endsWith('Deg'))continue;f.primitive[key]*=['height','b'].includes(key)?sy:sx;}

 return {scaleUV:[sx,sy],uniformToPreservePrimitive:uniform&&scale!==1};

}

export function applyCrossPlaneMatches(results,context,answers,groups){

 const matches=[];

 for(const q of context.questions){const chosen=context.candidates.find(c=>c.question===q.name&&c.value===answers.find(a=>a.name===q.name)?.choice);if(!chosen)continue;

  const f=results.find(r=>r.id===chosen.groupId);if(!f)continue;

  const target=results.find(r=>r.id===chosen.referenceId||chosen.sourceStrokeIds?.some(id=>r.sourceStrokeIds.includes(id))),axis=chosen.axisWorld,b=target?extent(target.pathWorld,axis):chosen.targetExtent,a=extent(f.pathWorld,axis);

  let scale=chosen.relation==='extent'?b.size/a.size:1,targetLevel=chosen.feature?.startsWith('edge_')?chosen.targetLevel:b[chosen.feature],delta=chosen.relation==='extent'?b.center-(dot(f.frame.origin,axis)+scale*(a.center-dot(f.frame.origin,axis))):targetLevel-a[chosen.sourceFeature];

  // Recheck bounded proposals against the actual fitted geometry, not just ink.

  if(!Number.isFinite(scale)||scale<.6||scale>1.65||!Number.isFinite(delta)||Math.abs(delta)>Math.max(a.size,b.size)*.35)continue;

  const before=f.pathWorld.map(p=>p.slice()),transformed=transformResult(f,axis,scale,delta),match={groupId:f.id,referenceId:chosen.referenceId,relation:chosen.relation,sourceFeature:chosen.sourceFeature,targetFeature:chosen.feature,axisWorld:axis,shiftMetres:delta,...transformed};

  f.constraints.crossPlaneMatches??=[];f.constraints.crossPlaneMatches.push(match);matches.push(match);

  const raw=groups.find(g=>g.id===f.id);if(raw){const error=deviation(raw.points,f.pathWorld.map(p=>uv(p,raw.frame)),f.constraints.closed);f.metrics={...f.metrics,preCrossPlane:f.metrics.preCrossPlane||{rms:f.metrics.rms,max:f.metrics.max},...error,relativeMax:error.max/bounds(raw.points).span};}

  f.metrics.crossPlaneMaxMoveMetres=Math.max(f.metrics.crossPlaneMaxMoveMetres||0,...before.map((p,i)=>Math.hypot(...sub(p,f.pathWorld[i]))));

 }

 return matches;

}

