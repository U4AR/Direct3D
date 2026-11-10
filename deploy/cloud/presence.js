(()=>{
 if(top!==self)return;let timer,dialog;
 async function ping(){try{const r=await fetch('/auth/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(r.status===401){location.replace('/login');return;}if(r.status===429){
  if(!dialog){dialog=document.createElement('dialog');dialog.id='draw3d-capacity';dialog.style.cssText='max-width:440px;padding:32px;border:1px solid #52766d;border-radius:18px;background:#162b32;color:#e0f1ed;font:16px/1.6 system-ui';const title=document.createElement('h2');title.textContent='Both design spaces are in use';const message=document.createElement('p');message.textContent='Draw3D supports 2 active users at a time. Wait for someone to sign out or for an idle space to expire, then try again.';const retry=document.createElement('button');retry.textContent='Try again';retry.onclick=()=>location.replace('/open?next='+encodeURIComponent(location.pathname+location.search));dialog.append(title,message,retry);dialog.addEventListener('cancel',e=>e.preventDefault());document.body.append(dialog);dialog.showModal();}
 }else if(r.ok&&dialog){location.replace('/open?next='+encodeURIComponent(location.pathname+location.search));return;}}catch{}finally{timer=setTimeout(ping,20000);}}
 addEventListener('pagehide',()=>clearTimeout(timer),{once:true});void ping();
})();
