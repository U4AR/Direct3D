import {test} from 'node:test';import assert from 'node:assert/strict';import {startVoiceDetector} from '../src/voice-detector.js';
test('a slow voice model falls back and releases its eventual detector without starting it',async()=>{
 let resolve,started=0,destroyed=0,fallback=0,reason;
 const pending=new Promise(r=>resolve=r),vad={start:async()=>fallback++,destroy:async()=>{}};
 const result=await startVoiceDetector({timeoutMs:5,loadNeural:()=>pending,makeFallback:()=>vad,onFallback:e=>reason=e.message});
 assert.equal(result.vad,vad);assert.equal(result.detector,'audio-level');assert.equal(fallback,1);assert.match(reason,/timed out/);
 resolve({start:async()=>started++,destroy:async()=>destroyed++});await new Promise(r=>setTimeout(r,5));assert.equal(started,0);assert.equal(destroyed,1);
});
test('a detector initialization failure keeps permitted audio usable through the level fallback',async()=>{
 let released=0;const result=await startVoiceDetector({loadNeural:async()=>({start:async()=>{throw Error('WASM unavailable');},destroy:async()=>released++}),makeFallback:()=>({start:async()=>{},destroy:async()=>{}})});assert.equal(result.detector,'audio-level');assert.equal(released,1);
});
test('a ready neural detector is used without starting a second audio processor',async()=>{
 let fallback=0;const neural={start:async()=>{},destroy:async()=>{}};const result=await startVoiceDetector({loadNeural:async()=>neural,makeFallback:()=>{fallback++;}});assert.equal(result.vad,neural);assert.equal(result.detector,'silero');assert.equal(fallback,0);
});
