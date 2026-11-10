const status=document.querySelector('#status');
const passcode=document.querySelector('#passcode');
const form=document.querySelector('#invitation');
const continueButton=document.querySelector('#continue');
const googleHost=document.querySelector('#google');
let opening=false;
async function enter(){
 if(opening)return;opening=true;form.hidden=true;googleHost.hidden=true;
 try{
  for(let i=0;i<120;i++){
   status.textContent="You're signed in. Opening your private workspace…";
   try{
    const r=await fetch('/auth/workspace',{credentials:'same-origin'}),data=await r.json();
    if(r.status===401){location.reload();return;}
    if(r.ok&&data.ready){location.replace('/desktop.html');return;}
    if(!r.ok&&r.status!==503)throw Error(data.error||'Workspace could not start.');
   }catch(error){if(i===119)throw error;}
   await new Promise(resolve=>setTimeout(resolve,2500));
  }
  status.textContent="You're signed in. Your workspace is still starting. Refresh this page in a minute; you don't need to enter the passcode again.";
 }catch(error){status.textContent="You're signed in, but the workspace could not start. Refresh to retry. "+error.message;}
 finally{opening=false;}
}
async function start(){
 const existing=await fetch('/auth/me');if(existing.ok){await enter();return;}
 const config=await(await fetch('/auth/config')).json();
 if(!config.clientId){continueButton.disabled=true;status.textContent='Google sign-in is being configured. Please try again shortly.';return;}
 const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
 const googleReady=new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>reject(Error('Google sign-in could not load. Please check your connection and refresh.'));});
 document.head.append(script);
 form.addEventListener('submit',async event=>{
  event.preventDefault();continueButton.disabled=true;status.textContent='Checking your invitation…';
  try{
   if(!/^\d{8,12}$/.test(passcode.value.trim()))throw Error('Enter the complete invitation passcode.');
   const r=await fetch('/auth/passcode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode:passcode.value.trim()})}),data=await r.json();
   if(!r.ok)throw Error(data.error||'The passcode could not be checked.');
   passcode.value='';await googleReady;
   google.accounts.id.initialize({client_id:config.clientId,nonce:data.nonce,auto_select:false,callback:async response=>{
    try{
     status.textContent='Verifying your Google account…';
     const result=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:response.credential})}),answer=await result.json();
     if(!result.ok)throw Error(answer.error||'Google sign-in failed.');
     await enter();
    }catch(error){status.textContent=error.message;}
   }});
   form.hidden=true;googleHost.hidden=false;status.textContent='Passcode accepted. Continue with Google to open your private workspace.';
   google.accounts.id.renderButton(googleHost,{theme:'filled_black',size:'large',shape:'pill',text:'continue_with',width:Math.min(360,googleHost.clientWidth)});
  }catch(error){status.textContent=error.message;}
  finally{continueButton.disabled=false;}
 });
}
start().catch(error=>status.textContent=error.message);
