import {constrainKnots,knotsToSegments} from './constraints.js';
const vec=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite),mod=(i,n)=>(i%n+n)%n;
export function verifyDecisionFigure(figure,metadata){
 const c=metadata.constraints;if(!!figure.closed!==!!c.closed)throw Error('Closed/open topology is locked by the decision-sketch harness');
 if(metadata.kind!=='profile'&&figure.kind!==(metadata.kind==='ellipse'?'spline':metadata.kind))throw Error('The analytic representation is locked; use the constraint-aware editing tool');
 if(figure.kind!=='spline')return true;const segments=figure.segments,n=segments?.length;if(!n||segments.some(s=>s.length!==8))throw Error('Invalid constrained cubic profile');
 const scale=Math.max(1e-9,...segments.flat().map(Math.abs)),epsilon=Math.max(1e-9,scale*1e-7);
 const equal=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<epsilon;
 for(let i=1;i<n;i++)if(!equal(segments[i-1].slice(6),segments[i].slice(0,2)))throw Error('Shared profile endpoints must remain connected');
 for(const [index,s] of segments.entries()){if(!c.lines&&!c.lineEdges?.includes(index))continue;const a=s.slice(0,2),b=s.slice(6),dx=b[0]-a[0],dy=b[1]-a[1];for(const p of [s.slice(2,4),s.slice(4,6)])if(Math.abs((p[0]-a[0])*dy-(p[1]-a[1])*dx)>epsilon*Math.max(epsilon,Math.hypot(dx,dy)))throw Error('Locked line segments must remain straight');}
 if(c.closed&&!equal(segments.at(-1).slice(6),segments[0].slice(0,2)))throw Error('The constrained profile must remain closed');
 if(c.analytic&&metadata.kind==='ellipse'){
  if(n!==4)throw Error('An analytic ellipse keeps four canonical cubic arcs');const a=segments[0][0],b=segments[0][7],k=4*(Math.sqrt(2)-1)/3,expected=[[a,0,a,k*b,k*a,b,0,b],[0,b,-k*a,b,-a,k*b,-a,0],[-a,0,-a,-k*b,-k*a,-b,0,-b],[0,-b,k*a,-b,a,-k*b,a,0]];
  if(!(a>0&&b>0)||segments.some((s,i)=>s.some((v,j)=>Math.abs(v-expected[i][j])>epsilon)))throw Error('Ellipse parameters must retain the canonical ellipse construction');return true;
 }
 for(const [offset,sign]of c.symmetry==='both'?[[c.mirrorOffset,[1,-1]],[c.mirrorOffset+n/2,[-1,1]]]:c.symmetry==='one'?[[c.mirrorOffset,c.mirrorAxis==='vertical'?[-1,1]:[1,-1]]]:[]){for(let i=0;i<n;i++)for(let j=0;j<4;j++){const other=segments[mod(offset-i-1,n)],a=segments[i].slice(j*2,j*2+2),b=other.slice((3-j)*2,(4-j)*2).map((v,k)=>v*sign[k]);if(!equal(a,b))throw Error('The profile must preserve its locked reflection symmetry');}}
 if(c.reflectionAxes===4){if(n%4)throw Error('Four-axis symmetry requires quarter-matched curve sections');for(let i=0;i<n;i++)for(let j=0;j<4;j++){const p=segments[i].slice(j*2,j*2+2),q=segments[(i+n/4)%n].slice(j*2,j*2+2);if(!equal([-p[1],p[0]],q))throw Error('Four-axis symmetry must preserve quarter-turn matching');}}
 if(c.smooth){for(let i=c.closed?0:1;i<n;i++){const a=segments[(i+n-1)%n],b=segments[i],u=[a[6]-a[4],a[7]-a[5]],v=[b[2]-b[0],b[3]-b[1]],length=Math.hypot(...u)*Math.hypot(...v);if(length<epsilon**2||u[0]*v[0]+u[1]*v[1]<=0||Math.abs(u[0]*v[1]-u[1]*v[0])>Math.max(epsilon**2,length*1e-5))throw Error('The smoothed profile must keep tangent-continuous joins');}}
 return true;
}
export function decisionSketchCatalog(session,figures){return (session.decisionSketches||[]).map(s=>{const figure=figures.find(f=>f.id===s.figureId);if(!figure||figure.hidden)return null;let verified=true,error;try{verifyDecisionFigure(figure,s);}catch(e){verified=false;error=e.message;}return {id:s.id,figureId:figure.id,version:figure.version,kind:s.kind,interpretation:s.interpretation,constraints:s.constraints,frame:{origin:figure.origin,xAxis:figure.xAxis,yAxis:figure.yAxis,planeId:figure.planeId},knots:figure.kind==='spline'&&!s.constraints.analytic?figure.segments.map(s=>s.slice(0,2)):undefined,dimensions:figure.dimensionsMetres,verified,error,sourceStrokeIds:s.sourceStrokeIds};}).filter(Boolean);}
export function updateDecisionSketch(args,evidence){
 const s=evidence.decisionSketches?.find(s=>s.id===args.sketchId),f=evidence.figures.find(f=>f.id===s?.figureId);if(!s||!f||f.version!==args.expectedVersion)throw Error('Unknown/stale constrained sketch; use the current figure version');verifyDecisionFigure(f,s);
 const edit={planeId:f.planeId??null,construction:!!f.construction,operation:'update',figureId:f.id,expectedVersion:f.version,kind:f.kind,name:f.name,origin:[...f.origin],xAxis:[...f.xAxis],yAxis:[...f.yAxis],radiusMetres:f.radiusMetres??null,startAngleDeg:f.startAngleDeg??null,endAngleDeg:f.endAngleDeg??null,widthMetres:f.widthMetres??null,heightMetres:f.heightMetres??null,end:f.end?[...f.end]:null,segments:f.segments?structuredClone(f.segments):null,closed:f.closed,extrusionMetres:null,strokeIds:f.strokeIds||[],dimensionNote:'Constraint-preserving '+args.operation};
 if(args.operation==='transform'){
  const t=args.translationUV||[0,0],scale=args.scaleUV||[1,1],angle=(args.rotationDegrees||0)*Math.PI/180;if(!vec(t)||!vec(scale)||scale.some(v=>v<=0||v>100)||!Number.isFinite(angle))throw Error('Use finite translation, positive scale and angle');if(['circle','arc'].includes(f.kind)&&Math.abs(scale[0]-scale[1])>1e-9)throw Error('A circular element requires uniform scaling; use equal scale values');
  edit.origin=f.origin.map((v,k)=>v+t[0]*f.xAxis[k]+t[1]*f.yAxis[k]);edit.xAxis=f.xAxis.map((v,k)=>v*Math.cos(angle)+f.yAxis[k]*Math.sin(angle));edit.yAxis=f.yAxis.map((v,k)=>v*Math.cos(angle)-f.xAxis[k]*Math.sin(angle));
  if(edit.radiusMetres!==null)edit.radiusMetres*=scale[0];if(edit.widthMetres!==null)edit.widthMetres*=scale[0];if(edit.heightMetres!==null)edit.heightMetres*=scale[1];
  if(edit.segments)edit.segments=edit.segments.map(s=>s.map((v,k)=>v*scale[k%2]));if(edit.end){const length=Math.hypot(...f.end.map((v,k)=>v-f.origin[k]));edit.end=edit.origin.map((v,k)=>v+edit.xAxis[k]*length*scale[0]);}
 }else if(args.operation==='move_knot'){
  if(f.kind!=='spline'||s.constraints.analytic||!vec(args.pointUV))throw Error('Move a knot only on a nonanalytic line/curve profile');const knots=f.segments.map(s=>s.slice(0,2));if(!s.constraints.closed)knots.push(f.segments.at(-1).slice(6));
  const result=constrainKnots(knots,{...s.constraints,align:s.constraints.aligned,anchors:[{index:args.knotIndex,point:args.pointUV}]});edit.segments=knotsToSegments(result.knots,{closed:s.constraints.closed,lines:s.constraints.lines,lineEdges:s.constraints.lineEdges}).map(s=>s.coordinates);
 }else throw Error('Unknown constrained sketch operation');
 verifyDecisionFigure(edit,s);return edit;
}
export function validateDecisionSketchEdits(edit,evidence){
 const changes=edit.sketchConstraintEdits||[];if(!Array.isArray(changes)||changes.length>16)throw Error('Invalid sketch constraint updates');const seen=new Set();
 for(const change of changes){const s=evidence.decisionSketches?.find(s=>s.figureId===change.figureId),f=evidence.figures.find(f=>f.id===change.figureId),e=edit.edits?.find(e=>e.operation==='update'&&e.figureId===change.figureId);if(!s||!f||!e||seen.has(f.id)||change.expectedVersion!==f.version||e.expectedVersion!==f.version||!change.constraints||typeof change.constraints!=='object'||!['circle','rectangle','line','arc','ellipse','profile'].includes(change.kind))throw Error('Constraint changes must accompany one current sketch geometry update');seen.add(f.id);verifyDecisionFigure(e,change);}
 for(const e of edit.edits||[]){const s=changes.find(s=>s.figureId===e.figureId)||evidence.decisionSketches?.find(s=>s.figureId===e.figureId);if(e.operation==='update'&&s)verifyDecisionFigure(e,s);}
 return changes;
}
