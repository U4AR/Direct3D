import {viewAlignedPlane} from './desktop-plane-safety.js';
import {drawingView} from './sketch-projection.js';
import {constructSketchPlane} from './plane-construction.js';

import * as T from 'three';

import {viewportManipulator} from './viewport-manipulator.js';

export function initDesktopPlanes(studio,store){

 const base=[0,1.15,-.6],saved=store.session.desktopPlanes||=[{id:'plane-front',name:'Front · XY',origin:base,xAxis:[1,0,0],yAxis:[0,1,0],normal:[0,0,1]},{id:'plane-top',name:'Top · XZ',origin:base,xAxis:[1,0,0],yAxis:[0,0,-1],normal:[0,1,0]},{id:'plane-right',name:'Right · YZ',origin:base,xAxis:[0,0,-1],yAxis:[0,1,0],normal:[1,0,0]}];

 const vec=a=>new T.Vector3(...a),matrix=f=>new T.Matrix4().makeBasis(vec(f.xAxis),vec(f.yAxis),vec(f.normal)).setPosition(vec(f.origin));

 function anchor(p){return p.anchor||vec(p.origin).addScaledVector(vec(p.normal),-vec(p.origin).sub(vec(base)).dot(vec(p.normal))).toArray();}

 if(!studio.desktopPlane.id)studio.setDesktopPlane({...studio.desktopPlane,id:'plane-front'});

 const panel=document.createElement('section');panel.id='cad-plane-editor';panel.innerHTML='<h2>1 · Choose a plane</h2><select id="cad-plane-library" aria-label="Drawing plane"></select><label>Offset (mm) <input id="cad-plane-distance" type="number" value="0" step="1"></label><p>Move perpendicular to this plane.</p><div class="two-buttons"><button id="cad-plane-apply">Set offset</button><button id="cad-plane-move">Drag offset</button></div><button id="cad-plane-rotate">Rotate plane</button><button id="cad-plane-sketch">2 · Sketch on this plane</button><details id="cad-new-plane"><summary>New plane…</summary><div class="cad-plane-bases" aria-label="Base planes"><button data-plane-base="plane-front">XY</button><button data-plane-base="plane-top">XZ</button><button data-plane-base="plane-right">YZ</button></div><label>Base plane <select id="cad-plane-base"></select></label><label>Offset (mm) <input id="cad-plane-new-offset" type="number" value="0" step="1"></label><div class="two-buttons"><label>X tilt (°) <input id="cad-plane-angle-x" type="number" value="0" min="-360" max="360" step="1"></label><label>Y tilt (°) <input id="cad-plane-angle-y" type="number" value="0" min="-360" max="360" step="1"></label></div><label>Name <input id="cad-plane-name" placeholder="New plane"></label><p>Offset along the base normal. Tilt around local X, then local Y.</p><button id="cad-plane-create">Create plane</button><button id="cad-plane-cancel">Cancel</button></details><p id="cad-plane-status" role="status">Select a plane, sketch, then ask AI to refine it.</p>';document.querySelector('#cad-model-history').after(panel);

 const baseSelect=panel.querySelector('#cad-plane-base');

 const select=panel.querySelector('#cad-plane-library'),distance=panel.querySelector('#cad-plane-distance'),status=panel.querySelector('#cad-plane-status');

 const proxy=new T.Object3D();studio.scene.add(proxy);let before=null,applying=false;
 const controls=viewportManipulator(studio,{space:'local',
  begin(){before=structuredClone(studio.desktopPlane);},
  change(){if(before)studio.setDesktopPlane(manipulatedFrame());},
  end(changed){if(!before)return;const next=manipulatedFrame();studio.setDesktopPlane(before);if(changed)void apply(next,before);}
 });studio.planeGizmo=controls;

 function refresh(){const priorBase=baseSelect.value;baseSelect.replaceChildren(...saved.map(p=>new Option(p.name,p.id)));baseSelect.value=saved.some(p=>p.id===priorBase)?priorBase:studio.desktopPlane.id;select.replaceChildren(...saved.map(p=>new Option(p.name,p.id)));select.value=studio.desktopPlane.id;distance.value=(vec(studio.desktopPlane.origin).sub(vec(anchor(studio.desktopPlane))).dot(vec(studio.desktopPlane.normal))*1000).toFixed(2);proxy.position.fromArray(studio.desktopPlane.origin);proxy.quaternion.setFromRotationMatrix(matrix(studio.desktopPlane));}

 async function moveAttached(old,next){
  const delta=matrix(next).multiply(matrix(old).invert()),transform=a=>vec(a).applyMatrix4(delta).toArray(),direction=a=>vec(a).transformDirection(delta).toArray(),figures=studio.desktopDrawing.summary().filter(f=>f.planeId===old.id),ids=new Set(figures.map(f=>f.id));
  const components=figures.map(f=>{const constraints=structuredClone(store.session.decisionSketches?.find(m=>m.figureId===f.id)?.constraints||{closed:!!f.closed,symmetry:'none'});for(const c of constraints.connections||[])if(ids.has(c.referenceId)){c.targetPoint=transform(c.targetPoint);if(c.referencePoint)c.referencePoint=transform(c.referencePoint);if(c.directionWorld)c.directionWorld=direction(c.directionWorld);}return {figure:{...f,origin:transform(f.origin),xAxis:direction(f.xAxis||[1,0,0]),yAxis:direction(f.yAxis||[0,1,0]),...(f.end?{end:transform(f.end)}:{}),planeId:next.id,dimensionNote:'Placement updated with reference plane'},constraints};});
  if(components.length)await studio.desktopDrawing.commitComponents(components,{recordHistory:false});
  for(const s of store.session.strokes.filter(s=>(s.drawingPlane||s.plane)?.id===old.id)){s.points=s.points.map(transform);s.drawingPlane=structuredClone(next);if(s.plane)s.plane=structuredClone(next);for(const key of ['view','endView'])if(s[key]?.cameraToWorld)s[key].cameraToWorld=delta.clone().multiply(new T.Matrix4().fromArray(s[key].cameraToWorld)).toArray();if(s.drawingTarget?.referencePlane)s.drawingTarget.referencePlane=structuredClone(next);delete s.localFit;const mesh=studio.strokeMeshes.get(s.id);mesh?.removeFromParent();mesh?.geometry.dispose();mesh?.material.dispose();studio.addStrokeMesh(s);try{await studio.strokeWorkflow.fit(s,{force:true});}catch(error){store.log('plane.stroke-fit.failed',{strokeId:s.id,error:error.message});}}
  studio.desktopSketches?.movePlane(next);store.session.revision++;
 }
 async function apply(frame,old=studio.desktopPlane){
  if(applying)return;if(studio.modelAgent?.busy||studio.desktopDrawing.working||studio.decisionLab?.applying){status.textContent='Wait for the current edit before moving the plane';return;}studio.decisionLab?.invalidate('Plane moved');if(frame.surfaceAttachment)frame={...frame,surfaceAttachment:{...frame.surfaceAttachment,offsetMetres:vec(frame.origin).sub(vec(frame.surfaceAttachment.frame.origin)).dot(vec(frame.normal))}};applying=true;const prior=structuredClone(saved.find(p=>p.id===frame.id));
  try{await studio.desktopHistory.before();studio.setDesktopPlane(frame);const index=saved.findIndex(p=>p.id===frame.id);if(index<0)saved.push(structuredClone(frame));else saved[index]=structuredClone(frame);await moveAttached(old,frame);await store.flush();await studio.desktopHistory.capture('Move or rotate plane '+frame.name);store.log('plane.move',{planeId:frame.id,from:old.origin,to:frame.origin});status.textContent='Plane updated. Its sketches moved with it.';}
  catch(e){studio.setDesktopPlane(old);const index=saved.findIndex(p=>p.id===frame.id);if(index>=0){if(prior)saved[index]=prior;else saved.splice(index,1);}studio.desktopSketches?.movePlane(old);status.textContent=e.message;}
  finally{applying=false;refresh();studio.onChange();}
 }

 function offsetFrame(){const d=Number(distance.value)/1000;if(!Number.isFinite(d))throw Error('Enter a finite offset');const p=studio.desktopPlane,a=anchor(p);return {...p,anchor:a,origin:vec(a).addScaledVector(vec(p.normal),d).toArray()};}

 function choose(id){controls.detach();const p=saved.find(p=>p.id===id);if(p){studio.desktopPlaneExplicit=true;studio.surface?.clear();studio.nativeSelection?.clear();studio.setDesktopPlane(structuredClone(p));studio.desktopDrawing.setMode('select');refresh();if(!panel.querySelector('#cad-new-plane').open)baseSelect.value=id;}}

 select.onchange=()=>{choose(select.value);startMove();};panel.querySelector('#cad-plane-apply').onclick=()=>{if(studio.modelAgent.busy){status.textContent='Stop AI before moving the plane.';return;}try{void apply(offsetFrame());}catch(e){status.textContent=e.message;}};

 const constructionPreview=new T.Group();constructionPreview.name='New plane preview';studio.scene.add(constructionPreview);

 function clearConstruction(){for(const o of [...constructionPreview.children]){o.removeFromParent();o.geometry.dispose();o.material.dispose();}studio.onChange();}

 function proposed(){const base=saved.find(p=>p.id===baseSelect.value);if(!base)throw Error('Select a base plane');return constructSketchPlane(base,{offsetMetres:Number(panel.querySelector('#cad-plane-new-offset').value)/1000,angleXDegrees:Number(panel.querySelector('#cad-plane-angle-x').value),angleYDegrees:Number(panel.querySelector('#cad-plane-angle-y').value)});}

 function previewConstruction(){clearConstruction();if(!panel.querySelector('#cad-new-plane').open)return;try{const p=proposed(),mesh=new T.Mesh(new T.PlaneGeometry(.35,.35),new T.MeshBasicMaterial({color:0x70f2c6,side:T.DoubleSide,transparent:true,opacity:.12,depthWrite:false})),border=new T.LineSegments(new T.EdgesGeometry(mesh.geometry),new T.LineBasicMaterial({color:0x70f2c6,transparent:true,opacity:.8}));for(const o of [mesh,border]){o.matrixAutoUpdate=false;o.matrix.copy(matrix(p));constructionPreview.add(o);}studio.onChange();status.textContent='Plane preview · '+panel.querySelector('#cad-plane-new-offset').value+' mm offset';}catch(e){status.textContent=e.message;}}

 panel.querySelector('#cad-new-plane').addEventListener('toggle',previewConstruction);

 for(const id of ['base','new-offset','angle-x','angle-y'])panel.querySelector('#cad-plane-'+id).addEventListener('input',previewConstruction);

 panel.querySelectorAll('[data-plane-base]').forEach(button=>button.onclick=()=>{baseSelect.value=button.dataset.planeBase;previewConstruction();});

 panel.querySelector('#cad-plane-cancel').onclick=()=>{panel.querySelector('#cad-new-plane').open=false;clearConstruction();};

 panel.querySelector('#cad-plane-create').onclick=async()=>{if(studio.modelAgent.busy)return;try{const p=proposed();await studio.desktopHistory.before();p.id=crypto.randomUUID();p.name=panel.querySelector('#cad-plane-name').value.trim()||'Plane '+(saved.length+1);saved.push(p);studio.desktopPlaneExplicit=true;studio.setDesktopPlane(p);await store.flush();await studio.desktopHistory.capture('Create plane '+p.name);panel.querySelector('#cad-new-plane').open=false;clearConstruction();refresh();startMove();status.textContent='Plane created. Click Sketch on this plane to begin.';}catch(e){status.textContent=e.message;}};

 panel.querySelector('#cad-plane-sketch').onclick=()=>{controls.detach();studio.beginSketch();};

 function startMove(mode='translate'){
  if(studio.modelAgent?.busy||studio.desktopDrawing.working||studio.decisionLab?.applying){status.textContent='Wait for the current edit before moving the plane.';return;}
  studio.decisionLab?.invalidate('Plane selected for movement');
  studio.desktopEditing?.setMode('cad');studio.desktopDrawing.setMode('select');
  before=structuredClone(studio.desktopPlane);refresh();
  controls.attach(proxy);
  status.textContent='Drag an axis arrow to move or a ring to turn the plane.';
 }
 panel.querySelector('#cad-plane-move').onclick=()=>startMove();
 panel.querySelector('#cad-plane-rotate').onclick=()=>startMove('rotate');
 function manipulatedFrame(){
  const origin=proxy.position.toArray();
  if(proxy.quaternion.angleTo(new T.Quaternion().setFromRotationMatrix(matrix(before)))<1e-7)return {...before,anchor:anchor(before),origin};
  const rotated=a=>vec(a).applyQuaternion(proxy.quaternion).toArray();
  const normal=rotated([0,0,1]),distance=vec(before.origin).sub(vec(anchor(before))).dot(vec(before.normal));
  return {...before,origin,xAxis:rotated([1,0,0]),yAxis:rotated([0,1,0]),normal,anchor:vec(origin).addScaledVector(vec(normal),-distance).toArray()};
 }
 window.addEventListener('draw3d-plane-changed',()=>{if(!controls.dragging)refresh();});const api={refresh,choose,startMove,apply,get moving(){return applying||controls.dragging;},async createViewPlane(){try{if(studio.modelAgent?.busy||studio.decisionLab?.busy)throw Error('Wait for the current edit before creating a plane');const frame=viewAlignedPlane(drawingView(studio),base,{id:crypto.randomUUID(),name:'View plane '+(saved.length-2)});await studio.desktopHistory.before();studio.planeView?.finish(false);saved.push(frame);studio.desktopPlaneExplicit=true;studio.setDesktopPlane(frame);studio.planeView.editPlane(frame.id);await store.flush();await studio.desktopHistory.capture('Create view plane through origin');refresh();status.textContent='View-aligned plane through the design origin · ready to draw';return frame;}catch(e){status.textContent=e.message;}},restore(planes,active){saved.splice(0,saved.length,...planes);studio.setDesktopPlane(active);refresh();},detach:()=>controls.detach()};studio.planeEditor=api;refresh();return api;

}

