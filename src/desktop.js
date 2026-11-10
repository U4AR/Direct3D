import {planeDrawingSafety} from './desktop-plane-safety.js';
import {initDesktopMouse} from './desktop-mouse.js';
import {initDesktopViewCube} from './desktop-view-cube.js';

import {initDesktopAppearance} from './desktop-appearance.js';

import {initDesktopPlaneView} from './desktop-plane-view.js';

import {initDesktopSketches} from './desktop-sketches.js';

import {initDesktopPlanes} from './desktop-planes.js';

import {initDesktopSelection} from './desktop-selection.js';

import {initDesktopAssist} from './desktop-assist.js';

import * as T from 'three';

import { download } from './storage.js';

import './main.js';

import './desktop.css';

async function openDesktop({detail:{studio,store}}) {

 const decisionLab=new URL(location.href).searchParams.get('experiment')==='decision';

 const $=s=>document.querySelector(s),left=$('.left-panel'),right=$('.right-panel');

 const keep=document.createElement('div');keep.hidden=true;document.body.append(keep);

 for(const child of [...left.children])if(!child.matches('.workspace-tabs,#stroke-workflow,#cad-model-history,#blender-workspace,.tool-tabs')&&!child.querySelector('#brush,#undo,#clear'))keep.append(child);

 for(const child of [...right.children])if(!['cad-properties','cad-sketch-constraints'].includes(child.id))keep.append(child);

 $('#draw').textContent='✎ Pen';$('#draw').title='Pen · double-click canvas to toggle (D)';$('#vr').hidden=true;$('#orbit').hidden=true;$('.project-name').textContent='Desktop';$('.brand').href='/desktop.html';

 const title=document.createElement('div');title.innerHTML='<span class="section-label">Workspace</span><h1>Sketch</h1><p class="muted">Select a plane or face to draw.</p>';left.prepend(title);

 $('#workspace-sketch').textContent='Drawing board';$('.canvas-title').innerHTML='<i></i> Workspace';

 $('#empty-state').innerHTML='<div class="empty-symbol">✎</div><h2>New sketch</h2><p>Select a plane or face to draw.</p>';

 const tools=document.createElement('section');tools.innerHTML='<h2>Canvas</h2><div class="two-buttons"><button id="desktop-flat">2D board</button><button id="desktop-3d" class="selected">3D CAD</button></div><button id="cad-start-sketch">Sketch on selected plane / face</button><button id="desktop-fit">Fit view</button><button id="desktop-svg">Export fitted SVG</button><p class="hint">Double-click · pen on / off<br>Middle drag · rotate<br>Ctrl + middle drag · pan<br>Shift + middle drag / wheel · zoom</p>';left.append(tools);

 const heading=document.createElement('div');heading.innerHTML='<span class="section-label">Assistant</span><h2 class="panel-title">Edit</h2><p class="muted">Describe a change.</p><label for="desktop-output">Create from sketch</label><select id="desktop-output"><option value="auto">Auto · 2D sketch</option><option value="solid">3D CAD model</option><option value="drawing">2D drawing</option></select>';right.append(heading);right.append($("#cad-properties"));

 const panel=$('#agent-panel');panel.hidden=false;right.append(panel);

 const form=panel.querySelector('.instruction-form'),input=form.querySelector('textarea');form.querySelector('label').textContent='What are you making?';input.placeholder='e.g. Clean this into a circle, diameter 80 mm. Or explicitly ask for a 3D part.';form.querySelector('button').hidden=true;

 $('#ai-run').textContent='Send';$('#ai-accept').textContent='Accept this draft';

 const advanced=document.createElement('details');advanced.innerHTML='<summary>Model tools & placement</summary>';advanced.className='desktop-advanced';

 for(const child of [...panel.children])if(!child.matches('.instruction-form,.model-agent-controls,#agent-connection'))advanced.append(child);panel.append(advanced);

 const openModel=document.createElement('button');openModel.id='desktop-open-model';openModel.textContent='Open model editor ↗';openModel.onclick=()=>$('#agent-follow').click();$('.model-agent-controls').append(openModel);

 for(const button of document.querySelectorAll('.workspace-tabs button'))if(button.textContent==='Models + agent')button.onclick=()=>{panel.hidden=false;advanced.open=true;advanced.scrollIntoView({block:'nearest'});};

 $('#desktop-output').value=store.session.desktopOutput||'auto';$('#desktop-output').onchange=e=>{store.session.desktopOutput=e.target.value;store.flush().catch(()=>{});};

 $('.model-agent-controls > p').textContent='Speak or type a change.';



 const composer=document.createElement('section');composer.id='desktop-input';composer.setAttribute('aria-label','Instructions');right.insertBefore(composer,heading);

 const speechPanel=$('.speech-panel');composer.append(speechPanel);$('#description-form').hidden=true;

 const audioHint=document.createElement('p');audioHint.id='desktop-audio-hint';audioHint.textContent='Enable the microphone to speak, or type below.';speechPanel.querySelector('.speech-top').after(audioHint);

 form.querySelector('label').textContent='Instructions';input.placeholder='Describe what to create or change…';input.rows=3;composer.append(form);const send=$('#ai-run');send.type='button';form.append(send);

 form.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();send.click();},true);

 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();send.click();}});

 window.addEventListener('draw3d-microphone-state',({detail:d})=>{audioHint.hidden=!!studio.speechCapture?.active||d.phase==='starting';if(d.phase==='error')audioHint.textContent='Microphone unavailable. Check browser permission, or type below.';else if(d.phase==='off')audioHint.textContent='Enable the microphone to speak, or type below.';});

 audioHint.hidden=!!studio.speechCapture?.active;

 const help=document.createElement('p');help.className='hint';help.textContent='Double-click the canvas to draw. Select a plane or face to sketch on it.';right.append(help);

 $('#creation-mode').value='full';$('#creation-mode').dispatchEvent(new Event('change'));

 const completed=studio.strokeWorkflow.completed;studio.strokeWorkflow.completed=s=>{completed(s);if(studio.strokeWorkflow.mode()==='full')studio.strokeWorkflow.fit(s).catch(()=>{});};

 studio.color='#8cbcff';studio.cursor.material.color.set(studio.color);studio.radius=.001;$('#brush').min='1';$('#brush').max='12';$('#brush').value='2';$('#brush').dispatchEvent(new Event('input'));

 const grid=new T.GridHelper(10,500,0x344350,0x202d39);grid.rotation.x=Math.PI/2;grid.position.set(0,1.15,-.605);studio.scene.add(grid);

 const furniture=studio.scene.children.filter(o=>o!==grid&&(o.isGridHelper||o.geometry?.type==='CylinderGeometry'||o.geometry?.type==='TorusGeometry'));furniture.forEach(o=>o.removeFromParent());

 const camera3D=studio.camera,camera2D=new T.OrthographicCamera(-1,1,.6,-.6,.01,100),sketchCamera=new T.OrthographicCamera(-1,1,.6,-.6,.001,100);camera2D.position.set(0,1.15,3);camera2D.lookAt(0,1.15,-.6);let flat=false,span=1.2,sketchSpan=.6;

 studio.desktopPlaneExplicit=!!store.session.desktopPlane;

 studio.desktopPlane=store.session.desktopPlane||{name:'Front · XY',origin:[0,1.15,-.6],xAxis:[1,0,0],yAxis:[0,1,0],normal:[0,0,1]};

 studio.desktopPoint=ray=>{const plane=studio.desktopInkFrame||studio.desktopPlane;const safety=planeDrawingSafety(plane,ray.direction.toArray());if(!safety.allowed){const label=document.querySelector('#cad-plane-status');if(label)label.textContent=safety.message;studio.cursor.visible=false;return null;}return ray.intersectPlane(new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(...plane.normal),new T.Vector3(...plane.origin)),new T.Vector3())?.toArray();};

 studio.setDesktopPlane=frame=>{studio.endAll();studio.desktopSelection?.clear();studio.surface.clear();studio.desktopPlane=structuredClone(frame);store.session.desktopPlane=studio.desktopPlane;const basis=new T.Matrix4().makeBasis(new T.Vector3(...frame.xAxis),new T.Vector3(...frame.yAxis),new T.Vector3(...frame.normal));grid.quaternion.setFromRotationMatrix(basis).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),Math.PI/2));grid.position.fromArray(frame.origin).addScaledVector(new T.Vector3(...frame.normal),-.003);const label=$('#cad-active-plane');if(label)label.textContent=frame.name;window.dispatchEvent(new Event('draw3d-plane-changed'));void store.flush();};

 const planes=document.createElement('div');planes.id='cad-plane-picker';planes.innerHTML='<span>PLANE</span><button data-plane="front">Front · XY</button><button data-plane="top">Top · XZ</button><button data-plane="right">Right · YZ</button><span id="cad-active-plane">Front · XY</span>';studio.container.append(planes);planes.querySelectorAll('button').forEach(b=>b.onclick=()=>{studio.planeEditor.choose('plane-'+b.dataset.plane);document.querySelector('#cad-plane-base').value='plane-'+b.dataset.plane;document.querySelector('#cad-new-plane').open=true;});

 studio.beginSketch=()=>{if(studio.nativeSelection?.summary()?.faceIndices.length&&studio.nativeSelection.drawOnFace())return;if(studio.nativeSelection?.summary()?.body&&studio.nativeSelection.drawOnBody())return;if(studio.surface.selected){studio.desktopDrawing?.setMode('pen');return;}if(studio.desktopSelection?.summary()?.kind==='surface'){studio.desktopSelection.drawOnSurface();studio.desktopDrawing.setMode('pen');return;}const sketch=studio.desktopSketches.ensure();studio.planeView.editSketch(sketch.id);};$('#cad-start-sketch').onclick=()=>studio.beginSketch();

 const resize=studio.resize.bind(studio);studio.resize=()=>{if(flat||studio.planeView?.editing){const r=studio.container.getBoundingClientRect(),a=r.width/Math.max(1,r.height),camera=flat?camera2D:sketchCamera,size=flat?span:sketchSpan;camera.left=-size*a/2;camera.right=size*a/2;camera.top=size/2;camera.bottom=-size/2;}resize();};

 // OrbitControls caches the up-axis transform for its camera. Refresh it when switching sketch planes.

 function syncOrbitUp(){studio.controls._quat.setFromUnitVectors(studio.camera.up,new T.Vector3(0,1,0));studio.controls._quatInverse.copy(studio.controls._quat).invert();}

 function view(isFlat){studio.planeView?.finish(false);studio.endAll();if(isFlat){studio.surface.clear();studio.desktopSelection?.clear();}flat=isFlat;if(flat&&studio.planeEditor)studio.planeEditor.choose('plane-front');if(flat)camera2D.up.set(0,1,0);studio.camera=flat?camera2D:camera3D;studio.controls.object=studio.camera;syncOrbitUp();studio.controls.target.set(camera2D.position.x,camera2D.position.y,-.6);studio.controls.enableRotate=!flat;studio.controls.mouseButtons.MIDDLE=T.MOUSE.ROTATE;studio.controls.mouseButtons.LEFT=null;studio.controls.enableDamping=false;if(!flat){const points=store.session.strokes.filter(s=>!s.hidden).flatMap(s=>s.points).map(p=>new T.Vector3(...p)),bounds=new T.Box3().setFromPoints(points);for(const figure of studio.desktopDrawing?.summary()||[])for(const p of studio.desktopDrawing.points(figure))bounds.expandByPoint(p);for(const model of studio.surfaceModels?.()||[])if(!model.hidden&&model.mesh.visible)bounds.union(new T.Box3().setFromObject(model.mesh));if(!bounds.isEmpty()){const c=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3()).length(),distance=Math.max(.15,size*1.5);studio.controls.target.copy(c);camera3D.position.copy(c).add(new T.Vector3(.65,.45,1).normalize().multiplyScalar(distance));camera3D.lookAt(c);}else{camera3D.position.set(.75,1.75,.65);camera3D.lookAt(0,1.15,-.6);}}grid.visible=true;furniture.forEach(o=>o.visible=o.isGridHelper&&!flat);studio.setMode(flat?'draw':'orbit');studio.resize();studio.camera.updateMatrixWorld(true);studio.onChange();$('#desktop-flat').classList.toggle('selected',flat);$('#desktop-3d').classList.toggle('selected',!flat);studio.desktopSelection?.sync();studio.planeEditor?.detach();studio.planeEditor?.refresh();studio.desktopDrawing?.setMode(flat?"pen":"select");badge();}

 function badge(){if(studio.planeView?.editing){$('#view-mode').textContent='SKETCH · '+studio.planeView.sketchName;return;}$('#view-mode').textContent=flat?'FRONT · '+studio.mode.toUpperCase():'PERSPECTIVE · INSPECT';}

 $('#desktop-flat').onclick=()=>view(true);$('#desktop-3d').onclick=()=>view(false);

 $('#draw').addEventListener('click',()=>studio.beginSketch());$('#erase').addEventListener('click',()=>studio.desktopEditing?.activateEraser());$('#orbit').addEventListener('click',()=>view(false));

 studio.renderer.domElement.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});

 studio.renderer.domElement.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();e.stopImmediatePropagation();const r=studio.renderer.domElement.getBoundingClientRect(),distance=studio.camera.isOrthographicCamera?(studio.camera.top-studio.camera.bottom)/studio.camera.zoom:studio.camera.position.distanceTo(studio.controls.target)*2*Math.tan(T.MathUtils.degToRad(studio.camera.fov)/2),right=new T.Vector3().setFromMatrixColumn(studio.camera.matrixWorld,0),up=new T.Vector3().setFromMatrixColumn(studio.camera.matrixWorld,1),delta=right.multiplyScalar(-(e.deltaX||0)*distance/r.height).add(up.multiplyScalar(e.deltaY*distance/r.height));studio.camera.position.add(delta);studio.controls.target.add(delta);studio.controls.update();return;}if(!flat&&!studio.planeView?.editing)return;e.preventDefault();e.stopImmediatePropagation();if(studio.planeView?.editing)sketchSpan=Math.max(.004,Math.min(100,sketchSpan*Math.exp(e.deltaY*.001)));else span=Math.max(.04,Math.min(10,span*Math.exp(e.deltaY*.001)));studio.resize();},{passive:false,capture:true});

 $('#desktop-fit').onclick=()=>{if(studio.planeView?.editing){studio.planeView.refit();return;}const points=[...store.session.strokes.filter(s=>!s.hidden).flatMap(s=>s.points),...(studio.desktopDrawing?.summary()||[]).flatMap(f=>studio.desktopDrawing.points(f).map(p=>p.toArray()))];if(!points.length)return;const box=new T.Box3().setFromPoints(points.map(p=>new T.Vector3(...p))),c=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3()),r=studio.container.getBoundingClientRect();camera2D.position.set(c.x,c.y,3);camera2D.lookAt(c.x,c.y,-.6);studio.controls.target.set(c.x,c.y,-.6);span=Math.max(.06,size.y*1.3,size.x*1.3/(r.width/r.height));if(!flat)view(true);else studio.resize();};

 $('#desktop-svg').textContent='Export drawing SVG';

 $('#desktop-svg').onclick=()=>{const figures=studio.desktopDrawing?.summary()||[],used=new Set(figures.flatMap(f=>f.strokeIds||[]));const raw=store.session.strokes.filter(s=>!s.hidden&&!used.has(s.id)).map(s=>s.localFit?.selected?.path||s.points),paths=[...raw,...figures.map(f=>studio.desktopDrawing.points(f).map(p=>p.toArray()))];if(!paths.length){$('#fit-status').textContent='Draw a figure before exporting.';return;}const all=paths.flat(),xs=all.map(p=>p[0]*1000),ys=all.map(p=>-p[1]*1000),x=Math.min(...xs)-2,y=Math.min(...ys)-2,w=Math.max(...xs)-x+2,h=Math.max(...ys)-y+2;const rawSVG=raw.map(path=>`<path d="${path.map((p,i)=>`${i?'L':'M'}${p[0]*1000},${-p[1]*1000}`).join(' ')}"/>`).join('');const figureSVG=figures.map(f=>{const a=f.xAxis||[1,0,0],b=f.yAxis||[0,1,0],transform=`matrix(${a[0]} ${-a[1]} ${b[0]} ${-b[1]} ${f.origin[0]*1000} ${-f.origin[1]*1000})`;if(f.kind==='arc'){const r=f.radiusMetres*1000,a=f.startAngleDeg*Math.PI/180,sweep=((f.endAngleDeg-f.startAngleDeg)%360+360)%360,b=a+sweep*Math.PI/180;return `<path transform="${transform}" d="M${r*Math.cos(a)},${r*Math.sin(a)} A${r},${r} 0 ${sweep>180?1:0} 1 ${r*Math.cos(b)},${r*Math.sin(b)}"/>`;}if(f.kind==='circle')return `<circle transform="${transform}" cx="0" cy="0" r="${f.radiusMetres*1000}"/>`;if(f.kind==='rectangle')return `<rect transform="${transform}" x="${-f.widthMetres*500}" y="${-f.heightMetres*500}" width="${f.widthMetres*1000}" height="${f.heightMetres*1000}"/>`;if(f.kind==='spline')return `<path transform="${transform}" d="${f.segments.map((s,i)=>`${i?'':`M${s[0]*1000},${s[1]*1000} `}C${s.slice(2).map(v=>v*1000).join(' ')}`).join(' ')}${f.closed?' Z':''}"/>`;return `<path d="M${f.origin[0]*1000},${-f.origin[1]*1000} L${f.end[0]*1000},${-f.end[1]*1000}"/>`;}).join('');download(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="${x} ${y} ${w} ${h}"><g fill="none" stroke="#172b42" stroke-width="0.5">${rawSVG}${figureSVG}</g></svg>`],{type:'image/svg+xml'}),'draw3d-desktop.svg');};



 const promptIntent=()=>$('#desktop-output').value==='auto'?'Follow the user instructions exactly. For drawing-only input, refine the intended planar figure as an editable 2D drawing. Do not add thickness or create a 3D object unless explicitly requested.':$('#desktop-output').value==='drawing'?'Refine this desktop sketch into a clean 2D drawing using native planar CAD sketches. Preserve proportions. Do not extrude unless requested.':'User explicitly selected 3D CAD output. Create 3D geometry to fulfill this selection, while any written instruction explicitly requesting a 2D figure takes precedence. Do not invent extra features. Respect the selected geometry and supplied dimensions.';

 $('#ai-run').addEventListener('click',()=>{let text=input.value.trim();if(!text&&store.session.strokes.some(s=>!s.hidden))text='Interpret the drawing and refine the current draft.';if(!text)return;input.value=promptIntent()+'\n\n'+text;input.dispatchEvent(new Event('input'));},true);

 initDesktopSelection({studio,store,isFlat:()=>flat});

 const assist=decisionLab?{refresh(){}}:initDesktopAssist({studio,store,output:$('#desktop-output'),input,promptIntent});

 // Refresh legacy numeric fits without treating reload as a new AI instruction.

 for(const stroke of store.session.strokes)if(stroke.localFit&&stroke.localFit.algorithmRevision!==4)studio.strokeWorkflow.fit(stroke).then(()=>assist.refresh()).catch(()=>{});



 window.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,[contenteditable]'))return;const action={d:()=>$('#draw').click(),e:()=>$('#erase').click(),v:()=>view(!flat)}[e.key.toLowerCase()];if(action){e.preventDefault();action();}});

 new MutationObserver(()=>{const text=studio.planeView?.editing?'SKETCH · '+studio.planeView.sketchName:flat?'FRONT · '+studio.mode.toUpperCase():'PERSPECTIVE · INSPECT';if($('#view-mode').textContent!==text)badge();}).observe($('#view-mode'),{childList:true});

 studio.returnToModelView=()=>view(false);studio.prepareForVR=studio.returnToModelView;view(false);initDesktopPlanes(studio,store);initDesktopSketches(studio,store);initDesktopAppearance(studio,store);initDesktopPlaneView({studio,store,isFlat:()=>flat,setSketchCamera:(center,plane,nextSpan)=>{flat=false;sketchSpan=nextSpan;studio.camera=sketchCamera;sketchCamera.zoom=1;sketchCamera.up.fromArray(plane.yAxis);const normal=new T.Vector3(...plane.normal),contextPoints=(studio.surfaceModels?.()||[]).filter(m=>!m.hidden&&m.mesh.visible).flatMap(m=>{const b=new T.Box3().setFromObject(m.mesh);return b.isEmpty()?[]:[b.min.x,b.max.x].flatMap(x=>[b.min.y,b.max.y].flatMap(y=>[b.min.z,b.max.z].map(z=>new T.Vector3(x,y,z))));}),depths=contextPoints.map(p=>p.clone().sub(center).dot(normal)),distance=Math.max(2,sketchSpan*3,...depths.map(d=>d+1));sketchCamera.near=.001;sketchCamera.far=Math.max(100,distance-Math.min(0,...depths)+10);sketchCamera.position.copy(center).addScaledVector(normal,distance);sketchCamera.lookAt(center);studio.controls.object=sketchCamera;syncOrbitUp();studio.controls.target.copy(center);studio.controls.enableRotate=true;studio.controls.enabled=true;studio.controls.update();studio.resize();sketchCamera.updateMatrixWorld(true);$('#desktop-flat').classList.remove('selected');$('#desktop-3d').classList.add('selected');studio.desktopSelection?.sync();badge();},returnTo3D:()=>view(false)});initDesktopMouse({studio,store,isFlat:()=>flat});await studio.modelsReady;await studio.desktopHistory?.ready;document.body.dataset.desktopReady='true';if(decisionLab){const {initDecisionSketchLab}=await import('./decision-sketch-lab.js');await initDecisionSketchLab({studio,store});}

 initDesktopViewCube(studio);
 document.querySelector('#app').inert=false;
 delete document.body.dataset.opening;
}
window.addEventListener('draw3d-ready',event=>openDesktop(event).catch(error=>{
 document.querySelector('#desktop-opening').textContent='Could not open the drawing workspace. '+error.message;
 console.error(error);
}));
