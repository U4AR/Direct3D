import {encodeCadMessage,decodeCadMessage} from './cad-worker-wire.js';
const kernelURL = new URL('/cad/assets/remus_wasm_bg-hcEhcIw4.wasm', globalThis.location.href).href;
const cacheKey = Symbol.for('draw3d.compiled-cad-kernels');
const attach = 'draw3d.attach-kernel';
const request = 'draw3d.request-kernel';
const response = 'draw3d.compiled-kernel';

function owner() {
  // CAD iframes can be replaced while the drawing page remains open.
  if (typeof window !== 'undefined' && window.parent !== window) {
    try { if (window.parent.location.origin === location.origin) return window.parent; } catch {}
  }
  return typeof window === 'undefined' ? globalThis : window;
}

function compiledKernel() {
  const host = owner();
  const cache = host[cacheKey] ||= new Map();
  if (!cache.has(kernelURL)) {
    const compilation = (async () => {
      const asset = await fetch(kernelURL);
      if (!asset.ok) throw Error('CAD kernel download failed (' + asset.status + ')');
      if (WebAssembly.compileStreaming && asset.headers.get('Content-Type')?.startsWith('application/wasm')) {
        return WebAssembly.compileStreaming(asset);
      }
      return WebAssembly.compile(await asset.arrayBuffer());
    })();
    cache.set(kernelURL, compilation);
    // A failed warm-up must never poison a later modelling request.
    compilation.catch(() => cache.delete(kernelURL));
  }
  return cache.get(kernelURL);
}

export function warmCadKernel() {
  if(!owner().draw3dRemoteCad)void compiledKernel();
}

export function createGeometryWorker(url, options) {
  const worker = new Worker(url, options);
  const host=owner(),clientId=crypto.randomUUID(),controller=new AbortController();
  const post=worker.postMessage.bind(worker),terminate=worker.terminate.bind(worker);
  let waiting=[],remote=false,stopped=false,chain=Promise.resolve();
  const cancelled=new Set();
  let latestSync;
  const deliver=data=>{if(!stopped)worker.dispatchEvent(new MessageEvent('message',{data}));};
  function sendRemote(command){
    if(command.type==='cancel'){cancelled.add(command.requestId);return;}
    const jobId=crypto.randomUUID(),broadcast=command.type==='sync'&&!command.requestId;
    if(broadcast)latestSync=jobId;
    const state={type:'state',phase:'rebuilding',projectId:command.document.projectId,version:command.document.version,requestId:command.requestId,stale:true};
    queueMicrotask(()=>{if(!broadcast||latestSync===jobId)deliver(state);});
    chain=chain.then(async()=>{
      if(stopped||command.requestId&&cancelled.delete(command.requestId))return;
      try{
        const reply=await host.draw3dServerCadJob({clientId,jobId,command:encodeCadMessage(command)},controller.signal);
        if(command.requestId&&cancelled.delete(command.requestId))return;
        for(const m of reply.messages){
          if(m.type==='state'&&broadcast&&latestSync!==jobId)continue;
          deliver(decodeCadMessage(m));
          // Each native worker message normally arrives in its own event-loop turn.
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }catch(error){
        const state={projectId:command.document?.projectId,version:command.document?.version,requestId:command.requestId,error:'Server CAD: '+error.message};
        deliver({type:command.type,ok:false,...state});deliver({type:'state',phase:'failed',stale:true,...state});
      }
    });
  }
  function switchToServer(){
    host.draw3dRemoteCad=true;remote=true;terminate();
    window.parent.postMessage({channel:'draw3d.cad',type:'server-recovery'},location.origin);
    for(const command of waiting)sendRemote(command);
    waiting=null;
  }
  worker.postMessage=(command,...args)=>{
    if(remote){sendRemote(structuredClone(command));return;}
    if(waiting)waiting.push(structuredClone(command));
    post(command,...args);
  };
  worker.terminate=()=>{stopped=true;controller.abort();terminate();};
  if(host.draw3dRemoteCad&&host.draw3dServerCadJob){switchToServer();return worker;}
  worker.addEventListener('message', async event => {
    if (event.data?.type !== request) {
      const m=event.data;
      if(waiting&&m?.type==='state'&&['ready','failed'].includes(m.phase)){
        waiting=waiting.filter(command=>command.document?.projectId!==m.projectId||command.document?.version!==m.version||command.requestId!==m.requestId);
      }
      return;
    }
    event.stopImmediatePropagation();
    try {
      const module = await compiledKernel();
      if(stopped)return;
      post({type: response, module});waiting=null;
    } catch (error) {
      // Some embedding policies forbid structured-cloning modules across realms.
      if(stopped)return;
      if(host.draw3dServerCadJob&&/out of memory|allocation failed|could not allocate/i.test(error.message)){switchToServer();return;}
      post({type: response, local: error.name === 'DataCloneError', error: error.message});
    }
  });
  post({type: attach});
  warmCadKernel();
  return worker;
}

let useOwner = false;
export function attachGeometryWorker() {
  self.addEventListener('message', event => {
    if (event.data?.type === attach) {
      event.stopImmediatePropagation();
      useOwner = true;
    }
  }, {capture: true});
}

async function workerModule() {
  if (!useOwner) return compiledKernel();
  return new Promise((resolve, reject) => {
    function receive(event) {
      if (event.data?.type !== response) return;
      event.stopImmediatePropagation();
      self.removeEventListener('message', receive, true);
      if (event.data.module) resolve(event.data.module);
      else if (event.data.local) resolve(compiledKernel());
      else reject(Error(event.data.error));
    }
    self.addEventListener('message', receive, {capture: true});
    self.postMessage({type: request});
  });
}

export async function instantiateRemus(imports, asset) {
  if (new URL(asset, kernelURL).href !== kernelURL) throw Error('Unexpected CAD kernel asset');
  let module;
  try { module = await workerModule(); }
  catch (error) { throw Error('CAD kernel compilation failed: ' + error.message, {cause: error}); }
  // Only executable code is shared. Every worker owns its mutable geometry heap.
  return (await WebAssembly.instantiate(module, imports)).exports;
}
