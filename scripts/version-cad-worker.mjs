import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// These pinned upstream assets keep their names when our native adapters change.
// Version the entire path into the module worker, including its circular import.
export async function versionCadWorker(root){
 const entry='draw3d-index-CyggANDN.js';
 const moduleFile='draw3d-kernel-module.js';
 const imports=new Map([
  ['occt-wasm-DNj0ubLK.js',[]],['draw3d-exact-cut.js',['occt-wasm-DNj0ubLK.js']],['cad-worker-wire.js',[]],[moduleFile,['cad-worker-wire.js']],
  [entry,['geometryWorker-BxZDCU2M.js',moduleFile]],
  ['geometryWorker-BxZDCU2M.js',['exact-gW6BI5D5.js',moduleFile,'exact-DaAeGT7W.js']],
  ['exact-gW6BI5D5.js',['exact-DaAeGT7W.js']],
  ['exact-DaAeGT7W.js',['exact-analysis-CscwUq6X.js',moduleFile,'draw3d-exact-cut.js']],
  ['exact-analysis-CscwUq6X.js',['exact-DaAeGT7W.js']]
 ]);
 const assets=path.join(root,'assets'),sources=new Map(),hash=createHash('sha256');
 await writeFile(path.join(assets,moduleFile),await readFile(new URL('../src/cad-kernel-module.js',import.meta.url)));
 await writeFile(path.join(assets,'cad-worker-wire.js'),await readFile(new URL('../src/cad-worker-wire.js',import.meta.url)));
 await writeFile(path.join(assets,'draw3d-exact-cut.js'),await readFile(new URL('../src/cad-exact-cut.js',import.meta.url)));
 for(const name of imports.keys()){
  let source=(await readFile(path.join(assets,name),'utf8')).replace(/\?draw3dKernel=[a-f0-9]{12}/g,'');
  if(name===entry&&!source.includes('editingStatus:')){
   const marker='__draw3dCAD={';if(source.split(marker).length!==2)throw Error('Review CAD editing mode bridge');
   source=source.replace(marker,marker+'editingStatus:()=>({mode:Qs.current,reason:Cu.current||null}),enableEditing:()=>{if(Xl||_u)throw Error(Xl||_u);om(`build`);},');
  }
  if(name===entry&&!source.includes('draw3dCadCommandError')){
   const caught='catch(e){return V($(e,`Command failed.`)),!1}',rejected='if(!Np(r))throw Error(`CAD rejected the command; inspect document diagnostics`);';
   if(source.split(caught).length!==2||source.split(rejected).length!==2)throw Error('Review CAD command diagnostics bridge');
   source=source.replace(caught,'catch(e){window.draw3dCadCommandError=e?.message||String(e);return V($(e,`Command failed.`)),!1}').replace('let r=N[e](...Array.isArray(t)?t:[t]);','window.draw3dCadCommandError=null;let r=N[e](...Array.isArray(t)?t:[t]);');
   source=source.replace(rejected,'if(!Np(r)){const message=window.draw3dCadCommandError||Cu.current||`CAD rejected the command`;window.parent.postMessage({channel:"draw3d.cad",type:"command-error",data:{operation:e,version:n,error:message}},location.origin);const failure=Error(message);failure.cadCommandError=true;throw failure;}');
  }
  if(name===entry&&!source.includes('geometryStatus:()=>')){
   const marker='__draw3dCAD={';
   if(!source.includes(marker)||!source.includes('Y.state.phase'))throw Error('Review native CAD geometry status bridge');
   source=source.replace(marker,marker+'geometryStatus:()=>({phase:Y.state.phase,error:Y.state.error}),');
  }
  if(name===entry&&!source.includes('draw3dMemoryRetry')){
   // The pinned editor restarts crashed workers, but a WASM allocation error
   // delivered as a normal state message otherwise leaves the same heap alive.
   const hook='if(t.type===`state`){if(!t.requestId&&t.phase===`ready`&&E)return;';
   const closure='let e=!1,v=0,x=`starting`,S=0,C=null,w=0,ee=';
   if(source.split(hook).length!==2||source.split(closure).length!==2)throw Error('Review geometry worker memory recovery against the pinned CAD entry');
   source=source.replace(closure,'let draw3dMemoryRetry=null,'+closure.slice(4)).replace(hook,hook+`
    if(!t.requestId&&t.phase==='failed'&&/out of memory|memory allocation failed|could not allocate memory/i.test(t.error||'')){
     const doc=b.current.manager()?.document,key=JSON.stringify([doc?.projectId,doc?.version]);
     if(doc&&key!==draw3dMemoryRetry){
      draw3dMemoryRetry=key;
      window.parent.postMessage({channel:'draw3d.cad',type:'memory-recovery',data:{projectId:doc.projectId,version:doc.version,phase:x}},location.origin);
      draw3dRestartMemory('CAD memory exhausted during '+x+'.');return;
     }
    }`);
  }
  if(name===entry&&!source.includes('const draw3dRestartMemory=')){
   const handler='ee.onmessage=e=>{let t=e.data;';
   if(source.split(handler).length!==2)throw Error('Review geometry worker restart scope');
   source=source.replace(handler,'const draw3dRestartMemory=reason=>T(ee,reason);'+handler);
  }
  if(name==='geometryWorker-BxZDCU2M.js'&&!source.includes('kernelMemoryDiagnostic')){
   const failure='s(U(`failed`,t,{stale:!0,error:i}))';
   if(source.split(failure).length!==2)throw Error('Review native worker failure telemetry');
   source=source.replace(failure,"s({...U(`failed`,t,{stale:!0,error:i}),kernelMemoryDiagnostic:{kernelState:W,operation:t.type,bodyCount:n.bodyOrder.length,featureCount:n.featureOrder.length,allocatedWasmBytes:q.allocatedWasmBytes??null,errorType:r?.name||null}})");
  }
  if(name===entry&&!source.includes('kernelMemoryDiagnostic')){
   const recover="if(doc&&key!==draw3dMemoryRetry){";
   const message="window.parent.postMessage({channel:'draw3d.cad',type:'memory-recovery',data:{projectId:doc.projectId,version:doc.version,phase:x}},location.origin);";
   const restart="const draw3dRestartMemory=reason=>T(ee,reason);";
   if(![recover,message,restart].every(marker=>source.split(marker).length===2))throw Error('Review native CAD memory diagnostic bridge');
   source=source.replace(message,'').replace(recover,`
    if(doc)window.parent.postMessage({channel:'draw3d.cad',type:'memory-recovery',data:{projectId:doc.projectId,version:doc.version,phase:x,retrying:key!==draw3dMemoryRetry,diagnostic:t.kernelMemoryDiagnostic}},location.origin);
    `+recover).replace(restart,"const draw3dRestartMemory=reason=>{ee.terminate();y({type:'state',phase:'starting',stale:true});setTimeout(()=>T(ee,reason),350);};");
  }
  if(name===entry&&!source.includes('import{createGeometryWorker}')){
   const marker='new Worker(new URL(`/cad/assets/geometryWorker-BxZDCU2M.js`';
   if(source.split(marker).length!==2)throw Error('Review native geometry worker creation');
   source='import{createGeometryWorker}from"./'+moduleFile+'";'+source.replace(marker,marker.replace('new Worker','createGeometryWorker'));
  }
  if(name==='geometryWorker-BxZDCU2M.js'&&!source.includes('import{attachGeometryWorker}')){
   source='import{attachGeometryWorker}from"./'+moduleFile+'";attachGeometryWorker();'+source;
  }
  if(name==='geometryWorker-BxZDCU2M.js'&&!source.includes("e.data?.type==='draw3d.attach-kernel'")){
   const marker='self.onmessage=e=>{let t=le(e.data);';
   if(source.split(marker).length!==2)throw Error('Review native worker control message routing');
   source=source.replace(marker,"self.onmessage=e=>{if(e.data?.type==='draw3d.attach-kernel'||e.data?.type==='draw3d.compiled-kernel')return;let t=le(e.data);");
  }
  if(name==='exact-DaAeGT7W.js'&&!source.includes('import{instantiateRemus}')){
   const marker='Cn=await re({"./remus_wasm_bg.js":';
   if(source.split(marker).length!==2||!source.includes('remus_wasm_bg-hcEhcIw4.wasm'))throw Error('Review native kernel instantiation');
   source='import{instantiateRemus}from"./'+moduleFile+'";'+source.replace(marker,marker.replace('await re','await instantiateRemus'));
  }
  if(name==='occt-wasm-DNj0ubLK.js'&&!source.includes('!globalThis.__draw3dServerCad&&')){
   const guard='o=globalThis.process?.versions?.node';if(!source.includes(guard))throw Error('Review OpenCascade environment detection');
   source=source.replace(guard,'o=!globalThis.__draw3dServerCad&&globalThis.process?.versions?.node');
  }
  if(name==='exact-DaAeGT7W.js'&&!source.includes('import{enableExactCut,exactCut}')){
   const hook='if(a.status===`ok`)return{status:`ok`,solid:a.value};let o=a.details';
   if(source.split(hook).length!==2)throw Error('Review the exact boolean adapter');
   source='import{enableExactCut,exactCut}from"./draw3d-exact-cut.js";'+source.replace(hook,
    'if(a.status===`ok`)return{status:`ok`,solid:a.value};if(t==="cut"&&ru){const fallback=exactCut(e,n,r,ru,Nv);if(fallback!=null)return{status:"ok",solid:fallback};}let o=a.details');
   source+='\nexport async function prepareDraw3dCut(){await Promise.all([enableExactCut(),tu()]);}';
  }
  if(name==='geometryWorker-BxZDCU2M.js'&&!source.includes('import{prepareDraw3dCut}')){
   const hook='try{if(s(U(`starting`,t,{stale:!0})),t.type===`preview-geometry`)';
   if(source.split(hook).length!==2)throw Error('Review cut preparation in native worker');
   source='import{prepareDraw3dCut}from"./exact-DaAeGT7W.js";'+source.replace(hook,'try{if(Object.values(n.nodes||{}).some(node=>node.data?.operation==="subtract"))await prepareDraw3dCut();'+hook.slice(4));
  }
  if(name==='exact-DaAeGT7W.js'){
   source=source.replace('prepareDraw3dCut(){await Promise','prepareDraw3dCut(){await au();await Promise');
   const marker='let s=o.result;return!s||s.quality!==`exact`?';
   if(!source.includes('if(recovered!=null)return')){
    if(source.split(marker).length!==2)throw Error('Review cancellable boolean recovery');
    source=source.replace(marker,'let s=o.result;if(t==="cut"&&ru&&(!s||s.quality!=="exact")){const recovered=exactCut(e,n,r,ru,Nv);if(recovered!=null)return{status:"ok",solid:recovered};}return!s||s.quality!==`exact`?');
   }
  }
  if(name==='exact-DaAeGT7W.js'){
   const fuseHook='e.fuseAll(Uint32Array.from(t))}catch(r){throw U_(e,t,n,r)??r}';
   if(!source.includes('const joined=exactCut')){
    if(source.split(fuseHook).length!==2)throw Error('Review native multi-body union adapter');
    source=source.replace(fuseHook,'e.fuseAll(Uint32Array.from(t))}catch(r){if(t.length===2&&ru){const joined=exactCut(e,t[0],t[1],ru,Nv,"fuse");if(joined!=null)return joined;}throw U_(e,t,n,r)??r}');
   }
   source=source.replaceAll('t==="cut"&&ru','["cut","fuse","intersect"].includes(t)&&ru').replaceAll('exactCut(e,n,r,ru,Nv)','exactCut(e,n,r,ru,Nv,t)');
  }
  if(name==='geometryWorker-BxZDCU2M.js')source=source.replace('node.data?.operation==="subtract"','["subtract","union","intersect"].includes(node.data?.operation)');
  if(name==='exact-DaAeGT7W.js'&&!source.includes('return verifiedBooleanStep(')){
   const marker='return lv(n.exportStep(r.serializeSolids(new Uint32Array(a))))';
   if(source.split(marker).length!==2)throw Error('Review the native STEP export adapter');
   source='import{verifiedBooleanStep}from"./draw3d-exact-cut.js";'+source.replace(marker,'const text=lv(n.exportStep(r.serializeSolids(new Uint32Array(a))));return verifiedBooleanStep(text,e,t,i,r,n,b[e.units],()=>a.length===1?r.volume(a[0],J):0)');
  }
  sources.set(name,source);hash.update(source);
 }
 const manifestFile=path.join(root,'asset-manifest.json');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
 for(const dep of [moduleFile,'cad-worker-wire.js','draw3d-exact-cut.js'])if(!manifest.includes(dep))manifest.push(dep);
 await writeFile(manifestFile,JSON.stringify(manifest));
 const suffix='?draw3dKernel='+hash.digest('hex').slice(0,12);
 for(const [name,deps] of imports){
  let source=sources.get(name);
  for(const dep of deps){
   if(!source.includes(dep))throw Error('Missing native CAD module reference '+dep);
   source=source.replaceAll(dep,dep+suffix);
  }
  await writeFile(path.join(assets,name),source);
 }
 const file=path.join(root,'index.html'),url='/cad/assets/'+entry;
 const html=(await readFile(file,'utf8')).replace(/\s*<script id="draw3d-kernel-imports"[^>]*>.*?<\/script>/,'').replace(/\?draw3dKernel=[a-f0-9]{12}/g,'');
 if(!html.includes('src="'+url+'"'))throw Error('Unexpected native CAD entry point');
 await writeFile(file,html.replace('<head>','<head>\n<script id="draw3d-kernel-imports" type="importmap">'+JSON.stringify({imports:{[url]:url+suffix}})+'</script>').replace('src="'+url+'"','src="'+url+suffix+'"'));
}
