import {setTimeout as delay} from 'node:timers/promises';
import {recoverableConnectionError} from '../src/request-recovery.js';

// Only repeat read-only provider operations. Callers apply geometry once, after
// the complete response. The same deadline covers all attempts and backoff.
export async function readProvider(fetcher,url,options,read,{stage,onRetry}={}) {
 const {signal}=options;
 for(let attempt=1;;attempt++){
  signal?.throwIfAborted();
  try{
   const response=await fetcher(url,options);
   if([408,502,503,504].includes(response.status)){
    await response.body?.cancel();
    throw Object.assign(Error('HTTP '+response.status),{transient:true});
   }
   return await read(response);
  }catch(error){
   signal?.throwIfAborted();
   if(!recoverableConnectionError(error)&&!recoverableConnectionError(error.cause)&&error.message!=='terminated')throw error;
   const code=error.cause?.code||error.code;
   const reason=typeof code==='string'&&/^[A-Z0-9_]+$/.test(code)?code:error.message;
   if(attempt===5){
    const detail=code==='ENOTFOUND'||code==='EAI_AGAIN'?'the server could not resolve the provider hostname, '+code:reason;
    throw Error(stage+' unavailable after '+attempt+' attempts ('+detail+')',{cause:error});
   }
   onRetry?.({stage,attempt,reason});
   await delay(400*2**(attempt-1),undefined,{signal});
  }
 }
}
