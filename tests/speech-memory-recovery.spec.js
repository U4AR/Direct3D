import {test,expect} from '@playwright/test';

test('mic sends WAV after ONNX runs out of memory and reuses the open mic on restart',async({page})=>{
 await page.addInitScript(()=>{
  window.addEventListener('draw3d-ready',e=>window.micTest=e.detail);
  window.micRequests=0;
  navigator.mediaDevices.getUserMedia=async()=>{
   window.micRequests++;
   const ctx=new AudioContext({sampleRate:16000}),dest=ctx.createMediaStreamDestination();
   const osc=ctx.createOscillator(),amp=ctx.createGain();osc.frequency.value=180;amp.gain.value=0;
   osc.connect(amp).connect(dest);osc.start();await ctx.resume();
   window.syntheticPhrase=()=>{
    const t=ctx.currentTime;
    amp.gain.setValueAtTime(.1,t+.1);amp.gain.setValueAtTime(0,t+.75);
   };
   return dest.stream;
  };
 });
 let wasmLoads=0;
 await page.route('**/vad/ort-wasm*.mjs',route=>{
  wasmLoads++;
  return route.fulfill({contentType:'application/javascript',body:'export default async function(){throw new WebAssembly.RuntimeError("Aborted(InternalError: out of memory)");}'});
 });
 const packets=[];
 await page.route('**/api/agent/concept-transcribe?*',r=>{
  packets.push(r.request().postDataJSON());return r.fulfill({json:{text:''}});
 });
 await page.route('**/api/agent/audio-log?*',r=>r.fulfill({json:{ready:true}}));
 const base=process.env.DRAW3D_TEST_BASE||'http://127.0.0.1:5191';
 await page.goto(base+'/desktop.html?experiment=decision&session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});
 await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true',{timeout:30000});
 await page.getByRole('button',{name:'Enable microphone',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>micTest.studio.speechCapture.active)).toBe(true);
 await page.evaluate(()=>window.syntheticPhrase());
 await expect.poll(()=>packets.length,{timeout:10000}).toBe(1);
 await page.evaluate(()=>micTest.studio.speechCapture.restart());
 await page.evaluate(()=>window.syntheticPhrase());
 await expect.poll(()=>packets.length,{timeout:10000}).toBe(2);
 for(const packet of packets){
  const wav=Buffer.from(packet.audioInputs[0].audio,'base64');expect(wav.toString('ascii',0,4)).toBe('RIFF');expect(wav.readUInt32LE(24)).toBe(16000);
  expect(wav.length).toBeGreaterThan(16000);expect(wav.length).toBeLessThan(80000);
  expect(wav.subarray(44).some(v=>v!==0)).toBe(true);
 }
 expect(new Set(packets.map(p=>p.audioId)).size).toBe(2);
 expect(await page.evaluate(()=>window.micRequests)).toBe(1);
 expect(wasmLoads).toBe(1);
 await page.evaluate(()=>micTest.studio.speechCapture.stop());
 expect(await page.evaluate(()=>micTest.studio.speechCapture.active)).toBe(false);
});

test('real local Silero ONNX rejects a tone and silence, then admits a spoken command',async({page})=>{
 const {readFile}=await import('node:fs/promises');
 const sample=(await readFile('artifacts/direct-audio-pause.wav')).toString('base64');
 const packets=[],onnx=[];
 page.on('response',r=>{if(r.url().endsWith('/silero_vad_v5.onnx'))onnx.push(r.status());});
 await page.route('**/api/agent/concept-transcribe?*',r=>{packets.push(r.request().postDataJSON());return r.fulfill({json:{text:''}});});
 await page.route('**/api/agent/audio-log?*',r=>r.fulfill({json:{ready:true}}));
 await page.addInitScript(()=>{window.addEventListener('draw3d-ready',e=>window.micTest=e.detail);
  window.selectedInputs=[];window.oldStreams=[];
  navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'desk',label:'Desk mic'},{kind:'audioinput',deviceId:'headset',label:'Headset mic'}];
  navigator.mediaDevices.getUserMedia=async args=>{
   window.selectedInputs.push(args.audio.deviceId?.exact);
   const ctx=new AudioContext({sampleRate:16000}),dest=ctx.createMediaStreamDestination();
   const oscillator=ctx.createOscillator(),gain=ctx.createGain();oscillator.frequency.value=240;gain.gain.value=0;
   oscillator.connect(gain).connect(dest);oscillator.start();await ctx.resume();
   window.tone=()=>{gain.gain.setValueAtTime(.1,ctx.currentTime);gain.gain.setValueAtTime(0,ctx.currentTime+1);};
   window.say=async audio=>{const source=ctx.createBufferSource();source.buffer=await ctx.decodeAudioData(Uint8Array.from(atob(audio),c=>c.charCodeAt(0)).buffer);source.connect(dest);source.start();};
   window.oldStreams.push(dest.stream);return dest.stream;
  };
 });
 await page.goto('http://127.0.0.1:5191/desktop.html?experiment=decision&session='+crypto.randomUUID(),{waitUntil:'domcontentloaded'});
 await expect(page.locator('body')).toHaveAttribute('data-decision-ready','true');
 await page.locator('#microphone-input').selectOption('desk');
 await page.getByRole('button',{name:'Enable microphone',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>micTest.studio.speechCapture.active),{timeout:20000}).toBe(true);
 expect(onnx).toContain(200);
 await page.locator('#microphone-input').selectOption('headset');
 await expect.poll(()=>page.evaluate(()=>micTest.studio.speechCapture.active&&!micTest.studio.speechCapture.restarting)).toBe(true);
 expect(await page.evaluate(()=>selectedInputs)).toEqual(['desk','headset']);
 expect(await page.evaluate(()=>oldStreams[0].getAudioTracks()[0].readyState)).toBe('ended');
 expect(await page.evaluate(()=>localStorage.getItem('draw3d.microphone.device'))).toBe('headset');
 const original=await page.locator('#decision-status').textContent();
 await page.evaluate(()=>window.tone());await page.waitForTimeout(2100);expect(packets).toHaveLength(0);
 await page.evaluate(audio=>window.say(audio),sample);await expect.poll(()=>packets.length,{timeout:15000}).toBe(1);
 await expect(page.locator('#decision-status')).toHaveText(original);
 expect(await page.evaluate(()=>micTest.studio.speechCapture.active)).toBe(true);
 await page.evaluate(()=>micTest.studio.speechCapture.stop());
});
