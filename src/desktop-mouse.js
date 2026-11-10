import {drawingView} from './sketch-projection.js';
import {planeDrawingSafety,viewAlignedPlane} from './desktop-plane-safety.js';
import * as T from 'three';
// Canvas-only gestures leave dimensions, forms and explicit selection controls alone.
export function initDesktopMouse({studio,store,isFlat}) {
 const canvas=studio.renderer.domElement,root=studio.container;
 let zoom=null,switching=false;
 let lastCapture=null;
 const isCanvas=e=>e.target===canvas&&!studio.renderer.xr.isPresenting;
 const viewPlane=document.createElement('button');viewPlane.id='desktop-view-plane';viewPlane.textContent='View plane through origin';viewPlane.title='Create a plane through the design origin, parallel to this view';viewPlane.onclick=()=>void studio.planeEditor.createViewPlane();document.querySelector('#cad-plane-picker')?.append(viewPlane);
 root.addEventListener('pointerdown',e=>{
  if(!isCanvas(e)||e.button!==0)return;
  studio.desktopInkFrame=null;
  if(!['draw','pen','line','circle','rectangle','reference'].includes(studio.desktopDrawing.mode==='pen'?studio.mode:studio.desktopDrawing.mode)||studio.surface?.selected?.scope==='body')return;
  const plane=studio.surface?.selected?.frame||studio.desktopPlane;
  const safety=planeDrawingSafety(plane,studio.camera.getWorldDirection(new T.Vector3()).toArray());
  if(safety.allowed)return;
  if(studio.desktopDrawing.mode==='pen'&&!studio.surface?.selected&&(studio.decisionLab?.autoPreview||!studio.desktopPlaneExplicit)){
   // Side-on rays cannot intersect the support reliably. Capture pixels at a
   // stable depth without changing the grid, active sketch or chosen support.
   const frame=viewAlignedPlane(drawingView(studio),studio.controls.target.toArray(),{name:'Ink capture'});
   if(!lastCapture||!['origin','xAxis','yAxis'].every(k=>frame[k].every((v,i)=>Math.abs(v-lastCapture[k][i])<1e-7)))lastCapture={...frame,id:'ink-view-'+crypto.randomUUID()};
   studio.desktopInkFrame=lastCapture;return;
  }
  studio.endAll();studio.cursor.visible=false;document.querySelector('#cad-plane-status').textContent=safety.message;
  e.preventDefault();e.stopImmediatePropagation();
 },true);
 for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>{studio.desktopInkFrame=null;});
 const automatic=document.createElement('button');automatic.id='desktop-draw-auto';automatic.textContent='Automatic';automatic.title='Draw in this view; let AI infer a suitable plane or surface';document.querySelector('#cad-plane-picker')?.append(automatic);
 automatic.onclick=()=>{studio.endAll();studio.planeView?.finish(false);studio.surface?.clear();studio.nativeSelection?.clear();studio.desktopPlaneExplicit=false;studio.desktopDrawing.setMode('select');togglePen();const label=document.querySelector('#cad-active-plane');if(label)label.textContent='Automatic · AI chooses support';};
 async function cursor(){if(switching)return;switching=true;try{studio.endAll();await studio.decisionLab?.acceptForEditing();studio.desktopEditing?.setMode('cad');studio.desktopDrawing.setMode('select');studio.cursor.visible=false;}finally{switching=false;}}
 async function togglePen(){
  if(studio.mode==='draw'){await cursor();return;}
  if(switching)return;studio.decisionLab?.pauseAutoAccept();studio.planeEditor?.detach();studio.desktopEditing?.setMode('drawing');
  studio.objects?.setEnabled(false);
  if(studio.nativeSelection?.summary()?.faceIndices?.length){studio.nativeSelection.drawOnFace();return;}
  studio.desktopDrawing.setMode('pen');
 }
 root.addEventListener('dblclick',e=>{if(!isCanvas(e)||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();void togglePen().catch(error=>{document.querySelector('#cad-tool-status').textContent=error.message;});},true);
 root.addEventListener('pointerdown',e=>{
  if(!isCanvas(e)||e.button!==1)return;studio.endAll();
  // OrbitControls swaps ROTATE/PAN with Ctrl. Shift is zoom, not that swap.
  studio.controls.mouseButtons.MIDDLE=e.shiftKey&&!e.ctrlKey?T.MOUSE.DOLLY:T.MOUSE.ROTATE;
  if(isFlat()&&!e.shiftKey){studio.controls.mouseButtons.MIDDLE=e.ctrlKey?T.MOUSE.ROTATE:T.MOUSE.PAN;}
  if(e.shiftKey&&!e.ctrlKey){e.preventDefault();e.stopImmediatePropagation();zoom={id:e.pointerId,y:e.clientY};canvas.setPointerCapture(e.pointerId);}
 },true);
 root.addEventListener('pointermove',e=>{if(!zoom||e.pointerId!==zoom.id)return;e.preventDefault();e.stopImmediatePropagation();const factor=Math.exp((e.clientY-zoom.y)*.008);zoom.y=e.clientY;const camera=studio.camera;if(camera.isOrthographicCamera){camera.zoom=T.MathUtils.clamp(camera.zoom/factor,.02,100);camera.updateProjectionMatrix();}else{const offset=camera.position.clone().sub(studio.controls.target),distance=T.MathUtils.clamp(offset.length()*factor,.01,1000);camera.position.copy(studio.controls.target).add(offset.setLength(distance));}studio.controls.update();studio.onChange();},true);
 const end=e=>{if(!zoom||e.pointerId!==zoom.id)return;zoom=null;e.preventDefault();e.stopImmediatePropagation();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);};
 root.addEventListener('pointerup',end,true);root.addEventListener('pointercancel',end,true);root.addEventListener('lostpointercapture',()=>{zoom=null;},true);
 studio.desktopMouse={togglePen,cursor,get penEnabled(){return studio.mode==='draw';}};
 return studio.desktopMouse;
}
