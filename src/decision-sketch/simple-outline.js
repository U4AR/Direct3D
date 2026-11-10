import {bounds,distance,simplify} from './math.js';
import {constrainKnots} from './constraints.js';

// A close point-to-ink error can still hide a zero-width spur. Test the
// boundary itself before using angle constraints on a closed line profile.
export function simpleOutline(points){
 if(points.length<3)return false;
 const span=bounds(points).span,eps=Math.max(span*1e-7,1e-12);
 const side=(a,b,p)=>{
  const cross=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  return Math.abs(cross)<=eps*distance(a,b)?0:Math.sign(cross);
 };
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],prev=points[(i+points.length-1)%points.length];
  if(distance(a,b)<=eps)return false;
  if(!side(a,b,prev)&&(prev[0]-a[0])*(b[0]-a[0])+(prev[1]-a[1])*(b[1]-a[1])>0)return false;
  for(let j=i+2;j<points.length;j++){
   if(i===0&&j===points.length-1)continue;
   const c=points[j],d=points[(j+1)%points.length];
   if([0,1].some(k=>Math.max(a[k],b[k])+eps<Math.min(c[k],d[k])||Math.max(c[k],d[k])+eps<Math.min(a[k],b[k])))continue;
   if(side(a,b,c)*side(a,b,d)<=0&&side(c,d,a)*side(c,d,b)<=0)return false;
  }
 }
 return true;
}

export function recoverLineOutline(raw,options){
 for(const tolerance of [.018,.009,.004]){
  const corners=simplify([...raw,raw[0]],tolerance).slice(0,-1);
  if(corners.length>64)continue;
  for(const align of options.align?[true,false]:[false]){
   const fit=constrainKnots(corners,{...options,closed:true,lines:true,align});
   if(simpleOutline(fit.knots))return {...fit,align};
  }
 }
 return null;
}
