// Small deterministic geometry helpers shared by fitting and replay. Metres, XYZ.
export const add=(a,b)=>a.map((v,i)=>v+b[i]), sub=(a,b)=>a.map((v,i)=>v-b[i]), mul=(a,s)=>a.map(v=>v*s), dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0), cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]], len=a=>Math.hypot(...a), unit=a=>mul(a,1/Math.max(1e-15,len(a))), dist=(a,b)=>len(sub(a,b)), mean=p=>mul(p.reduce(add,[0,0,0]),1/Math.max(1,p.length));
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function quantile(a,q){const s=[...a].sort((a,b)=>a-b);return s[Math.floor(clamp(q,0,1)*(s.length-1))]??0;}
export function segmentDistance(p,a,b){const d=sub(b,a);return dist(p,add(a,mul(d,clamp(dot(sub(p,a),d)/Math.max(1e-20,dot(d,d)),0,1))));}
export function pathDistance(p,path){let d=Infinity;for(let i=1;i<path.length;i++)d=Math.min(d,segmentDistance(p,path[i-1],path[i]));return d;}
export const world=(p,m)=>add(m.center,m.axes.reduce((q,a,i)=>add(q,mul(a,p[i])),[0,0,0])),local=(p,m)=>m.axes.map(a=>dot(sub(p,m.center),a));
export function robustRms(errors,weights=errors.map(()=>1),tolerance=Infinity){let sum=0,total=0;for(let i=0;i<errors.length;i++){// Huber loss bounds the influence of a tracking spike without discarding it.
 const d=Math.abs(errors[i]),cap=tolerance*3,w=weights[i]??1;sum+=w*(d<=cap?d*d:2*cap*d-cap*cap);total+=w;}return Math.sqrt(sum/Math.max(total,1e-12));}
export function matrixPoint(p,m){if(!m)return [...p];const w=m[3]*p[0]+m[7]*p[1]+m[11]*p[2]+m[15];return [0,1,2].map(i=>(m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i])/w);}
