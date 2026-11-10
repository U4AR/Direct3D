export const recoverableConnectionError=e=>!!e?.transient||/failed to fetch|fetch failed|networkerror|network request failed|load failed|unexpected end of json|timed? out|timeout|browser session expired|wait for the local bridge|connection.*(lost|reset|closed)|DNS lookup failed|ENOTFOUND|ECONN|EAI_AGAIN/i.test(e?.message||'');
export async function retryJSON(url,options,{fetcher=fetch,onRetry=()=>{},attempts=7,delay=ms=>new Promise(r=>setTimeout(r,ms)),cancelled=()=>false}={}){
 for(let attempt=0;;attempt++){
  try{const response=await fetcher(url,typeof options==='function'?options():options);let value;try{value=await response.json();}catch(e){const error=Error('Connection interrupted while receiving JSON');error.transient=true;throw error;}
   if([408,429,500,502,503,504].includes(response.status)){const error=Error(value.error||'Server temporarily unavailable');error.transient=true;throw error;}return {response,value};
  }catch(error){if(cancelled()||attempt>=attempts-1||!(error.transient||recoverableConnectionError(error)))throw error;const waitMs=Math.min(10000,500*2**attempt);await onRetry({attempt:attempt+1,waitMs,message:'Connection interrupted · reconnecting automatically'});await delay(waitMs);}
 }
}
