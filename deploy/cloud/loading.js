(()=>{
 const status=document.querySelector('#loading-status'),retry=document.querySelector('#loading-retry'),main=document.querySelector('main');
 const requested=new URLSearchParams(location.search).get('next')||'/desktop.html?experiment=decision';
 let next='/desktop.html?experiment=decision';try{const url=new URL(requested,location.origin);if(url.origin===location.origin&&['/desktop.html','/index.html'].includes(url.pathname))next=url.pathname+url.search+url.hash;}catch{}
 function stage(id,message){for(const li of document.querySelectorAll('li'))li.removeAttribute('aria-current');document.querySelector('#step-'+id).setAttribute('aria-current','step');status.textContent=message;}
 async function run(){retry.hidden=true;main.setAttribute('aria-busy','true');document.querySelector('.spinner').hidden=false;try{
  stage('account','Checking your sign-in…');const me=await fetch('/auth/me');if(me.status===401){location.replace('/login');return;}if(!me.ok)throw Error('Could not check your account. Please try again.');
  stage('runtime','Waking up your private workspace. This can take a minute after a break…');
  for(let attempt=0;attempt<120;attempt++){
   const r=await fetch('/auth/prepare',{signal:AbortSignal.timeout(190000)});if(r.status===401){location.replace('/login');return;}const data=await r.json();
   if(r.ok&&data.ready){stage('tools','Workspace ready. Loading your drawing and CAD tools…');location.replace(next);return;}
   if(!r.ok&&r.status!==503)throw Error(data.error||'Workspace could not start.');
   status.textContent=data.stage==='provisioning'?'Creating your private workspace for the first time. Your account and files stay separate.':'Your workspace is still waking up. Keeping your sign-in while we retry…';
   await new Promise(resolve=>setTimeout(resolve,2500));
  }throw Error('Your workspace is taking longer than expected. Choose Try again to reconnect.');
 }catch(error){status.textContent=error.name==='TimeoutError'?'The workspace is still waking up. Choose Try again; your saved work is kept.':error.message;retry.hidden=false;main.setAttribute('aria-busy','false');document.querySelector('.spinner').hidden=true;}}
 retry.onclick=run;void run();
})();
