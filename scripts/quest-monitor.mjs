import {chromium} from 'playwright';
import fs from 'node:fs/promises';
await fs.mkdir('artifacts/quest', {recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://localhost:5173'));
if(!page) throw Error('Draw3D Quest tab not found');
const errors=[];
page.on('pageerror',e=>{errors.push(e.message); console.log('PAGEERROR',e.message)});
page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLEERROR',m.text())}});
const cdp=await page.context().newCDPSession(page);
await cdp.send('Log.enable');
cdp.on('Log.entryAdded',({entry})=>{if(entry.level==='error'){errors.push(entry.text); console.log('LOGERROR',entry.text)}});
const report={started:new Date().toISOString(),capabilities:await page.evaluate(async()=>({userAgent:navigator.userAgent,secure:isSecureContext,xr:!!navigator.xr,immersive:await navigator.xr?.isSessionSupported('immersive-vr'),speech:typeof window.SpeechRecognition,webkitSpeech:typeof window.webkitSpeechRecognition,mic:!!navigator.mediaDevices})),snapshots:[],errors};
for(let i=0;i<12;i++){
 const snapshot=await page.evaluate(async()=>{
 const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('draw3d-studio',1);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)});
 const id=localStorage.getItem('draw3d.active');
 const get=(name,key,all=false)=>new Promise((res,rej)=>{const store=db.transaction(name).objectStore(name);const q=all?store.getAll(key):store.get(key);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});
 const session=await get('sessions',id);
 const range=IDBKeyRange.bound([id],[id,[]]);
 const events=await get('events',range,true);
 const assets=await get('assets',range,true);
 db.close();
 const counts={};for(const e of events)counts[e.type]=(counts[e.type]||0)+1;
 return {at:new Date().toISOString(),session:id,geometry:document.querySelector('#geometry-count')?.textContent,speech:document.querySelector('#speech-status')?.textContent,vad:document.querySelector('#vad-indicator')?.textContent,notice:document.querySelector('#notice')?.textContent,counts,strokes:session.strokes.map(s=>({input:s.input,points:s.points.length})),transcripts:session.transcripts,latestPose:events.filter(e=>e.type==='xr.pose').at(-1),recent:events.filter(e=>!['xr.pose','stroke.point'].includes(e.type)).slice(-14),assets:assets.map(a=>({name:a.name,bytes:a.blob.size,metadata:a.metadata}))};
 });
 report.snapshots.push(snapshot);
 console.log(JSON.stringify({...snapshot,latestPose:snapshot.latestPose ? {inputs:snapshot.latestPose.data.inputs.map(i=>({key:i.key,pressed:i.pressed,hover:i.hover,axes:i.axes,buttons:i.buttons})),trackedHead:!!snapshot.latestPose.data.head}:null}));
 await fs.writeFile('artifacts/quest/quest-hardware-after-fix.json',JSON.stringify(report,null,2));
 if(i<11)await new Promise(r=>setTimeout(r,5000));
}
await browser.close();

