import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('http://localhost:5173'));
const result=await page.evaluate(async()=>{
  const {createMicVAD}=await import('/src/vad.js');
  const ctx=new AudioContext(); const stream=ctx.createMediaStreamDestination().stream;
  let frames=0,speech=0;
  const start=performance.now();
  const vad=await createMicVAD({getStream:async()=>stream,onFrameProcessed:()=>frames++,onSpeechEnd:()=>speech++});
  const loadMs=performance.now()-start;
  await vad.start();const inferenceStart=performance.now();
  for(let i=0;i<8;i++)await vad.processFrame(new Float32Array(512));
  const inferenceMs=performance.now()-inferenceStart;
  await vad.destroy();await ctx.close();
  return {frames,speech,loadMs,inferenceMs,input:'eight synthetic silent frames on physical Quest; not a live microphone test'};
});
await fs.writeFile('artifacts/quest/vad.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result));await browser.close();
