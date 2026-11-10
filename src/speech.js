import {savedMicrophoneInput,saveMicrophoneInput} from './microphone-input.js';
import { encodeWav } from "./audio.js";

import { createLevelVAD } from "./level-vad.js";
import {startVoiceDetector} from './voice-detector.js';

// ONNX caches an initialization failure for the lifetime of the page.
let neuralVADUnavailable=false;

export class SpeechCapture {
  constructor(store, onStatus, onTranscript, onActivity, onInterim = () => {}, onDiagnostics = () => {}) {
    Object.assign(this, {
      store,
      onStatus,
      onTranscript,
      onActivity,
      onInterim,
      onDiagnostics,
    });
    this.active = false;
    this.inputDeviceId=savedMicrophoneInput();
    this.assetWrites = new Set();
  }
  trackWrite(write){
    this.assetWrites.add(write);
    const done=()=>this.assetWrites.delete(write);
    write.then(done,done);
  }
  async selectInputDevice(deviceId){
    const wasActive=this.active;
    if(this.starting||this.restarting)throw Error('Wait for the microphone to finish starting');
    this.restarting=true;
    try{
      this.inputDeviceId=deviceId;saveMicrophoneInput(deviceId);
      if(wasActive){await this.stop();await this.start();}
    }finally{this.restarting=false;}
  }
  async restart() {
    if (this.starting || this.restarting) return;
    this.restarting = true;
    let audioContext;
    try {
      audioContext = new AudioContext({sampleRate:16000});
      audioContext.resume().catch(() => {});
      await this.stop({preserveStream:true}); await this.start({audioContext});
    } finally {
      this.restarting = false;
      if (audioContext && this.audioContext !== audioContext && audioContext.state !== "closed") await audioContext.close();
    }
  }
  async start({audioContext} = {}) {
    if (this.active || this.starting) return;
    this.paused=false;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Microphone needs HTTPS or localhost.");
    this.starting=true;
    this.engine = "direct";
    this.onStatus("Starting microphone and local VAD…");
    this.onDiagnostics({phase:"starting",status:"Starting microphone and local VAD…",level:0,probability:0,speaking:false});
    try {
      // Unlock synchronously from the click/XR select event, before model loads
      // or getUserMedia awaits consume the browser user-activation window.
      this.audioContext=audioContext || new AudioContext({sampleRate:16000});
      this.audioContext.resume().catch(error=>this.store.log("audio.resume-error",{message:error.message}));
      this.stream = this.retainedStream?.getAudioTracks().some(t=>t.readyState==="live") ? this.retainedStream : await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(this.inputDeviceId?{deviceId:{exact:this.inputDeviceId}}:{}),
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.retainedStream=null;
      this.onDiagnostics({phase:'captured',status:'Microphone access granted · preparing voice detection…',level:0,probability:0,speaking:false});
      this.inputLabel=this.stream.getAudioTracks()[0]?.label||"system default";
      const captureStream = this.stream;
      for(const track of this.stream.getAudioTracks()) {
        const report=()=>this.store.log("microphone.track",{state:track.readyState,muted:track.muted,enabled:track.enabled});
        track.onmute=()=>{report();this.onStatus("Microphone muted by headset/browser");this.onDiagnostics({phase:"muted",status:"Microphone muted by headset/browser",level:0,speaking:false});};
        track.onunmute=()=>{report();this.listeningStatus();};
        track.onended=()=>{
          if (this.stream !== captureStream || this.stopping) return;
          report();
          void this.stop().finally(()=>{
            this.onStatus("Microphone disconnected · enable microphone again");
            this.onDiagnostics({phase:"error",status:"Microphone disconnected · enable microphone again",level:0,speaking:false});
          });
        };
        report();
      }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      const recorder = (this.recorder = new MediaRecorder(
        this.stream,
        mime ? { mimeType: mime } : undefined,
      ));
      const recordingId = crypto.randomUUID();
      let index = 0;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        const write = this.store.asset(
          `audio/${recordingId}-${String(index++).padStart(5, "0")}.chunk`,
          event.data,
          { recordingId, mimeType: recorder.mimeType, t: this.store.elapsed() },
        );
        this.trackWrite(write);
        write.catch((error) => this.onStatus(error.message));
      };
      recorder.start(3000);
      this.lastAudioFrame=performance.now();
      this.lastAudioLog=0;
      this.audioPeak=0;
      this.lastSignalAt=performance.now();
      this.lastMeterAt=0;
      let detector='silero',waitingForPause=false;
      const vadOptions = {
        ...(new URL(location.href).searchParams.get("experiment")==="decision"?{redemptionMs:512}:{}),
        audioContext:this.audioContext,
        onFrameProcessed: (probabilities,frame) => {
          if (this.stream !== captureStream || this.stopping) return;
          this.lastAudioFrame=performance.now();
          let peak=0,sum=0;
          for(const sample of frame) {peak=Math.max(peak,Math.abs(sample));sum+=sample*sample;}
          this.audioPeak=Math.max(this.audioPeak,peak);
          if(peak>0.0001) this.lastSignalAt=this.lastAudioFrame;
          if(this.lastAudioFrame-this.lastMeterAt>=100) {
            const silence=this.lastAudioFrame-this.lastSignalAt>3000;
            const rms=Math.sqrt(sum/Math.max(1,frame.length));
            this.onDiagnostics({phase:silence ? "no-signal" : "listening",status:waitingForPause ? "15 s voice limit · pause before continuing" : silence ? "No mic signal · check mic access / headset awake" : (detector==="silero"?"Local Silero ONNX · listening":"Audio-level fallback · listening"),level:Math.max(0,Math.min(1,(20*Math.log10(Math.max(1e-8,rms))+60)/50)),probability:probabilities.isSpeech,frames:true});
            this.lastMeterAt=this.lastAudioFrame;
          }
          if(this.lastAudioFrame-this.lastAudioLog>3000) {
            this.store.log("audio.level",{peak:this.audioPeak,speech:probabilities.isSpeech,context:this.audioContext.state});
            this.audioPeak=0;this.lastAudioLog=this.lastAudioFrame;
          }
        },
        getStream: async () => captureStream,
        pauseStream: async () => {},
        resumeStream: async () => this.stream,
        submitUserSpeechOnPause: true,
        onClipLimit: reached=>{waitingForPause=reached;if(reached)this.store.log("speech.duration-limit",{detector});},
        onDetectorError: error=>{
          this.store.log("microphone.detector-error",{message:error.message});
          void this.stop().then(()=>this.onStatus("Microphone stopped · enable it to retry"));
        },
        onSpeechStart: () => {
          this.segmentStart = this.store.elapsed();
          this.onActivity(true);
          this.store.log("speech.start");
        },
        onSpeechEnd: (audio) => {
          this.onActivity(false);
          this.enqueue(audio);
        },
        onVADMisfire: () => {
          this.onActivity(false);
          this.store.log("speech.misfire");
          window.dispatchEvent(new Event("draw3d-speech-misfire"));
        },
      };
      if(!neuralVADUnavailable){
        const selected=await startVoiceDetector({loadNeural:async()=>{const {createMicVAD}=await import('./vad.js');return createMicVAD(vadOptions);},makeFallback:()=>createLevelVAD(vadOptions),onFallback:error=>{neuralVADUnavailable=true;this.store.log('microphone.vad-unavailable',{detector,reason:String(error?.message??error)});this.onDiagnostics({phase:'captured',status:'Microphone allowed · starting lightweight voice detection…',level:0});}});
        this.vad=selected.vad;detector=selected.detector;
      }else{
        detector='audio-level';
        this.vad=createLevelVAD(vadOptions);
        await this.vad.start();
      }
      this.active = true;
      if(this.audioContext.state!=="running") {
        await Promise.race([this.audioContext.resume(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Audio is paused by Quest Browser. Enable the microphone before entering VR.")),3000))]);
      }
      this.audioWatchdog=setInterval(()=>{
        if(!this.active) return;
        if(this.audioContext.state==="suspended") this.audioContext.resume().catch(()=>{});
        if(performance.now()-this.lastAudioFrame>6000) {
          this.onStatus("No microphone frames · check headset mic, then restart microphone");
          this.onDiagnostics({phase:"stalled",status:"No audio frames · restart microphone",level:0,probability:0,speaking:false,frames:false});
        }
      },3000);
      this.store.log("microphone.start", {
        engine: this.engine,
        localVAD: true,
        detector,inputLabel:this.inputLabel,inputDeviceId:this.inputDeviceId,
        localTranscription: false,
        directModelAudio: true,
      });
      this.listeningStatus();
      this.onDiagnostics({phase:'listening',status:'Listening · '+this.inputLabel,level:0,probability:0,speaking:false,detector});
    } catch (error) {
      await this.stop({preserveStream:/fetch|dynamically imported|network/i.test(error.message)});
      if(/fetch|dynamically imported|network/i.test(error.message)) {
        this.store.log("microphone.network-error",{message:error.message});
        error=new Error("PC connection interrupted while loading voice detection. Retrying when connected; microphone access is remembered.");
      }
      this.onStatus(error.message);
      this.onDiagnostics({phase:"error",status:error.message,level:0,probability:0,speaking:false});
      throw error;
    } finally { this.starting=false; }
  }
  listeningStatus() {
    this.onStatus(this.active ? "Listening · "+(this.inputLabel||"system default") : "Microphone off");
  }
  enqueue(audio) {
    const id = crypto.randomUUID(),
      end = this.store.elapsed(),
      start = this.segmentStart ?? end - audio.length / 16;
    this.store.log("speech.segment", {
      id,
      start,
      end,
      sampleRate: 16000,
      sampleCount: audio.length,
    });
    const write = this.store.asset(`speech/${id}.f32`, new Blob([audio]), {
      start,
      end,
      sampleRate: 16000,
    });
    this.trackWrite(write);
    write.catch((error) => this.onStatus(error.message));
    const wav=encodeWav(audio),early=this.engine==="direct"&&new URL(location.href).searchParams.get("experiment")==="decision";
    const detail={id,name:`speech/${id}.wav`,start,end,mimeType:"audio/wav",source:"direct-audio"};
    if(early)window.dispatchEvent(new CustomEvent("draw3d-audio-final",{detail:{...detail,blob:wav}}));
    const wavWrite=this.store.asset(`speech/${id}.wav`,wav,{start,end,sampleRate:16000,kind:"speech-replay",audioId:id});
    this.trackWrite(wavWrite);
    wavWrite.then(()=>{
      this.store.session.audioUploadQueue ||= [];
      this.store.session.audioUploadQueue.push({id,name:`speech/${id}.wav`,start,end});
      this.store.flush().catch(()=>{});
      window.dispatchEvent(new Event("draw3d-audio-saved"));
      if(this.engine === "direct"&&!early)window.dispatchEvent(new CustomEvent("draw3d-audio-final",{detail}));
    }).catch(error=>this.onStatus("Audio save failed: "+error.message));
  }
  stop({preserveStream=false} = {}) {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopCapture({preserveStream}).finally(() => { this.stopping = null; });
    return this.stopping;
  }
  async pause(){this.paused=true;await this.stop();this.onStatus('Audio paused · resume when ready');this.onDiagnostics({phase:'paused',status:'Audio paused · resume when ready',level:0,speaking:false});this.store.log('microphone.paused');}
  async resume(){if(!this.paused)return;await this.start();this.store.log('microphone.resumed');}
  async stopCapture({preserveStream=false} = {}) {
    this.active = false;
    const stream = this.stream||this.retainedStream;
    this.stream = null;
    this.retainedStream=preserveStream&&stream?.getAudioTracks().some(t=>t.readyState==="live")?stream:null;
    stream?.getTracks().forEach(track => { track.onended = track.onmute = track.onunmute = null; });
    // Release device access immediately; detector/recorder cleanup may be async.
    if(!this.retainedStream)stream?.getTracks().forEach(track=>track.stop());
    clearInterval(this.audioWatchdog);
    this.native?.stop();
    this.native = null;
    if (this.vad) {
      const vad=this.vad;this.vad=null;
      // A lost device can make VAD cleanup fail; still release the recorder and stream.
      for (const action of ["pause","destroy"]) {
        try { await vad[action](); }
        catch(error) { this.store.log("microphone.cleanup-error",{action,message:error.message}); }
      }
    }
    if (this.recorder?.state === "recording")
      await new Promise((resolve) => {
        this.recorder.onstop = resolve;
        this.recorder.stop();
      });
    if(this.audioContext && this.audioContext.state!=="closed") await this.audioContext.close();
    this.audioContext=null;
    await Promise.allSettled(this.assetWrites);
    this.onActivity(false);
    this.onDiagnostics({phase:"off",status:"Microphone off",level:0,probability:0,speaking:false,frames:false});
    if (!this.busy) this.onStatus("Microphone off");
    this.store.log("microphone.stop");
  }
}
