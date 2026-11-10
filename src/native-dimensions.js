import {add,mul,sub,mean,unit,cross,len} from './drawing-math.js';
const XYZ=[[1,0,0],[0,1,0],[0,0,1]];
export function nativeDimensionDescriptors(model){
 const bounds=model.blender?.metrics?.bounds||model.mesh?.geometry?.boundingBox;if(!bounds)return [];
 const min=Array.isArray(bounds.min)?bounds.min:bounds.min.toArray(),max=Array.isArray(bounds.max)?bounds.max:bounds.max.toArray(),size=min.map((v,i)=>max[i]-v),center=mean([min,max]),span=Math.max(.01,Math.hypot(...size)),gap=span*.12,out=[];
 const descriptor=(featureIndex,parameter,title,value,{component=null,multiplier=1,axis=0,axes=XYZ,origin=center,sizes=size,unitLabel='mm',editMode=null}={})=>{if(!Number.isFinite(value)||value<=0)return;const u=axes[axis],v=axes[(axis+1)%3],offset=mul(v,(sizes[(axis+1)%3]||0)/2+gap*(1+out.length*.15)),c=add(origin,offset),half=unitLabel==='mm'?value/2:span/3;out.push({key:featureIndex+':'+parameter+':'+component,title,value,unit:unitLabel,featureIndex,parameter,component,multiplier,editable:featureIndex>=0,editMode,segment:[add(c,mul(u,-half)),add(c,mul(u,half))]});};
 for(const [i,f]of (model.blender?.features||[]).entries()){
  const p=f.parameters||{},axes=p.axes||XYZ,origin=p.center||center;
  if(f.operation==='create_cube'||['extract_region','split_region'].includes(f.operation)&&p.regionType==='box')for(let axis=0;axis<3;axis++)descriptor(i,'sizeMetres',(f.operation==='create_cube'?['Width','Height','Depth']:['Region width','Region height','Region depth'])[axis],p.sizeMetres?.[axis],{component:axis,axis,axes,origin,sizes:p.sizeMetres});
  if(['create_sphere','create_cylinder','create_torus','create_sketch','hole','hole_pattern','thread','create_helix','create_cone','create_pipe'].includes(f.operation)&&p.radiusMetres)descriptor(i,'radiusMetres',f.operation==='create_torus'?'Ring diameter':f.operation.startsWith('hole')?'Hole diameter':'Diameter',p.radiusMetres*2,{multiplier:2,axes,origin});
  if(f.operation==='create_sketch'&&p.profilePoints?.length){const revolved=(model.blender.features||[]).slice(i+1).some(f=>f.operation==='revolve'&&Math.abs(f.parameters?.direction?.[1]||0)>.999)&&p.profilePoints.every(p=>p[0]>=0);const lo=[0,1].map(a=>Math.min(...p.profilePoints.map(v=>v[a]))),hi=[0,1].map(a=>Math.max(...p.profilePoints.map(v=>v[a]))),sizes=[hi[0]-lo[0],hi[1]-lo[1],0],o=add(origin,add(mul(axes[0],(lo[0]+hi[0])/2),mul(axes[1],(lo[1]+hi[1])/2)));if(revolved){descriptor(i,'profilePoints','Diameter',hi[0]*2,{axis:0,component:0,multiplier:2,axes,origin:add(origin,mul(axes[1],(lo[1]+hi[1])/2)),sizes:[hi[0]*2,sizes[1],0],editMode:'profile-radius'});descriptor(i,'profilePoints','Height',sizes[1],{axis:1,component:1,axes,origin:o,sizes,editMode:'profile-size'});}else for(let axis=0;axis<2;axis++)descriptor(i,'profilePoints',['Profile width','Profile height'][axis],sizes[axis],{axis,component:axis,axes,origin:o,sizes,editMode:'profile-size'});}
  if(['thread','create_helix'].includes(f.operation)){descriptor(i,'pitchMetres','Thread pitch',p.pitchMetres,{axes,origin});descriptor(i,'heightMetres','Thread length',p.heightMetres,{axis:1,axes,origin});if(p.threadDepthMetres)descriptor(i,'threadDepthMetres','Thread depth',p.threadDepthMetres,{axes,origin});}
  if(f.operation==='create_sketch'&&p.profileType){descriptor(i,'widthMetres','Profile width',p.widthMetres,{axes,origin});descriptor(i,'heightMetres','Profile height',p.heightMetres,{axis:1,axes,origin});if(p.cornerRadiusMetres)descriptor(i,'cornerRadiusMetres','Corner radius',p.cornerRadiusMetres,{axes,origin});}
  if(f.operation==='create_cone'&&p.topRadiusMetres)descriptor(i,'topRadiusMetres','Top diameter',p.topRadiusMetres*2,{multiplier:2,axes,origin});
  if(['create_cylinder','create_cone'].includes(f.operation))descriptor(i,'heightMetres','Height',p.heightMetres,{axis:1,axes,origin});
  if(f.operation==='create_torus')descriptor(i,'minorRadiusMetres','Tube diameter',p.minorRadiusMetres*2,{multiplier:2,axes,origin});
  if(f.operation==='extrude'){const n=unit(p.direction||[0,0,1]),x=unit(cross(Math.abs(n[1])<.9?[0,1,0]:[1,0,0],n)),y=unit(cross(n,x));descriptor(i,'distanceMetres','Extrusion',p.distanceMetres,{axis:2,axes:[x,y,n]});}
  if(f.operation==='offset')descriptor(i,'distanceMetres','Offset',Math.abs(p.distanceMetres),{multiplier:Math.sign(p.distanceMetres)});
  if(f.operation==='draft')descriptor(i,'angleDeg','Draft angle',Math.abs(p.angleDeg),{unitLabel:'°',multiplier:Math.sign(p.angleDeg)});
  if(f.operation==='body_pattern'&&p.patternType==='linear')descriptor(i,'spacingMetres','Pattern spacing',p.spacingMetres);
  if(f.operation==='thicken')descriptor(i,'thicknessMetres','Surface thickness',Math.abs(p.thicknessMetres),{multiplier:Math.sign(p.thicknessMetres)});
  if(f.operation==='revolve')descriptor(i,'angleDeg','Revolution',p.angleDeg,{unitLabel:'°'});
  if(['fillet','chamfer','bevel'].includes(f.operation))descriptor(i,'widthMetres',f.operation==='fillet'?'Fillet radius':f.operation==='chamfer'?'Chamfer':'Bevel',p.widthMetres);
  if(['shell','solidify'].includes(f.operation))descriptor(i,'thicknessMetres','Wall thickness',p.thicknessMetres);
 }
 if(!out.length)for(let axis=0;axis<3;axis++)descriptor(-1,'bounds','Bounds '+['X','Y','Z'][axis],size[axis],{axis});
 return out;
}
export function nativeDimensionChange(descriptor,displayValue,features){
 if(!descriptor.editable)throw Error('Overall bounds are measurements. Edit a native modeling feature to change this body.');
 if(!Number.isFinite(displayValue)||displayValue<=0||displayValue>(descriptor.unit==='°'?360:100000))throw Error('Enter a positive dimension within the supported range.');
 const feature=features[descriptor.featureIndex];if(!feature)throw Error('This feature no longer exists.');const value=descriptor.unit==='mm'?displayValue/1000:displayValue,changed=value/descriptor.multiplier;
 if(descriptor.editMode==='profile-radius'){const points=feature.parameters.profilePoints,ratio=changed/Math.max(...points.map(p=>p[0]));return {featureIndex:descriptor.featureIndex,profilePoints:points.map(([r,y])=>[r*ratio,y])};}
 let parameter=changed;if(descriptor.editMode==='profile-size'){const a=descriptor.component,points=feature.parameters.profilePoints,lo=Math.min(...points.map(p=>p[a])),hi=Math.max(...points.map(p=>p[a])),mid=(lo+hi)/2,ratio=changed/(hi-lo);return {featureIndex:descriptor.featureIndex,profilePoints:points.map(p=>p.map((v,i)=>i===a?mid+(v-mid)*ratio:v))};}if(descriptor.component!==null){parameter=[...feature.parameters[descriptor.parameter]];parameter[descriptor.component]=changed;}
 return {featureIndex:descriptor.featureIndex,[descriptor.parameter]:parameter};
}
