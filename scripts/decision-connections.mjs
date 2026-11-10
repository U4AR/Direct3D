import {sameSketchPlane} from './decision-cross-plane.mjs';

import {sketchFrame} from '../src/desktop-sketch-fit.js';

import {bounds,simplify,distance,deviation} from '../src/decision-sketch/math.js';

import {constrainKnots,knotsToSegments} from '../src/decision-sketch/constraints.js';

import {sampleDraftSegment} from '../src/desktop-measured-draft.js';

const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),sub=(a,b)=>a.map((v,k)=>v-b[k]),world=(p,f)=>f.origin.map((v,k)=>v+p[0]*f.xAxis[k]+p[1]*f.yAxis[k]),uv=(p,f)=>[f.xAxis,f.yAxis].map(a=>dot(sub(p,f.origin),a));

function project(p,a,b){const d=sub(b,a),t=Math.max(0,Math.min(1,dot(sub(p,a),d)/(dot(d,d)||1)));return a.map((v,k)=>v+t*d[k]);}

export function nearbyConnectionContext(groups,data){

 const refs=[...groups.map((g,i)=>({id:g.id,order:i,frame:g.frame,points:g.points.map(p=>world(p,g.frame)),sourceStrokeIds:g.strokes.map(s=>s.id)})),...(data.references||[]).map(r=>({...r,order:-1,frame:sketchFrame(r.plane)}))],questions=[],candidates=[];

 for(const [order,g]of groups.entries()){

  const span=bounds(g.points).span;if(distance(g.points[0],g.points.at(-1))<span*.10)continue;

  for(const [end,point]of [['start',g.points[0]],['end',g.points.at(-1)]]){

   const options=[];

   for(const r of refs){if(r.order>=order||!sameSketchPlane(g.frame,r.frame)||r.sourceStrokeIds?.some(id=>g.strokes.some(s=>s.id===id)))continue;

    const local=r.points.map(p=>uv(p,g.frame)),size=Math.max(span,bounds(local).span),tolerance=Math.max(.0005,size*.045),vertices=simplify(local,size*.012);

    for(const [index,p]of vertices.entries()){

     const d=distance(point,p);if(d<tolerance)options.push({referenceId:r.id,feature:'vertex',targetPoint:world(p,g.frame),distanceMetres:d,targetVertexHint:index});

     for(const k of data.options?.align===false?[]:[0,1]){const delta=Math.abs(point[k]-p[k]);if(delta<tolerance*.6&&d<size*1.5)options.push({referenceId:r.id,feature:k===0?'same_u':'same_v',targetPoint:world(point.map((v,j)=>j===k?p[j]:v),g.frame),referencePoint:world(p,g.frame),distanceMetres:delta,scorePenalty:tolerance*.4});}

    }

    let closest;for(let i=1;i<local.length;i++){const p=project(point,local[i-1],local[i]),d=distance(point,p);if(!closest||d<closest.distanceMetres)closest={referenceId:r.id,feature:'edge',targetPoint:world(p,g.frame),distanceMetres:d};}if(closest?.distanceMetres<tolerance)options.push(closest);

   }

   const selected=options.sort((a,b)=>(a.distanceMetres+(a.scorePenalty||0))-(b.distanceMetres+(b.scorePenalty||0))).filter((c,i,a)=>a.findIndex(r=>r.referenceId===c.referenceId&&r.feature===c.feature&&distance(r.targetPoint,c.targetPoint)<.0001)===i).slice(0,6);if(!selected.length)continue;

   const name=g.id+'.connect_'+end;for(const [i,c]of selected.entries())candidates.push({...c,value:'connect_'+i,question:name,groupId:g.id,end,sourcePoint:world(point,g.frame)});

   questions.push({type:'choice',name,instructions:'Should '+g.id+' / '+end+' attach or align to existing nearby sketch geometry? Attach only if this group remains open; choose independent if it becomes a closed outline. Use nearbyConnectionCandidates, original images and user instructions. Prefer coincidence at intended touching corners/edges, and common horizontal/vertical levels when they express a shared feature or symmetric spacing. Proximity is evidence, not a command: preserve separate details, clearances and explicit user offsets. A same_u/same_v choice aligns only that coordinate, not the whole point. Other figures must not move.',choices:[{value:'independent',description:'Keep the endpoint independent.'},...selected.map((c,i)=>({value:'connect_'+i,description:c.feature+' on '+c.referenceId+'; correction '+(c.distanceMetres*1000).toFixed(2)+' mm.'}))]});

  }

 }

 return {questions,candidates};

}

