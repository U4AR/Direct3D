// Remember user intent, never bypass the browser's microphone permission.
const preferenceKey='draw3d.microphone.enabled';
export function initMicrophoneSession(speech,{storage=localStorage}={}) {
 let wanted=false,timer,retries=0,destroyed=false,resuming=false;
 try{wanted=storage.getItem(preferenceKey)==='true';}catch{}
 const clear=()=>{clearTimeout(timer);timer=null;};
 const save=value=>{wanted=!!value;retries=0;clear();try{storage.setItem(preferenceKey,String(wanted));}catch{}};
 async function resume({repair=false,gesture=false}={}) {
  if(destroyed||!wanted||resuming||document.hidden||speech.starting||speech.restarting||speech.stopping)return;
  if(speech.active&&!repair){speech.audioContext?.resume().catch(()=>{});return;}
  resuming=true;
  try{
   const permission=await navigator.permissions?.query({name:'microphone'}).catch(()=>null);
   if(destroyed||!wanted||document.hidden)return;
   // Automatic recovery must not produce another permission dialogue.
   if(permission?.state!=='granted'&&!(gesture&&!permission))return;
   if(speech.active)await speech.restart();else await speech.start();
  }catch(error){speech.store.log('microphone.auto-recovery',{message:error.message});}
  finally{resuming=false;}
 }
 function update(state) {
  if(!wanted||destroyed)return;
  if(['listening','no-signal'].includes(state.phase)){clear();return;}
  if(!['off','error','stalled'].includes(state.phase)||timer||retries>=3)return;
  const repair=state.phase==='stalled';
  timer=setTimeout(()=>{timer=null;retries++;void resume({repair});},2000*Math.pow(2,retries));
 }
 const wake=()=>{if(document.hidden)return;retries=0;void resume();};
 const gesture=()=>{if(!speech.active)void resume({gesture:true});};
 window.addEventListener('online',wake);window.addEventListener('focus',wake);window.addEventListener('draw3d-backend-connected',wake);
 document.addEventListener('visibilitychange',wake);document.addEventListener('pointerdown',gesture);
 const destroy=()=>{destroyed=true;clear();window.removeEventListener('online',wake);window.removeEventListener('focus',wake);window.removeEventListener('draw3d-backend-connected',wake);document.removeEventListener('visibilitychange',wake);document.removeEventListener('pointerdown',gesture);window.removeEventListener('pagehide',destroy);void speech.stop();};
 window.addEventListener('pagehide',destroy);
 queueMicrotask(()=>void resume());
 return {setEnabled:save,update,resume,destroy,get enabled(){return wanted;}};
}
