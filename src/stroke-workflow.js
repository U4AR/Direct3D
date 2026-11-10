import {initDrawingRecorder} from './drawing-recorder.js';
import * as T from 'three';
export function initStrokeWorkflow(studio,store){
 const group=new T.Group();group.name='Local fitted stroke references';group.visible=!document.body.classList.contains('desktop-studio');studio.scene.add(group);
 const previews=new Map(),pending=new Map();let serial=0,worker,lastSync=-Infinity;
 const panel=document.createElement('section');panel.id='stroke-workflow';
 panel.innerHTML='<details class="sketch-options"><summary>Sketch options</summary><label>Mode <select id="creation-mode"><option value="incremental">Stroke by stroke</option><option value="full">Full object</option></select></label><p id="workflow-help"></p><label><input id="show-fits" type="checkbox" checked> Show fitted geometry</label><label><input id="show-raw" type="checkbox" checked> Show original strokes</label><label>Curve degree <select id="curve-degree"><option>2</option><option selected>3</option><option>5</option><option>7</option></select></label><label>Fit tolerance (mm) <input id="fit-tolerance" type="number" min="0.1" max="100" step="0.5" placeholder="Auto"></label><button id="refit-stroke">Refit latest stroke</button><p id="fit-status" role="status">Draw a stroke to fit it locally.</p></details>';
 document.querySelector('.left-panel .tool-tabs').before(panel);
 const mode=panel.querySelector('#creation-mode'),status=panel.querySelector('#fit-status');
 mode.value=store.session.creationMode==='full'?'full':'incremental';
 const setStatus=text=>{status.textContent=text;studio.fitStatus=text;studio.updateHUD();};
 const free=m=>{m.geometry.dispose();m.material.dispose();m.removeFromParent();};
 function restore(s){const old=previews.get(s.id);if(old)free(old);previews.delete(s.id);const fit=s.localFit?.selected;if(!fit?.path?.length)return;
  const geometry=new T.BufferGeometry().setFromPoints(fit.path.map(p=>new T.Vector3(...p))),line=new T.Line(geometry,new T.LineBasicMaterial({color:fit.accepted?0x78caff:0xffbd78,depthTest:false}));line.renderOrder=30;line.userData.strokeId=s.id;group.add(line);previews.set(s.id,line);sync(true);
 }
 function sync(force=false){const now=performance.now();if(!force&&now-lastSync<100)return;lastSync=now;const showFits=panel.querySelector('#show-fits').checked,showRaw=panel.querySelector('#show-raw').checked;const existing=new Map(store.session.strokes.map(s=>[s.id,s]));for(const [id,m]of previews){const s=existing.get(id);if(!s){free(m);previews.delete(id);}else m.visible=!s.hidden&&showFits;}
  for(const s of store.session.strokes){const m=studio.strokeMeshes.get(s.id);if(m)m.visible=!s.hidden&&!studio.desktopPreviewStrokeIds?.has(s.id)&&(showRaw||!s.localFit?.selected);}
 }
 function launch(){worker=new Worker(new URL('./stroke-fit-worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);clearTimeout(job.timer);data.error?job.reject(Error(data.error)):job.resolve(data.result);};worker.onerror=()=>{for(const job of pending.values()){clearTimeout(job.timer);job.reject(Error('Local fitting worker failed; original drawing is saved. Refit to retry.'));}pending.clear();worker.terminate();worker=null;};}
 const tasks=new Map();
 function fit(s,{force=false,...options}={}){
  if(tasks.has(s.id))return tasks.get(s.id).then(result=>s.localFit||fit(s,{force:true,...options}));
  if(s.localFit?.version===1&&s.localFit?.algorithmRevision===4&&s.localFit?.regularization?.version===1&&!force)return Promise.resolve(s.localFit);
  if(!worker)launch();setStatus('Fitting stroke locally…');const id=++serial;
  const sourcePoints=JSON.stringify(s.points);
  const job=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Stroke fitting timed out; original drawing retained.'));},30000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,points:s.points,options:{curveDegree:Number(panel.querySelector('#curve-degree').value),...(panel.querySelector('#fit-tolerance').value?{toleranceMetres:Number(panel.querySelector('#fit-tolerance').value)/1000}:{}),...options}});});
  const task=job.then(async result=>{if(!store.session.strokes.includes(s)||JSON.stringify(s.points)!==sourcePoints)return result;s.localFit=result;s.fitVersion=(s.fitVersion||0)+1;restore(s);store.log('stroke.local-fit',{strokeId:s.id,fitVersion:s.fitVersion,result});await store.flush();const f=result.selected;setStatus(f?`${f.kind} · ${(f.errors.rmsMetres*1000).toFixed(1)} mm RMS${f.accepted?'':' · approximate, inspect'}`:result.message);return result;}).catch(e=>{setStatus(e.message);throw e;}).finally(()=>tasks.delete(s.id));tasks.set(s.id,task);return task;
 }
 const recorder=initDrawingRecorder(studio,store,panel);
 function completed(s){recorder.capture(s);if(mode.value==='incremental')fit(s).catch(()=>{});}
 function changeMode(){store.session.creationMode=mode.value;document.body.dataset.creationMode=mode.value;
  panel.querySelector('#workflow-help').textContent=mode.value==='incremental'?'Each stroke becomes a local geometric reference. Speak or type to modify it or build the next feature.':'Build a complete object with AI, the CAD / Sculpt editors, or the depth-to-mesh pipeline.';
  store.log('workflow.mode',{mode:mode.value});store.flush().catch(()=>{});studio.updateHUD();}
 mode.onchange=changeMode;panel.querySelector('#show-fits').onchange=()=>sync(true);panel.querySelector('#show-raw').onchange=()=>sync(true);
 panel.querySelector('#refit-stroke').onclick=()=>{const s=store.session.strokes.filter(s=>!s.hidden).at(-1);if(s)fit(s,{force:true}).catch(()=>{});};
 const api={restore,sync,fit,completed,mode:()=>mode.value,summary:()=>({mode:mode.value,policy:mode.value==='incremental'?'Use latest stroke fits as spatial references for the requested next feature. Do not invent a whole object unless asked.':'Full object creation',fits:store.session.strokes.filter(s=>!s.hidden&&s.localFit).slice(-16).map(s=>({strokeId:s.id,fitVersion:s.fitVersion,status:s.localFit.status,kind:s.localFit.selected?.kind,parameters:s.localFit.selected?.parameters,errors:s.localFit.selected?.errors,regularization:s.localFit.regularization,units:'metres',coordinateSystem:'world Y-up'}))})};
 studio.strokeWorkflow=api;for(const s of store.session.strokes)restore(s);changeMode();return api;
}
