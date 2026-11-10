import {fitCurve} from '../scripts/constrained-curve.mjs';
import {analyzePCA} from './primitive-fitting.js';
import {resampleStroke} from './stroke-fitting.js';
import {add,sub,mul,dot,cross,len,unit,dist,mean,quantile,segmentDistance,clamp,robustRms} from './drawing-math.js';
export const REGULARIZATION_VERSION=1;
export function scoredRawPoints(input,tolerance=.01){const typical=quantile(input.slice(1).map((p,i)=>dist(p,input[i])),.5);return input.map((p,i)=>{const a=input[Math.max(0,i-1)],b=input[Math.min(input.length-1,i+1)],spike=i>0&&i<input.length-1&&Math.min(dist(p,a),dist(p,b))>Math.max(tolerance*2,typical*6)&&segmentDistance(p,a,b)>tolerance*1.5&&dist(a,b)<Math.min(dist(p,a),dist(p,b));return {index:i,reliability:spike?.12:1,trackingOutlier:spike};});}
export function cleanTrackingSpikes(input,tolerance=.01){const scores=scoredRawPoints(input,tolerance);return input.map((p,i)=>scores[i].trackingOutlier?mean([input[i-1],input[i+1]]):[...p]);}
const XYZ=[[1,0,0],[0,1,0],[0,0,1]];
function directions(axes){const all=axes.map(a=>unit(a));for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)for(const sign of [-1,1])all.push(unit(add(axes[i],mul(axes[j],sign))));return all;}
function lineFit(points){const pca=analyzePCA(points),d=pca.axes[0],ts=points.map(p=>dot(sub(p,pca.centroid),d));return {a:add(pca.centroid,mul(d,Math.min(...ts))),b:add(pca.centroid,mul(d,Math.max(...ts))),d,center:pca.centroid};}
function simplify(p,tol,start=0,end=p.length-1,out=[0]){let best=tol,index=-1;for(let i=start+1;i<end;i++){const d=segmentDistance(p[i],p[start],p[end]);if(d>best){best=d;index=i;}}if(index>=0){simplify(p,tol,start,index,out);simplify(p,tol,index,end,out);}else out.push(end);return out;}
export function regularizeStroke(input,{toleranceMetres,referenceAxes=XYZ,localFit}={}){
 if(!Array.isArray(input)||input.length<2||input.length>20000||input.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw Error('Regularization needs 2–20000 finite XYZ points');
 const points=resampleStroke(cleanTrackingSpikes(input,toleranceMetres??.01),Math.min(192,Math.max(32,input.length)));if(points.length<2)return {version:REGULARIZATION_VERSION,status:'degenerate',rawPointCount:input.length,points,pointScores:[],rawPointScores:scoredRawPoints(input),segments:[],regularity:[],cornerPoints:[],referenceAxes,toleranceMetres:toleranceMetres??.001};const pca=analyzePCA(points),span=Math.hypot(...pca.extents.map(e=>e.size)),tol=toleranceMetres??Math.max(.0005,Math.min(.015,span*.035)),closed=dist(points[0],points.at(-1))<span*.12;
 if(!(tol>0&&tol<=.1))throw Error('Invalid regularization tolerance');
 // Arc-length samples prevent a slow hand or stationary dwell from winning by density.
 const rawPointScores=scoredRawPoints(input,tol);
 const pointScores=points.map((p,i)=>{const k=3,a=points[Math.max(0,i-k)],b=points[Math.min(points.length-1,i+k)],u=unit(sub(p,a)),v=unit(sub(b,p)),angle=i<k||i>=points.length-k?0:Math.acos(clamp(dot(u,v),-1,1));const noise=segmentDistance(p,points[Math.max(0,i-1)],points[Math.min(points.length-1,i+1)]),reliability=clamp(1/(1+(noise/(tol*1.5))**2),.1,1);return {index:i,reliability,turnDeg:angle*180/Math.PI,cornerScore:clamp((angle-.35)/.9,0,1),edgeWeight:4*reliability,surfaceWeight:reliability};});
 const clean=localFit?.selected,analytic=clean?.accepted&&['circle','rectangle','polygon'].includes(clean.kind);let breaks;
 if(analytic&&clean.kind==='circle')breaks=[0,points.length-1];else{
  const proposed=simplify(points,tol*.7),corners=proposed.filter(i=>i>2&&i<points.length-3&&pointScores[i].turnDeg>32);
  breaks=[0,...corners.filter((i,k)=>!k||i-corners[k-1]>3),points.length-1];
 }
 const segments=[],regularity=[];for(let k=1;k<breaks.length;k++){
  const first=breaks[k-1],last=breaks[k],part=points.slice(first,last+1);if(part.length<2)continue;
  const fit=lineFit(part),residual=part.map(p=>segmentDistance(p,fit.a,fit.b)),rms=robustRms(residual,part.map((_,j)=>pointScores[first+j].reliability),tol),straight=rms<tol*.65&&len(sub(fit.b,fit.a))>tol*2;
  if(straight){let best=fit.d,bestDot=0;for(const d of directions(referenceAxes)){const v=Math.abs(dot(d,fit.d));if(v>bestDot){bestDot=v;best=dot(d,fit.d)<0?mul(d,-1):d;}}
   let a=fit.a,b=fit.b,snapped=false;const angle=Math.acos(clamp(bestDot,0,1))*180/Math.PI,L=dist(a,b);if(angle<7&&L*Math.sin(angle*Math.PI/180)/2<tol*1.25){a=add(fit.center,mul(best,-L/2));b=add(fit.center,mul(best,L/2));snapped=true;regularity.push({type:'axis-or-45-degree',segment:segments.length,correctionDeg:angle});}
   // Preserve drawing direction rather than PCA's arbitrary eigenvector sign.
   if(dist(a,part[0])>dist(b,part[0]))[a,b]=[b,a];segments.push({kind:'line',sourceRange:[first,last],path:[a,b],rmsMetres:rms,confidence:clamp(1-rms/(tol*2),0,1),regularized:snapped});
  }else{let path=analytic&&clean.kind==='circle'?clean.path:resampleStroke(part,Math.min(32,part.length)),curve=null,error=clean?.errors?.rmsMetres??0;if(!analytic&&part.length>=4){const fitted=fitCurve(part,{degree:3,controlCount:Math.min(10,part.length),fairnessWeight:.0000001,robustThresholdMetres:tol,constraints:{anchors:[{t:0,point:part[0]},{t:1,point:part.at(-1)}]}});curve=fitted.curve;path=fitted.samples.map(p=>Array.isArray(p)?p:p.point);error=fitted.diagnostics.rmsMetres;}segments.push({kind:analytic&&clean.kind==='circle'?'circle':'spline',sourceRange:[first,last],path:resampleStroke(path,Math.min(48,path.length)),curve,rmsMetres:error,confidence:clamp(1-error/(tol*3),.1,.95),regularized:false});}
 }
 // Intersect consecutive snapped lines; keep sharp, connected corners without rounding them.
 const join=(a,b)=>{if(a?.kind!=='line'||b?.kind!=='line')return;const u=unit(sub(a.path[1],a.path[0])),v=unit(sub(b.path[1],b.path[0])),w=sub(a.path[0],b.path[0]),c=dot(u,v),den=1-c*c;if(den<.02)return;const t=(c*dot(v,w)-dot(u,w))/den,s=(dot(v,w)-c*dot(u,w))/den,p=add(a.path[0],mul(u,t)),q=add(b.path[0],mul(v,s)),mid=mean([p,q]);if(dist(p,q)<tol*2&&dist(mid,a.path[1])<tol*3&&dist(mid,b.path[0])<tol*3){a.path[1]=mid;b.path[0]=[...mid];regularity.push({type:Math.abs(c)<.1?'perpendicular':Math.abs(Math.abs(c)-Math.SQRT1_2)<.1?'45-degree':'intersection',segments:[segments.indexOf(a),segments.indexOf(b)]});}};
 for(let i=1;i<segments.length;i++)join(segments[i-1],segments[i]);if(closed)join(segments.at(-1),segments[0]);
 return {version:REGULARIZATION_VERSION,rawPointCount:input.length,points,pointScores,rawPointScores,segments,closed,planar:Math.sqrt(pca.eigenvalues[2])<tol,toleranceMetres:tol,regularity,cornerPoints:segments.slice(1).filter((s,i)=>s.kind==='line'&&segments[i].kind==='line').map(s=>s.path[0]),referenceAxes,policy:'Soft axis/45-degree priors within measured error tolerance. Curves remain curves. Original samples are retained; scores are geometric confidence, not calibrated probabilities.'};
}
export function regularizeDrawing(strokes,options={}){
 const paths=strokes.map(s=>({id:s.id,role:s.spatialRole||'edge',...regularizeStroke(s.points,{...options,localFit:s.localFit})})),tol=options.toleranceMetres??Math.max(.001,...paths.map(p=>p.toleranceMetres)),nodes=[],edges=[];
 const node=(p,id)=>{let n=nodes.find(n=>dist(n.point,p)<tol*1.5);if(!n){n={id:'junction-'+nodes.length,point:[...p],sources:[]};nodes.push(n);}n.sources.push(id);return n.id;};
 for(const p of paths)for(const s of p.segments)if(s.kind==='line')edges.push({strokeId:p.id,a:node(s.path[0],p.id),b:node(s.path[1],p.id),lengthMetres:dist(...s.path),direction:unit(sub(s.path[1],s.path[0])),confidence:s.confidence});
 const relations=[];for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){const a=edges[i],b=edges[j],d=Math.abs(dot(a.direction,b.direction));if(d>.995)relations.push({type:'parallel',edges:[i,j]});if(d<.08)relations.push({type:'perpendicular',edges:[i,j]});if(Math.abs(a.lengthMetres-b.lengthMetres)<tol*1.5)relations.push({type:'equal-length',edges:[i,j],suggestedMetres:(a.lengthMetres+b.lengthMetres)/2});if(relations.length>=256)break;}
 return {version:REGULARIZATION_VERSION,paths,graph:{nodes,edges},relations:relations.slice(0,256),toleranceMetres:tol,coordinateSystem:options.coordinateSystem||'world Y-up',stages:['arc-length sampling and point confidence','piecewise line/curve approximation','bounded geometric regularization','junction and relation graph']};
}
