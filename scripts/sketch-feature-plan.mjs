import polygonClipping from 'polygon-clipping';
import {Vector3} from 'three';
import {sketchFrame} from '../src/desktop-sketch-fit.js';
import {resample} from '../src/decision-sketch/math.js';

const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const relative=(a,b)=>a.map((x,i)=>x-b[i]);
const offset=(a,b,d)=>a.map((x,i)=>x+b[i]*d);
const bounds=values=>[Math.min(...values),Math.max(...values)];
const cubicLine=(a,b)=>[...a,...offset(a,relative(b,a),1/3),...offset(a,relative(b,a),2/3),...b];
const choice=(...values)=>({type:'string',enum:values});

export function featurePlanSchema(data){
 const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
 const list=(items,maxItems)=>({type:'array',items,minItems:1,maxItems});
 const text={type:'string'},number={type:['number','null']};
 return object({
  sketches:{...list(object({id:text,name:text,strokeIds:list(data.strokes.length?choice(...data.strokes.map(s=>s.id)):text,12),
   profile:choice('ellipse','circle','rectangle','outline','rib'),widthMetres:number}),8),minItems:0},
  features:list(object({id:text,name:text,sketch:{type:['string','null']},toolBody:{type:['string','null']},operation:choice('new-body','join','cut','intersect'),
   target:{type:['string','null']},extent:choice('through-all','opposed-pockets','visible-half','centered','forward','backward'),depthMetres:number}),12)
 });
}

function planeSection(model,f){
 if(!model?.positions||!model.indices)return [];
 const vertices=[],section=[];
 for(let i=0;i<model.positions.length;i+=3){
  const p=new Vector3().fromArray(model.positions,i);
  if(model.matrixWorld)p.applyMatrix4({elements:model.matrixWorld});
  const delta=relative(p.toArray(),f.origin);
  vertices.push([dot(delta,f.xAxis),dot(delta,f.yAxis),dot(delta,f.normal)]);
 }
 const ix=model.indices;
 for(let i=0;i<ix.length;i+=3){
  const crossings=[],tri=[vertices[ix[i]],vertices[ix[i+1]],vertices[ix[i+2]]];
  for(let j=0;j<3;j++){
   const a=tri[j],b=tri[(j+1)%3];
   if(Math.abs(a[2])<1e-8)crossings.push(a.slice(0,2));
   if(a[2]*b[2]<0)crossings.push(offset(a,relative(b,a),a[2]/(a[2]-b[2])).slice(0,2));
  }
  if(crossings.length>1)section.push([crossings[0],crossings.reduce((far,p)=>Math.hypot(...relative(p,crossings[0]))>Math.hypot(...relative(far,crossings[0]))?p:far)]);
 }
 return section;
}
function nearestPoint(p,segments){
 let nearest,dist=Infinity;
 for(const [a,b] of segments){
  const ab=relative(b,a),t=Math.max(0,Math.min(1,dot(relative(p,a),ab)/(dot(ab,ab)||1))),q=offset(a,ab,t);
  const d=Math.hypot(...relative(q,p));if(d<dist){dist=d;nearest=q;}
 }
 return nearest;
}
function profileGeometry(spec,uv,section,fit){
 const [xs,ys]=[0,1].map(k=>bounds(uv.map(p=>p[k]))),w=xs[1]-xs[0],h=ys[1]-ys[0],span=Math.max(w,h);
 if(span<.0001)throw Error('The guide has no measurable extent');
 const center=[xs[0]+w/2,ys[0]+h/2],p=resample(uv,13),K=.5522847498307936;
 const base={...fit,kind:'spline',closed:true,construction:false,widthMetres:null,heightMetres:null,radiusMetres:null,segments:null,end:null,startAngleDeg:null,endAngleDeg:null,extrusionMetres:null};
 if(spec.profile==='circle')return {...base,kind:'circle',radiusMetres:(w+h)/4,center};
 if(spec.profile==='rectangle')return {...base,kind:'rectangle',widthMetres:w,heightMetres:h,center};
 if(spec.profile==='ellipse')return {...base,center,segments:[[1,0,1,K,K,1,0,1],[0,1,-K,1,-1,K,-1,0],[-1,0,-1,-K,-K,-1,0,-1],[0,-1,K,-1,1,-K,1,0]].map(s=>s.map((v,i)=>v*(i%2?h:w)/2))};
 let boundary;
 if(spec.profile==='outline'){
  if(spec.strokeIds.length!==1)throw Error('Use one ordered boundary for an outline');
  if(Math.hypot(...relative(p[0],p.at(-1)))<span*.02)p.pop();
  // A hand-drawn boundary may cross itself at the join or double back.
  // Clip it into simple loops and discard only small pen overshoots.
  const regions=polygonClipping.union([p]);
  const area=ring=>Math.abs(ring.slice(1).reduce((sum,b,i)=>sum+ring[i][0]*b[1]-b[0]*ring[i][1],0))/2;
  const loops=regions.map(r=>({ring:r[0],area:area(r[0]),holes:r.slice(1)})).sort((a,b)=>b.area-a.area);
  const main=loops[0];
  if(!main||main.area<span*span*1e-6||main.holes.length||loops.slice(1).reduce((sum,l)=>sum+l.area,0)>main.area*.1)
   throw Error('This guide has multiple substantial loops or lacks a closed area. Use a rib for an open guide or choose separate profiles for its loops.');
  boundary=main.ring.slice(0,-1);
 }else if(spec.profile==='rib'){
  if(spec.strokeIds.length!==1)throw Error('A rib follows one ordered guide');
  const width=spec.widthMetres??span*.06;
  if(!(width>0&&width<=100))throw Error('Invalid rib width');
  const left=[],right=[];
  for(const [i,pt] of p.entries()){
   const d=relative(p[Math.min(i+1,p.length-1)],p[Math.max(0,i-1)]),l=Math.hypot(...d)||1;
   const n=[-d[1]/l,d[0]/l],wall=nearestPoint(pt,section),gap=wall?dot(relative(wall,pt),n):0;
   const reach=Math.max(width/2,Math.abs(gap)+Math.min(width/4,.001));
   // Keep the two rails in stroke order when the guide crosses the wall.
   left.push(offset(pt,n,gap>0?reach:width/2));
   right.push(offset(pt,n,gap<0?-reach:-width/2));
  }
  // Tight turns can still overlap. Unite the swept strips before extrusion
  // so a crossing or pen reversal cannot produce a bow-tie sketch.
  const strips=[];
  for(let i=1;i<p.length;i++){
   strips.push([[left[i-1],right[i-1],right[i]]],[[left[i-1],right[i],left[i]]]);
  }
  const region=polygonClipping.union(...strips);
  if(region.length!==1||region[0].length!==1)throw Error('The rib guide needs a single continuous outline without enclosed holes');
  boundary=region[0][0].slice(0,-1);
  if(boundary.length<3||boundary.length>64)throw Error('The rib outline has too many turns for one profile; split it into shorter guides');

 }else throw Error('Unknown sketch profile');
 const vertices=boundary.map(q=>relative(q,center));
 return {...base,center,segments:vertices.map((a,i)=>cubicLine(a,vertices[(i+1)%vertices.length]))};
}

