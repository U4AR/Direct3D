const preference='draw3d.microphone.device';
export function initMicrophoneInput(speech){
 const panel=document.querySelector('.speech-panel');
 if(!panel||!navigator.mediaDevices?.enumerateDevices)return;
 const label=document.createElement('label');label.textContent='Microphone ';
 const select=document.createElement('select');select.id='microphone-input';select.setAttribute('aria-label','Microphone input');
 label.append(select);panel.querySelector('.speech-top').after(label);
 let updating=false;
 async function refresh(){
  const devices=await navigator.mediaDevices.enumerateDevices();
  const ids=new Set(devices.filter(d=>d.kind==='audioinput').map(d=>d.deviceId));
  const chosen=speech.inputDeviceId;
  select.replaceChildren(new Option('System default',''));
  for(const device of devices.filter(d=>d.kind==='audioinput'&&d.deviceId!=='default'&&d.deviceId!=='communications')){
   select.add(new Option(device.label||'Microphone '+select.options.length,device.deviceId));
  }
  if(chosen&&!ids.has(chosen))select.add(new Option('Selected microphone disconnected',chosen));
  select.value=chosen;
 }
 select.onchange=async()=>{
  if(updating)return;
  updating=true;select.disabled=true;
  try{await speech.selectInputDevice(select.value);await refresh();}
  catch(error){speech.onStatus('Microphone input failed: '+error.message);}
  finally{updating=false;select.disabled=false;}
 };
 const changed=()=>{void refresh().catch(()=>{});};
 navigator.mediaDevices.addEventListener('devicechange',changed);
 window.addEventListener('draw3d-microphone-state',event=>{
  if(['listening','no-signal','off'].includes(event.detail.phase))changed();
 },{once:true});
 // Refresh labels after microphone permission is granted.
 window.addEventListener('draw3d-speech-status',event=>{if(event.detail.text.startsWith('Listening'))changed();});
 changed();
 window.addEventListener('pagehide',()=>navigator.mediaDevices.removeEventListener('devicechange',changed),{once:true});
}
export function savedMicrophoneInput(){
 try{return localStorage.getItem(preference)||'';}catch{return '';}
}
export function saveMicrophoneInput(value){
 try{localStorage.setItem(preference,value);}catch{}
}
