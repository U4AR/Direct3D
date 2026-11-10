const svgNS='http://www.w3.org/2000/svg';
export function initPartChat({studio,store,header}){
 const rows=store.session.partConversation||=[];
 const pane=document.createElement('aside');pane.id='part-chat';pane.setAttribute('aria-label','Design conversation');
 const title=document.createElement('h2');title.textContent='Conversation';
 const feed=document.createElement('div');feed.className='part-chat-feed';feed.setAttribute('role','log');
 const toggle=document.createElement('button');toggle.id='part-chat-toggle';toggle.textContent='Chat';toggle.type='button';header.append(toggle);
 document.querySelector('#app>main').append(pane);pane.append(title,feed);
 function open(value){pane.hidden=!value;document.body.classList.toggle('part-chat-open',value);toggle.setAttribute('aria-expanded',String(value));studio.resize();}
 toggle.onclick=()=>open(pane.hidden);open(innerWidth>=1000);
 const urls=[];
 function render(row,prepend=false){
  const item=document.createElement('article');item.className='part-message '+row.role;
  const label=document.createElement('small');label.textContent=(row.role==='user'?'You':'CAD')+(row.plane?' · '+row.plane:'');item.append(label);
  if(row.points?.length){
   const svg=document.createElementNS(svgNS,'svg'),line=document.createElementNS(svgNS,'polyline');
   const xs=row.points.map(p=>p[0]),ys=row.points.map(p=>-p[1]);
   const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y,pad=Math.max(w,h,.001)*.075;
   svg.setAttribute('viewBox',[x-pad,y-pad,w+2*pad,h+2*pad].join(' '));svg.setAttribute('aria-label','Original pen stroke');svg.setAttribute('role','img');
   line.setAttribute('points',xs.map((a,i)=>a+','+ys[i]).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');line.setAttribute('vector-effect','non-scaling-stroke');svg.append(line);item.append(svg);
  }
  if(row.image){const img=document.createElement('img');img.src=row.image;img.alt='Drawing at the time of the request';img.loading='lazy';item.append(img);}
  if(row.text){const p=document.createElement('p');p.textContent=row.text;item.append(p);}
  if(row.audioRef){const play=document.createElement('button');play.textContent='Play recording';play.onclick=async()=>{
   const asset=await store.get('assets',[store.session.id,row.audioRef]);
   if(!asset){play.textContent='Recording unavailable';return;}
   const audio=document.createElement('audio');audio.controls=true;audio.src=URL.createObjectURL(asset.blob);urls.push(audio.src);play.replaceWith(audio);void audio.play().catch(()=>{});
  };item.append(play);}
  if(prepend)feed.prepend(item);else{const near=feed.scrollHeight-feed.clientHeight-feed.scrollTop<70;feed.append(item);if(near)feed.scrollTop=feed.scrollHeight;}
 }
 function add(row){rows.push(row);render(row);void store.flush();}
 const loaded=new Set(rows.map(r=>r.key));
 function once(key,row){if(loaded.has(key))return;loaded.add(key);add({...row,key});}
 for(const row of rows)render(row);
 // Prior sessions kept the original camera image and speech in their case assets.
 const old=(store.session.decisionCases||[]).filter(c=>c.asset&&!rows.some(r=>r.caseId===c.id));
 if(old.length){const more=document.createElement('button');more.textContent='Earlier drawings';title.after(more);more.onclick=async()=>{more.disabled=true;
  for(const c of old.splice(-12).reverse()){
   const saved=await store.get('assets',[store.session.id,c.asset]);if(!saved)continue;
   const {data,result}=JSON.parse(await saved.blob.text());
   if(result.refinement?.summary)render({role:'assistant',text:result.refinement.summary},true);
   for(const s of [...(data.speechInputs||[])].reverse())render({role:'user',text:s.text,audioRef:s.audioRef||'speech/'+s.audioId+'.wav'},true);
   render({role:'user',text:data.speechInputs?.length?'':data.prompt,plane:data.plane?.name,image:data.image},true);
  }
  more.disabled=false;if(!old.length)more.remove();
 };}
 const log=store.log.bind(store);store.log=(type,data)=>{
  log(type,data);
  if(type==='stroke.end'){
   const s=store.session.strokes.find(s=>s.id===data.id);if(!s?.points?.length)return;
   const plane=s.drawingPlane||s.plane||studio.desktopPlane;
   const points=s.points.filter((_,i)=>i%Math.ceil(s.points.length/160)===0||i===s.points.length-1).map(p=>[plane.xAxis,plane.yAxis].map(a=>a.reduce((n,v,k)=>n+v*(p[k]-plane.origin[k]),0)));
   once('ink:'+s.id,{role:'user',plane:plane.name||plane.id,points});
  }
  if(type==='decision.speech.bound')once('voice:'+data.audioId,{role:'user',text:data.text,audioRef:data.audioRef||'speech/'+data.audioId+'.wav',strokeIds:data.strokeIds});
  if(type==='decision.instruction.received'&&data.source==='typed')add({role:'user',text:data.displayText||data.text});
  if(type==='decision.refinement.failed')add({role:'assistant',text:data.reason||data.error||'Sketch refinement failed.'});
  if(type==='decision.error')add({role:'assistant',text:'Could not finish. '+data.message});
 };
 window.addEventListener('pagehide',()=>urls.forEach(URL.revokeObjectURL),{once:true});
 return {reply(id,text){if(text)once('reply:'+id,{role:'assistant',text,caseId:id});}};
}
