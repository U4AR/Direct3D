// Geometry proposes nearby retraces; only an explicit model decision merges them.
import {bounds,centroid,distance,resample,pathDistance} from '../src/decision-sketch/math.js';
const gap=g=>distance(g.points[0],g.points.at(-1))/bounds(g.points).span;
function inside(p,path){let yes=false;for(let i=0,j=path.length-1;i<path.length;j=i++){const a=path[i],b=path[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}

export function traceMergeCandidates(groups){const pairs=[];for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){
 const a=groups[i],b=groups[j];if(JSON.stringify(a.frame)!==JSON.stringify(b.frame)||gap(a)>.2||gap(b)>.2)continue;
 const x=bounds(a.points),y=bounds(b.points),span=Math.max(x.span,y.span);if(Math.min(x.span,y.span)/span<.65||distance(x.center,y.center)>.1*span)continue;
 const ap=resample(a.points,48),bp=resample(b.points,48),errors=[...ap.map(p=>pathDistance(p,b.points)),...bp.map(p=>pathDistance(p,a.points))],rms=Math.sqrt(errors.reduce((n,v)=>n+v*v,0)/errors.length)/span,max=Math.max(...errors)/span;
 if(rms<.065&&max<.15)pairs.push({name:'traces.'+a.id+'.'+b.id,groupIds:[a.id,b.id],rmsFraction:rms,maxFraction:max,insideFraction:ap.filter(p=>inside(p,b.points)).length/ap.length,interleaved:ap.some(p=>inside(p,b.points))&&ap.some(p=>!inside(p,b.points)),note:'Interleaved noisy boundaries support retracing; consistently nested boundaries may be separate walls.'});
 }return pairs.slice(0,64);}
function consensus(paths){const first=resample(paths[0],128,true),aligned=[first];for(const path of paths.slice(1)){const points=resample(path,128,true);let best={cost:Infinity};for(const sign of [1,-1])for(let offset=0;offset<128;offset++){let cost=0;for(let i=0;i<128;i++){const q=points[((offset+sign*i)%128+128)%128];cost+=(q[0]-first[i][0])**2+(q[1]-first[i][1])**2;}if(cost<best.cost)best={cost,offset,sign};}aligned.push(first.map((_,i)=>points[((best.offset+best.sign*i)%128+128)%128]));}const out=first.map((_,i)=>[0,1].map(k=>aligned.reduce((n,p)=>n+p[i][k],0)/aligned.length));return [...out,out[0]];}
export function mergeApprovedTraces(groups,answers){const parents=new Map(groups.map(g=>[g.id,g.id])),find=id=>{while(parents.get(id)!==id)id=parents.get(id);return id;},approved=[];
 for(const pair of traceMergeCandidates(groups)){if(answers.find(a=>a.name===pair.name)?.choice!=='same_outline')continue;const [a,b]=pair.groupIds.map(find);if(a!==b)parents.set(b,a);approved.push(pair);}
 const clusters=new Map();for(const g of groups){const id=find(g.id);if(!clusters.has(id))clusters.set(id,[]);clusters.get(id).push(g);}
 return {groups:[...clusters.values()].map(cluster=>cluster.length===1?cluster[0]:{...cluster[0],retraced:true,points:consensus(cluster.map(g=>g.points)),strokes:cluster.flatMap(g=>g.strokes),mergedGroupIds:cluster.map(g=>g.id)}),approved};
}
// Propose complete outlines across pen lifts, reordered fragments and pauses.
// Endpoints must be close at BOTH fragments' scale; approval stays with the model.
export function strokeChainCandidates(groups){
 const open=groups.filter(g=>gap(g)>.08),adj=new Map(open.map(g=>[g.id,[]]));
 for(let i=0;i<open.length;i++)for(let j=i+1;j<open.length;j++){const a=open[i],b=open[j];if(JSON.stringify(a.frame)!==JSON.stringify(b.frame)||a.strokes.some(s=>s.erasedFrom&&b.strokes.some(t=>t.erasedFrom===s.erasedFrom)))continue;const d=Math.min(...[a.points[0],a.points.at(-1)].flatMap(p=>[b.points[0],b.points.at(-1)].map(q=>distance(p,q))));if(d<.14*Math.min(bounds(a.points).span,bounds(b.points).span)){adj.get(a.id).push(b.id);adj.get(b.id).push(a.id);}}
 const used=new Set(),out=[];for(const g of open){if(used.has(g.id))continue;const stack=[g.id],ids=[];while(stack.length){const id=stack.pop();if(used.has(id))continue;used.add(id);ids.push(id);stack.push(...adj.get(id));}if(ids.length<2)continue;
  const selected=ids.map(id=>open.find(g=>g.id===id)),paths=selected.map(g=>g.points);let points=paths.shift().slice();while(paths.length){const candidates=paths.flatMap((p,i)=>[{i,left:false,p,d:distance(points.at(-1),p[0])},{i,left:false,p:[...p].reverse(),d:distance(points.at(-1),p.at(-1))},{i,left:true,p,d:distance(points[0],p.at(-1))},{i,left:true,p:[...p].reverse(),d:distance(points[0],p[0])}]).sort((a,b)=>a.d-b.d),next=candidates[0];paths.splice(next.i,1);points=next.left?[...next.p,...points]:[...points,...next.p];}
  out.push({id:'chain'+out.length,frame:g.frame,points,strokes:selected.flatMap(g=>g.strokes),joinedGroupIds:ids});
 }return out;
}
export function joinApprovedChains(groups,answers){const approved=strokeChainCandidates(groups).filter(g=>answers.find(a=>a.name===g.id+'.join')?.choice==='join'),ids=new Set(approved.flatMap(g=>g.joinedGroupIds));return {groups:[...groups.filter(g=>!ids.has(g.id)),...approved],approved:approved.map(({id,joinedGroupIds})=>({id,groupIds:joinedGroupIds}))};}
