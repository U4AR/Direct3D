import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {encodeCadMessage,decodeCadMessage} from '../src/cad-worker-wire.js';

const workers=new Map();
const operations=new Set(['sync','preview-geometry','mass-properties','export','mesh-quality','section','solve-sketch','sketch-2d-op','recognize-imported-face']);
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function close(key,slot){
 if(workers.get(key)!==slot)return;
 workers.delete(key);clearTimeout(slot.idle);void slot.worker.terminate();
}
export async function serverCadJob(sessionId,{clientId,jobId,command}){
 if(!uuid.test(clientId)||!uuid.test(jobId)||!operations.has(command?.type)||typeof command.document?.projectId!=='string')throw Error('Invalid CAD worker request');
 const key=sessionId+'/'+clientId;
 let slot=workers.get(key);
 if(!slot){
  if(workers.size>=4){
   const idle=[...workers].filter(([,s])=>!s.busy).sort((a,b)=>a[1].used-b[1].used)[0];
   if(!idle)throw Error('Server CAD workers are busy. Retry the build.');
   close(...idle);
  }
  const assets=path.resolve(process.env.DRAW3D_STATIC_DIR||'dist','cad','assets');
  slot={worker:new Worker(new URL('./cad-server-worker.mjs',import.meta.url),{workerData:{assets},resourceLimits:{maxOldGenerationSizeMb:384}})};
  workers.set(key,slot);
  slot.worker.on('error',()=>close(key,slot));
  if(command.type==='sync')command={...command,forceFull:true};
 }
 if(slot.jobId===jobId)return slot.result;
 if(slot.busy)throw Error('Previous CAD operation still running');
 clearTimeout(slot.idle);slot.busy=true;slot.jobId=jobId;
 slot.result=new Promise((resolve,reject)=>{
  const messages=[];
  const finish=(error)=>{
   clearTimeout(timer);slot.worker.off('message',onMessage);slot.worker.off('error',finish);slot.worker.off('exit',onExit);
   slot.busy=false;slot.used=Date.now();
   if(error){close(key,slot);reject(error);return;}
   slot.idle=setTimeout(()=>close(key,slot),60000);slot.idle.unref();resolve({messages});
  };
  const onExit=()=>finish(Error('Server CAD worker stopped'));
  function onMessage(m){
   try{
    // Keep the terminal state and exact geometry; repeated progress ticks are already shown by the client.
    if(m.type==='state'&&!['ready','failed'].includes(m.phase))return;
    messages.push(encodeCadMessage(m));
    if(m.type==='state')finish();
   }catch(error){finish(error);}
  }
  const timer=setTimeout(()=>finish(Error('Server CAD rebuild timed out')),45000);
  slot.worker.on('message',onMessage);slot.worker.once('error',finish);slot.worker.once('exit',onExit);
  try{slot.worker.postMessage(decodeCadMessage(command));}catch(error){finish(error);}
 });
 return slot.result;
}
