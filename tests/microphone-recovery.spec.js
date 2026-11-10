import {test,expect} from '@playwright/test';
const base=process.env.DRAW3D_TEST_URL||'http://localhost:5173';
test('disconnected microphone exposes recovery, reacquires audio, and ignores stale track events',async({page})=>{
 await page.route('**/src/vad.js',route=>route.fulfill({contentType:'application/javascript',body:`export async function createMicVAD(options){return {start:async()=>{window.emitAudio=()=>options.onFrameProcessed({isSpeech:0},new Float32Array(512).fill(.01));window.emitAudio();},pause:async()=>{if(window.failPause)throw Error("Device lost");},destroy:async()=>{}}}` }));
 await page.addInitScript(()=>{
  window.SpeechRecognition=window.webkitSpeechRecognition=undefined;
  const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.micStreams=[];
  navigator.mediaDevices.getUserMedia=async args=>{const stream=await original(args);window.micStreams.push(stream);return stream;};
 });
 await page.goto(base+'/');
 await page.locator('#mic').click();
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#mic-reconnect')).toBeHidden();
 await page.evaluate(()=>{window.failPause=true;const track=window.micStreams[0].getAudioTracks()[0];window.oldEnd=track.onended;track.dispatchEvent(new Event('ended'));});
 await expect(page.locator('#speech-status')).toContainText('disconnected');
 await expect(page.locator('#mic-reconnect')).toBeVisible();
 await page.locator('#mic-reconnect').click();
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>page.evaluate(()=>window.micStreams.length)).toBe(2);
 await expect(page.locator('#mic-reconnect')).toBeHidden();
 await page.evaluate(()=>{window.oldEnd();window.emitAudio();});
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>window.micStreams[1].getAudioTracks()[0].readyState)).toBe('live');
 // No more VAD frames arrive: the watchdog offers a restart of the live stream.
 await expect(page.locator('#mic-reconnect')).toBeVisible({timeout:12000});
 await page.locator('#mic-reconnect').click();
 expect(await page.evaluate(()=>window.micStreams.length)).toBe(2);
 await expect(page.locator('#mic-reconnect')).toBeHidden();
 expect(await page.evaluate(()=>window.micStreams[1].getAudioTracks()[0].readyState)).toBe('live');
 await page.locator('#mic').click();
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>window.micStreams[1].getAudioTracks()[0].readyState)).toBe('ended');
});

test('voice detector network failure offers a useful retry and retains granted capture',async({page})=>{
 await page.route('**/src/vad.js',route=>route.fulfill({contentType:'application/javascript',body:`export async function createMicVAD(options){if(!window.vadAttempt++){throw new TypeError('Failed to fetch');}return {start:async()=>options.onFrameProcessed({isSpeech:0},new Float32Array(512).fill(.01)),pause:async()=>{},destroy:async()=>{}}}`}));
 await page.addInitScript(()=>{window.vadAttempt=0;window.SpeechRecognition=window.webkitSpeechRecognition=undefined;});
 await page.goto(base+'/');await page.locator('#mic').click();
 await expect(page.locator('#speech-status')).toContainText('PC connection interrupted');
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 await page.locator('#mic-reconnect').click();
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#mic-reconnect')).toBeHidden();
});


test('remembers granted microphone across reloads and explicit Stop disables restoration',async({page,context})=>{
 await context.grantPermissions(['microphone']);
 await page.route('**/src/vad.js',route=>route.fulfill({contentType:'application/javascript',body:`export async function createMicVAD(o){let timer;return {start:async()=>{timer=setInterval(()=>o.onFrameProcessed({isSpeech:0},new Float32Array(512).fill(.01)),100);},pause:async()=>clearInterval(timer),destroy:async()=>clearInterval(timer)}}`}));
 await page.addInitScript(()=>{window.SpeechRecognition=window.webkitSpeechRecognition=undefined;});
 await page.goto(base+'/');await page.locator('#mic').click();
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>localStorage.getItem('draw3d.microphone.enabled'))).toBe('true');
 await page.reload();await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 await page.locator('#mic').click();await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>localStorage.getItem('draw3d.microphone.enabled'))).toBe('false');
 await page.reload();await page.waitForTimeout(2500);await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','false');
});

