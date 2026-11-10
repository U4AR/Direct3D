import {sketchFrame} from './desktop-sketch-fit.js';
// Offset along the base normal, then tilt around local X and the resulting
// local Y. Both rotations pivot at the new plane origin; no three-axis offsets.
export function constructSketchPlane(base,{offsetMetres=0,angleXDegrees=0,angleYDegrees=0}={}){
 if(![offsetMetres,angleXDegrees,angleYDegrees].every(Number.isFinite)||Math.abs(offsetMetres)>1000||Math.abs(angleXDegrees)>360||Math.abs(angleYDegrees)>360)throw Error('Enter a finite offset and angles between -360° and 360°');
 const f=sketchFrame(base),dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],rotate=(v,axis,a)=>{const c=Math.cos(a),s=Math.sin(a),x=cross(axis,v),d=dot(axis,v);return v.map((v,k)=>v*c+x[k]*s+axis[k]*d*(1-c));};
 f.origin=f.origin.map((v,k)=>v+f.normal[k]*offsetMetres);
 for(const [key,degrees]of [['xAxis',angleXDegrees],['yAxis',angleYDegrees]]){const axis=f[key].slice(),a=degrees*Math.PI/180;for(const k of ['xAxis','yAxis','normal'])f[k]=rotate(f[k],axis,a);}
 return {...f,anchor:[...f.origin],construction:{basePlaneId:base.id,offsetMetres,angleXDegrees,angleYDegrees,rotationOrder:'local X then local Y'}};
}
