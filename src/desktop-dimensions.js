import {extrusionThickness} from './extrusion-depths.js';
import * as T from 'three';

// Values entered here modify explicit CAD parameters; no drawing interpretation or AI call.
export function dimensionChange(figure,key,value,{dims,basis}){
 if(!Number.isFinite(value))throw Error('Enter a finite number.');
 if(key==='angleDeg'){
  const b=basis(figure),length=dims(figure).lengthMetres,a=T.MathUtils.degToRad(value);
  return {end:new T.Vector3(...figure.origin).addScaledVector(b.x,length*Math.cos(a)).addScaledVector(b.y,length*Math.sin(a)).toArray()};
 }
 if(key==='sweepDeg'){
  if(!(value>0&&value<360))throw Error('Arc sweep must be greater than 0° and less than 360°.');
  return {endAngleDeg:figure.startAngleDeg+value};
 }
 const limit=key==='diameterMetres'?200:100;if(!(value>0&&value<=limit))throw Error('Enter a positive dimension up to '+(limit*1000).toLocaleString()+' mm.');
 if(key==='diameterMetres')return {radiusMetres:value/2};
 if(key==='lengthMetres'){
  if(figure.kind==='spline')return {segments:figure.segments.map(s=>s.map(v=>v*value/dims(figure).lengthMetres))};
  return {end:new T.Vector3(...figure.end).sub(new T.Vector3(...figure.origin)).normalize().multiplyScalar(value).add(new T.Vector3(...figure.origin)).toArray()};
 }
 if(['radiusMetres','widthMetres','heightMetres'].includes(key))return {[key]:value};
 throw Error('This dimension is not editable.');
}

