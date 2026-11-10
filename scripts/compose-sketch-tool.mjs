import {sketchFrame} from '../src/desktop-sketch-fit.js';
import {validateDesktopEdit} from '../src/desktop-edit-contract.js';

const numeric={type:'number'},nullableString={type:['string','null']},nullableVersion={type:['integer','null']};
const coords=n=>({type:'array',items:numeric,minItems:n,maxItems:n});
const entitySchema=(kind,coordinates)=>{const properties={name:{type:'string'},kind:{type:'string',enum:[kind]},coordinates,closed:{type:'boolean'},figureId:nullableString,expectedVersion:nullableVersion};return {type:'object',properties,required:Object.keys(properties),additionalProperties:false};};
export const COMPOSE_SKETCH_TOOL={type:'function',name:'compose_sketch',strict:true,
 description:'Reconstruct the INTENDED drawing in one move using images + measured reference UV. Use separate named straight runs and true curves; never make one spline for a mixed angular/rounded outline. Coordinates are absolute UV metres in the chosen reference plane. line:[startU,startV,endU,endV]; polyline:[u0,v0,u1,v1,...] for STRAIGHT CORNERS ONLY; circle:[u,v,r]; arc:[u,v,r,startDegrees,endDegrees] counter-clockwise; rectangle:[u,v,width,height]; arc3:[startU,startV,midU,midV,endU,endV] computes a true circle through 3 ON-CURVE anchors locally: start/end at the two junctions with straight runs, mid at the bulge apex between them, not a control handle. Example semicircle:[0,0,0.05,0.05,0.1,0]. Use one complete arc for a circular cut-in/end; spline:[[8 cubic controls],...] ONLY for noncircular curved runs. At most 16 entities/64 expanded edges. figureId/expectedVersion update existing geometry; null creates. No thickness.',
 parameters:{type:'object',properties:{intent:{type:'string'},strokeIds:{type:'array',items:{type:'string'},minItems:1,maxItems:16},planeId:nullableString,entities:{type:'array',minItems:1,maxItems:16,items:{anyOf:[entitySchema('line',coords(4)),entitySchema('polyline',{type:'array',items:numeric,minItems:4,maxItems:130}),entitySchema('circle',coords(3)),entitySchema('arc',coords(5)),entitySchema('arc3',coords(6)),entitySchema('rectangle',coords(4)),entitySchema('spline',{type:'array',items:coords(8),minItems:1,maxItems:64})]}}},required:['intent','strokeIds','planeId','entities'],additionalProperties:false}};

