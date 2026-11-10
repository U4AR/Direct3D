export const XR_ENTRY_TIMEOUT_MS=12000;
function deadline(promise,{timeoutMs,message,onTimeout=()=>{},onLate=()=>{}}){
 return new Promise((resolve,reject)=>{let done=false,expired=false;const timer=setTimeout(()=>{done=true;expired=true;onTimeout();const e=Error(message);e.code='XR_ENTRY_TIMEOUT';reject(e);},timeoutMs);
 Promise.resolve(promise).then(value=>{if(done){if(expired)onLate(value);return;}done=true;clearTimeout(timer);resolve(value);},error=>{if(done)return;done=true;clearTimeout(timer);reject(error);});});
}
const close=session=>{try{Promise.resolve(session.end()).catch(()=>{});}catch{}};
export function requestImmersiveSession(xr,{timeoutMs=XR_ENTRY_TIMEOUT_MS}={}){
 // Invoke immediately while the click still has transient user activation.
 let request;try{request=xr.requestSession('immersive-vr',{requiredFeatures:['local-floor'],optionalFeatures:['hand-tracking']});}catch(e){return Promise.reject(e);}
 return deadline(request,{timeoutMs,message:'VR entry did not finish. Bring Quest Browser to the foreground and retry. If another VR app is open, switch out of it first.',onLate:close}).catch(error=>{if(error.name==='NotSupportedError'){const e=Error('Quest Browser could not start VR. Bring this browser window to the foreground and close any other active VR experience, then retry. ('+error.message+')');e.code='XR_UNAVAILABLE';throw e;}throw error;});
}
export function bindImmersiveSession(manager,session,{timeoutMs=XR_ENTRY_TIMEOUT_MS}={}){
 let closed=false;const cleanup=()=>{if(!closed){closed=true;close(session);}};let binding;try{binding=manager.setSession(session);}catch(e){cleanup();return Promise.reject(e);}
 return deadline(binding,{timeoutMs,message:'The headset VR display did not start. Quest Browser is ready to retry; your design remains saved.',onTimeout:cleanup,onLate:cleanup}).catch(e=>{cleanup();throw e;});
}