export function initDesktopDimensions({studio,figures,labels,dims,basis,points,select,commit,extrude,status}){
 const nodes=new Map(),mm=v=>(v*1000).toFixed(2),deg=v=>Number(v.toFixed(3)).toString();let editing=null,saving=false;
 const dialog=document.createElement('dialog');dialog.id='cad-dimension-editor';dialog.setAttribute('aria-labelledby','cad-dimension-editor-title');
 dialog.innerHTML='<form novalidate><strong id="cad-dimension-editor-title"></strong><label for="cad-dimension-value">Value <span id="cad-dimension-unit"></span></label><input id="cad-dimension-value" type="number" step="any" inputmode="decimal" autocomplete="off"><p id="cad-dimension-help">Enter to apply · Esc to cancel</p><p id="cad-dimension-error" role="alert"></p><div><button type="button" id="cad-dimension-cancel">Cancel</button><button type="submit" id="cad-dimension-save">Apply</button></div></form>';
 document.body.append(dialog);const input=dialog.querySelector('input'),error=dialog.querySelector('#cad-dimension-error'),save=dialog.querySelector('#cad-dimension-save');
 const math={dims,basis};
 function descriptors(f){
  const list=[];
  const add=(key,title,unit,value,text)=>list.push({key,title,unit,value,text});
  if(f.kind==='circle')add('diameterMetres','Diameter','mm',f.radiusMetres*2,'Ø '+mm(f.radiusMetres*2)+' mm');
  else if(f.kind==='rectangle'){add('widthMetres','Width','mm',f.widthMetres,'W '+mm(f.widthMetres)+' mm');add('heightMetres','Height','mm',f.heightMetres,'H '+mm(f.heightMetres)+' mm');}
  else if(f.kind==='arc'){add('radiusMetres','Radius','mm',f.radiusMetres,'R '+mm(f.radiusMetres)+' mm');const sweep=((f.endAngleDeg-f.startAngleDeg)%360+360)%360;add('sweepDeg','Arc sweep','°',sweep,deg(sweep)+'°');}
  else{add('lengthMetres','Length','mm',dims(f).lengthMetres,mm(dims(f).lengthMetres)+' mm');if(f.kind==='line'){const b=basis(f),d=new T.Vector3(...f.end).sub(new T.Vector3(...f.origin)),a=T.MathUtils.radToDeg(Math.atan2(d.dot(b.y),d.dot(b.x)));add('angleDeg','Angle','°',a,deg(a)+'°');}}
  if(f.extrusion)add('depthMetres','Extrusion depth','mm',extrusionThickness(f.extrusion),'T '+mm(extrusionThickness(f.extrusion))+' mm');
  return list;
 }
 function close(){if(saving)return;if(dialog.open)dialog.close();editing=null;}
 function open(figureId,key,anchor){
  if(saving)return;studio.decisionLab?.pauseAutoAccept();const figure=figures.find(f=>f.id===figureId&&!f.hidden),d=figure&&descriptors(figure).find(d=>d.key===key);if(!d)return;
  select(figureId);editing={figureId,key,version:figure.version,initialValue:d.value,descriptor:d};error.textContent='';save.disabled=false;dialog.querySelector('strong').textContent=d.title+' · '+(figure.name||figure.kind);dialog.querySelector('#cad-dimension-unit').textContent='('+d.unit+')';
  input.value=Number((d.unit==='mm'?d.value*1000:d.value).toFixed(6));input.setAttribute('aria-label',d.title+' ('+d.unit+')');editing.initialDisplay=input.value;
  const r=anchor?.getBoundingClientRect();dialog.style.left=Math.max(12,Math.min(innerWidth-292,r?r.left:innerWidth/2-140))+'px';dialog.style.top=Math.max(12,Math.min(innerHeight-230,r?r.bottom+10:innerHeight/2-100))+'px';
  if(!dialog.open)dialog.showModal();const bounds=dialog.getBoundingClientRect();if(r){dialog.style.left=Math.max(12,Math.min(innerWidth-bounds.width-12,r.left))+'px';const above=r.top-bounds.height-10;dialog.style.top=Math.max(12,Math.min(innerHeight-bounds.height-12,above>=12?above:r.bottom+10))+'px';}input.focus();input.select();
 }
 dialog.addEventListener('close',()=>{editing=null;});dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
 dialog.querySelector('#cad-dimension-cancel').onclick=close;
 dialog.querySelector('form').onsubmit=async e=>{
  e.preventDefault();if(!editing||saving)return;const active=editing;
  try{
   const f=figures.find(f=>f.id===active.figureId),d=f&&descriptors(f).find(d=>d.key===active.key);
   if(!f||f.version!==active.version||!d||d.value!==active.initialValue)throw Error('This figure changed while you were editing. Cancel and reopen its dimension.');
   if(!input.value.trim())throw Error('Enter a number.');const typed=Number(input.value),value=active.descriptor.unit==='mm'?typed/1000:typed;
   if(!Number.isFinite(value))throw Error('Enter a finite number.');if(value===d.value||typed===Number(active.initialDisplay)){close();return;}
   let changes;if(active.key==='depthMetres'){if(!(value>0&&value<=100))throw Error('Enter a positive depth up to 100,000 mm.');}else changes=dimensionChange(f,active.key,value,math);
   if(studio.modelAgent?.busy||studio.desktopDrawing?.working)throw Error('Wait for the current edit before changing dimensions');studio.decisionLab?.invalidate('Editing dimension');saving=true;save.disabled=true;error.textContent='';status.textContent='Updating '+active.descriptor.title.toLowerCase()+'…';
   if(active.key==='depthMetres')await extrude(f.id,value);else await commit({...changes,expectedVersion:f.version,dimensionNote:active.descriptor.title+' edited manually to '+typed+' '+active.descriptor.unit},f);
   select(f.id);status.textContent=active.descriptor.title+' updated';saving=false;close();render();
  }catch(err){error.textContent=err.message;status.textContent=err.message;input.focus();}finally{saving=false;save.disabled=false;}
 };
 for(const type of ['pointerdown','pointerup','mousedown','mouseup'])labels.addEventListener(type,e=>e.stopPropagation());
 labels.addEventListener('click',e=>{e.stopPropagation();const target=e.target.closest('[data-dimension-key]');if(!target)return;const root=target.closest('[data-figure-id]');if(e.detail===0)open(root.dataset.figureId,target.dataset.dimensionKey,target);else select(root.dataset.figureId);});
 labels.addEventListener('dblclick',e=>{const target=e.target.closest('[data-dimension-key]');if(!target)return;e.preventDefault();e.stopPropagation();open(target.closest('[data-figure-id]').dataset.figureId,target.dataset.dimensionKey,target);});
 function render(){
  const shown=new Set();for(const f of figures.filter(f=>!f.hidden)){
   shown.add(f.id);let node=nodes.get(f.id);if(!node){const element=document.createElement('span');element.className='cad-dimension-label';element.dataset.figureId=f.id;node={element,buttons:new Map()};nodes.set(f.id,node);labels.append(element);}
   const descriptorsForFigure=descriptors(f),keys=new Set(descriptorsForFigure.map(d=>d.key));for(const [key,button]of node.buttons)if(!keys.has(key)){button.remove();node.buttons.delete(key);}
   for(const d of descriptorsForFigure){let button=node.buttons.get(d.key);if(!button){button=document.createElement('button');button.type='button';button.dataset.dimensionKey=d.key;node.buttons.set(d.key,button);node.element.append(button);}if(button.textContent!==d.text)button.textContent=d.text;button.title='Double-click to edit '+d.title.toLowerCase();button.setAttribute('aria-label','Edit '+d.title.toLowerCase()+' for '+(f.name||f.kind));}
   const path=points(f);let p=new T.Vector3(...f.origin);if(f.kind==='rectangle')p.addScaledVector(basis(f).y,f.heightMetres/2);else if(f.kind==='circle')p.addScaledVector(basis(f).x,f.radiusMetres);else if(path.length)p.copy(path[Math.floor((path.length-1)/2)]);p.project(studio.camera);node.element.style.left=((p.x+1)*50)+'%';node.element.style.top=((1-p.y)*50)+'%';node.element.style.display=p.z< -1||p.z>1?'none':'';
  }
  for(const [id,node]of nodes)if(!shown.has(id)){node.element.remove();nodes.delete(id);}
 }
 render();const timer=setInterval(render,150);window.addEventListener('pagehide',()=>{clearInterval(timer);if(dialog.open)dialog.close();dialog.remove();},{once:true});return {open,close,render};
}