export function composeSketchEdit({call,run,evidence}){
 if(evidence.workspace!=='desktop')throw Error('Sketch composition requires desktop mode');
 const a=JSON.parse(call.arguments),sources=a.strokeIds?.map(id=>evidence.strokes.find(s=>s.id===id));
 if(!sources?.length||sources.length>16||sources.some(s=>!s)||new Set(a.strokeIds).size!==a.strokeIds.length)throw Error('Select distinct current source strokes');
 const plane=id=>evidence.referencePlanes?.find(p=>p.id===id)||evidence.sketchCatalog?.find(p=>p.plane?.id===id)?.plane||(evidence.defaultPlane?.id===id?evidence.defaultPlane:null);
 const sourcePlane=s=>s.plane||evidence.frames.find(f=>f.layer==='stroke'&&f.strokeIds?.includes(s.id))?.imageReference?.sketchPlane||evidence.desktopView?.plane||evidence.defaultPlane;
 const chosen=a.planeId?plane(a.planeId):sourcePlane(sources[0]);
 if(!chosen)throw Error('Unknown authoring plane; project_sketch can measure another plane first');
 const frame=sketchFrame(chosen),world=uv=>frame.origin.map((v,k)=>v+frame.xAxis[k]*uv[0]+frame.yAxis[k]*uv[1]);
 if(!a.planeId&&sources.some(s=>JSON.stringify(sketchFrame(sourcePlane(s)))!==JSON.stringify(frame)))throw Error('Different source planes require an explicit authoring plane');
 const edits=[];
 if(typeof a.intent!=='string'||!a.intent.trim()||a.intent.length>500||!Array.isArray(a.entities)||!a.entities.length||a.entities.length>16)throw Error('Describe the intended figure and supply 1–16 entities');
 for(const entity of a.entities){
  let {kind,name,coordinates:c,closed,figureId,expectedVersion}=entity;
  if(kind==='spline'){if(!Array.isArray(c)||!c.length||c.some(s=>!Array.isArray(s)||s.length!==8||!s.every(Number.isFinite)))throw Error('Spline requires nested cubic arrays, each with 8 finite UV numbers');c=c.flat();}
  if(!Array.isArray(c)||c.some(v=>!Number.isFinite(v))||c.length>512)throw Error('Coordinates must be finite plane-metre numbers');
  const sizes={line:4,circle:3,arc:5,arc3:6,rectangle:4};
  if(kind in sizes&&c.length!==sizes[kind]||kind==='spline'&&(!c.length||c.length%8)||kind==='polyline'&&(c.length<4||c.length%2)||!['line','polyline','circle','arc','rectangle','spline','arc3'].includes(kind))throw Error('Invalid '+kind+' coordinate count');
  if(kind==='arc3'){
   const [ax,ay,bx,by,cx,cy]=c,b=[bx-ax,by-ay],d=[cx-ax,cy-ay],cross=b[0]*d[1]-b[1]*d[0];
   if(Math.abs(cross)<1e-10*Math.max(1e-12,Math.hypot(...b)*Math.hypot(...d)))throw Error('Three arc anchors must not be collinear');
   const bb=b[0]**2+b[1]**2,dd=d[0]**2+d[1]**2,ox=(bb*d[1]-dd*b[1])/(2*cross),oy=(b[0]*dd-d[0]*bb)/(2*cross),center=[ax+ox,ay+oy];
   const angle=(x,y)=>(Math.atan2(y-center[1],x-center[0])*180/Math.PI+360)%360;
   let start=angle(ax,ay),end=angle(cx,cy);if((angle(bx,by)-start+360)%360>(end-start+360)%360)[start,end]=[end,start];
   c=[...center,Math.hypot(ox,oy),start,end];kind='arc';
  }
  const make=(type,coords,label=name)=>({planeId:frame.id,construction:false,operation:figureId===null?'create':'update',figureId,expectedVersion,kind:type,name:label,origin:['line','circle','arc','rectangle'].includes(type)?world(coords.slice(0,2)):frame.origin,xAxis:frame.xAxis,yAxis:frame.yAxis,radiusMetres:['circle','arc'].includes(type)?coords[2]:null,startAngleDeg:type==='arc'?coords[3]:null,endAngleDeg:type==='arc'?coords[4]:null,widthMetres:type==='rectangle'?coords[2]:null,heightMetres:type==='rectangle'?coords[3]:null,end:type==='line'?world(coords.slice(2)):null,segments:type==='spline'?Array.from({length:coords.length/8},(_,i)=>coords.slice(i*8,i*8+8)):null,closed:['circle','rectangle'].includes(type)||type==='spline'&&closed,extrusionMetres:null,strokeIds:a.strokeIds,dimensionNote:a.intent});
  if(kind==='polyline'){
   if(figureId!==null||expectedVersion!==null)throw Error('A polyline creates multiple line figures; update individual edges by ID instead');
   const points=Array.from({length:c.length/2},(_,i)=>c.slice(i*2,i*2+2));
   if(closed&&points[0].some((v,k)=>v!==points.at(-1)[k]))points.push(points[0]);
   for(let i=1;i<points.length;i++)edits.push(make('line',[...points[i-1],...points[i]],name+' '+i));
  }else edits.push(make(kind,c));
 }
 const edit={summary:a.intent,assumptions:[],question:null,questionOptions:[],edits,modelEdits:[],solidEdits:[],requestedSketchIds:[],requestedStrokeArchiveIds:[],voiceControl:null,automation:run.automation||null,continuation:run.automation?{reason:'Continue the active modeling goal',nextMove:'Inspect the composed sketch and finish the active task.'}:null};
 if(edits.length>64)throw Error('Composition has '+edits.length+' figures (each polyline edge counts); maximum 64. Simplify straight runs to intended corners, and replace chord chains around rounded features with arc/circle or genuine curve entities. No geometry applied.');
 validateDesktopEdit(edit,evidence);
 return {edit,result:{name:'compose_sketch',intent:a.intent,applied:true,geometryChanged:true,figureCount:edits.length,sourceStrokeIds:a.strokeIds}};
}
