import * as T from 'three';

const faces = [
  {name:'Right',normal:[1,0,0],up:[0,1,0],color:'#496e91',points:[[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]]},
  {name:'Left',normal:[-1,0,0],up:[0,1,0],color:'#496e91',points:[[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]},
  {name:'Top',normal:[0,1,0],up:[0,0,-1],color:'#7392ab',points:[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]},
  {name:'Bottom',normal:[0,-1,0],up:[0,0,1],color:'#7392ab',points:[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]},
  {name:'Front',normal:[0,0,1],up:[0,1,0],color:'#567f9e',points:[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]},
  {name:'Back',normal:[0,0,-1],up:[0,1,0],color:'#567f9e',points:[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]},
];
const iso=[1,.75,1];

// The cube uses the same Y-up world frame as the desktop plane picker.
// Projecting its faces avoids a second WebGL context and keeps labels readable.
export function initDesktopViewCube(studio){
 const root=document.createElement('section');root.id='cad-view-cube';root.setAttribute('aria-label','View orientation');
 root.innerHTML='<div class="view-cube-heading"><span>VIEW</span><button type="button" class="view-cube-home" title="Isometric view" aria-label="Isometric view">⌂</button></div><svg class="view-cube-control" viewBox="0 0 120 110" tabindex="0" role="group" aria-label="Rotate view cube" aria-describedby="view-cube-help"></svg><select aria-label="Standard view"><option value="custom">Custom view</option><option value="Isometric">Isometric</option>'+faces.map(f=>`<option>${f.name}</option>`).join('')+'</select><span id="view-cube-help">Drag to rotate · click a face</span>';
 studio.container.append(root);
 const svg=root.querySelector('svg'),select=root.querySelector('select'),ns='http://www.w3.org/2000/svg';
 const groups=faces.map(face=>{const g=document.createElementNS(ns,'g'),polygon=document.createElementNS(ns,'polygon'),label=document.createElementNS(ns,'text');g.dataset.face=face.name;g.setAttribute('role','button');g.setAttribute('aria-label',face.name+' view');g.setAttribute('tabindex','0');polygon.setAttribute('fill',face.color);label.textContent=face.name.toUpperCase();g.append(polygon,label);svg.append(g);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();snap(face.name);}});return {face,g,polygon,label};});
 let drag=null,lastCamera=null,lastQuaternion=new T.Quaternion(0,0,0,0),disposed=false;
 function syncOrbitUp(){studio.controls._quat?.setFromUnitVectors(studio.camera.up,new T.Vector3(0,1,0));studio.controls._quatInverse?.copy(studio.controls._quat).invert();}
 function prepare(){studio.endAll();if(studio.planeView?.isFlat||studio.planeView?.editing)studio.returnToModelView();}
 function changed(){studio.camera.updateMatrixWorld(true);studio.controls.update();render();}
 function snap(name){prepare();const face=faces.find(f=>f.name===name),direction=new T.Vector3(...(face?.normal||iso)).normalize(),distance=Math.max(.001,studio.camera.position.distanceTo(studio.controls.target));studio.camera.up.fromArray(face?.up||[0,1,0]);studio.camera.position.copy(studio.controls.target).addScaledVector(direction,distance);studio.camera.lookAt(studio.controls.target);syncOrbitUp();changed();select.value=name;}
 function render(){const camera=studio.camera;if(lastCamera===camera&&lastQuaternion.equals(camera.quaternion))return;lastCamera=camera;lastQuaternion.copy(camera.quaternion);const inverse=camera.quaternion.clone().invert(),project=p=>new T.Vector3(...p).applyQuaternion(inverse),ordered=[];
  for(const item of groups){const n=project(item.face.normal);item.g.style.display=n.z>.002?'':'none';if(n.z<=.002)continue;const points=item.face.points.map(project),center=points.reduce((a,p)=>a.add(p),new T.Vector3()).multiplyScalar(.25);item.polygon.setAttribute('points',points.map(p=>`${60+p.x*24},${55-p.y*24}`).join(' '));item.label.setAttribute('x',String(60+center.x*24));item.label.setAttribute('y',String(55-center.y*24));ordered.push({g:item.g,z:center.z});}
  ordered.sort((a,b)=>a.z-b.z).forEach(({g})=>svg.append(g));
  const offset=camera.position.clone().sub(studio.controls.target).normalize(),face=faces.find(f=>offset.dot(new T.Vector3(...f.normal))>.99999),isometric=offset.dot(new T.Vector3(...iso).normalize())>.99999;select.value=face?.name||(isometric?'Isometric':'custom');
 }
 function rotate(dx,dy){const camera=studio.camera,q=camera.quaternion.clone(),up=new T.Vector3(0,1,0).applyQuaternion(q),right=new T.Vector3(1,0,0).applyQuaternion(q),turn=new T.Quaternion().setFromAxisAngle(up,-dx*.012).premultiply(new T.Quaternion().setFromAxisAngle(right,-dy*.012)),offset=camera.position.clone().sub(studio.controls.target).applyQuaternion(turn);camera.position.copy(studio.controls.target).add(offset);camera.up.applyQuaternion(turn).normalize();camera.lookAt(studio.controls.target);syncOrbitUp();changed();}
 svg.addEventListener('pointerdown',e=>{if(e.button!==0||drag)return;e.preventDefault();e.stopPropagation();prepare();drag={id:e.pointerId,x:e.clientX,y:e.clientY,total:0,face:e.target.closest('[data-face]')?.dataset.face,controlsEnabled:studio.controls.enabled};studio.controls.enabled=false;svg.setPointerCapture(e.pointerId);svg.classList.add('dragging');});
 svg.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.total+=Math.hypot(dx,dy);drag.x=e.clientX;drag.y=e.clientY;if(drag.total>3)rotate(dx,dy);});
 function finish(e){if(!drag||drag.id!==e.pointerId)return;const previous=drag;drag=null;studio.controls.enabled=previous.controlsEnabled;svg.classList.remove('dragging');if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);if(e.type==='pointerup'&&previous.total<=3&&previous.face)snap(previous.face);}
 svg.addEventListener('pointerup',finish);svg.addEventListener('pointercancel',finish);svg.addEventListener('lostpointercapture',finish);
 svg.addEventListener('keydown',e=>{if(e.target!==svg)return;const delta={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]}[e.key];if(delta){e.preventDefault();e.stopPropagation();prepare();rotate(...delta);}else if(e.key==='Home'){e.preventDefault();snap('Isometric');}});
 root.querySelector('.view-cube-home').onclick=()=>snap('Isometric');select.onchange=()=>{if(select.value!=='custom')snap(select.value);};
 // Camera instances also change when entering/leaving an orthographic sketch.
 studio.controls.addEventListener('change',render);const timer=setInterval(render,150);render();
 function dispose(){if(disposed)return;disposed=true;clearInterval(timer);studio.controls.removeEventListener('change',render);if(drag)studio.controls.enabled=drag.controlsEnabled;root.remove();}
 window.addEventListener('pagehide',dispose,{once:true});const api={snap,render,dispose};studio.viewCube=api;return api;
}
