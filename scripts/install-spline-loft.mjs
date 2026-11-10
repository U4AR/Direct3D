import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

// Use adaptive chords for swept spline profiles (ruled lofts and extrusions). The source sketch and
// feature references stay native, so later control-point edits rebuild the loft.
function loftSectionProfile(region) {
 function flatten(loop) {
  const cubics=loop.curves.filter(c=>c.kind==='bezier');
  if(!cubics.length)return loop;
  const points=cubics.flatMap(c=>[c.a,c.b,...c.controls]);
  const span=Math.max(...['x','y'].map(k=>Math.max(...points.map(p=>p[k]))-Math.min(...points.map(p=>p[k]))));
  const tolerance=span*.001,curves=[];
  function subdivide(row,depth) {
   const a=row[0],b=row.at(-1),dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
   const flat=row.slice(1,-1).every(p=>{
    const t=length2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length2)):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=tolerance;
   });
   if(flat){if(Math.hypot(dx,dy)>span*1e-10)curves.push({kind:'line',a,b});return;}
   if(depth>=14||curves.length>=512)throw Error('Spline profile exceeds solid construction resolution');
   const left=[a],right=[b];
   while(row.length>1){row=row.slice(1).map((p,i)=>({x:(row[i].x+p.x)/2,y:(row[i].y+p.y)/2}));left.push(row[0]);right.unshift(row.at(-1));}
   subdivide(left,depth+1);subdivide(right,depth+1);
  }
  for(const curve of loop.curves){
   if(curve.kind==='bezier')subdivide([curve.a,...curve.controls,curve.b],0);
   else curves.push(curve);
  }
  return {...loop,curves};
 }
 return {...region,outer:flatten(region.outer),holes:region.holes.map(flatten)};
}
export async function installSplineLoft(root){
 const file=path.join(root,'assets/exact-DaAeGT7W.js'),code=await readFile(file,'utf8');
 const originalExtrude='c=QS(e,i,o.faceBasis,s),d=e.extrude(';
 const boundedExtrude='c=QS(e,loftSectionProfile(i),o.faceBasis,s),d=e.extrude(';
 if(!code.includes(boundedExtrude)&&code.split(originalExtrude).length!==2)throw Error('Review spline extrusion integration against the pinned CAD engine');
 const update=source=>writeFile(file,source.replace(originalExtrude,boundedExtrude));
 const installed=code.indexOf('function loftSectionProfile(');
 if(installed!==-1){
  const end=code.indexOf('function nC(e,t,n,r,i,a,o,ruled){',installed);
  if(end===-1)throw Error('Unrecognized installed loft integration');
  await update(code.slice(0,installed)+loftSectionProfile.toString()+'\n'+code.slice(end));return;
 }
 const anchor='function nC(e,t,n,r,i,a,o){',result='return QS(e,l[0],c,a)}function rC',call='nC(e,t,n,r,i,a,`Loft section ${o+1}`)';
 for(const key of [anchor,result,call])if(code.split(key).length!==2)throw Error('Review spline loft integration against the pinned CAD engine');
 await update(code.replace(anchor,loftSectionProfile.toString()+'\nfunction nC(e,t,n,r,i,a,o,ruled){').replace(result,'return QS(e,ruled?loftSectionProfile(l[0]):l[0],c,a)}function rC').replace(call,'nC(e,t,n,r,i,a,`Loft section ${o+1}`,nModeRuled)').replace('let o=n.data.sections,s=o.map','let nModeRuled=n.data.mode==="ruled",o=n.data.sections,s=o.map'));
}
