// Private per-recording corrections, scoped to the actual still-active source ink.
// This is explicit user feedback, not model training or cross-user retrieval.
import {readdir,readFile} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
const hash=points=>createHash('sha256').update(JSON.stringify(points)).digest('hex');
export async function matchingDrawingCorrections(data,{recordingId,directory=process.env.DRAW3D_DRAWING_EXAMPLES_DIR}={}){
 if(!directory||!recordingId)return [];let names;try{names=await readdir(directory,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
 const active=new Map(data.strokes.map(s=>[s.id,hash(s.points)])),corrections=[];
 for(const name of names.filter(n=>n.isDirectory()).slice(-32))try{const example=JSON.parse(await readFile(path.join(directory,name.name,'example.json'),'utf8')),source=JSON.parse(await readFile(example.sourceRequest,'utf8'));if(source.recordingId!==recordingId||typeof example.userIntent!=='string')continue;const ids=source.data.strokes.filter(s=>active.get(s.id)===hash(s.points)).map(s=>s.id);if(!ids.length)continue;corrections.push({source:'explicit user correction for matching active ink',sourceStrokeIds:ids,text:example.userIntent.slice(0,2000)});}catch(e){if(e.code!=='ENOENT')throw e;}
 return corrections.slice(-4);
}
