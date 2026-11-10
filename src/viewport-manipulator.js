import {Raycaster,Vector2} from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';

// Both helpers share one pivot. A single pointer owner prevents a ring and an
// arrow from starting two overlapping edits or passing the release to a sketch.
export function viewportManipulator(studio,{space='world',change,begin,end,detached}={}){
 const canvas=studio.renderer.domElement,ray=new Raycaster(),pointer=new Vector2();
 const controls=['translate','rotate'].map(mode=>{
  const c=new TransformControls(studio.camera);
  c.setSpace(space);c.setMode(mode);c.setSize(mode==='translate'?1.04:.71);
  const helper=c.getHelper();helper.name='Placement '+mode;studio.scene.add(helper);
  // Show only the three axis arrows and their corresponding rotation arcs.
  for(const group of [c._gizmo.gizmo[mode],c._gizmo.picker[mode]])
   for(const child of [...group.children])if(!['X','Y','Z'].includes(child.name))group.remove(child);
  c.addEventListener('objectChange',()=>{changed=true;change?.();studio.onChange();});return c;
 });
 let owner=null,target=null,pointerId=null,changed=false,blockClick=false,orbitWasEnabled=true;
 const abort=new AbortController(),opts={capture:true,signal:abort.signal};
 function coords(e){const r=canvas.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);pointer.button=e.button;return pointer;}
 function pick(e){
  const p=coords(e);ray.setFromCamera(p,studio.camera);let best=null;
  for(const c of controls){
   c.camera=studio.camera;c.getHelper().updateMatrixWorld(true);
   const hit=ray.intersectObjects(c._gizmo.picker[c.mode].children,false).find(h=>h.object.visible);
   if(hit&&(!best||hit.distance<best.hit.distance))best={c,hit};
  }
  for(const c of controls)c.axis=c===best?.c?best.hit.object.name:null;
  canvas.dataset.transformHandle=best?best.c.mode+'-'+best.hit.object.name:'';return best?.c;
 }
 function stop(e){e.preventDefault();e.stopImmediatePropagation();}
 window.addEventListener('pointerdown',e=>{
  if(e.target!==canvas||!target||e.button!==0||owner||studio.decisionLab?.busy)return;
  const c=pick(e);if(!c)return;
  c.pointerDown(coords(e));if(!c.dragging)return;
  owner=c;changed=false;pointerId=e.pointerId;blockClick=true;orbitWasEnabled=studio.controls.enabled;studio.controls.enabled=false;
  canvas.setPointerCapture(pointerId);begin?.();stop(e);
 },opts);
 window.addEventListener('pointermove',e=>{
  if(!target||e.target!==canvas)return;
  if(owner&&e.pointerId===pointerId){owner.pointerMove(coords(e));stop(e);}
  else if(!owner&&!e.buttons)pick(e);
 },opts);
 function release(e,cancel=false){
  if(!owner||e.pointerId!==pointerId)return;
  const active=owner,dirty=changed;owner=null;
  if(cancel)active.reset();
  active.pointerUp(null);if(canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);
  studio.controls.enabled=orbitWasEnabled;pointerId=null;stop(e);end?.(dirty&&!cancel,active.mode);setTimeout(()=>{blockClick=false;},0);
 }
 window.addEventListener('pointerup',e=>release(e),opts);
 window.addEventListener('pointercancel',e=>release(e,true),opts);
 window.addEventListener('click',e=>{if(e.target===canvas&&blockClick){blockClick=false;stop(e);}},opts);
 const api={attach(obj){
  studio.activePlacement?.detach();target=obj;studio.activePlacement=api;
  for(const c of controls){c.camera=studio.camera;c.attach(obj);}studio.onChange();
 },detach(){
  if(owner){owner.reset();owner.pointerUp(null);owner=null;studio.controls.enabled=orbitWasEnabled;if(canvas.hasPointerCapture(pointerId))canvas.releasePointerCapture(pointerId);pointerId=null;}
  const hadTarget=!!target;target=null;if(hadTarget)delete canvas.dataset.transformHandle;for(const c of controls)c.detach();if(hadTarget)detached?.();if(studio.activePlacement===api)studio.activePlacement=null;studio.onChange();
 },get object(){return target;},get axis(){return controls.find(c=>c.axis)?.axis;},get dragging(){return !!owner;}};
 window.addEventListener('pagehide',()=>{abort.abort();api.detach();for(const c of controls){studio.scene.remove(c.getHelper());c.getHelper().dispose();}},{once:true});
 return api;
}
