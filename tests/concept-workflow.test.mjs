import {test} from 'node:test';import assert from 'node:assert/strict';import {ConceptWorkflow,conceptReferences,conceptSignature,transcribeConceptAudio} from '../scripts/concept-workflow.mjs';import {desktopReasoning} from '../scripts/desktop-edit.mjs';
const evidence=()=>({version:1,workspace:'vr',units:'metres',strokes:[{id:'s1',points:[[0,0,0],[.1,.1,0]]}],models:[],frames:['front','top','right'].map((n,i)=>({id:n,layer:'spatial-'+n,image:'data:image/png;base64,'+Buffer.from(n).toString('base64')}))});
const good=async()=>({ok:true,status:200,json:async()=>({data:[{b64_json:Buffer.from('synthetic image').toString('base64')}]})});
test('three distinct prompts run concurrently using all three sketch views',async()=>{let active=0,peak=0;const bodies=[];const w=new ConceptWorkflow({fetcher:async(url,o)=>{bodies.push(JSON.parse(o.body));active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return good();}});const e=evidence(),j=w.start('a',{prompt:'wheel base',evidence:e});await w.get('a',j.id).completion;assert.equal(peak,3);assert.equal(bodies.length,3);assert.equal(new Set(bodies.map(b=>b.prompt)).size,3);for(const b of bodies){assert.equal(b.model,'gpt-image-2.5-flare');assert.equal(b.quality,'low');assert.equal(b.images.length,3);}assert.equal(w.status('a').status,'awaiting_selection');assert.equal(w.status('a').selected,null);});
test('selection does not authorize creation; only explicit confirmation consumes a matching snapshot',async()=>{const w=new ConceptWorkflow({fetcher:good}),e=evidence(),j=w.start('a',{prompt:'wheel base',evidence:e});await w.get('a').completion;assert.throws(()=>w.consume('a',j.id,e,'wheel base'),/Confirm/);w.select('a',{id:j.id,candidateId:1});assert.throws(()=>w.consume('a',j.id,e,'wheel base'),/Confirm/);w.confirm('a',{id:j.id,evidence:e});const selected=w.consume('a',j.id,e,'wheel base');assert.equal(selected.candidateId,1);assert.match(selected.image,/^data:image/);assert.throws(()=>w.consume('a',j.id,e,'wheel base'),/Confirm/);});
test('new ink, body movement, different instructions or another browser cannot use a confirmed choice',async()=>{const w=new ConceptWorkflow({fetcher:good}),e=evidence(),j=w.start('a',{prompt:'wheel',evidence:e});await w.get('a').completion;w.select('a',{id:j.id,candidateId:0});const changed=structuredClone(e);changed.strokes[0].points[1][0]=.2;assert.throws(()=>w.confirm('a',{id:j.id,evidence:changed}),/changed/);w.confirm('a',{id:j.id,evidence:e});assert.throws(()=>w.consume('a',j.id,e,'chair'),/Confirm/);assert.throws(()=>w.status('b',j.id),/expired/);assert.notEqual(conceptSignature(e),conceptSignature(changed));});
test('failed image leaves other ready choices selectable; cancellation aborts remaining generation',async()=>{let calls=0;const w=new ConceptWorkflow({fetcher:async()=>++calls===2?{ok:false,status:429,json:async()=>({error:{message:'Rate limited'}})}:good()}),e=evidence(),j=w.start('a',{prompt:'wheel',evidence:e});await w.get('a').completion;assert.deepEqual(w.status('a').candidates.map(c=>c.status),['ready','failed','ready']);assert.throws(()=>w.select('a',{id:j.id,candidateId:1}),/completed/);w.cancel('a');assert.equal(w.status('a').status,'cancelled');assert.equal(w.get('a').controller.signal.aborted,true);});
test('voice goes through gpt-transcribe, not Terra audio input; medium is pinned for all Terra edits',async()=>{let form;const text=await transcribeConceptAudio([{mimeType:'audio/wav',audio:Buffer.from('synthetic wav').toString('base64')}],{fetcher:async(url,o)=>{assert.match(url,/audio\/transcriptions$/);form=o.body;return {ok:true,json:async()=>({text:'Make a wheel'})};}});assert.equal(form.get('model'),'gpt-transcribe');assert.equal(text,'Make a wheel');assert.equal(desktopReasoning({run:{model:'gpt-6.1-terra'},prompt:'create a cylinder'}),'medium');});

test('symmetric sketches retain three calibrated views even when the rendered pixels match',()=>{const e=evidence();e.frames.forEach(f=>f.image='data:image/png;base64,AAAA');assert.equal(conceptReferences(e).length,3);});
test('desktop planar sketch review can use its one original view',async()=>{const w=new ConceptWorkflow({fetcher:good}),e=evidence();delete e.workspace;e.frames=e.frames.slice(0,1);const j=w.start('desktop',{prompt:'A plate from this sketch',evidence:e});await w.get('desktop').completion;assert.equal(w.status('desktop').candidates.length,3);});

test('transcription reuses the recording after a connection failure and a truncated stream',async()=>{
 const failures=[],partials=[],audio=[],inputs=[{mimeType:'audio/wav',audio:Buffer.from('saved clip').toString('base64')}];
 const text=await transcribeConceptAudio(inputs,{
  onRetry:detail=>failures.push(detail),onTranscript:words=>partials.push(words),
  fetcher:async(url,options)=>{
   audio.push(await options.body.get('file').text());
   if(audio.length===1)throw Object.assign(TypeError('fetch failed'),{cause:Object.assign(Error(),{code:'ECONNRESET'})});
   const events=audio.length===2?[{type:'transcript.text.delta',delta:'Make'}]:[{type:'transcript.text.done',text:'Make a notch'}];
   return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n').join(''),{headers:{'content-type':'text/event-stream'}});
  }
 });
 assert.deepEqual(audio,['saved clip','saved clip','saved clip']);
 assert.deepEqual(failures.map(f=>f.attempt),[1,2]);assert.equal(failures[0].reason,'ECONNRESET');
 assert.deepEqual(partials,['Make']);assert.equal(text,'Make a notch');
});

test('transcription reports a provider credential rejection on the first attempt',async()=>{
 let calls=0;
 await assert.rejects(()=>transcribeConceptAudio([{mimeType:'audio/wav',audio:'YQ=='}],{fetcher:async()=>{
  calls++;return Response.json({error:{message:'Invalid key'}},{status:401});
 }}),/OpenAI 401/);
 assert.equal(calls,1);
});
