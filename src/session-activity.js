// IndexedDB is the outbox. An acknowledged sequence is advanced only after the
// server has durably written the batch. Resending an event is idempotent.
export function recordSessionActivity(store,send){
 const key='draw3d.activity.v1.'+store.namespace+'.'+store.session.id;
 let checkpoint;
 try{checkpoint=JSON.parse(localStorage.getItem(key));}catch{}
 if(!checkpoint){checkpoint={stream:crypto.randomUUID(),seq:0};localStorage.setItem(key,JSON.stringify(checkpoint));}
 let sending=false,timer,stopped=false;
 // Keep full geometry and media in their existing indexed recordings. The
 // activity stream records input points verbatim and references larger outputs.
 function serialize(row){
  const json=JSON.stringify(row.data,(k,v)=>{
   if(/^(authorization|token|apiKey|capability|password|secret|audioBase64)$/i.test(k))return undefined;
   if(typeof v==='string'&&(/^data:[^,]+;base64,/.test(v)||v.length>24000))return {storedInSession:true,length:v.length};
   if(Array.isArray(v)&&v.length>512)return {storedInSession:true,length:v.length};
   return v;
  });
  const data=json&&json.length<=12000?JSON.parse(json):{storedInSession:true,id:row.data?.id,fitId:row.data?.fitId};
  return {seq:row.seq,t:row.t,wallTime:row.wallTime,type:row.type,data};
 }
 async function sync(){
  if(sending||stopped)return;
  sending=true;let delay=2400;
  try{
   if(store.sequence<=checkpoint.seq)return;
   const rows=await new Promise((ok,fail)=>{
    const range=IDBKeyRange.bound([store.session.id,checkpoint.seq],[store.session.id,[]],true);
    const query=store.db.transaction('events').objectStore('events').getAll(range,64);
    query.onsuccess=()=>ok(query.result);query.onerror=()=>fail(query.error);
   });
   if(!rows.length)return;
   const events=rows.map(serialize),reply=await send({stream:checkpoint.stream,events});
   if(reply?.savedThrough!==events.at(-1).seq)throw Error('Recording batch was not acknowledged');
   checkpoint.seq=reply.savedThrough;localStorage.setItem(key,JSON.stringify(checkpoint));
   if(rows.length===64)delay=40;
  }catch{delay=5000;}finally{sending=false;if(!stopped)timer=setTimeout(sync,delay);}
 }
 const click=e=>{
  const el=e.target.closest?.('button,select,summary,input[type="checkbox"],input[type="number"],[role="button"]');
  if(el)store.log('ui.action',{control:el.id||el.dataset.tool||el.getAttribute('aria-label')||el.textContent.trim().slice(0,80),event:e.type,value:e.type!=='change'?undefined:el.type==='checkbox'?el.checked:el.value});
 };
 document.addEventListener('click',click,true);
 document.addEventListener('change',click,true);
 const leave=()=>{stopped=true;clearTimeout(timer);};
 window.addEventListener('pagehide',leave);
 window.addEventListener('pageshow',()=>{if(stopped){stopped=false;timer=setTimeout(sync,0);}});
 timer=setTimeout(sync,1000);
}
