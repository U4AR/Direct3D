const FRAME_MS=32; // The microphone worklet resamples to 512 samples at 16 kHz.
export const MAX_CLIP_MS=15000;

export function speechSegments(options,{neural=true}={}){
 const {onSpeechStart,onSpeechEnd,onVADMisfire}=options;
 const tail=Math.max(1,Math.ceil((options.redemptionMs??640)/FRAME_MS));
 const maxFrames=Math.floor(MAX_CLIP_MS/FRAME_MS);
 let lead=[],frames=[],voiced=0,quiet=0,announced=false,waitingForPause=false;
 function reset(){lead=[];frames=[];voiced=0;quiet=0;announced=false;}
 function finish(atLimit=false){
  const deliver=announced&&(!atLimit||neural),notify=announced;
  const trim=atLimit?0:Math.max(0,quiet-6),clip=frames.slice(0,frames.length-trim);
  reset();waitingForPause=atLimit;
  if(atLimit)options.onClipLimit?.(true);
  if(deliver){
   const audio=new Float32Array(clip.length*512);
   clip.forEach((f,i)=>audio.set(f,i*512));onSpeechEnd(audio);
  }else if(notify)onVADMisfire?.();
 }
 function process(frame,probability){
  const strong=probability>=.55,low=probability<.32;
  quiet=low?quiet+1:0;
  if(waitingForPause){if(quiet>=tail){waitingForPause=false;reset();options.onClipLimit?.(false);}return;}
  if(!frames.length&&!strong){lead.push(frame);if(lead.length>8)lead.shift();return;}
  if(!frames.length){frames=lead;lead=[];}
  frames.push(frame);
  if(strong)voiced++;
  if(!announced&&voiced>=9){announced=true;onSpeechStart?.();}
  if(quiet>=tail)finish();
  else if(frames.length>=maxFrames)finish(true);
 }
 return {process,finish,reset};
}

// One ordered frame stream drives the local model or the low-memory fallback.
export function createFrameMic(options,score,{neural=false,release}={}){
 const segments=speechSegments(options,{neural});
 let source,node,running=false,draining=null,backlog=[],epoch=0,destroyed=false;
 async function processFrame(frame){
  const token=epoch,probability=await score(frame);
  if(!running||token!==epoch)return;
  options.onFrameProcessed?.({isSpeech:probability,notSpeech:1-probability},frame);
  segments.process(frame,probability);
 }
 async function drain(){
  while(running&&backlog.length)await processFrame(backlog.shift());
 }
 async function pause(){
  running=false;epoch++;backlog=[];source?.disconnect();source=null;
  if(node){node.port.onmessage=null;node.port.postMessage('SPEECH_STOP');node.port.close();node.disconnect();node=null;}
  await draining;
  segments.finish();
 }
 return {
  processFrame,
  async start(){
   const ctx=options.audioContext,stream=await options.getStream();
   if(destroyed)return;
   await ctx.audioWorklet.addModule('/vad/vad.worklet.bundle.min.js');
   if(destroyed)return;
   node=new AudioWorkletNode(ctx,'vad-helper-worklet',{processorOptions:{frameSamples:512}});
   running=true;
   node.port.onmessage=({data})=>{
    if(!running||data.message!=='AUDIO_FRAME')return;
    // Do not accumulate minutes of stale audio on a suspended or overloaded tab.
    if(backlog.length>=64){epoch++;backlog=[];segments.reset();options.onVADMisfire?.();}
    backlog.push(new Float32Array(data.data));
    if(!draining)draining=drain().catch(error=>{
     running=false;segments.reset();options.onDetectorError?.(error);
    }).finally(()=>{draining=null;});
   };
   source=ctx.createMediaStreamSource(stream);source.connect(node);node.connect(ctx.destination);
  },
  pause,async destroy(){if(destroyed)return;destroyed=true;await pause();await release?.();}
 };
}

export function createLevelVAD(options){
 let ambient=.002;
 return createFrameMic(options,frame=>{
  let sum=0;for(const value of frame)sum+=value*value;
  const rms=Math.sqrt(sum/frame.length),threshold=Math.max(.006,ambient*3);
  if(rms<threshold)ambient+=.04*(rms-ambient);
  return rms>=threshold?1:0;
 });
}
