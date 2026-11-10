export function createSessionWriter(name){
 if(typeof Worker==='undefined')return null;
 let worker,serial=0,failed=false;const pending=new Map();
 try{worker=new Worker(new URL('./session-writer-worker.js',import.meta.url),{type:'module'});}catch{return null;}
 worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);clearTimeout(job.timer);data.error?job.reject(Error(data.error)):job.resolve();};
 worker.onerror=()=>{failed=true;worker.terminate();for(const job of pending.values()){clearTimeout(job.timer);job.reject(Error('Background storage stopped; the next save uses local fallback'));}pending.clear();};
 return {get failed(){return failed;},write(snapshot,batch){if(failed)return Promise.reject(Error('Background storage is unavailable'));return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);failed=true;worker.terminate();reject(Error('Background save timed out; export the session if this persists'));},30000);pending.set(id,{resolve,reject,timer});try{worker.postMessage({id,name,snapshot,batch});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}});},close(){failed=true;worker.terminate();for(const job of pending.values()){clearTimeout(job.timer);job.reject(Error('Background storage closed'));}pending.clear();}};
}
export function automaticSessionSnapshotDue(now,lastSnapshot,interval=10000){return now-lastSnapshot>=interval;}
