import * as T from 'three';
import {viewportManipulator} from './viewport-manipulator.js';

export function bodyManipulator(studio,inputs,commit){
 const pivot=new T.Group(),start=new T.Vector3(),handle=viewportManipulator(studio,{change:values,detached:removeOutline,end:changed=>{if(changed)void commit();}});
 studio.scene.add(pivot);let outline;
 function clear(){handle.detach();removeOutline();}
 function removeOutline(){if(outline){pivot.remove(outline);outline.geometry.dispose();outline.material.dispose();outline=null;}studio.onChange();}
 function select(bodyId){
  clear();const model=studio.surfaceModels?.().find(m=>m.nativeId===bodyId&&!m.hidden);
  if(!model)return;
  const mesh=model.mesh;mesh.updateWorldMatrix(true,false);
  new T.Box3().setFromObject(mesh).getCenter(start);pivot.position.copy(start);pivot.quaternion.identity();pivot.updateMatrixWorld(true);
  outline=new T.LineSegments(new T.EdgesGeometry(mesh.geometry,25),new T.LineBasicMaterial({color:0xa5d9c1,transparent:true,opacity:.7,depthTest:false}));
  outline.matrixAutoUpdate=false;outline.matrix.copy(pivot.matrixWorld).invert().multiply(mesh.matrixWorld);pivot.add(outline);
  handle.attach(pivot);studio.onChange();
 }
 function values(){
  const shift=pivot.position.clone().sub(start).multiplyScalar(1000).toArray();
  const angles=pivot.rotation.toArray().slice(0,3).map(T.MathUtils.radToDeg);
  for(const [key,values] of [['translation',shift],['rotation',angles]])values.forEach((v,i)=>inputs[key][i].value=v.toFixed(2));
  studio.onChange();
 }
 function fromFields(){
  pivot.position.copy(start).add(new T.Vector3(...inputs.translation.map(i=>(i.valueAsNumber||0)/1000)));
  pivot.rotation.set(...inputs.rotation.map(i=>T.MathUtils.degToRad(i.valueAsNumber||0)));studio.onChange();
 }
 for(const input of Object.values(inputs).flat())input.addEventListener('input',fromFields);
 window.addEventListener('pagehide',()=>{clear();},{once:true});
 return {select,clear};
}
