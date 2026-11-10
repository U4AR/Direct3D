import {sketchFrame,fitDesktopSketch} from './desktop-sketch-fit.js';
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const lerp=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t);
const pointDistance=(p,a,b)=>{const d=[b[0]-a[0],b[1]-a[1]],t=Math.max(0,Math.min(1,((p[0]-a[0])*d[0]+(p[1]-a[1])*d[1])/(d[0]**2+d[1]**2||1)));return dist(p,lerp(a,b,t));};
export function pathDistance2(p,path){let best=Infinity;for(let i=1;i<path.length;i++)best=Math.min(best,pointDistance(p,path[i-1],path[i]));return best;}
function resample(points,count=192){const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+dist(points[i-1],points[i]));if(!lengths.at(-1))return [points[0],points.at(-1)];let j=1;return Array.from({length:Math.min(count,Math.max(points.length,2))},(_,i)=>{const s=lengths.at(-1)*i/(Math.min(count,Math.max(points.length,2))-1);while(j<points.length-1&&lengths[j]<s)j++;return lerp(points[j-1],points[j],(s-lengths[j-1])/(lengths[j]-lengths[j-1]||1));});}
function simplify(points,tolerance){const kept=new Set([0,points.length-1]),stack=[[0,points.length-1]];while(stack.length){const [a,b]=stack.pop();let error=tolerance,index=-1;for(let i=a+1;i<b;i++){const d=pointDistance(points[i],points[a],points[b]);if(d>error){index=i;error=d;}}if(index>=0){kept.add(index);stack.push([a,index],[index,b]);}}return [...kept].sort((a,b)=>a-b);}
export function sampleDraftSegment(s,count=40){
 const c=s.coordinates;
 if(s.kind==='rectangle'){const [u,v,w,h]=c;return [[u-w/2,v-h/2],[u+w/2,v-h/2],[u+w/2,v+h/2],[u-w/2,v+h/2],[u-w/2,v-h/2]];}
 if(s.kind==='line')return Array.from({length:count},(_,i)=>lerp(c.slice(0,2),c.slice(2),i/(count-1)));
 if(s.kind==='arc'||s.kind==='circle'){const start=s.kind==='circle'?0:c[3],sweep=s.kind==='circle'?360:c[4];return Array.from({length:Math.max(count,Math.ceil(Math.abs(sweep)/4)+1)},(_,i)=>{const a=(start+sweep*i/(Math.max(count,Math.ceil(Math.abs(sweep)/4)+1)-1))*Math.PI/180;return [c[0]+c[2]*Math.cos(a),c[1]+c[2]*Math.sin(a)];});}
 return Array.from({length:count},(_,i)=>{const t=i/(count-1),u=1-t;return [0,1].map(k=>u**3*c[k]+3*u*u*t*c[k+2]+3*u*t*t*c[k+4]+t**3*c[k+6]);});
}
export function draftDeviation(source,segments){
 const paths=segments.map(s=>sampleDraftSegment(s)),forward=source.map(p=>Math.min(...paths.map(path=>pathDistance2(p,path)))),backward=paths.flat().map(p=>pathDistance2(p,source));
 return {rms:Math.sqrt(forward.reduce((n,d)=>n+d*d,0)/forward.length),max:Math.max(...forward,...backward),sourceToDraftMax:Math.max(...forward),draftToSourceMax:Math.max(...backward)};
}
function score(part,s){const m=draftDeviation(part,[s]);return {...s,error:m};}
export function fitDraftRange(part,kind){
 if(part.length<2)return null;
 const a=part[0],b=part.at(-1),chord=dist(a,b);
 if(kind==='line')return chord>1e-10?score(part,{kind,coordinates:[...a,...b]}):null;
 if(kind==='arc'){
  if(part.length<4||chord<1e-9)return null;
  const mid=lerp(a,b,.5),n=[-(b[1]-a[1])/chord,(b[0]-a[0])/chord];let xx=0,xy=0;
  for(const p of part){const q=[p[0]-mid[0],p[1]-mid[1]],x=2*(q[0]*n[0]+q[1]*n[1]),y=q[0]**2+q[1]**2-chord**2/4;xx+=x*x;xy+=x*y;}
  if(xx<1e-20)return null;const t=xy/xx,center=[mid[0]+t*n[0],mid[1]+t*n[1]],radius=Math.hypot(chord/2,t);
  const angles=part.map(p=>Math.atan2(p[1]-center[1],p[0]-center[0]));let sweep=0,travel=0;
  for(let i=1;i<angles.length;i++){let d=angles[i]-angles[i-1];while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;sweep+=d;travel+=Math.abs(d);}
  if(Math.abs(sweep)<.15||Math.abs(sweep)>Math.PI*1.98||travel>Math.abs(sweep)*1.15)return null;
  return score(part,{kind,coordinates:[...center,radius,angles[0]*180/Math.PI,sweep*180/Math.PI]});
 }
 if(kind==='spline'){
  if(part.length<4)return null;const lengths=[0];for(let i=1;i<part.length;i++)lengths.push(lengths.at(-1)+dist(part[i-1],part[i]));
  let aa=0,ab=0,bb=0;const rhs=[[0,0],[0,0]];
  for(let i=0;i<part.length;i++){const t=lengths[i]/lengths.at(-1),u=1-t,x=3*u*u*t,y=3*u*t*t;aa+=x*x;ab+=x*y;bb+=y*y;for(let k=0;k<2;k++){const r=part[i][k]-u**3*a[k]-t**3*b[k];rhs[k][0]+=x*r;rhs[k][1]+=y*r;}}
  const det=aa*bb-ab*ab;if(det<1e-15)return null;
  const c1=[0,1].map(k=>(rhs[k][0]*bb-rhs[k][1]*ab)/det),c2=[0,1].map(k=>(rhs[k][1]*aa-rhs[k][0]*ab)/det);
  return score(part,{kind,coordinates:[...a,...c1,...c2,...b]});
 }
 return null;
}
function corner(points,indexes,k){if(k===0||k===indexes.length-1)return false;const a=points[indexes[k-1]],b=points[indexes[k]],c=points[indexes[k+1]],u=[b[0]-a[0],b[1]-a[1]],v=[c[0]-b[0],c[1]-b[1]];return (u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v)||1)<Math.cos(Math.PI*40/180);}
export function measuredDraftPath(stroke,plane,{toleranceRatio=.006}={}){
 const frame=sketchFrame(plane),raw=stroke.points.map(p=>frame.xAxis.map((_,k)=>p[k]-frame.origin[k])).map(q=>[q.reduce((v,x,k)=>v+x*frame.xAxis[k],0),q.reduce((v,x,k)=>v+x*frame.yAxis[k],0)]).filter((p,i,a)=>!i||dist(p,a[i-1])>1e-10);
 if(raw.length<2)throw Error('Stroke has no measurable length');
 const bounds={min:[0,1].map(k=>Math.min(...raw.map(p=>p[k]))),max:[0,1].map(k=>Math.max(...raw.map(p=>p[k])))},span=dist(bounds.min,bounds.max),tolerance=Math.max(.0001,span*toleranceRatio),closed=raw.length>5&&dist(raw[0],raw.at(-1))<tolerance*2;
 const normalError=Math.max(...stroke.points.map(p=>Math.abs(frame.normal.reduce((n,v,k)=>n+(p[k]-frame.origin[k])*v,0))));
 if(normalError>Math.max(.001,span*.02))throw Error('Nonplanar surface ink needs the surface/3D workflow; do not flatten it into a planar draft');
 const source=raw.map(p=>[...p]);if(closed){const mid=lerp(source[0],source.at(-1),.5);source[0]=mid;source[source.length-1]=[...mid];}
 const circle=closed?fitDesktopSketch([stroke],{plane:frame,kind:'circle'}).paths[0].primitive:null;
 if(circle){const segment={id:'e0',kind:'circle',coordinates:[...circle.center,circle.radiusMetres],range:[0,source.length-1]},metrics=draftDeviation(raw,[segment]);if(metrics.max<=tolerance)return {strokeId:stroke.id,frame,bounds,closed,points:source,source:raw,segments:[{...segment,error:metrics}],toleranceMetres:tolerance,metrics};}
 const points=resample(source),ids=simplify(points,tolerance*.65);let fitTol=tolerance*.65;
 while(ids.length>65){fitTol*=1.2;ids.splice(0,ids.length,...simplify(points,fitTol));}
 const hard=ids.map((_,k)=>corner(points,ids,k)),cost=Array(ids.length).fill(Infinity),prev=[];cost[0]=0;
 for(let j=1;j<ids.length;j++)for(let i=j-1;i>=0;i--){
  if(i<j-1&&hard.slice(i+1,j).some(Boolean))break;
  const part=points.slice(ids[i],ids[j]+1),candidates=['line','arc','spline'].map(kind=>fitDraftRange(part,kind)).filter(s=>s&&s.error.max<=tolerance);
  for(const s of candidates){const value=cost[i]+({line:1,arc:1.15,spline:1.7}[s.kind])+.2*(s.error.rms/tolerance)**2;if(value<cost[j]){cost[j]=value;prev[j]={i,segment:{...s,range:[ids[i],ids[j]]}};}}
 }
 const segments=[];let j=ids.length-1;while(j>0){const next=prev[j];if(!next)throw Error('Measured contour could not be segmented within tolerance');segments.unshift(next.segment);j=next.i;}
 segments.forEach((s,i)=>s.id='e'+i);
 const metrics=draftDeviation(raw,segments);
 return {strokeId:stroke.id,frame,bounds,closed,points,source:raw,segments,toleranceMetres:tolerance,metrics};
}

