import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {hasSolidConstruction,sketchTask} from './sketch-task.mjs';

const {values}=parseArgs({options:{root:{type:'string'},limit:{type:'string',default:'12'},recording:{type:'string'},'show-prompt':{type:'boolean'}}});
const root=path.resolve(values.root||process.env.SESSION_DIR||'sessions','decision-sketches');
const limit=Number(values.limit);
if(!Number.isSafeInteger(limit)||limit<1)throw Error('Use a positive integer for --limit.');
async function optional(file,json=true){
 try{const value=await readFile(file,'utf8');return json?JSON.parse(value):value;}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function folders(dir){
 try{return (await readdir(dir,{withFileTypes:true})).filter(f=>f.isDirectory()).map(f=>path.join(dir,f.name));}
 catch(e){if(e.code==='ENOENT')return [];throw e;}
}
const entries=await Promise.all((await folders(root)).map(async dir=>({dir,time:(await stat(path.join(dir,'request.json')).catch(()=>null))?.mtimeMs||0})));
const counts=new Map();let shown=0;
for(const {dir,time} of entries.sort((a,b)=>b.time-a.time)){
 if(shown>=limit)break;
 const request=await optional(path.join(dir,'request.json'));
 if(!request||values.recording&&!request.recordingId?.startsWith(values.recording))continue;
 const fit=await optional(path.join(dir,'result.json')),refs=await folders(path.join(dir,'refinements'));
 const attempts=await Promise.all(refs.map(async folder=>({time:(await stat(folder)).mtimeMs,
  task:(await optional(path.join(folder,'task-response.json')))?.answers?.find(a=>a.name==='deliverable')?.choice,
  result:await optional(path.join(folder,'result.json')),error:await optional(path.join(folder,'failure.json'))})));
 const last=attempts.sort((a,b)=>b.time-a.time)[0];
 const raw=await optional(path.join(dir,'preview.jsonl'),false);
 const receipts=(raw||'').trim().split(/\r?\n/).filter(Boolean).map(l=>JSON.parse(l));
 const terminal=receipts.at(-1),received=receipts.findLastIndex(r=>r.state==='received');
 const verifiedFeatures=receipts.slice(Math.max(received,0)).filter(r=>r.state==='building'&&r.reason?.startsWith('Verified native solid')).length;
 const error=last?.error||await optional(path.join(dir,'failure.json'));
 const planned=last?.result?(hasSolidConstruction(last.result)?'solid':'sketch'):null;
 const expected=last?.result?.requestedDeliverable||last?.task||(fit?sketchTask(fit):null);
 let state=terminal?.state||'no client receipt';
 if(terminal?.state==='stale')state='superseded';
 else if(error)state='error';
 else if(last?.result?.refinement?.question)state='question';
 else if(['sketch','face_placement'].includes(expected)&&planned==='solid')state='unexpected solid plan';
 else if(['material_feature','new_body'].includes(expected)&&planned!=='solid')state='missing solid plan';
 const row={at:new Date(time).toISOString(),case:path.basename(dir),recording:request.recordingId,expected,planned,verifiedFeatures,state};
 if(error||terminal?.state==='failed')row.reason=error?.message||terminal.reason;
 if(values['show-prompt'])row.prompt=request.data.prompt;
 console.log(JSON.stringify(row));counts.set(state,(counts.get(state)||0)+1);shown++;
}
console.log(JSON.stringify({examined:shown,states:Object.fromEntries(counts)}));
