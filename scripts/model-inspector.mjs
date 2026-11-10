import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
const root=()=>path.resolve(process.env.SESSION_DIR||'sessions','desktop-edits');
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(s);
const json=async p=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
export async function inspectRuns(recordingId){
 if(!uuid(recordingId))throw Error('A recording ID is required');
 let dirs;try{dirs=await readdir(root(),{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
 const rows=await Promise.all(dirs.filter(d=>d.isDirectory()&&uuid(d.name)).map(async d=>{const folder=path.join(root(),d.name),r=await json(path.join(folder,'request.json'));if(r?.recordingId!==recordingId)return null;const files=await readdir(folder);return {id:d.name,prompt:r.prompt,model:r.body?.model,updatedAt:await stat(path.join(folder,'events.jsonl')).then(s=>s.mtimeMs).catch(async()=> (await stat(path.join(folder,'request.json'))).mtimeMs),turns:1+files.filter(f=>/^turn-\d+$/.test(f)).length};}));
 return rows.filter(Boolean).sort((a,b)=>b.updatedAt-a.updatedAt);
}
export async function inspectRun(recordingId,runId,depth=0){
 if(depth>1)throw Error('Nested specialist recordings are unavailable');
 if(!uuid(runId)||!uuid(recordingId))throw Error('Invalid recording or run ID');
 const folder=path.join(root(),runId),first=await json(path.join(folder,'request.json'));if(!first||first.recordingId!==recordingId)throw Error('Run is not in this recording');
 const dirs=['',...(await readdir(folder)).filter(d=>/^turn-\d+$/.test(d)).sort((a,b)=>Number(a.slice(5))-Number(b.slice(5)))];
 const turns=await Promise.all(dirs.map(async(dir,i)=>{const f=path.join(folder,dir),files=['request','wire-request','response','recovery-request','recovery-wire-request','recovery-response','application'];return {turn:i+1,...Object.fromEntries(await Promise.all(files.map(async n=>[n,await json(path.join(f,n+'.json'))])))};}));
 let events=[];try{events=(await readFile(path.join(folder,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
 let delegates=[];try{const children=await readdir(path.join(folder,'delegates'));delegates=(await Promise.all(children.filter(uuid).slice(0,4).map(async id=>{const result=await json(path.join(folder,'delegates',id,'result.json'));if(!result||result.id!==id)return null;let recording;try{recording=await inspectRun(recordingId,id,depth+1);}catch{}return {result,recording};}))).filter(Boolean);}catch(e){if(e.code!=='ENOENT')throw e;}
 return {id:runId,recordingId,prompt:first.prompt,turns,events,delegates,humanReview:await json(path.join(folder,'human-review.json'))};
}