test('ended track recovers automatically using existing permission',async({page,context})=>{
 await context.grantPermissions(['microphone']);
 await page.route('**/src/vad.js',route=>route.fulfill({contentType:'application/javascript',body:`export async function createMicVAD(o){return {start:async()=>o.onFrameProcessed({isSpeech:0},new Float32Array(512).fill(.01)),pause:async()=>{},destroy:async()=>{}}}`}));
 await page.addInitScript(()=>{window.SpeechRecognition=window.webkitSpeechRecognition=undefined;const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.micStreams=[];navigator.mediaDevices.getUserMedia=async o=>{const stream=await get(o);window.micStreams.push(stream);return stream;};});
 await page.goto(base+'/');await page.locator('#mic').click();await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>window.micStreams[0].getAudioTracks()[0].dispatchEvent(new Event('ended')));
 await expect.poll(()=>page.evaluate(()=>window.micStreams.length),{timeout:10000}).toBe(2);
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
});

test('remembered preference never prompts automatically when permission needs a user decision',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('draw3d.microphone.enabled','true');navigator.permissions.query=async()=>({state:'prompt'});window.micRequests=0;navigator.mediaDevices.getUserMedia=async()=>{window.micRequests++;throw Error('Must not request permission automatically');};});
 await page.goto(base+'/');await page.waitForTimeout(2500);
 expect(await page.evaluate(()=>window.micRequests)).toBe(0);
});


test('voice detection retries a network failure without requesting another audio stream',async({page,context})=>{
 await context.grantPermissions(['microphone']);
 await page.route('**/src/vad.js',route=>route.fulfill({contentType:'application/javascript',body:`export async function createMicVAD(o){if(!window.vadAttempt++)throw new TypeError('Failed to fetch');return {start:async()=>o.onFrameProcessed({isSpeech:0},new Float32Array(512).fill(.01)),pause:async()=>{},destroy:async()=>{}}}`}));
 await page.addInitScript(()=>{window.vadAttempt=0;window.SpeechRecognition=window.webkitSpeechRecognition=undefined;const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.micStreams=[];navigator.mediaDevices.getUserMedia=async o=>{const s=await get(o);window.micStreams.push(s);return s;};});
 await page.goto(base+'/');await page.locator('#mic').click();
 await expect(page.locator('#speech-status')).toContainText('PC connection interrupted');
 await expect(page.locator('#speech-status')).toContainText('Listening',{timeout:10000});
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>window.micStreams.length)).toBe(1);
 await page.locator('#mic').click();await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','false');expect(await page.evaluate(()=>window.micStreams[0].getAudioTracks()[0].readyState)).toBe('ended');
});

test('browser dictation permission failure keeps granted microphone alive for audio fallback',async({page,context})=>{
 await context.grantPermissions(['microphone']);
 await page.route('**/src/vad.js',route=>route.fulfill({contentType:'application/javascript',body:`export async function createMicVAD(o){return {start:async()=>o.onFrameProcessed({isSpeech:0},new Float32Array(512).fill(.01)),pause:async()=>{},destroy:async()=>{}}}`}));
 await page.addInitScript(()=>{window.SpeechRecognition=class {start(){setTimeout(()=>this.onerror?.({error:'not-allowed'}),0);}stop(){}};});
 await page.goto(base+'/');await page.locator('#mic').click();
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#speech-status')).toContainText('audio');
});


test('Stop cancels a detector retry and releases a retained microphone immediately',async({page,context})=>{
 await context.grantPermissions(['microphone']);
 await page.route('**/src/vad.js',route=>route.fulfill({contentType:'application/javascript',body:`export async function createMicVAD(){throw new TypeError('Failed to fetch');}`}));
 await page.addInitScript(()=>{window.SpeechRecognition=window.webkitSpeechRecognition=undefined;const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);window.micStreams=[];navigator.mediaDevices.getUserMedia=async o=>{const s=await get(o);window.micStreams.push(s);return s;};});
 await page.goto(base+'/');await page.locator('#mic').click();await expect(page.locator('#speech-status')).toContainText('PC connection interrupted');
 await expect(page.locator('#mic')).toContainText('Stop microphone');await page.locator('#mic').click();
 await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','false');
 expect(await page.evaluate(()=>window.micStreams[0].getAudioTracks()[0].readyState)).toBe('ended');
 await page.waitForTimeout(2500);expect(await page.evaluate(()=>window.micStreams.length)).toBe(1);
 expect(await page.evaluate(()=>localStorage.getItem('draw3d.microphone.enabled'))).toBe('false');
});
