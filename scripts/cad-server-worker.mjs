import {parentPort,workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Run the pinned editor worker, including its exact geometry kernel, with the
// same message contract as the browser. Only its packaged WASM assets may load.
const assets=workerData.assets;
globalThis.__draw3dServerCad=true;
globalThis.self=globalThis;
globalThis.location=new URL('http://cad.local/cad/assets/geometryWorker-BxZDCU2M.js');
const events=new EventTarget();
globalThis.addEventListener=events.addEventListener.bind(events);
globalThis.removeEventListener=events.removeEventListener.bind(events);
globalThis.fetch=async input=>{
 const url=new URL(typeof input==='string'?input:input.url||input.href,location);
 if(url.origin!==location.origin||!/^\/cad\/assets\/(?:remus_wasm(?:_io)?_bg-[\w-]+|occt-wasm-gYVViyDS)\.wasm$/.test(url.pathname))throw Error('Unknown native CAD asset');
 const bytes=await readFile(path.join(assets,path.basename(url.pathname)));
 return new Response(bytes,{headers:{'Content-Type':'application/wasm'}});
};
globalThis.postMessage=message=>parentPort.postMessage(message);
await import(pathToFileURL(path.join(assets,'geometryWorker-BxZDCU2M.js')).href);
parentPort.on('message',data=>self.onmessage({data}));
