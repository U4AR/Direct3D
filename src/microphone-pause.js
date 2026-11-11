export function initMicrophonePause(speech,setEnabled){
 const button=document.createElement('button');button.id='mic-pause';button.type='button';button.title='Pause microphone capture while continuing to design or type';let busy=false;
 function render(){button.textContent=speech.paused?'Resume audio':'Pause audio';button.disabled=busy||speech.starting||!speech.active&&!speech.paused;button.setAttribute('aria-pressed',String(!!speech.paused));}
 button.onclick=async()=>{if(busy)return;busy=true;render();try{if(speech.paused){setEnabled(true);await speech.resume();}else{setEnabled(false);document.querySelectorAll('audio,video').forEach(media=>media.pause());await speech.pause();}}catch(error){speech.onStatus(error.message);speech.store.log('microphone.pause-error',{message:error.message});}finally{busy=false;render();}};
 const update=()=>render();window.addEventListener('draw3d-microphone-state',update);document.querySelector('#mic').after(button);render();window.addEventListener('pagehide',()=>window.removeEventListener('draw3d-microphone-state',update),{once:true});return button;
}