function combinedBounds(a,b){
 return {min:a.min.map((v,k)=>Math.min(v,b.min[k])),max:a.max.map((v,k)=>Math.max(v,b.max[k]))};
}

export function compileFeaturePlan(plan,data,fit,authored=[],bases=[]){
 if(!Array.isArray(plan.sketches)||plan.sketches.length>8||!plan.features?.length||plan.features.length>12)throw Error('Use at most eight sketches and one to twelve features');
 const bodies=new Map((data.partContext?.bodies||[]).map(b=>[b.bodyId,b])),outputs=new Map(),used=new Set(),sketches=new Map(),cached=new Map(),additions=[...authored],planes=[],solidEdits=[];
 for(const [index,base] of bases.entries()){
  const id='feature-result:'+index;
  if(bodies.has(base.solid.name)||outputs.has(base.solid.name)||base.solid.name.startsWith('feature-result:'))throw Error('Use distinct base body names.');
  const output={index,bounds:base.bounds,meridians:base.meridians,revolveAxis:base.revolveAxis};
  outputs.set(id,output);outputs.set(base.solid.name,output);
  solidEdits.push(base.solid);
 }
 for(const spec of plan.sketches){if(!spec.id||sketches.has(spec.id))throw Error('Use unique sketch IDs');sketches.set(spec.id,spec);}
 for(const feature of plan.features){
  const {target,operation,extent}=feature,spec=sketches.get(feature.sketch),prior=outputs.get(target),body=prior?.body??bodies.get(target);
  if(!feature.id||feature.id.startsWith('feature-result:')||outputs.has(feature.id)||bodies.has(feature.id))throw Error('Invalid feature ID');
  if(operation==='new-body'?target!=null:(!prior&&!body||used.has(prior||target)))throw Error('Target a current body or the result of an earlier feature');
  const kind={'new-body':'extrude',join:'join-material',cut:'pocket',intersect:'common-material'}[operation];
  if(!kind)throw Error('Unknown body operation');
  const reference=id=>outputs.has(id)?'feature-result:'+outputs.get(id).index:id;
  if(feature.toolBody!=null){
   const tool=outputs.get(feature.toolBody)||bodies.get(feature.toolBody);
   if(feature.sketch!=null||!tool||operation==='new-body'||feature.toolBody===target||prior===tool||used.has(outputs.get(feature.toolBody)||feature.toolBody))throw Error('Choose two distinct current bodies for the boolean');
   solidEdits.push({kind,name:feature.name,loftMode:'ruled',targetBodyId:reference(target),toolBodyId:reference(feature.toolBody),profiles:[]});
   const box=prior?.bounds||body?.boundsWorld,toolBox=tool.bounds||tool.boundsWorld;
   outputs.set(feature.id,{index:solidEdits.length-1,body,meridians:prior?.meridians,revolveAxis:prior?.revolveAxis,bounds:operation==='join'?combinedBounds(box,toolBox):box});
   used.add(prior||target);used.add(outputs.get(feature.toolBody)||feature.toolBody);continue;
  }
  const authoredId=/^added:(0|[1-9]\d*)$/.exec(feature.sketch);
  // Existing outlines are native profiles. Resampling their synthetic guide
  // would discard the original spline and introduce an extra disposable sketch.
  const nativeId=spec?.profile==='outline'&&spec.strokeIds.length===1&&spec.strokeIds[0].startsWith('existing:')?spec.strokeIds[0].slice(9):feature.sketch;
  const native=(data.availableFigures||data.sketchFigures||[]).find(f=>f.id===nativeId);
  const source=authoredId?authored[Number(authoredId[1])]:native;
  let geometry,origin,f,strokeIds,view,span,name;
  if(spec&&!native){
   const strokes=spec.strokeIds.map(id=>data.strokes.find(s=>s.id===id));
   if(!strokes.length||strokes.some(s=>!s?.points?.length))throw Error('Missing sketch guide');
   f=sketchFrame(strokes[0].plane||data.plane);
   const points=strokes.flatMap(s=>s.points);
   const uv=points.map(p=>[f.xAxis,f.yAxis].map(a=>dot(relative(p,f.origin),a)));
   if(points.some(p=>Math.abs(dot(relative(p,f.origin),f.normal))>.0001))throw Error('A feature sketch must use coplanar guides');
   const mesh=data.surfaceScene?.models?.find(m=>m.nativeId===body?.bodyId);
   const meridian=(prior?.meridians||[]).flatMap(path=>{
    if(!path.every(p=>Math.abs(dot(relative(p,f.origin),f.normal))<1e-6))return [];
    const points=path.map(p=>[f.xAxis,f.yAxis].map(axis=>dot(relative(p,f.origin),axis)));
    return points.slice(1).map((p,i)=>[points[i],p]);
   });
   const section=meridian.length?meridian:(spec.profile==='rib'?planeSection(mesh,f):[]);
   const profile=profileGeometry(spec,uv,section,fit.edits[0]);
   const {center,...edit}=profile;geometry=edit;
   origin=offset(offset(f.origin,f.xAxis,center[0]),f.yAxis,center[1]);
   span=Math.max(...[0,1].map(k=>{const [a,b]=bounds(uv.map(p=>p[k]));return b-a}));
   if(operation==='cut'&&spec.profile==='outline'&&meridian.length&&extent==='visible-half'){
    // A notch marker drawn just outside a revolved rim can graze the surface
    // without penetrating it. Keep remote guides and centered holes in place.
    const contact=nearestPoint(center,meridian),gap=Math.hypot(...relative(contact,center));
    const axis=prior.revolveAxis;
    const radialAt=p=>{const d=relative(p,axis.origin);return Math.hypot(...offset(d,axis.direction,-dot(d,axis.direction)));};
    const contactWorld=offset(offset(f.origin,f.xAxis,contact[0]),f.yAxis,contact[1]);
    if(radialAt(origin)>radialAt(contactWorld)+span*.02&&gap<span*.8){
     origin=offset(offset(f.origin,f.xAxis,contact[0]),f.yAxis,contact[1]);
    }
   }
   strokeIds=spec.strokeIds;view=strokes[0].view;name=spec.name;
  }else{
   if(!source||source.construction||!['circle','rectangle','spline'].includes(source.kind)||source.kind==='spline'&&!source.closed)throw Error('Select a closed guide, authored sketch or existing sketch ID');
   f=sketchFrame(source);origin=[...source.origin];geometry=source;name=source.name;
   span=source.widthMetres||source.radiusMetres*2||Math.max(...(source.segments||[]).flat().map(Math.abs))||.02;
   strokeIds=source.strokeIds||[];
  }
  let front=0,back=0,oppositeShift;
  const depth=feature.depthMetres??Math.max(.001,span*.08);
  if(!(depth>0&&depth<=100))throw Error('Invalid feature depth');
  const worldBounds=prior?.bounds||body?.boundsWorld;
  if(['through-all','visible-half','opposed-pockets'].includes(extent)){
   if(!worldBounds)throw Error('This extent requires a target body');
   const {min,max}=worldBounds,coords=[];
   for(const x of [min[0],max[0]])for(const y of [min[1],max[1]])for(const z of [min[2],max[2]])coords.push(dot(relative([x,y,z],origin),f.normal));
   const [lo,hi]=bounds(coords),margin=Math.max(.0001,(hi-lo)*.01),side=dot((view||data.view)?.cameraToWorld?.slice(8,11)||f.normal,f.normal)>=0?1:-1;
   if(extent==='opposed-pockets'){
    if(operation!=='cut')throw Error('Opposed pockets require a cut');
    const penetration=feature.depthMetres??(hi-lo)*.4;
    if(penetration>=(hi-lo)/2)throw Error('Opposed pockets must leave a central web; use through-all for a passage');
    origin=offset(origin,f.normal,lo-margin);
    front=penetration+margin;oppositeShift=hi-lo-penetration+margin;
   }else{
    origin=offset(origin,f.normal,extent==='through-all'?lo-margin:(lo+hi)/2);
   if(extent==='through-all')front=hi-lo+2*margin;else if(side>0)front=(hi-lo)/2+margin;else back=(hi-lo)/2+margin;
   }
  }else if(extent==='centered')front=back=depth/2;
  else if(extent==='forward')front=depth;
  else if(extent==='backward')back=depth;
  else throw Error('Unknown extrusion extent');
  let figureId,expectedVersion=1;
  if(source&&origin.every((v,k)=>Math.abs(v-source.origin[k])<1e-9)){
   figureId=authoredId?'fit:added-'+authoredId[1]:native.id;
   expectedVersion=authoredId?1:native.version;
  }else{
   const key=JSON.stringify([feature.sketch,origin,spec?.profile==='rib'?body?.bodyId:null]);
   figureId=cached.get(key);
   if(!figureId){
    const plane={...f,id:'feature-'+crypto.randomUUID(),origin,name};
    planes.push(plane);
    // New profiles carry only drawing-edit fields, even when copied from a native sketch.
    const edit=Object.fromEntries(Object.keys(fit.edits[0]).map(k=>[k,geometry[k]??null]));
    additions.push({...edit,name,operation:'create',figureId:null,expectedVersion:null,origin,xAxis:f.xAxis,yAxis:f.yAxis,planeId:plane.id,strokeIds:strokeIds.filter(id=>data.strokes.some(s=>s.id===id))});
    figureId='fit:added-'+(additions.length-1);cached.set(key,figureId);
   }
  }
  solidEdits.push({kind,name:feature.name,loftMode:'ruled',...(target==null?{}:{targetBodyId:reference(target)}),profiles:[{figureId,expectedVersion,depthMetres:front,backDepthMetres:back||null}]});
  if(oppositeShift!==undefined){
   const secondOrigin=offset(origin,f.normal,oppositeShift);
   const plane={...f,id:'feature-'+crypto.randomUUID(),origin:secondOrigin,name:name+' opposite'};
   planes.push(plane);
   const first=additions[Number(figureId.slice(10))]||geometry;
   const secondEdit=Object.fromEntries(Object.keys(fit.edits[0]).map(k=>[k,first[k]??null]));
   additions.push({...secondEdit,operation:'create',figureId:null,expectedVersion:null,origin:secondOrigin,xAxis:f.xAxis,yAxis:f.yAxis,planeId:plane.id,name:plane.name,strokeIds:strokeIds.filter(id=>data.strokes.some(s=>s.id===id))});
   solidEdits.push({kind,name:feature.name+' opposite',loftMode:'ruled',targetBodyId:'feature-result:'+(solidEdits.length-1),profiles:[{figureId:'fit:added-'+(additions.length-1),expectedVersion:1,depthMetres:front,backDepthMetres:null}]});
  }
  const outline=geometry.segments?.flatMap(s=>[s.slice(0,2),s.slice(2,4),s.slice(4,6),s.slice(6,8)])??[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y])=>[x*(geometry.radiusMetres||geometry.widthMetres/2),y*(geometry.radiusMetres||geometry.heightMetres/2)]);
  const corners=outline.flatMap(([x,y])=>[-back,front].map(z=>offset(offset(offset(origin,f.xAxis,x),f.yAxis,y),f.normal,z)));
  const limits=[0,1,2].map(k=>bounds(corners.map(p=>p[k]))),toolBox={min:limits.map(b=>b[0]),max:limits.map(b=>b[1])};
  let box=worldBounds||toolBox;
  if(operation==='join')box=combinedBounds(box,toolBox);
  outputs.set(feature.id,{index:solidEdits.length-1,body,meridians:prior?.meridians,revolveAxis:prior?.revolveAxis,bounds:box});if(target!=null)used.add(prior||target);
 }
 if(solidEdits.length>12||additions.length>16)throw Error('This plan exceeds the size of one editable preview');
 return {planes,additions,solidEdits};
}
