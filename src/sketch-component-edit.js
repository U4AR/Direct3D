import {smoothCubicJoins} from './sketch-regularization.js';
import {constrainKnots,knotsToSegments} from './decision-sketch/constraints.js';
import {sampleDraftSegment} from './desktop-measured-draft.js';
import {verifyDecisionFigure} from './decision-sketch/harness.js';
const mod=(i,n)=>(i%n+n)%n,dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),sub=(a,b)=>a.map((v,k)=>v-b[k]);
export const figureUV=(p,f)=>[f.xAxis||[1,0,0],f.yAxis||[0,1,0]].map(a=>dot(sub(p,f.origin),a));
export const figureWorld=(p,f)=>f.origin.map((v,k)=>v+p[0]*(f.xAxis||[1,0,0])[k]+p[1]*(f.yAxis||[0,1,0])[k]);
export function componentVertices(f){if(f.kind==='spline'){const p=f.segments.map(s=>s.slice(0,2));if(!f.closed)p.push(f.segments.at(-1).slice(6));return p;}if(f.kind==='rectangle'){const x=f.widthMetres/2,y=f.heightMetres/2;return [[-x,-y],[x,-y],[x,y],[-x,y]];}if(f.kind==='line')return [[0,0],figureUV(f.end,f)];return [];}
export function componentEdges(f){const p=componentVertices(f);if(f.kind==='spline')return f.segments.map(s=>sampleDraftSegment({kind:'spline',coordinates:s},20));if(p.length)return Array.from({length:f.kind==='line'?1:p.length},(_,i)=>[p[i],p[(i+1)%p.length]]);if(f.kind==='arc')return [Array.from({length:65},(_,i)=>{const a=(f.startAngleDeg+(((f.endAngleDeg-f.startAngleDeg)%360+360)%360)*i/64)*Math.PI/180;return [f.radiusMetres*Math.cos(a),f.radiusMetres*Math.sin(a)];})];if(f.kind==='circle')return [Array.from({length:97},(_,i)=>[f.radiusMetres*Math.cos(i*Math.PI/48),f.radiusMetres*Math.sin(i*Math.PI/48)])];return [];}
export function defaultSketchRules(f){return {closed:!!f.closed,symmetry:'none',lines:false,lineEdges:f.kind==='spline'?f.segments.flatMap((s,i)=>{const dx=s[6]-s[0],dy=s[7]-s[1],straight=[2,4].every(k=>Math.abs((s[k]-s[0])*dy-(s[k+1]-s[1])*dx)<1e-10);return straight?[i]:[];}):[],aligned:true};}
// Mirror-selected endpoints are projected to feasible targets together, so an
// edge crossing the mirror axis moves in its allowed direction under the mouse.
function symmetricTargets(anchors,c,n){const map=new Map(anchors.map(a=>[a.index,a.point.slice()]));for(const [offset,sign]of c.symmetry==='both'?[[c.mirrorOffset,[1,-1]],[c.mirrorOffset+n/2,[-1,1]]]:c.symmetry==='one'?[[c.mirrorOffset,c.mirrorAxis==='vertical'?[-1,1]:[1,-1]]]:[]){for(const [i,a]of map){const j=c.closed?mod(offset-i,n):n-1-i,b=map.get(j);if(!b)continue;for(const k of [0,1]){const x=(a[k]+b[k]*sign[k])/2;a[k]=x;b[k]=x*sign[k];}}}if(c.reflectionAxes===4){if(n%4)throw Error('Four-axis symmetry needs quarter-matched knots');for(const [i,p]of [...map])for(let j=1;j<4;j++){const a=j*Math.PI/2;map.set(mod(i+j*n/4,n),[p[0]*Math.cos(a)-p[1]*Math.sin(a),p[0]*Math.sin(a)+p[1]*Math.cos(a)]);}}return [...map].map(([index,point])=>({index,point}));}
export function editSketchComponent(f,metadata,selection,targetUV,{detach=false,rules,connectionTargets}={}){
 const next=structuredClone(f),constraints={...structuredClone(metadata?.constraints||defaultSketchRules(f)),...rules};let vertices=componentVertices(f);
 if(targetUV&&(!Array.isArray(targetUV)||targetUV.length!==2||!targetUV.every(Number.isFinite)))throw Error('Use a finite sketch point');
 if(rules?.symmetry){delete constraints.mirrorAxis;delete constraints.mirrorOffset;delete constraints.reflectionAxes;delete constraints.rotationalOrder;}if(detach)constraints.connections=[];
 if(connectionTargets)constraints.connections=structuredClone(connectionTargets);
 if(selection?.kind==='figure'){
  if(constraints.connections?.length&&!detach)throw Error('This figure is connected. Alt-drag its center to detach');const delta=sub(targetUV,selection.startUV);next.origin=figureWorld(delta,f);if(f.end)next.end=f.end.map((v,k)=>v+next.origin[k]-f.origin[k]);
 }else if(f.kind==='spline'&&!constraints.analytic){
  if(rules?.symmetry==='both'&&f.closed&&vertices.length%2){vertices=f.segments.flatMap(s=>[s.slice(0,2),[0,1].map(k=>(s[k]+3*s[k+2]+3*s[k+4]+s[k+6])/8)]);constraints.lineEdges=(constraints.lineEdges||[]).flatMap(i=>[i*2,i*2+1]);if(Number.isInteger(constraints.mirrorOffset))constraints.mirrorOffset*=2;for(const c of constraints.connections||[])c.sourceKnotIndex*=2;}
  let anchors=[];
  if(selection?.kind==='vertex'){if(!vertices[selection.index])throw Error('Unknown vertex');anchors=[{index:selection.index,point:targetUV}];}
  if(selection?.kind==='edge'){const i=selection.index,j=(i+1)%vertices.length;if(!vertices[i]||!vertices[j])throw Error('Unknown edge');const delta=sub(targetUV,selection.startUV);anchors=[{index:i,point:vertices[i].map((v,k)=>v+delta[k])},{index:j,point:vertices[j].map((v,k)=>v+delta[k])}];}
  anchors=symmetricTargets(anchors,constraints,vertices.length);
  const linearAnchors=[];for(const c of connectionTargets||constraints.connections||[]){const point=figureUV(c.targetPoint,f);if(c.feature==='same_u'||c.feature==='same_v'){const axis=c.directionWorld||f.xAxis,normal=[dot(axis,f.xAxis),dot(axis,f.yAxis)];linearAnchors.push({index:c.sourceKnotIndex,normal,value:dot(point,normal)});}else anchors.push({index:c.sourceKnotIndex,point});}
  const result=constrainKnots(vertices,{...constraints,align:constraints.aligned,anchors,linearAnchors});Object.assign(constraints,{symmetry:result.symmetry,mirrorOffset:result.mirrorOffset});next.segments=knotsToSegments(result.knots,{...constraints}).map(s=>s.coordinates);delete constraints.circularArcs;delete constraints.curveStyle;delete constraints.regularization;
 }else if(f.kind==='rectangle'){
  const mirrors=[constraints.symmetry==='both',['one','both'].includes(constraints.symmetry)],sizes=[f.widthMetres,f.heightMetres],offset=[0,0];
  if(selection?.kind==='vertex'){const opposite=vertices[(selection.index+2)%4];for(const k of [0,1]){sizes[k]=mirrors[k]?Math.abs(targetUV[k])*2:Math.abs(targetUV[k]-opposite[k]);offset[k]=mirrors[k]?0:(targetUV[k]+opposite[k])/2;}}
  else if(selection?.kind==='edge'){const d=sub(targetUV,selection.startUV),i=selection.index,k=i%2?0:1,sign=i===1||i===2?1:-1;sizes[k]+=sign*d[k]*(mirrors[k]?2:1);offset[k]=mirrors[k]?0:d[k]/2;}
  next.widthMetres=sizes[0];next.heightMetres=sizes[1];next.origin=figureWorld(offset,f);
 }else if(f.kind==='circle'||f.kind==='arc'){if(targetUV)next.radiusMetres=Math.hypot(...targetUV);}
 else if(f.kind==='line'){
  if(selection?.kind==='edge'){const d=sub(targetUV,selection.startUV);next.origin=figureWorld(d,f);next.end=f.end.map((v,k)=>v+next.origin[k]-f.origin[k]);}
  else if(selection?.index===0)next.origin=figureWorld(targetUV,f);else if(selection)next.end=figureWorld(targetUV,f);
  const targets=connectionTargets||constraints.connections||[];for(const c of targets){const key=c.sourceKnotIndex===0?'origin':'end';if(c.feature==='same_u'||c.feature==='same_v'){const axis=c.directionWorld||f.xAxis,delta=dot(sub(c.targetPoint,next[key]),axis);next[key]=next[key].map((v,k)=>v+axis[k]*delta);continue;}if(selection?.kind==='vertex'&&selection.index===c.sourceKnotIndex&&Math.hypot(...sub(next[key],c.targetPoint))>1e-7&&!detach)throw Error('Endpoint is connected. Move its reference or Alt-drag to detach.');next[key]=c.targetPoint.slice();}
 }else throw Error('Use dimensions to edit this analytic curve');
 if(next.kind==='rectangle'&&!(next.widthMetres>1e-6&&next.heightMetres>1e-6)||next.kind==='circle'&&!(next.radiusMetres>1e-6))throw Error('Keep a positive size');
 if(constraints.smooth&&next.kind==='spline')next.segments=smoothCubicJoins(next.segments,next.closed);
 if(metadata)verifyDecisionFigure(next,{...metadata,constraints});
 next.dimensionNote='Edited '+(selection?.kind||'constraints')+' · '+constraints.symmetry+' symmetry'+(constraints.aligned?' · alignment preserved':'');
 return {figure:next,constraints};
}