export function regularizeDraftLines(path){
 // Shared endpoints move together; never snap each edge independently and open gaps.
 const nodes=path.segments.map(s=>path.points[s.range[0]].slice());nodes.push(path.points[path.segments.at(-1).range[1]].slice());const original=nodes.map(p=>p.slice());
 for(let pass=0;pass<18;pass++)for(let i=0;i<path.segments.length;i++){
  if(path.segments[i].kind!=='line')continue;
  const d=[original[i+1][0]-original[i][0],original[i+1][1]-original[i][1]],angle=Math.atan2(d[1],d[0]),target=Math.round(angle/(Math.PI/4))*Math.PI/4;
  if(Math.abs(angle-target)>Math.PI*3.5/180)continue;
  const n=[-Math.sin(target),Math.cos(target)],error=(nodes[i+1][0]-nodes[i][0])*n[0]+(nodes[i+1][1]-nodes[i][1])*n[1];
  for(const [index,sign]of [[i,1],[i+1,-1]]){const q=nodes[index].map((v,k)=>v+sign*.3*error*n[k]);if(dist(q,original[index])<=path.toleranceMetres*.65)nodes[index]=q;}
  if(path.closed){const p=lerp(nodes[0],nodes.at(-1),.5);nodes[0]=p;nodes[nodes.length-1]=p;}
 }
 const segments=path.segments.map((s,i)=>{const part=path.points.slice(s.range[0],s.range[1]+1).map(p=>p.slice());part[0]=nodes[i];part[part.length-1]=nodes[i+1];return {...s,...fitDraftRange(part,s.kind)};});
 return draftDeviation(path.source,segments).max<=path.toleranceMetres*1.5?segments:path.segments;
}
