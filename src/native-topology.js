import * as T from 'three';
export function projectedNativeEdges(model,camera,rect){
 model.mesh.updateWorldMatrix(true,false);const result=[];
 for(const edge of model.blender?.metrics?.edges||[]){const points=(edge.polyline||[]).map(p=>{const world=new T.Vector3(...p).applyMatrix4(model.mesh.matrixWorld),clip=world.clone().project(camera);return {world,x:rect.left+(clip.x+1)*rect.width/2,y:rect.top+(1-clip.y)*rect.height/2,z:clip.z};});result.push({index:edge.index,points});}return result;
}
export function nearestNativeEdge(edges,x,y,maxPixels=14,visible=()=>true){let best=null;for(const edge of edges)for(let i=1;i<edge.points.length;i++){const a=edge.points[i-1],b=edge.points[i];if(a.z<-1||a.z>1||b.z<-1||b.z>1)continue;const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1))),distance=Math.hypot(x-a.x-dx*t,y-a.y-dy*t);if(distance<=maxPixels&&(!best||distance<best.distance)){const point=a.world.clone().lerp(b.world,t);if(visible(point))best={index:edge.index,distance,point};}}return best;}
function intersects(a,b,r){let low=0,high=1;const dx=b.x-a.x,dy=b.y-a.y;for(const [p,q]of [[-dx,a.x-r.left],[dx,r.right-a.x],[-dy,a.y-r.top],[dy,r.bottom-a.y]]){if(p===0){if(q<0)return false;continue;}const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);if(low>high)return false;}return true;}
export function rectangleNativeEdges(edges,r){return edges.filter(e=>e.points.some((b,i)=>i>0&&b.z>=-1&&b.z<=1&&intersects(e.points[i-1],b,r))).map(e=>e.index);}
