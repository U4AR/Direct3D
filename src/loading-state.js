const tasks=new Map();
export function loadingState(task,message,state='loading'){
 if(state==='ready')tasks.delete(task);else tasks.set(task,{message,state});
 const initial=document.querySelector('#opening-detail');if(initial&&document.body.hasAttribute('data-opening'))initial.textContent=message;
 let banner=document.querySelector('#workspace-loading');
 if(!banner){banner=document.createElement('aside');banner.id='workspace-loading';banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');document.body.append(banner);}
 const current=[...tasks.values()].at(-1);banner.hidden=!current;banner.dataset.state=current?.state||'ready';banner.textContent=current?.message||'';
}