export function applyNearbyConnections(results,context,answers,groups){

 const attached=[];

 for(const q of context.questions){const c=context.candidates.find(c=>c.question===q.name&&c.value===answers.find(a=>a.name===q.name)?.choice);if(!c)continue;const f=results.find(f=>f.id===c.groupId);if(!f||f.constraints.closed||!['line','profile'].includes(f.kind))continue;

  const old=structuredClone(f),target=results.find(f=>f.id===c.referenceId),targetPoint=c.targetPoint.slice();

  if(target){const vertices=target.knots?.map(p=>world(p,target.frame))||target.pathWorld,nearest=vertices.reduce((best,p)=>distance(p,c.referencePoint||c.targetPoint)<distance(best,c.referencePoint||c.targetPoint)?p:best,vertices[0]);if(c.feature==='vertex')targetPoint.splice(0,3,...nearest);if(c.feature==='edge'){const path=target.pathWorld,projections=path.slice(1).map((p,i)=>project(c.targetPoint,path[i],p)).sort((a,b)=>distance(a,c.targetPoint)-distance(b,c.targetPoint));if(projections[0])targetPoint.splice(0,3,...projections[0]);}if(c.feature==='same_u'||c.feature==='same_v'){const group=groups.find(g=>g.id===f.id),k=c.feature==='same_u'?0:1,local=uv(targetPoint,group.frame),reference=uv(nearest,group.frame);local[k]=reference[k];targetPoint.splice(0,3,...world(local,group.frame));}}

  try{

   const index=c.end==='start'?0:(f.knots?.length||2)-1;

   if(f.kind==='profile'){const previous=f.constraints.connections||[],anchors=previous.filter(c=>!c.feature.startsWith('same_')).map(c=>({index:c.sourceKnotIndex,point:uv(c.targetPoint,f.frame)})),linearAnchors=previous.filter(c=>c.feature.startsWith('same_')).map(c=>{const normal=[dot(c.directionWorld,f.frame.xAxis),dot(c.directionWorld,f.frame.yAxis)];return {index:c.sourceKnotIndex,normal,value:dot(uv(c.targetPoint,f.frame),normal)};});if(c.feature==='same_u'||c.feature==='same_v'){const frame=groups.find(g=>g.id===f.id).frame,axis=c.feature==='same_u'?frame.xAxis:frame.yAxis,normal=[dot(axis,f.frame.xAxis),dot(axis,f.frame.yAxis)];linearAnchors.push({index,normal,value:dot(uv(targetPoint,f.frame),normal)});}else anchors.push({index,point:uv(targetPoint,f.frame)});const result=constrainKnots(f.knots,{...f.constraints,align:f.constraints.aligned,anchors,linearAnchors});f.knots=result.knots;f.segments=knotsToSegments(f.knots,{...f.constraints,closed:false}).map(s=>({...s,coordinates:s.coordinates}));f.pathWorld=f.segments.flatMap(s=>sampleDraftSegment({kind:'spline',coordinates:s.coordinates},12)).map(p=>world(p,f.frame));}

   else{const path=f.pathWorld.map(p=>p.slice());path[c.end==='start'?0:path.length-1]=targetPoint;const d=sub(path.at(-1),path[0]),length=Math.hypot(...d);if(length<1e-6)continue;const x=d.map(v=>v/length),n=f.frame.normal,y=[n[1]*x[2]-n[2]*x[1],n[2]*x[0]-n[0]*x[2],n[0]*x[1]-n[1]*x[0]];f.frame={...f.frame,origin:path[0],xAxis:x,yAxis:y};f.primitive.length=length;f.pathWorld=path;}

   const connection={sourceKnotIndex:index,referenceId:c.referenceId,feature:c.feature,targetPoint,referencePoint:c.referencePoint,directionWorld:c.feature==='same_u'?groups.find(g=>g.id===f.id).frame.xAxis:c.feature==='same_v'?groups.find(g=>g.id===f.id).frame.yAxis:undefined};const g=groups.find(g=>g.id===f.id);if(g){const error=deviation(g.points,f.pathWorld.map(p=>uv(p,g.frame)),false);f.metrics={...f.metrics,...error,relativeMax:error.max/bounds(g.points).span};if(f.metrics.relativeMax>Math.max(.10,old.metrics.relativeMax+.035))throw Error('Nearby connection would distort the intended outline');}f.constraints.connections??=[];f.constraints.connections.push(connection);attached.push({groupId:f.id,...connection});

  }catch(e){Object.assign(f,old);f.warnings.push('Connection not applied: '+e.message);}

 }

 return attached;

}

