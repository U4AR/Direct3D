import path from 'node:path';
import {assessMeasuredEdit} from './desktop-measured-tool.mjs';
// Explicit developer replay: reads a saved request (or stdin), never applies to
// the user's scene. Original data and model outputs stay in the backend log volume.
import {readFile} from 'node:fs/promises';
import {runDesktopEdit} from './desktop-edit.mjs';
import {newDesktopContext} from './desktop-context.mjs';
import {selectedModel} from './agent-provider.mjs';
const source=process.argv[2];
if(!source)throw Error('Provide a saved desktop request path, or - for stdin');
let raw='';if(source==='-'){for await(const chunk of process.stdin)raw+=chunk;}else raw=await readFile(source,'utf8');
const request=JSON.parse(raw),run={id:crypto.randomUUID(),recordingId:'intent-replay-'+crypto.randomUUID(),model:selectedModel(),step:1,events:[],nativeSchemaEncoding:'json',supervision:request.evidence.supervision||{level:'balanced'}};
if(!process.env.OPENAI_API_KEY&&process.env.OPENAI_API_KEY_FILE)process.env.OPENAI_API_KEY=(await readFile(process.env.OPENAI_API_KEY_FILE,'utf8')).trim();
const start=performance.now(),edit=await runDesktopEdit({run,prompt:request.prompt,promptSource:'desktop-sketch',evidence:request.evidence,context:newDesktopContext(),signal:AbortSignal.timeout(120000)});
const response=JSON.parse(await readFile(path.resolve(process.env.SESSION_DIR||'sessions','desktop-edits',run.id,'response.json'),'utf8'));
console.log(JSON.stringify({replayId:run.id,model:run.model,elapsedMs:Math.round(performance.now()-start),providerCalls:run.providerCallCount,providerMs:run.providerDurationMs,deviation:assessMeasuredEdit(request.evidence,edit),usage:response.usage,toolCalls:response.output?.filter(o=>o.type==='function_call').map(o=>({name:o.name,arguments:JSON.parse(o.arguments)})),edit}));
