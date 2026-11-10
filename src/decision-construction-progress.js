import {revolveSection} from './revolve-section.js';
import * as T from 'three';

// Sample by distance, so a cluster of control points doesn't crowd one end of
// the provisional surface. Exact construction still uses the native profiles.
function sampleRing(points,count=64){
 const closed=points.slice();
 if(closed[0].distanceToSquared(closed.at(-1))>1e-16)closed.push(closed[0]);
 const distance=[0];
 for(let i=1;i<closed.length;i++)distance.push(distance[i-1]+closed[i-1].distanceTo(closed[i]));
 let edge=1;
 return Array.from({length:count},(_,i)=>{
  const target=distance.at(-1)*i/count;
  while(edge<closed.length-1&&distance[edge]<target)edge++;
  return closed[edge-1].clone().lerp(closed[edge],(target-distance[edge-1])/(distance[edge]-distance[edge-1]||1));
 });
}
function aligned(previous,ring){
 let best=Infinity,indices;
 for(const direction of [1,-1])for(let offset=0;offset<ring.length;offset++){
  const order=ring.map((_,i)=>(offset+direction*i+ring.length)%ring.length);
  const score=order.reduce((sum,j,i)=>sum+previous[i].distanceToSquared(ring[j]),0);
  if(score<best){best=score;indices=order;}
 }
 return indices.map(i=>ring[i]);
}
export function initConstructionProgress(studio){
 const box=document.createElement('aside');box.id='decision-construction';box.hidden=true;box.setAttribute('aria-label','Live construction');
 box.innerHTML='<ol aria-live="polite"></ol><time></time><button type="button" data-retry hidden>Retry</button><button type="button" hidden aria-label="Dismiss construction error">×</button>';studio.container.append(box);
 const list=box.querySelector('ol'),elapsed=box.querySelector('time');
 const ghost=new T.Group();ghost.name='Provisional CAD surfaces';studio.scene.add(ghost);
 const retry=box.querySelector('[data-retry]'),dismiss=box.querySelector('[aria-label="Dismiss construction error"]');dismiss.onclick=()=>stop();
 let timer,start;
 function clearGeometry(){
  for(const object of [...ghost.children]){object.geometry.dispose();object.material.dispose();ghost.remove(object);}
  studio.onChange();
 }
 function step(message){
  if(list.lastElementChild?.textContent===message)return;
  const row=document.createElement('li');row.textContent=message;list.append(row);
  if(list.children.length>4)list.firstElementChild.remove();
 }
 function stop(){clearInterval(timer);box.hidden=true;dismiss.hidden=true;retry.hidden=true;retry.onclick=null;clearGeometry();}
 function begin(message){
  stop();start=performance.now();list.replaceChildren();elapsed.textContent='0 s';step(message);box.hidden=false;
  timer=setInterval(()=>elapsed.textContent=Math.floor((performance.now()-start)/1000)+' s',500);
 }
 function previewSolid(spec){
  clearGeometry();
  const figures=studio.desktopDrawing.summary();
  const sources=spec.profiles.map(p=>figures.find(f=>f.id===p.figureId));
  if(!sources.length||sources.some(f=>!f))return;
  let rings=sources.map(f=>sampleRing(studio.desktopDrawing.points(f)));
  if(['extrude','join-material','pocket','common-material'].includes(spec.kind)){
   const normal=new T.Vector3(...sources[0].xAxis).cross(new T.Vector3(...sources[0].yAxis)).normalize(),p=spec.profiles[0];
   rings=[-(p.backDepthMetres||0),p.depthMetres].map(depth=>rings[0].map(v=>v.clone().addScaledVector(normal,depth)));
  }else if(spec.kind==='revolve'){
   const f=sources[0],rev=spec.revolution;
   const x=new T.Vector3(...f.xAxis),y=new T.Vector3(...f.yAxis),origin=new T.Vector3(...f.origin);
   let section=rings[0],axis=rev.axis==='vertical'?y:x,pivot=origin;
   const meridian=revolveSection(f,rev);
   if(meridian){
    pivot=new T.Vector3(...meridian.origin);axis=new T.Vector3(...meridian.xAxis);
    section=sampleRing(studio.desktopDrawing.points(meridian));
   }
   axis=axis.clone().normalize();
   rings=Array.from({length:33},(_,i)=>section.map(p=>p.clone().sub(pivot).applyAxisAngle(axis,T.MathUtils.degToRad(rev.angleDegrees)*i/32).add(pivot)));
  }else if(spec.kind!=='loft')return;
  for(let n=1;n<rings.length;n++){
   const a=rings[n-1],b=rings[n]=spec.kind==='loft'?aligned(a,rings[n]):rings[n],vertices=[];
   for(let i=0;i<a.length;i++){
    const j=(i+1)%a.length;
    for(const p of [a[i],a[j],b[i],a[j],b[j],b[i]])vertices.push(p.x,p.y,p.z);
   }
   const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(vertices,3));
   ghost.add(new T.Mesh(geometry,new T.MeshBasicMaterial({color:spec.kind==='pocket'?0xec9974:0x65c9b7,side:T.DoubleSide,transparent:true,opacity:.28,depthWrite:false})));
  }
  for(const ring of rings.filter((_,i)=>spec.kind!=='revolve'||i%8===0))ghost.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(ring),new T.LineBasicMaterial({color:0x85ead6})));
  studio.onChange();
 }
 function failed(message,onRetry){
  clearInterval(timer);clearGeometry();step(message);dismiss.hidden=false;retry.hidden=!onRetry;retry.onclick=onRetry;box.hidden=false;
 }
 return {begin,step,stop,failed,previewSolid,clearGeometry};
}
