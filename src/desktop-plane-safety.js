const dot=(a,b)=>a.reduce((n,v,k)=>n+v*b[k],0),unit=a=>{const n=Math.hypot(...a);return a.map(v=>v/(n||1));};
export function planeDrawingSafety(plane,direction){
 const incidence=Math.abs(dot(unit(plane.normal),unit(direction)));
 return {allowed:Number.isFinite(incidence)&&incidence>=.18,incidence,message:'This plane is nearly edge-on. Rotate toward it or choose View plane through origin.'};
}
export function viewAlignedPlane(view,origin,{id='view-plane',name='View plane',offsetMetres=0}={}){
 const m=view?.cameraToWorld;if(!Array.isArray(m)||m.length!==16||!m.every(Number.isFinite)||!Array.isArray(origin)||origin.length!==3||!origin.every(Number.isFinite)||!Number.isFinite(offsetMetres)||Math.abs(offsetMetres)>100)throw Error('A calibrated view and finite plane origin/offset are required');
 const xAxis=unit(m.slice(0,3)),yAxis=unit(m.slice(4,7)),normal=unit(m.slice(8,11));return {id,name,anchor:origin.slice(),origin:origin.map((v,k)=>v+normal[k]*offsetMetres),xAxis,yAxis,normal};
}
