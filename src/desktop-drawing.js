import {revolveSection} from './revolve-section.js';
import {ensureCadEditing} from './cad-readiness.js';
import {nativeExtrusionDepths,extrusionThickness} from './extrusion-depths.js';
import {initDesktopEditing} from './desktop-editing.js';
import {defaultSketchRules} from './sketch-component-edit.js';
import {initSketchComponentEditor} from './sketch-component-editor.js';
import {verifyDecisionFigure} from './decision-sketch/harness.js';
import * as T from 'three';
import {initDesktopDimensions,dimensionChange} from './desktop-dimensions.js';
export function initDesktopDrawing({studio,store,ensure,settled,refresh,renderer}){
 const resolveCAD=ensure;ensure=async mode=>{const api=await resolveCAD(mode);if(mode==='cad')await ensureCadEditing(api);return api;};
 const figures=store.session.desktopFigures||=[];const group=new T.Group();group.name='Editable desktop drawing figures';studio.scene.add(group);const meshes=new Map();let temporaryHidden=new Set();let selected=null,userSelected=false,mode='select',start=null,working=false;
 const labels=document.createElement('div');labels.id='cad-dimension-labels';studio.container.append(labels);
 const bar=document.createElement('div');bar.id='desktop-cad-toolbar';bar.setAttribute('aria-label','CAD sketch tools');bar.innerHTML='<span>SKETCH</span><button data-tool="pen" id="cad-pen" title="Pen · freehand sketch (D)" aria-pressed="false"><span class="pen-symbol" aria-hidden="true">✎</span> Pen <kbd>D</kbd></button><button data-tool="erase" id="cad-eraser" title="Eraser (E)">⌫ Eraser <kbd>E</kbd></button><button data-tool="select" class="selected" title="Cursor · double-click canvas to switch pen">Cursor</button><button data-tool="line">╱ Line</button><button data-tool="reference">┄ Reference</button><button data-tool="rectangle">▭ Rectangle</button><button data-tool="circle">◯ Circle</button><button id="cad-dimensions-toggle" aria-pressed="true">Dimensions</button><button id="desktop-native-editor">Advanced CAD ↗</button>';studio.container.append(bar);const toolSize=new ResizeObserver(()=>studio.container.style.setProperty('--cad-tools-bottom',(bar.offsetTop+bar.offsetHeight+5)+'px'));toolSize.observe(bar);window.addEventListener('pagehide',()=>toolSize.disconnect(),{once:true});
 const properties=document.createElement('section');properties.id='cad-properties';properties.innerHTML='<h2>Geometry & dimensions</h2><select id="cad-figure-list" aria-label="Editable drawing figure"><option value="">Select a figure</option></select><label>Name <input id="cad-element-name" aria-label="Element name"></label><label><input id="cad-element-construction" type="checkbox"> Reference / construction geometry</label><div id="cad-placement-fields"></div><p id="cad-dimension-note">AI-created dimensions and selected object measurements appear here.</p><div id="cad-dimension-fields"></div><div class="two-buttons"><button id="cad-apply-dimensions" disabled>Apply dimensions</button><button id="cad-extrude-figure" disabled>Extrude…</button></div><label id="cad-thickness-label" hidden>Thickness (mm) <input id="cad-thickness" type="number" min="0.1" value="10" step="1"><button id="cad-confirm-extrude">Create extrusion</button></label><label>Ask AI about this element <input id="cad-element-prompt" placeholder="e.g. Set width to 80 mm"></label><button id="cad-element-ai">Edit selected element with AI</button><p id="cad-tool-status" role="status"></p>';document.querySelector('.right-panel>div').after(properties);
 const list=properties.querySelector('select'),fields=properties.querySelector('#cad-dimension-fields'),status=properties.querySelector('#cad-tool-status'),note=properties.querySelector('#cad-dimension-note');
 const vector=a=>new T.Vector3(...a),mm=v=>(v*1000).toFixed(2);
 const arcSweep=f=>((f.endAngleDeg-f.startAngleDeg)%360+360)%360;
 function basis(f){const x=vector(f.xAxis||[1,0,0]).normalize(),y=vector(f.yAxis||[0,1,0]);y.addScaledVector(x,-y.dot(x)).normalize();if(x.length()<.99||y.length()<.99)throw Error('Figure axes must be nonzero and independent');return {x,y,n:new T.Vector3().crossVectors(x,y).normalize()};}
 function points(f){const {x,y}=basis(f),o=vector(f.origin),at=(a,b)=>o.clone().addScaledVector(x,a).addScaledVector(y,b);if(f.kind==='arc')return Array.from({length:65},(_,i)=>{const a=T.MathUtils.degToRad(f.startAngleDeg+arcSweep(f)*i/64);return at(f.radiusMetres*Math.cos(a),f.radiusMetres*Math.sin(a));});if(f.kind==='circle')return Array.from({length:129},(_,i)=>at(f.radiusMetres*Math.cos(i*Math.PI/64),f.radiusMetres*Math.sin(i*Math.PI/64)));if(f.kind==='rectangle'){const w=f.widthMetres/2,h=f.heightMetres/2;return [[-w,-h],[w,-h],[w,h],[-w,h],[-w,-h]].map(([a,b])=>at(a,b));}if(f.kind==='spline')return f.segments.flatMap((s,index)=>Array.from({length:25},(_,i)=>{const t=i/24,u=1-t;return at(u*u*u*s[0]+3*u*u*t*s[2]+3*u*t*t*s[4]+t*t*t*s[6],u*u*u*s[1]+3*u*u*t*s[3]+3*u*t*t*s[5]+t*t*t*s[7]);}).slice(index?1:0));return [o,vector(f.end)];}
 function dims(f){if(f.kind==='spline'){const p=points(f);return {lengthMetres:p.slice(1).reduce((sum,v,i)=>sum+v.distanceTo(p[i]),0)};}return ['circle','arc'].includes(f.kind)?{radiusMetres:f.radiusMetres}:f.kind==='rectangle'?{widthMetres:f.widthMetres,heightMetres:f.heightMetres}:{lengthMetres:vector(f.end).distanceTo(vector(f.origin))};}
 function redraw(f){const old=meshes.get(f.id);if(old){old.geometry.dispose();old.material.dispose();old.removeFromParent();}const line=new T.Line(new T.BufferGeometry().setFromPoints(points(f)),f.construction?new T.LineDashedMaterial({color:0x92a8bd,dashSize:.012,gapSize:.008,depthTest:false}):new T.LineBasicMaterial({color:f.id===selected?0xffcd72:0x9cddff,depthTest:false}));line.computeLineDistances();line.visible=!f.hidden&&!temporaryHidden.has(f.id);line.renderOrder=45;line.userData.figureId=f.id;group.add(line);meshes.set(f.id,line);}
 function select(id,fromUser=true){selected=id||null;if(fromUser)studio.desktopEditing?.selectFigure(selected);userSelected=fromUser;for(const f of figures)redraw(f);list.value=selected||'';const f=figures.find(f=>f.id===selected);fields.replaceChildren();properties.querySelector('#cad-apply-dimensions').disabled=!f;properties.querySelector('#cad-extrude-figure').disabled=!f||f.construction||['line','arc'].includes(f.kind)||f.kind==='spline'&&!f.closed;properties.querySelector('#cad-placement-fields').replaceChildren();properties.querySelector('#cad-element-name').value=f?.name||'';properties.querySelector('#cad-element-construction').checked=!!f?.construction;if(!f){note.textContent='Draw on the selected plane or select a sketch element to edit dimensions.';return;}for(const [i,axis]of ['X','Y','Z'].entries()){const label=document.createElement('label');label.textContent=axis+' position (mm)';const input=document.createElement('input');input.type='number';input.step='.1';input.value=mm(f.origin[i]);input.dataset.axis=String(i);label.append(input);properties.querySelector('#cad-placement-fields').append(label);}if(f.kind==='line'){const label=document.createElement('label');label.textContent='Angle in sketch plane (°)';const input=document.createElement('input');input.type='number';input.step='.1';const d=vector(f.end).sub(vector(f.origin)),b=basis(f);input.value=(T.MathUtils.radToDeg(Math.atan2(d.dot(b.y),d.dot(b.x)))).toFixed(3);input.id='cad-line-angle';label.append(input);properties.querySelector('#cad-placement-fields').append(label);}if(f.kind==='arc')for(const [key,title]of [['startAngleDeg','Start angle (°)'],['endAngleDeg','End angle (°)']]){const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type='number';input.step='.1';input.value=f[key];input.dataset.arcAngle=key;label.append(input);properties.querySelector('#cad-placement-fields').append(label);}note.textContent=f.dimensionNote||'Editable native 2D '+f.kind+' · dimensions in mm';for(const [key,value]of Object.entries(dims(f))){const label=document.createElement('label');label.textContent=({radiusMetres:'Radius',widthMetres:'Width',heightMetres:'Height',lengthMetres:'Length'})[key]+' (mm)';const input=document.createElement('input');input.type='number';input.step='.1';input.min='.01';input.value=mm(value);input.dataset.dimension=key;label.append(input);fields.append(label);}}
 function updateList(){list.replaceChildren(new Option('Select a figure',''),...figures.map(f=>new Option(f.name||f.kind,f.id)));list.value=selected||'';}
 function validate(f){if(!['circle','rectangle','line','arc','spline'].includes(f.kind))throw Error('Unsupported drawing kind');if(!Array.isArray(f.origin)||f.origin.length!==3||!f.origin.every(Number.isFinite))throw Error('Finite world-metre origin required');basis(f);if(f.kind==='arc'&&(!Number.isFinite(f.startAngleDeg)||!Number.isFinite(f.endAngleDeg)||!(arcSweep(f)>0)||f.closed))throw Error('Arc needs finite start/end angles and a nonzero sweep below 360 degrees');for(const [k,v]of Object.entries(dims(f)))if(!Number.isFinite(v)||v<=0||v>100)throw Error('Positive dimension up to 100 metres required: '+k);}
 const convert=(p,s=1)=>({x:p[0]*s,y:-p[2]*s,z:p[1]*s});
 function nativeData(f,scale){if(f.kind==='arc')return {objectKind:'arc',centerX:0,centerY:0,radius:f.radiusMetres*scale,startAngleDeg:f.startAngleDeg,endAngleDeg:f.endAngleDeg};if(f.kind==='spline')return {objectKind:'spline',closed:f.closed,segments:f.segments.map(points=>({points:points.map(v=>v*scale)}))};if(f.kind==='circle')return {objectKind:'circle',centerX:0,centerY:0,radius:f.radiusMetres*scale};if(f.kind==='rectangle')return {objectKind:'rectangle',centerX:0,centerY:0,width:f.widthMetres*scale,height:f.heightMetres*scale};const {x,y}=basis(f),d=vector(f.end).sub(vector(f.origin));return {objectKind:'line',x1:0,y1:0,x2:d.dot(x)*scale,y2:d.dot(y)*scale};}
 async function native(f,existing){let api=await ensure('cad');if(!api.document()){await api.create('Desktop drawing','mm');await settled(api);api=await ensure('cad');}const doc=api.document(),scale={mm:1000,cm:100,m:1,inch:1/.0254}[doc.units],{x,y,n}=basis(f),planeRef={type:'frame',frame:{origin:convert(f.origin,scale),xAxis:convert(x.toArray()),yAxis:convert(y.toArray()),zAxis:convert(n.toArray())}};
  // Sketch commands write the parametric document synchronously. Only dependent
  // solids need a completed kernel rebuild before this edit can be published.
  const rebuild=!!existing&&(existing.extrusion||Object.values(doc.nodes||{}).some(node=>node.kind==='body')||(store.session.desktopSolids||[]).some(s=>s.figureIds.includes(existing.id)));
  async function execute(operation,payload,version){
   const deadline=performance.now()+3500;
   for(;;){
    const current=await ensure('cad');
    if(current.document()?.projectId!==doc.projectId)throw Error('The active CAD project changed');
    try{return current.execute(operation,payload,version);}
    catch(error){
     // This particular guard runs before a command is dispatched. Never replay a mutated document.
     if(!error.message.startsWith('CAD is busy; retry')||performance.now()>=deadline||current.document().version!==version)throw error;
     await new Promise(resolve=>setTimeout(resolve,60));
    }
   }
  }
  if(existing && existing.projectId!==doc.projectId)throw Error('The figure belongs to a different CAD project; reopen its project before editing');
  if(existing&&existing.kind!==f.kind){
   if(existing.extrusion||(store.session.desktopSolids||[]).some(s=>s.figureIds.includes(existing.id)))throw Error('This profile supports a solid; edit that feature before changing its sketch type');
   try{await execute('deleteSketchObject',{sketchId:existing.sketchId,objectId:existing.objectId},doc.version);if(rebuild)await settled(api);return await native(f,null);}
   catch(error){if(api.document().version!==doc.version){(await ensure('cad')).restore(doc);if(rebuild)await settled(api);await refresh();}throw error;}
  }
  const geometry=nativeData(f,scale);
  if(existing){
   await execute('updateSketchObject',{sketchId:f.sketchId,objectId:f.objectId,data:{...geometry,construction:!!f.construction}},doc.version);
   if(JSON.stringify([f.origin,f.xAxis,f.yAxis])!==JSON.stringify([existing.origin,existing.xAxis,existing.yAxis]))await execute('updateSketch',{sketchId:f.sketchId,planeRef},api.document().version);
  }else{
   const result=await execute('addSketch',{name:f.name||f.kind,planeRef,objects:[{...geometry,construction:!!f.construction}]},doc.version);
   const ids=result.command.payload.ids;f.sketchId=ids.sketchId;f.objectId=ids.objectNodeIds[0];f.projectId=doc.projectId;
  }
  if(rebuild)await settled(api);
  const verified=api.document(),saved=verified.nodes?.[f.objectId]?.data;
  if(!Object.values(verified.nodes).some(n=>n.kind==='sketch'&&n.sketchId===f.sketchId&&n.objectIds.includes(f.objectId))||!saved||Object.keys(geometry).some(key=>JSON.stringify(saved[key])!==JSON.stringify(geometry[key])))throw Error('Native sketch verification failed for '+f.name);
  await refresh();return verified;
 }

 async function preview(){const scene=new T.Scene();scene.background=new T.Color('#101923');for(const f of figures){const m=meshes.get(f.id);scene.add(new T.Line(m.geometry,m.material));}renderer.setSize(640,Math.max(160,Math.round(640/(studio.camera.aspect||1))),false);renderer.render(scene,studio.camera);const image=renderer.domElement.toDataURL('image/png');renderer.setSize(320,240,false);return image;}
 async function commit(a,existing,{recordHistory=true,previewImage=true}={}){if(working)throw Error('A drawing operation is already executing');await studio.desktopHistory?.before();if(a.expectedSketchRevision!==undefined&&a.expectedSketchRevision!==store.session.revision)throw Error('Drawing revision changed; inspect context again');if(existing&&a.expectedVersion!==existing.version)throw Error('Figure version changed; read drawing_list');const f={...(existing||{}),...a,id:existing?.id||crypto.randomUUID(),version:(existing?.version||0)+1,strokeIds:a.strokeIds||existing?.strokeIds||[],planeId:a.planeId!==undefined?a.planeId:existing?.planeId??(studio.surface.selected?null:studio.desktopPlane?.id)};delete f.expectedVersion;delete f.figureId;studio.desktopSketches?.attachFigure(f);validate(f);working=true;try{const linked=(store.session.desktopSolids||[]).filter(s=>s.derivedSection && s.figureIds.includes(f.id));
   if(linked.length){
    const api=await ensure('cad'), before=api.document(), refreshed=[];
    try{
     await native(f,existing);
     for(const solid of linked){
      if(f.construction)throw Error('A construction line cannot define a solid');
      const updated=revolveSection(f,solid.parameters.revolution);
      if(!updated)throw Error('The edited profile no longer defines the derived meridian');
      const section={...solid.derivedSection,...updated};
      await native(section,solid.derivedSection);
      const body=api.document().derived.bodyRepresentations?.[solid.bodyId];
      if(!body?.exportableStep || !(body.volume>0))throw Error('This edit would invalidate the revolved solid');
      refreshed.push([solid,section]);
     }
     for(const [solid,section] of refreshed)solid.derivedSection=section;
    } catch(error){api.restore(before);await settled(api);await refresh();throw error;}
   }else await native(f,existing);
   if(existing)Object.assign(existing,f);else figures.push(f);for(const solid of store.session.desktopSolids||[])if(solid.figureIds.includes(f.id)){solid.version++;for(const p of solid.parameters?.profiles||[])if(p.figureId===f.id)p.expectedVersion=f.version;}selected=f.id;redraw(f);updateList();select(f.id,false);studio.desktopSketches?.render();studio.onChange();store.log('drawing.figure',{figure:f});await store.flush();if(recordHistory)await studio.desktopHistory?.capture((existing?'Edit ':'Create ')+(f.construction?'reference ':'')+(f.name||f.kind),{documentOnly:!existing});const image=previewImage?await preview():null;return {figure:structuredClone(f),dimensionsMetres:dims(f),units:'metres',image,nativeSketchId:f.sketchId,solidCreated:false,drawingReview:{state:'awaiting_feedback',kind:'drawing',figureIds:[f.id],modelIds:[],models:[],strokeIds:[],sourceStrokeIds:f.strokeIds,summary:'Created editable 2D '+f.kind+' with visible dimensions.',uncertainties:f.dimensionNote?[f.dimensionNote]:[]}};}finally{working=false;}}
 function summary(){return figures.map(f=>({...structuredClone(f),dimensionsMetres:dims(f)}));}
 list.onchange=()=>select(list.value);properties.querySelector('#cad-apply-dimensions').onclick=async()=>{const f=figures.find(f=>f.id===selected);if(!f)return;const a={name:properties.querySelector('#cad-element-name').value.trim()||f.name,construction:properties.querySelector('#cad-element-construction').checked,origin:[...f.origin],dimensionNote:'Dimensions and placement edited by user'};for(const input of properties.querySelectorAll('[data-axis]'))a.origin[Number(input.dataset.axis)]=Number(input.value)/1000;for(const input of fields.querySelectorAll('input:not([readonly])'))a[input.dataset.dimension]=Number(input.value)/1000;for(const input of properties.querySelectorAll('[data-arc-angle]'))a[input.dataset.arcAngle]=Number(input.value);if(f.kind==='line'){const angle=T.MathUtils.degToRad(Number(properties.querySelector('#cad-line-angle').value)),b=basis(f);a.end=vector(a.origin).addScaledVector(b.x,a.lengthMetres*Math.cos(angle)).addScaledVector(b.y,a.lengthMetres*Math.sin(angle)).toArray();delete a.lengthMetres;}try{if(f.kind==='spline'){Object.assign(a,dimensionChange(f,'lengthMetres',a.lengthMetres,{dims,basis}));delete a.lengthMetres;}studio.decisionLab?.invalidate('Editing dimensions');status.textContent='Updating native dimensions…';await commit({...a,expectedVersion:f.version},f);select(f.id);status.textContent='Dimensions updated';}catch(e){status.textContent=e.message;}};
 async function extrude(id,distance){const f=figures.find(f=>f.id===id);if(!f||f.construction||!Number.isFinite(distance)||distance<=0||distance>100||['line','arc'].includes(f.kind)||f.kind==='spline'&&!f.closed)throw Error('Select a closed figure and positive thickness');
  if(!f.extrusion?.featureId){
   const result=await createSolid({kind:'extrude',name:'Extruded '+f.kind,loftMode:'ruled',revolution:null,profiles:[{figureId:f.id,expectedVersion:f.version,depthMetres:distance,backDepthMetres:null}]});
   return {...result,bodyId:result.solid.bodyId};
  }
  await studio.desktopHistory?.before();let api=await ensure('cad');if(api.busy()){await settled(api);api=await ensure('cad');}const doc=api.document();if(doc.projectId!==f.projectId)throw Error('Reopen the figure project');const scale={mm:1000,cm:100,m:1,inch:1/.0254}[doc.units];let bodyId=f.extrusion?.bodyId,featureId=f.extrusion?.featureId;const oldTotal=f.extrusion&&extrusionThickness(f.extrusion);
  const front=oldTotal>0?distance*(f.extrusion.distanceMetres/oldTotal):distance,back=distance-front;
  api.execute('updateFeature',{featureId,data:{...nativeExtrusionDepths(front,back,scale),...(back===0||front===0?{backDistance:0}:{})}},doc.version);await settled(api);await refresh();const body=api.document().derived.bodyRepresentations?.[bodyId],models=(studio.surfaceModels?.()||[]).filter(m=>m.nativeId===bodyId);if(!body?.exportableStep||!(body.volume>0)||!models.length)throw Error('Native extrusion did not publish a valid visible solid; inspect CAD before retrying');f.extrusion={...f.extrusion,bodyId,featureId,distanceMetres:front,backDistanceMetres:back};for(const solid of store.session.desktopSolids||[])if(solid.kind==='extrude'&&solid.bodyId===bodyId){solid.version++;solid.parameters.profiles[0].depthMetres=front;solid.parameters.profiles[0].backDepthMetres=back;solid.parameters.profiles[0].expectedVersion=f.version;}store.log('drawing.extrude',{figureId:f.id,distanceMetres:distance,bodyId});await store.flush();await studio.desktopHistory?.capture('Extrude '+(f.name||f.kind)+' · '+mm(distance)+' mm');return {solidCreated:true,bodyId,modelIds:models.map(m=>m.id),models:models.map(m=>({id:m.id,version:m.version}))};}
 async function builtBody(bodyId,label,projectId,requireDisplay,featureName=label){
  // Native commands advance the design before the worker publishes the new
  // body. Wait for its ID, including on remote workers. Inspecting a previous
  // ready document must never dispatch a boolean with a missing operand.
  const deadline=performance.now()+120000;
  while(performance.now()<deadline){
   const api=await ensure('cad'),state=api.geometryStatus?.();
   if(state?.phase==='failed')throw Error('CAD rebuild failed: '+state.error);
   if(!api.busy()&&(!state||state.phase==='ready')){
    const d=api.document();
    if(d.projectId!==projectId)throw Error('The active CAD project changed');
    const body=d.derived.bodyRepresentations?.[bodyId];
    if(body?.exportableStep&&body.volume>0){
     if(!requireDisplay)return {body};
     await refresh(true);
     const models=(studio.surfaceModels?.()||[]).filter(m=>m.nativeId===bodyId&&!m.hidden);
     if(models.length)return {body,models};
    }
    const reason=d.derived.warnings?.findLast(w=>String(w).includes(featureName));
    if(reason)throw Error('CAD could not build '+label+': '+reason);
   }
   await new Promise(resolve=>setTimeout(resolve,160));
  }
  throw Error('CAD timed out verifying '+label);
 }
 async function createSolid(spec){
  if(working)throw Error('A drawing operation is already executing');const inputs=spec.profiles.map(p=>{const f=figures.find(f=>f.id===p.figureId);if(!f||f.version!==p.expectedVersion||f.construction||['line','arc'].includes(f.kind)||(f.kind==='spline'&&!f.closed && spec.revolution?.axis!=='endpoints'&&!spec.revolution?.wallThicknessMetres))throw Error('Solid needs current compatible sketch outputs');return f;});const single=['extrude','revolve','pocket','join-material','common-material'].includes(spec.kind);if((!spec.toolBodyId&&(inputs.length<(single?1:2)||single&&inputs.length!==1))||new Set(inputs.map(f=>f.id)).size!==inputs.length)throw Error('Select at least two distinct closed profiles');await studio.desktopHistory?.before();working=true;let api,before;
  try{api=await ensure('cad');if(api.busy()){await settled(api);api=await ensure('cad');}before=api.document();if(inputs.some(f=>f.projectId!==before.projectId))throw Error('All profiles must belong to this CAD project');const scale={mm:1000,cm:100,m:1,inch:1/.0254}[before.units],section=f=>({sketchId:f.sketchId,profile:{all:true,sourceEntityIds:[f.objectId]}});let command, derivedSection;
   if (spec.kind==='revolve') {
    const source=inputs[0], {axis,angleDegrees}=spec.revolution;
    derivedSection=revolveSection(source,spec.revolution);
    if (derivedSection) {
     await native(derivedSection,null);await settled(api);api=await ensure('cad');
    }
    command=api.execute('revolveSketch',{name:spec.name, sketchId:derivedSection?.sketchId||source.sketchId,
     axis:derivedSection?'horizontal':axis, angleDeg:angleDegrees},api.document().version);
   } else if(spec.kind==='extrude'){const p=spec.profiles[0];command=api.execute('extrudeSketch',{name:spec.name,sketchId:inputs[0].sketchId,profile:section(inputs[0]).profile,...nativeExtrusionDepths(p.depthMetres,p.backDepthMetres,scale),operation:'new-body'},api.document().version);}else if(spec.kind==='loft')command=api.execute('loftSections',{name:spec.name,mode:spec.loftMode,sections:inputs.map(section)},api.document().version);
   else if(['pocket','join-material','common-material'].includes(spec.kind)){
    const original=before.derived.bodyRepresentations?.[spec.targetBodyId];
    if(!original?.exportableStep||original.consumed)throw Error('The target body for this cut has changed');
    let toolId=spec.toolBodyId;
    if(toolId){
     const tool=before.derived.bodyRepresentations?.[toolId];
     if(!tool?.exportableStep||tool.consumed||toolId===spec.targetBodyId)throw Error('Select a distinct current tool body');
    }else{
     const f=inputs[0],p=spec.profiles[0];
     const tool=api.execute('extrudeSketch',{name:spec.name+' tool',sketchId:f.sketchId,profile:section(f).profile,...nativeExtrusionDepths(p.depthMetres,p.backDepthMetres,scale),operation:'new-body'},before.version);
     toolId=tool.command.payload.ids.bodyId;
     await builtBody(toolId,spec.name+' tool from '+f.name,before.projectId,false,spec.name+' tool');
     api=await ensure('cad');
    }
    command=api.execute('booleanBodies',{name:spec.name,operation:{pocket:'subtract','join-material':'union','common-material':'intersect'}[spec.kind],targetBodyIds:[spec.targetBodyId,toolId]},api.document().version);
   }
   else{if(!['intersect','union','subtract'].includes(spec.kind))throw Error('Unsupported sketch solid operation');const bodyIds=[];for(const [i,f]of inputs.entries()){const p=spec.profiles[i];const c=api.execute('extrudeSketch',{name:spec.name+' / '+f.name,sketchId:f.sketchId,profile:section(f).profile,...nativeExtrusionDepths(p.depthMetres,p.backDepthMetres,scale),operation:'new-body'},api.document().version);bodyIds.push(c.command.payload.ids.bodyId);await settled(api);}command=api.execute('booleanBodies',{name:spec.name,operation:spec.kind,targetBodyIds:bodyIds},api.document().version);}
   const {bodyId,featureId}=command.command.payload.ids;
   const {body,models}=await builtBody(bodyId,spec.name,before.projectId,true);
   if(derivedSection?.expectedVolumeMetres3&&body?.volume){
     const expected=derivedSection.expectedVolumeMetres3*scale**3;
     if(Math.abs(body.volume/expected-1)>.035)throw Error('Hollow revolve volume disagrees with its wall section');
    }
   if(spec.targetBodyId){
    const previous=before.derived.bodyRepresentations[spec.targetBodyId].volume;
    if(spec.kind==='pocket'&&body.volume>=previous*(1-1e-5))throw Error('The cut removed no measurable target material');
    if(spec.kind==='join-material'&&body.volume<=previous*(1+1e-5))throw Error('The join added no measurable target material');
   }
   if(spec.kind==='extrude'){const f=figures.find(f=>f.id===inputs[0].id);f.extrusion={bodyId,featureId,distanceMetres:spec.profiles[0].depthMetres,backDistanceMetres:spec.profiles[0].backDepthMetres||0};}const solid={id:crypto.randomUUID(),version:1,name:spec.name,kind:spec.kind,figureIds:inputs.map(f=>f.id),sketchIds:[...new Set(inputs.map(f=>f.desktopSketchId).filter(Boolean))],bodyId,featureId,projectId:before.projectId,parameters:structuredClone(spec),...(derivedSection?{derivedSection}:{})};(store.session.desktopSolids||=[]).push(solid);await store.flush();await studio.desktopHistory?.capture('Build '+spec.name+' from '+solid.sketchIds.length+' sketches');return {solidCreated:true,solid,modelIds:models.map(m=>m.id),models:models.map(m=>({id:m.id,version:m.version}))};
  }catch(e){try{if(api&&before){api=await ensure('cad');if(api.geometryStatus?.().phase!=='failed')await settled(api);api.restore(before);await settled(api);await refresh();}}catch(restoreError){throw Error(e.message+'; CAD rollback failed: '+restoreError.message);}throw e;}finally{working=false;}
 }
 properties.querySelector('#cad-extrude-figure').onclick=()=>{const f=figures.find(f=>f.id===selected);properties.querySelector('#cad-thickness-label').hidden=false;properties.querySelector('#cad-thickness').value=f?.extrusion?mm(extrusionThickness(f.extrusion)):'10';properties.querySelector('#cad-confirm-extrude').textContent=f?.extrusion?'Update extrusion':'Create extrusion';};properties.querySelector('#cad-confirm-extrude').onclick=async()=>{try{const distance=Number(properties.querySelector('#cad-thickness').value)/1000;await extrude(selected,distance);status.textContent='Native solid created · '+mm(distance)+' mm thickness';properties.querySelector('#cad-thickness-label').hidden=true;}catch(e){status.textContent=e.message;}};
 function setMode(value){if(value!=='select')studio.activePlacement?.detach();mode=value;studio.endAll();studio.setMode(value==='pen'?'draw':value==='erase'?'erase':'orbit');studio.controls.enabled=true;studio.controls.mouseButtons.LEFT=null;bar.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('selected',b.dataset.tool===value);b.setAttribute('aria-pressed',String(b.dataset.tool===value));});studio.onChange();status.textContent=value==='select'?'Select a figure to edit its dimensions':value==='pen'?'Freehand drawing':'Drag to create a '+value;}
 bar.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{if(b.dataset.tool==='select'&&studio.desktopMouse){void studio.desktopMouse.cursor();return;}if(b.dataset.tool==='erase'&&studio.desktopEditing){studio.desktopEditing.activateEraser();return;}if(b.dataset.tool==='pen'&&studio.beginSketch&&!studio.planeView?.isFlat)studio.beginSketch();else setMode(b.dataset.tool);});document.querySelector('#draw').addEventListener('click',()=>setMode('pen'));document.querySelector('#erase').addEventListener('click',()=>setMode('erase'));bar.querySelector('#desktop-native-editor').onclick=()=>studio.openNativeCAD?.();bar.querySelector('#cad-dimensions-toggle').onclick=e=>{labels.hidden=!labels.hidden;studio.nativeDimensions?.setVisible(!labels.hidden);if(labels.hidden)dimensionEditor.close();e.currentTarget.setAttribute('aria-pressed',String(!labels.hidden));};
 function planePoint(e){const rect=studio.renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),studio.camera);const surface=studio.surface.selected;if(surface)return studio.surface.point(ray.ray);if(studio.desktopPoint)return studio.desktopPoint(ray.ray);return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,0,1),.6),new T.Vector3())?.toArray();}
 const canvas=studio.renderer.domElement;canvas.addEventListener('pointerdown',e=>{if(e.button!==0||!['line','circle','rectangle','reference'].includes(mode))return;studio.decisionLab?.invalidate('Drawing a CAD element');start=planePoint(e);e.preventDefault();e.stopImmediatePropagation();if(start)canvas.setPointerCapture(e.pointerId);},true);canvas.addEventListener('pointerup',async e=>{if(!start)return;const end=planePoint(e),a=start;start=null;if(!end)return;const surface=studio.surface.selected,plane=surface?.frame||studio.desktopPlane,x=plane?.xAxis||[1,0,0],y=plane?.yAxis||[0,1,0],delta=vector(end).sub(vector(a)),args={kind:mode==='reference'?'line':mode,construction:mode==='reference',xAxis:x,yAxis:y,origin:a};if(mode==='circle')args.radiusMetres=delta.length();if(mode==='rectangle'){args.origin=vector(a).add(vector(end)).multiplyScalar(.5).toArray();args.widthMetres=Math.abs(delta.dot(vector(x)));args.heightMetres=Math.abs(delta.dot(vector(y)));}if(mode==='line'||mode==='reference')args.end=end;try{status.textContent='Creating native '+mode+'…';await commit(args);status.textContent='Native '+mode+' created';setMode('select');}catch(error){status.textContent=error.message;}});
 canvas.addEventListener('click',e=>{if(mode!=='select'||e.button!==0)return;const rect=canvas.getBoundingClientRect(),caster=new T.Raycaster();caster.params.Line.threshold=.008;caster.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),studio.camera);const hit=caster.intersectObjects([...meshes.values()])[0];if(hit)select(hit.object.userData.figureId);});
 const previousSelection=studio.desktopSelectionChanged;studio.desktopSelectionChanged=s=>{previousSelection?.(s);const model=studio.surfaceModels?.().find(m=>m.id===s?.modelId);if(!model)return;const size=new T.Box3().setFromObject(model.mesh).getSize(new T.Vector3());note.textContent='Measured '+s.kind+' · '+model.name;fields.replaceChildren();for(const [axis,value]of ['X','Y','Z'].map((axis,i)=>[axis,size.getComponent(i)])){const p=document.createElement('p');p.textContent=axis+' · '+mm(value)+' mm';fields.append(p);}properties.querySelector('#cad-apply-dimensions').disabled=true;properties.querySelector('#cad-extrude-figure').disabled=true;};
 const dimensionEditor=initDesktopDimensions({studio,figures,labels,dims,basis,points,select,commit,extrude,status});for(const f of figures)redraw(f);updateList();if(figures.length)select(figures.at(-1).id,false);
 properties.querySelector('#cad-element-ai').onclick=async()=>{const f=figures.find(f=>f.id===selected),text=properties.querySelector('#cad-element-prompt').value.trim();if(!f||!text){status.textContent='Select an element and type the requested change.';return;}try{await studio.modelAgent.submitInstruction('Edit only the selected figure '+f.id+' ('+(f.name||f.kind)+'). '+text,'element-prompt');}catch(e){status.textContent=e.message;}};
 function restoreFigures(saved,{preserveVersions=false}={}){const revision=Math.max(store.session.desktopFigureVersion||0,...figures.map(f=>f.version));for(const m of meshes.values()){m.removeFromParent();m.geometry.dispose();m.material.dispose();}meshes.clear();figures.splice(0,figures.length,...saved.map(f=>({...f,version:preserveVersions?f.version:Math.max(f.version,revision)+1})));store.session.desktopFigureVersion=Math.max(0,...figures.map(f=>f.version));for(const f of figures)redraw(f);updateList();select(figures.at(-1)?.id,false);studio.onChange();}
 async function commitComponents(components,{recordHistory=true}={}){
  if(working)throw Error('A drawing operation is already executing');for(const c of components){const f=figures.find(f=>f.id===c.figure.id);if(!f||f.version!==c.figure.version)throw Error('Sketch changed; select it again');validate(c.figure);verifyDecisionFigure(c.figure,{kind:c.figure.kind==='spline'?'profile':c.figure.kind,constraints:c.constraints});}
  await studio.desktopHistory?.before();const api=await ensure('cad'),documentBefore=api.document(),figuresBefore=structuredClone(figures),rulesBefore=structuredClone(store.session.decisionSketches||[]);
  try{for(const c of components){let meta=(store.session.decisionSketches||=[]).find(s=>s.figureId===c.figure.id);if(!meta){meta={id:crypto.randomUUID(),figureId:c.figure.id,kind:c.figure.kind==='spline'?'profile':c.figure.kind};store.session.decisionSketches.push(meta);}meta.constraints=structuredClone(c.constraints);await commit({...c.figure,expectedVersion:c.figure.version},figures.find(f=>f.id===c.figure.id),{recordHistory:false,previewImage:false});}if(recordHistory&&components.length)select(components[0].figure.id);await store.flush();if(recordHistory)await studio.desktopHistory?.capture('Edit sketch components'+(components.length>1?' · '+components.length+' linked figures':''));}
  catch(e){api.restore(documentBefore);await settled(api);await refresh();store.session.decisionSketches=rulesBefore;restoreFigures(figuresBefore,{preserveVersions:true});await store.flush();throw e;}
 }
 async function trimFigures(changes){
  if(working)throw Error('A drawing operation is already executing');for(const c of changes){const f=figures.find(f=>f.id===c.figureId);if(!f||f.version!==c.expectedVersion)throw Error('Sketch changed; erase again');if(f.extrusion||(store.session.desktopSolids||[]).some(s=>s.figureIds.includes(f.id)))throw Error('This profile supports a solid. Remove its extrusion or solid feature before opening the boundary.');for(const p of c.pieces)validate(p);}
  await studio.desktopHistory?.before();const api=await ensure('cad'),documentBefore=api.document(),figuresBefore=structuredClone(figures),rulesBefore=structuredClone(store.session.decisionSketches||[]),affected=new Set(changes.map(c=>c.figureId)),replacements=[],bySource=new Map();working=true;
  try{for(const c of changes){const old=figures.find(f=>f.id===c.figureId);bySource.set(old.id,[]);api.execute('deleteSketchObject',{sketchId:old.sketchId,objectId:old.objectId},api.document().version);await settled(api);for(const [i,p]of c.pieces.entries()){const f={...structuredClone(p),id:i?crypto.randomUUID():old.id,version:old.version+1,name:(old.name||old.kind)+(i?' / '+(i+1):''),desktopSketchId:old.desktopSketchId};delete f.extrusion;await native(f,null);replacements.push(f);bySource.get(old.id).push(f);}}
   const unique=figuresBefore.flatMap(f=>bySource.has(f.id)?bySource.get(f.id):[f]);
   store.session.decisionSketches=(store.session.decisionSketches||[]).filter(m=>!affected.has(m.figureId));for(const m of store.session.decisionSketches)if(m.constraints?.connections)m.constraints.connections=m.constraints.connections.filter(c=>!affected.has(c.referenceId));for(const f of replacements)store.session.decisionSketches.push({id:crypto.randomUUID(),figureId:f.id,kind:f.kind==='spline'?'profile':f.kind,constraints:defaultSketchRules(f),sourceStrokeIds:f.strokeIds||[]});restoreFigures(unique,{preserveVersions:true});store.session.revision++;await store.flush();await studio.desktopHistory?.capture('Erase CAD portions');studio.desktopSketches?.render();studio.desktopEditing?.refresh();
  }catch(e){api.restore(documentBefore);await settled(api);await refresh();store.session.decisionSketches=rulesBefore;restoreFigures(figuresBefore,{preserveVersions:true});await store.flush();throw e;}finally{working=false;}
 }
 // Called inside the same review transaction after the new solid and all
 // requested features have passed native validation.
 async function retireRedesignedBody(target){
  let api=await ensure('cad');const doc=await settled(api);
  const solids=store.session.desktopSolids||[],prior=solids.find(s=>s.bodyId===target.id&&s.featureId===target.featureId&&s.projectId===target.projectId);
  if(!prior||target.projectId!==doc.projectId||!doc.derived.exportableBodyIds.includes(target.id))throw Error('The original body changed during redesign.');
  const retained=doc.derived.exportableBodyIds.filter(id=>id!==target.id);
  if(!retained.length)throw Error('The replacement must be built before retiring the original.');
  const chain=Object.values(doc.nodes).filter(n=>n.kind==='feature'&&n.bodyId===target.id);
  if(!chain.some(f=>f.featureId===target.featureId))throw Error('The original feature is no longer available.');
  for(const f of chain.reverse()){
   api=await ensure('cad');if(!Object.values(api.document().nodes).some(n=>n.featureId===f.featureId))continue;
   api.execute('deleteFeature',{featureId:f.featureId},api.document().version);await settled(api);
  }
  const next=await settled(api);
  if(next.derived.exportableBodyIds.includes(target.id))throw Error('The original body still exists after replacement.');
  for(const id of retained){
   const old=doc.derived.bodyRepresentations[id],updated=next.derived.bodyRepresentations[id];
   if(!next.derived.exportableBodyIds.includes(id))throw Error('Replacement lost a previously valid solid: '+id);
   if(Math.abs(updated.volume-old.volume)>Math.max(1e-6,old.volume*1e-7))throw Error('Replacement changed the volume of '+id+' from '+old.volume+' to '+updated.volume);
  }
  store.session.desktopSolids=solids.filter(s=>s.bodyId!==target.id);
  for(const f of figures)if(f.extrusion?.bodyId===target.id)delete f.extrusion;
  await refresh();await store.flush();
 }
 async function placeBody(bodyId,{translation=[0,0,0],rotation=[0,0,0],center=false,preview=false}={}){
  if(working||[...translation,...rotation].some(v=>!Number.isFinite(v)))throw Error('Enter finite move and rotation values.');
  working=true;let cad,before,changed=false;
  try{
   if(!preview)await studio.desktopHistory.before();
   cad=await ensure('cad');await settled(cad);before=cad.document();
   const body=before.derived.bodyRepresentations?.[bodyId],box=body?.bbox;
   if(!body?.exportableStep||body.consumed||!box)throw Error('Select a current solid body.');
   const unit={mm:1000,cm:100,m:1,inch:1/.0254}[before.units],origin=convert([0,1.15,-.6],unit);
   const pivot=Object.fromEntries(['x','y','z'].map(k=>[k,(box.min[k]+box.max[k])/2]));
   const delta=convert(translation,unit/1000),angles=convert(rotation);
   const target=Object.fromEntries(['x','y','z'].map(k=>[k,(center?origin[k]:pivot[k])+delta[k]]));
   function move(name,offset,rot){
    cad.execute('transformBody',{name,targetBodyId:bodyId,translation:offset,rotationDeg:rot},cad.document().version);changed=true;
   }
   if(rotation.some(v=>Math.abs(v)>1e-5)){
    move('Body rotation pivot',Object.fromEntries(Object.entries(pivot).map(([k,v])=>[k,-v])));
    await settled(cad);move('Rotate body', {x:0,y:0,z:0},angles);await settled(cad);
    // Recenter the actual rotated bounds for the Align command.
    if(center){const b=cad.document().derived.bodyRepresentations[bodyId].bbox;for(const k of ['x','y','z'])target[k]-=(b.min[k]+b.max[k])/2;}
    move('Place body',target);
   }else{
    const offset=Object.fromEntries(['x','y','z'].map(k=>[k,target[k]-pivot[k]]));
    if(Object.values(offset).some(v=>Math.abs(v)>1e-7))move('Move body',offset);
   }
   if(changed){
    await builtBody(bodyId,'Body placement',before.projectId,true);
    if(!preview)await studio.desktopHistory.capture('Move / rotate body');
    store.log('cad.body.placed',{bodyId,translation,rotation,center});
   }
  }catch(error){if(changed&&before){cad.restore(before);await settled(cad);await refresh();}throw error;}
  finally{working=false;studio.onChange();}
 }
 const api={retireRedesignedBody,placeBody,setTemporaryHidden(ids){temporaryHidden=new Set(ids);for(const f of figures){const mesh=meshes.get(f.id);if(mesh)mesh.visible=!f.hidden&&!temporaryHidden.has(f.id);}studio.onChange();},trimFigures,commitComponents,get mode(){return mode;},get working(){return working;},get selectedId(){return userSelected?selected:null;},restoreFigures,names:['drawing_list','drawing_create','drawing_update'],summary,select,setMode,points,validate,extrude,createSolid,dimensionEditor,async dispatch(tool,a){if(tool==='drawing_list')return {figures:summary(),units:'metres'};if(tool==='drawing_create')return commit(a);const f=figures.find(f=>f.id===a.figureId);if(!f)throw Error('Unknown drawing figure');return commit(a,f);}};studio.desktopDrawing=api;initSketchComponentEditor({studio,store,status});initDesktopEditing({studio,store,status});return api;
}
