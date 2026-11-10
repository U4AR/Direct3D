import {Matrix4,Vector3} from 'three';
import {renderDecisionInk} from './decision-ink-image.mjs';

export const speechMetadata=inputs=>inputs?.map(({guides,...entry})=>entry);

function clip(a,b,box){
 let lo=0,hi=1;
 for(let k=0;k<2;k++){
  const delta=b[k]-a[k];
  if(Math.abs(delta)<1e-12){if(a[k]<box[0][k]||a[k]>box[1][k])return null;continue;}
  const u=(box[0][k]-a[k])/delta,v=(box[1][k]-a[k])/delta;
  lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));
 }
 return lo<=hi?[lo,hi].map(t=>a.map((p,k)=>p+(b[k]-p)*t)):null;
}

// One small contact sheet for the turn. The recorded camera preserves what
// "here" meant even if the user later orbits or the raw strokes are archived.
export function speechInkContent(data){
 const inputs=data.speechInputs||[],groups=[],labels=[];
 const paths=new Map([...data.references||[],...data.strokes||[]].map(s=>[s.id,s.points]));
 for(const entry of inputs)for(const g of entry.guides||[])if(!paths.has(g.id))paths.set(g.id,g.points);
 for(const entry of inputs.slice(-8)){
  const view=entry.view||data.view,ids=new Set([...entry.strokeIds||[],...entry.figureIds||[]]);
  if(!ids.size||view?.cameraToWorld?.length!==16||view.projectionMatrix?.length!==16)continue;
  const matrix=new Matrix4().fromArray(view.projectionMatrix).multiply(new Matrix4().fromArray(view.cameraToWorld).invert());
  const projected=[];
  for(const [id,path] of paths){
   if(!Array.isArray(path)||path.length<2)continue;
   const count=Math.min(path.length,96),points=[];
   for(let i=0;i<count;i++){
    const point=path[Math.round(i*(path.length-1)/(count-1))];
    if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite))continue;
    const p=new Vector3(...point).applyMatrix4(matrix);
    if(p.z>=-1&&p.z<=1)points.push([p.x*(view.aspect||1),p.y]);
   }
   if(points.length>1)projected.push({id,points});
  }
  const focus=projected.filter(s=>ids.has(s.id)),points=focus.flatMap(s=>s.points);
  if(!points.length)continue;
  const min=[0,1].map(k=>Math.min(...points.map(p=>p[k]))),max=[0,1].map(k=>Math.max(...points.map(p=>p[k])));
  const pad=Math.max(.012,.55*Math.max(...max.map((v,k)=>v-min[k])));
  const box=[min.map(v=>v-pad),max.map(v=>v+pad)],strokes=[];
  for(const s of projected.filter(s=>!ids.has(s.id))){
   for(let i=1;i<s.points.length;i++){
    const uv=clip(s.points[i-1],s.points[i],box);
    if(uv)strokes.push({uv,color:[155,160,167],context:true});
   }
  }
  strokes.push(...focus.map(s=>({uv:s.points,color:[0,76,195]})));
  groups.push({id:entry.audioId,strokes,points:box});
  labels.push({panel:groups.length,transcript:entry.text,strokeIds:entry.strokeIds,figureIds:entry.figureIds});
 }
 if(!groups.length)return [];
 return [{type:'input_text',text:'Spoken sketch details in capture order, left to right, then next row. Blue marks the indicated ink or linked figure. Grey shows surrounding geometry from the same viewpoint. Each panel is individually enlarged. '+JSON.stringify(labels)},
  {type:'input_image',image_url:renderDecisionInk(groups).image,detail:groups.length>2?'high':'low'}];
}
