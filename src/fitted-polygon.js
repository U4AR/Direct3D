import * as T from "three";
import {primitiveFromPoints} from "./fitted-primitive.js";
export function polygonFromPoints(points,a={}){
 const sides=a.sides??5;if(!Number.isInteger(sides)||sides<3||sides>32)throw Error("Polygon needs 3-32 sides");
 const fit=primitiveFromPoints(points,{...a,shape:"box",orientation:a.orientation||"plane",dimensionExpressions:{...a.dimensionExpressions,y:a.dimensionExpressions?.y||String(a.thicknessMetres??.01)}});
 const q=new T.Quaternion().setFromEuler(new T.Euler(...fit.rotationDeg.map(T.MathUtils.degToRad))),inv=q.clone().invert(),origin=new T.Vector3(...fit.center);
 const raw=points.map(p=>new T.Vector3(...p).sub(origin).applyQuaternion(inv)).map(p=>[p.x,p.z]);
 // Uniform arc-length sampling avoids overweighting where a hand paused.
 const lengths=[0];for(let i=1;i<raw.length;i++)lengths.push(lengths.at(-1)+Math.hypot(raw[i][0]-raw[i-1][0],raw[i][1]-raw[i-1][1]));
 const samples=[];let j=1;for(let i=0;i<192;i++){const d=lengths.at(-1)*i/191;while(j<raw.length-1&&lengths[j]<d)j++;const t=(d-lengths[j-1])/(lengths[j]-lengths[j-1]||1);samples.push(raw[j-1].map((v,k)=>v+(raw[j][k]-v)*t));}
 const vertices=([cx,cy,r,angle])=>Array.from({length:sides},(_,i)=>[cx+r*Math.cos(angle+i*2*Math.PI/sides),cy+r*Math.sin(angle+i*2*Math.PI/sides)]);
 const extent=Math.max(fit.size[0],fit.size[2]);
 function errors(v){const poly=vertices(v);return samples.map(p=>{let best=Infinity;for(let i=0;i<sides;i++){const x=poly[i],y=poly[(i+1)%sides],dx=y[0]-x[0],dy=y[1]-x[1],t=Math.max(0,Math.min(1,((p[0]-x[0])*dx+(p[1]-x[1])*dy)/(dx*dx+dy*dy)));best=Math.min(best,(p[0]-x[0]-t*dx)**2+(p[1]-x[1]-t*dy)**2);}return best;});}
 const score=v=>v[2]>extent*.15&&v[2]<extent*2?errors(v).reduce((s,x)=>s+x,0)/samples.length:Infinity;
 let best=[0,0,extent*.55,0],loss=Infinity;
 for(let k=0;k<48;k++){const v=[0,0,extent*.55,k*2*Math.PI/(sides*48)],l=score(v);if(l<loss){best=v;loss=l;}}
 let steps=[extent*.08,extent*.08,extent*.08,Math.PI/(sides*12)];
 for(let iteration=0;iteration<48;iteration++){let improved=false;for(let axis=0;axis<4;axis++)for(const direction of [-1,1]){const next=[...best];next[axis]+=steps[axis]*direction;const l=score(next);if(l<loss){loss=l;best=next;improved=true;}}if(!improved)steps=steps.map(s=>s*.5);}
 const poly=vertices(best),min=[0,1].map(i=>Math.min(...poly.map(p=>p[i]))),max=[0,1].map(i=>Math.max(...poly.map(p=>p[i]))),center=min.map((v,i)=>(v+max[i])/2);
 fit.center=origin.add(new T.Vector3(center[0],0,center[1]).applyQuaternion(q)).toArray();fit.size=[max[0]-min[0],fit.size[1],max[1]-min[1]];
 fit.polygon={sides,vertices:poly.map(p=>p.map((v,i)=>v-center[i])),radiusMetres:best[2],rmsMetres:Math.sqrt(loss),maxMetres:Math.sqrt(Math.max(...errors(best))),method:"Regular equal-edge polygon fitted to arc-resampled projected strokes by bounded coordinate search. Local optimum; inspect silhouette."};
 return fit;
}
