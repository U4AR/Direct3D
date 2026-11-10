import {readFile,writeFile} from 'node:fs/promises';
const file=process.argv[2];
if(!file){console.error('Usage: node scripts/replay-speech.mjs <saved.wav>');process.exit(1);}
const audio=(await readFile(file)).toString('base64');
const response=await fetch('http://127.0.0.1:8788/api/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audio,mimeType:'audio/wav',id:'replay-'+Date.now()}),signal:AbortSignal.timeout(120000)});
const result=await response.json();if(!response.ok)throw Error(result.error||'Transcription failed');
await writeFile(file+'.replay.json',JSON.stringify(result,null,2));console.log(JSON.stringify({text:result.text,model:result.model,responseFile:file+'.replay.json'},null,2));
