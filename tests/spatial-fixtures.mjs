export const lerp=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
export function cuboidStrokes({rotate=.3,noise=.0005}={}){
 const transform=p=>[p[0]*Math.cos(rotate)+p[2]*Math.sin(rotate),1+p[1],-.6-p[0]*Math.sin(rotate)+p[2]*Math.cos(rotate)];
 const c=Array.from({length:8},(_,i)=>transform([i&1?.2:-.2,i&2?.15:-.15,i&4?.1:-.1])),strokes=[];
 for(let i=0;i<8;i++)for(let j=0;j<3;j++)if(!(i>>j&1))strokes.push({id:'edge-'+strokes.length,spatialRole:'edge',points:Array.from({length:30},(_,k)=>lerp(c[i],c[i|1<<j],k/29).map((x,d)=>x+noise*Math.sin(k*1.7+d))) });return strokes;
}
export function ring(id,f){return {id,spatialRole:'edge',points:Array.from({length:81},(_,i)=>f(i*Math.PI/40))};}
export function cylinderStrokes(){return [ring('rim-a',t=>[.15*Math.cos(t),.8,-.6+.15*Math.sin(t)]),ring('rim-b',t=>[.15*Math.cos(t),1.2,-.6+.15*Math.sin(t)]),{id:'generator',points:Array.from({length:24},(_,i)=>[.15,.8+.4*i/23,-.6])}];}
export function sphereStrokes(){return [ring('xy',t=>[.2*Math.cos(t),1+.2*Math.sin(t),-.6]),ring('xz',t=>[.2*Math.cos(t),1,-.6+.2*Math.sin(t)]),ring('yz',t=>[0,1+.2*Math.cos(t),-.6+.2*Math.sin(t)])];}
export function helixStroke(){return {id:'helix',points:Array.from({length:120},(_,i)=>{const t=i/119;return [.15*Math.cos(t*Math.PI*4),.8+.4*t,-.6+.15*Math.sin(t*Math.PI*4)];})};}
export function sheetStrokes(){const f=(u,v)=>[(u-.5)*.4,1+.08*Math.sin(u*Math.PI)*Math.sin(v*Math.PI),-.6+(v-.5)*.4];return [0,1,2,3].map(i=>({id:'boundary-'+i,spatialRole:'edge',points:Array.from({length:24},(_,k)=>{const t=k/23;return i===0?f(0,t):i===1?f(1,t):i===2?f(t,0):f(t,1);})})).concat([.25,.5,.75].map(v=>({id:'sheet-'+v,spatialRole:'surface',points:Array.from({length:24},(_,k)=>f(k/23,v))})));}

// Hand-like, imperfect wire sketch: a seat, four legs and a back, with genuine depth.
export function chairStrokes({noise=.0015,rotate=.18}={}){
 const transform=([x,y,z])=>[x*Math.cos(rotate)+z*Math.sin(rotate),y,-.8-x*Math.sin(rotate)+z*Math.cos(rotate)];
 const a=[-.23,.46,-.22],b=[.23,.46,-.22],c=[.23,.46,.22],d=[-.23,.46,.22];
 const edges=[[a,b],[b,c],[c,d],[d,a],...[a,b,c,d].map(p=>[p,[p[0],.02,p[2]]]),[a,[-.23,.91,-.22]],[b,[.23,.91,-.22]],[[-.23,.91,-.22],[.23,.91,-.22]],[[-.23,.67,-.22],[.23,.67,-.22]]];
 return edges.map(([a,b],i)=>({id:'chair-ink-'+i,spatialRole:'edge',points:Array.from({length:35},(_,k)=>transform(lerp(a,b,k/34).map((x,j)=>x+noise*Math.sin(k*1.1+i+j*2))))}));
}

// Same chair topology in two long pen gestures rather than twelve separate edges.
export function continuousChairStrokes(){
 const paths=[[[ -.23,.02,.22],[-.23,.46,.22],[-.23,.46,-.22],[-.23,.02,-.22],[-.23,.46,-.22],[-.23,.91,-.22],[.23,.91,-.22],[.23,.46,-.22],[.23,.02,-.22]],[[.23,.02,.22],[.23,.46,.22],[.23,.46,-.22],[-.23,.46,-.22],[-.23,.46,.22],[.23,.46,.22]]];
 return paths.map((path,i)=>({id:'continuous-chair-'+i,spatialRole:'edge',points:path.slice(1).flatMap((b,j)=>Array.from({length:30},(_,k)=>lerp(path[j],b,k/29).map((x,d)=>x+(d===2?-.8:0)+.0015*Math.sin(k*1.1+j+d))))}));
}
