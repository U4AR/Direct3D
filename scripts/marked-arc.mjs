const pi=Math.PI,deg=pi/180;
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const polar=(r,t)=>[r*Math.cos(t),r*Math.sin(t)];
const line=(a,b)=>[...a,...a.map((v,i)=>(2*v+b[i])/3),...a.map((v,i)=>(v+2*b[i])/3),...b];
const unwrap=(angle,near)=>near+Math.atan2(Math.sin(angle-near),Math.cos(angle-near));
function uv(point,frame){
 return [frame.xAxis,frame.yAxis].map(axis=>axis.reduce((n,v,k)=>n+v*(point[k]-frame.origin[k]),0));
}
function curve(segments,a,b,radius,offset=()=>[0,0]){
 if(b-a<1e-8)return;
 const count=Math.ceil((b-a)/(pi/4));
 for(let i=0;i<count;i++){
  const start=a+(b-a)*i/count,end=a+(b-a)*(i+1)/count;
  const span=end-start,k=4/3*Math.tan(span/4);
  const node=(t,sign)=>{
   const [d,rate]=offset(t),r=radius+d,p=polar(r,t),v=[rate*Math.cos(t)-p[1],rate*Math.sin(t)+p[0]];
   return [p,p.map((n,j)=>n+sign*k*v[j])];
  };
  const [p,c]=node(start,1),[q,h]=node(end,-1);
  segments.push([...p,...c,...h,...q]);
 }
}
export function markedArcSchema(fit){
 const hosts=fit.results.filter((r,i)=>fit.edits[i].kind==='arc'&&fit.edits[i].operation==='create').map(r=>r.id);
 if(!hosts.length)return null;
 const enumeration=values=>({type:'string',enum:values}),object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
 return object({host:enumeration(hosts),name:{type:'string'},span:enumeration(['fitted','semicircle-preserve-radius','semicircle-preserve-endpoints']),closeWithDiameter:{type:'boolean'},details:{type:'array',maxItems:8,items:object({guide:enumeration(fit.results.map(r=>r.id)),direction:enumeration(['inward','outward']),shape:enumeration(['rounded','angular'])})}});
}
export function markedArcOperations(plan,fit,data){
 const spec=plan.markedArc,index=fit.results.findIndex(r=>r.id===spec.host),base=fit.edits[index];
 if(base?.kind!=='arc'||base.operation!=='create')throw Error('Choose a newly fitted arc as the host.');
 const radius=base.radiusMetres,first=base.startAngleDeg*deg,sweep=((base.endAngleDeg-base.startAngleDeg)%360+360)%360*deg,mid=first+sweep/2;
 if(!(radius>0&&sweep>1e-5))throw Error('An arc contour requires a nonzero sweep and radius.');
 let start=first,end=first+sweep,r=radius,center=[0,0];
 const endpoints=spec.span==='semicircle-preserve-endpoints';
 if(endpoints){
  const a=polar(radius,start),b=polar(radius,end);
  center=a.map((x,i)=>(x+b[i])/2);r=Math.hypot(a[0]-center[0],a[1]-center[1]);
  start=Math.atan2(a[1]-center[1],a[0]-center[0]);end=start+pi;
 }else if(spec.span==='semicircle-preserve-radius'){
  start=mid-pi/2;
  const square=Math.round(start/(pi/2))*pi/2;
  if(square<=first+1e-6&&square+pi>=first+sweep-1e-6)start=square;
  end=start+pi;
 }else if(spec.span!=='fitted')throw Error('Unknown arc span.');
 const consumed=new Set([spec.host]),ids=new Set(base.strokeIds);
 const details=spec.details.map(detail=>{
  const guide=fit.results.find(g=>g.id===detail.guide);
  if(!guide||consumed.has(guide.id)||fit.edits[fit.results.indexOf(guide)].operation!=='create')throw Error('Each local feature needs its own new guide.');
  consumed.add(guide.id);
  const traces=data.strokes.filter(s=>guide.sourceStrokeIds.includes(s.id));
  const points=traces.flatMap(s=>s.points);
  if(!points.length)throw Error('The local feature guide has no recorded points.');
  const normal=fit.results[index].frame.normal;
  if(points.some(p=>Math.abs(p.reduce((acc,v,k)=>acc+(v-base.origin[k])*normal[k],0))>radius*.025))throw Error('Choose detail strokes on the host arc plane.');
  for(const id of guide.sourceStrokeIds)ids.add(id);
  const local=points.map(p=>uv(p,base));
  const angles=local.map(p=>unwrap(Math.atan2(p[1],p[0]),mid));
  const radial=local.map(p=>Math.hypot(...p)-radius);
  if(Math.min(...radial.map(Math.abs))>radius*.3)throw Error('The detail guide is too far from the host arc.');
  const map=t=>endpoints?start+(t-first)/sweep*pi:t;
  const lo=clamp(map(Math.min(...angles)),start,end),hi=clamp(map(Math.max(...angles)),start,end);
  if(hi-lo<1e-4)throw Error('The indicated detail has no span on this arc.');
  const signed=detail.direction==='inward'?-1:1;
  const observed=Math.max(...radial.map(v=>signed*v));
  const depth=clamp(Math.max(observed*(r/radius),r*(hi-lo)*.2),.001*r,.7*r);
  return {lo,hi,delta:signed*depth,shape:detail.shape};
 }).sort((a,b)=>a.lo-b.lo);
 const segments=[];
 let last=start;
 for(const {lo,hi,delta,shape} of details){
  if(lo<last-1e-7)throw Error('Local detail spans overlap. Use distinct guides or replace the combined outline.');
  curve(segments,last,lo,r);
  const width=hi-lo;
  if(shape==='angular'){
   const corners=[polar(r,lo),polar(r+delta,lo+.18*width),polar(r+delta,hi-.18*width),polar(r,hi)];
   for(let i=1;i<corners.length;i++)segments.push(line(corners[i-1],corners[i]));
  }else{
   const fn=t=>[delta*(1-Math.cos(2*pi*(t-lo)/width))/2,delta*pi*Math.sin(2*pi*(t-lo)/width)/width];
   for(let i=0;i<4;i++)curve(segments,lo+width*i/4,lo+width*(i+1)/4,r,fn);
  }
  last=hi;
 }
 curve(segments,last,end,r);
 const origin=base.origin.map((x,k)=>x+center[0]*base.xAxis[k]+center[1]*base.yAxis[k]);
 const replacement={...base,name:spec.name,origin,radiusMetres:r,startAngleDeg:start/deg,endAngleDeg:end/deg,strokeIds:[...ids]};
 if(details.length||spec.closeWithDiameter){
  if(spec.closeWithDiameter)segments.push(line(polar(r,end),polar(r,start)));
  Object.assign(replacement,{kind:'spline',segments,closed:spec.closeWithDiameter,radiusMetres:null,startAngleDeg:null,endAngleDeg:null});
 }
 return [{referenceId:spec.host,action:'replace',replacement},...[...consumed].slice(1).map(referenceId=>({referenceId,action:'omit'}))];
}
