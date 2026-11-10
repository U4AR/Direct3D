import {mkdir,readdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const pending=new Map();
function folder(recordingId){
 if(!uuid.test(recordingId))throw Error('Invalid recording ID');
 return path.resolve(process.env.SESSION_DIR||'sessions','activity',recordingId);
}
export function reviewActivity(event){
 const d=event.data||{};
 if(/(?:\.failed|\.error|\.detector-error|\.network-error)$/.test(event.type))return {kind:'failure',detail:String(d.reason||d.error||d.message||event.type).slice(0,280)};
 if(event.type==='decision.refinement.received'&&d.refinement?.question)return {kind:'clarification',detail:String(d.refinement.question).slice(0,280)};
 if(event.type==='decision.feedback'&&['discarded','incorrect'].includes(d.verdict)||event.type==='ai.preview.discarded')return {kind:'rejected preview',detail:String(d.note||d.reason||'Preview discarded').slice(0,280)};
 if(event.type==='decision.preview.visible'&&d.elapsedMs>10000)return {kind:'slow preview',detail:Math.round(d.elapsedMs/1000)+' seconds'};
 if(event.type==='cad.memory-recovery')return {kind:'CAD memory recovery',detail:String(d.phase||'')};
 return null;
}
export async function saveActivity(recordingId,{stream,events}){
 const base=folder(recordingId);
 if(!uuid.test(stream)||!Array.isArray(events)||!events.length||events.length>64)throw Error('Invalid recording batch');
 for(const [i,e] of events.entries()){
  if(!Number.isSafeInteger(e?.seq)||e.seq<1||(i&&e.seq<=events[i-1].seq)||typeof e.type!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(e.type)||typeof e.wallTime!=='string'||!Number.isFinite(Date.parse(e.wallTime))||Buffer.byteLength(JSON.stringify(e))>65536)throw Error('Invalid activity event');
 }
 const dir=path.join(base,stream),last=events.at(-1).seq;
 const save=async()=>{
  await mkdir(dir,{recursive:true});
  const groups=new Map();
  for(const e of events){
   const bucket=Math.floor((e.seq-1)/256);
   if(!groups.has(bucket))groups.set(bucket,[]);
   groups.get(bucket).push({seq:e.seq,t:e.t,wallTime:e.wallTime,type:e.type,data:e.data,review:reviewActivity(e)});
  }
  for(const [bucket,incoming] of groups){
   const file=path.join(dir,bucket+'.json'),temp=file+'.'+randomUUID()+'.tmp';
   let prior=[];
   try{prior=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   const rows=new Map(prior.map(e=>[e.seq,e]));
   for(const e of incoming)if(!rows.has(e.seq))rows.set(e.seq,e);
   try{await writeFile(temp,JSON.stringify([...rows.values()].sort((a,b)=>a.seq-b.seq)));await rename(temp,file);}
   finally{await rm(temp,{force:true});}
  }
  return {savedThrough:last};
 };
 const task=(pending.get(dir)||Promise.resolve()).catch(()=>{}).then(save);
 pending.set(dir,task);
 try{return await task;}finally{if(pending.get(dir)===task)pending.delete(dir);}
}
export async function recentActivity(recordingId){
 const base=folder(recordingId);
 let streams;try{streams=await readdir(base);}catch(e){if(e.code==='ENOENT')return {events:[],findings:[]};throw e;}
 const rows=[];
 for(const stream of streams.filter(s=>uuid.test(s))){
  const dir=path.join(base,stream),files=(await readdir(dir)).filter(f=>/^\d+\.json$/.test(f)).sort((a,b)=>parseInt(b)-parseInt(a)).slice(0,4);
  for(const file of files)for(const e of JSON.parse(await readFile(path.join(dir,file),'utf8')))rows.push({...e,stream});
 }
 rows.sort((a,b)=>Date.parse(b.wallTime)-Date.parse(a.wallTime)||b.seq-a.seq);
 return {events:rows.filter(e=>!['stroke.point','xr.pose','audio.level','runtime.performance'].includes(e.type)).slice(0,40),
  findings:rows.filter(e=>e.review).slice(0,24).map(({seq,stream,wallTime,review})=>({seq,stream,wallTime,...review}))};
}
