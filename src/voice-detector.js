// Model downloads must not keep a permitted microphone stuck in "starting".
export async function startVoiceDetector({loadNeural,makeFallback,onFallback=()=>{},timeoutMs=12000}){
 let expired=false,neural,timer,cleaned=false;
 const cleanup=async()=>{if(neural&&!cleaned){cleaned=true;await neural.destroy();}};
 const attempt=(async()=>{neural=await loadNeural();if(expired){await cleanup();return null;}await neural.start();if(expired){await cleanup();return null;}return neural;})();
 try{
  const vad=await Promise.race([attempt,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Voice model startup timed out')),timeoutMs);})]);
  return {vad,detector:'silero'};
 }catch(error){
  expired=true;onFallback(error);void cleanup().catch(()=>{});void attempt.catch(()=>{});
  const vad=makeFallback();let fallbackTimer;
  try{await Promise.race([vad.start(),new Promise((_,reject)=>{fallbackTimer=setTimeout(()=>reject(Error('Voice capture took too long. Check your connection and retry the microphone.')),timeoutMs);})]);}
  catch(failure){void vad.destroy().catch(()=>{});throw failure;}finally{clearTimeout(fallbackTimer);}
  return {vad,detector:'audio-level'};
 }finally{clearTimeout(timer);}
}
