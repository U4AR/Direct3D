import {brushTouches} from './sketch-eraser.js';
const lerp=(a,b,t)=>a.map((v,k)=>v+(b[k]-v)*t);
// Split the original polyline at brush boundaries; never connect across a cut.
// Sampling follows screen length, so even two-point strokes can be trimmed.
export function trimRawStroke(stroke,brush,radius,project){
 if(!brush.length||!Number.isFinite(radius)||radius<1)throw Error('Invalid eraser brush');
 const paths=[];let path=null,changed=false;
 const push=(p,time)=>{if(!path){path={points:[],times:[]};paths.push(path);}if(!path.points.length||Math.hypot(...p.map((v,k)=>v-path.points.at(-1)[k]))>1e-10){path.points.push(p);path.times.push(time);}};
 for(let i=1;i<stroke.points.length;i++){
  const a=stroke.points[i-1],b=stroke.points[i],pa=project(a),pb=project(b);
  if(!pa?.every(Number.isFinite)||!pb?.every(Number.isFinite))return {changed:false,pieces:[structuredClone(stroke)]};
  const length=Math.hypot(pb[0]-pa[0],pb[1]-pa[1]),n=Math.min(8192,Math.max(2,Math.ceil(length/Math.max(.5,radius/3)))),at=t=>lerp(a,b,t),time=t=>stroke.times?.length===stroke.points.length?stroke.times[i-1]+(stroke.times[i]-stroke.times[i-1])*t:undefined,hit=t=>brushTouches(project(at(t)),brush,radius);
  let previous=hit(0),start=previous?null:0;changed||=previous;if(previous)path=null;
  for(let j=1;j<=n;j++){const t=j/n,current=hit(t);changed||=current;if(current!==previous){let lo=(j-1)/n,hi=t;for(let k=0;k<20;k++){const mid=(lo+hi)/2;if(hit(mid)===previous)lo=mid;else hi=mid;}const boundary=(lo+hi)/2;if(current){push(at(start),time(start));push(at(boundary),time(boundary));path=null;start=null;}else start=boundary;}previous=current;}
  if(start!==null){push(at(start),time(start));push(b.slice(),time(1));}
 }
 if(!changed)return {changed:false,pieces:[structuredClone(stroke)]};
 return {changed:true,pieces:paths.filter(p=>p.points.length>1).map(p=>{const next={...structuredClone(stroke),points:p.points,erasedFrom:stroke.erasedFrom||stroke.id,intentionallyOpen:true};if(p.times.every(Number.isFinite))next.times=p.times;else delete next.times;for(const key of ['localFit','fit','fitting','spatialFit'])delete next[key];return next;})};
}