// Connections point from a newer stroke to an existing reference. Re-evaluate
// downstream endpoints when that reference moves; never silently break a link.
export function connectedSketchEdits(figures,metadata,root){
 const edits=new Map([[root.figure.id,root]]),queue=[root.figure.id];let passes=0;
 while(queue.length){const id=queue.shift();if(++passes>Math.max(4,figures.length**2))throw Error('Cyclic sketch connections need to be detached before this edit');const before=figures.find(f=>f.id===id),after=edits.get(id).figure;
  for(const child of figures){const m=metadata.find(s=>s.figureId===child.id);if(!m?.constraints.connections?.some(c=>c.referenceId===id))continue;
   const connections=structuredClone(edits.get(child.id)?.constraints.connections||m.constraints.connections);
   for(const c of connections.filter(c=>c.referenceId===id)){
    const oldPaths=c.feature==='vertex'?[componentVertices(before)]:componentEdges(before),newPaths=c.feature==='vertex'?[componentVertices(after)]:componentEdges(after);let nearest=null;
    for(let e=0;e<oldPaths.length;e++){const path=oldPaths[e].map(p=>figureWorld(p,before));if(c.feature==='vertex'||c.feature==='same_u'||c.feature==='same_v'){for(let i=0;i<path.length;i++){const d=Math.hypot(...sub(path[i],c.referencePoint||c.targetPoint));if(!nearest||d<nearest.d)nearest={d,e,i,t:0};}}else for(let i=0;i<path.length-1;i++){const a=path[i],v=sub(path[i+1],a),t=Math.max(0,Math.min(1,dot(sub(c.targetPoint,a),v)/(dot(v,v)||1))),p=a.map((v,k)=>v+t*(path[i+1][k]-v)),d=Math.hypot(...sub(p,c.targetPoint));if(!nearest||d<nearest.d)nearest={d,e,i,t};}}
    if(!nearest||!newPaths[nearest.e]?.[nearest.i])throw Error('Connected reference topology changed');const {e,i,t}=nearest,a=figureWorld(newPaths[e][i],after),b=figureWorld(newPaths[e][Math.min(i+1,newPaths[e].length-1)],after),point=a.map((v,k)=>v+t*(b[k]-v));
    if(c.feature==='same_u'||c.feature==='same_v'){const axis=c.directionWorld||child.xAxis,delta=dot(sub(point,c.referencePoint||c.targetPoint),axis);c.targetPoint=c.targetPoint.map((v,k)=>v+axis[k]*delta);c.referencePoint=point;}else c.targetPoint=point;
   }
   const next=editSketchComponent(edits.get(child.id)?.figure||child,{...m,constraints:edits.get(child.id)?.constraints||m.constraints},null,null,{connectionTargets:connections});edits.set(child.id,next);if(!queue.includes(child.id))queue.push(child.id);
  }
 }
 return [...edits.values()];
}
