import { BrowserSpeech, speechRecognitionClass } from './browser-speech.js';
import { encodeWav, blobToBase64 } from './audio.js';

export class SpeechCapture {
  constructor(store, onStatus, onTranscript, onActivity, onInterim = () => {}) {
    Object.assign(this, { store, onStatus, onTranscript, onActivity, onInterim });
    this.active = false; this.queue = []; this.busy = false; this.assetWrites = []; this.retryBlocked = false;
  }
  async start() {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone needs HTTPS or localhost.');
    this.engine = speechRecognitionClass() ? 'browser' : 'gemini';
    this.retryBlocked = false;
    this.onStatus('Starting microphone and local VAD…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
      const recordingId = crypto.randomUUID(); let index = 0;
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        const write = this.store.asset(`audio/${recordingId}-${String(index++).padStart(5, '0')}.chunk`, event.data, { recordingId, mimeType: recorder.mimeType, t: this.store.elapsed() });
        this.assetWrites.push(write); write.catch(error => this.onStatus(error.message));
      };
      recorder.start(3000);
      if (this.engine === 'browser') {
        this.native = new BrowserSpeech({ onFinal: this.onTranscript, onInterim: this.onInterim, onStatus: this.onStatus, onEvent: (type, data) => this.store.log(type, data), now: () => this.store.elapsed(), onUnavailable: () => this.useGemini() });
        try { await this.native.start(); }
        catch (error) { if (/not-allowed|audio-capture/.test(error.message)) throw error; this.native.stop(); this.useGemini(); }
      }
      const { createMicVAD } = await import('./vad.js');
      this.vad = await createMicVAD({ getStream: async () => this.stream, pauseStream: async () => {}, resumeStream: async () => this.stream, submitUserSpeechOnPause: true,
        onSpeechStart: () => { this.segmentStart = this.store.elapsed(); this.onActivity(true); this.store.log('speech.start'); },
        onSpeechEnd: audio => { this.onActivity(false); this.enqueue(audio); },
        onVADMisfire: () => { this.onActivity(false); this.store.log('speech.misfire'); },
      });
      this.active = true; await this.vad.start();
      this.store.log('microphone.start', { engine: this.engine, localVAD: true, localTranscription: this.engine === 'browser' && !!this.native?.local });
      this.listeningStatus(); this.pump();
    } catch (error) { await this.stop(); throw error; }
  }
  useGemini() { this.engine = 'gemini'; this.store.log('speech.engine', { engine: 'gemini', reason: 'browser-unavailable' }); this.onStatus('Browser dictation unavailable · Gemini audio fallback (requires key)'); }
  listeningStatus() { this.onStatus(!this.active ? 'Microphone off' : this.engine === 'gemini' ? 'Listening · Gemini audio transcription' : this.native?.local ? 'Listening · browser on-device speech' : 'Listening · browser speech (may use network)'); }
  enqueue(audio) {
    const id = crypto.randomUUID(), end = this.store.elapsed(), start = this.segmentStart ?? end - audio.length / 16;
    this.store.log('speech.segment', { id, start, end, sampleRate: 16000, sampleCount: audio.length });
    const write = this.store.asset(`speech/${id}.f32`, new Blob([audio]), { start, end, sampleRate: 16000 });
    this.assetWrites.push(write); write.catch(error => this.onStatus(error.message));
    if (this.engine !== 'gemini') return;
    // Bound provider requests to 20 seconds, retaining the full original utterance.
    for (let offset = 0; offset < audio.length; offset += 320000) this.queue.push({ id: `${id}-${offset}`, audio: audio.slice(offset, offset + 320000), start: start + offset / 16, end: Math.min(end, start + (offset + 320000) / 16) });
    this.pump();
  }
  async pump() {
    if (this.busy || this.retryBlocked || !this.queue.length || this.engine !== 'gemini') return;
    this.busy = true; const item = this.queue[0];
    this.onStatus(`Transcribing with Gemini · ${this.queue.length} queued`);
    try {
      const wav = encodeWav(item.audio);
      await this.store.asset(`speech/${item.id}.wav`, wav, { start: item.start, end: item.end, source: 'gemini-input' });
      const response = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: await blobToBase64(wav), mimeType: 'audio/wav', id: item.id }), signal: AbortSignal.timeout(120000) });
      let result; try { result = await response.json(); } catch { throw new Error('Start npm run bridge for Gemini transcription.'); }
      if (!response.ok) throw new Error(result.error || `Transcription request failed (${response.status})`);
      await this.store.asset(`speech/${item.id}-transcript.json`, new Blob([JSON.stringify(result)]), { source: 'gemini' });
      if (result.text?.trim()) this.onTranscript({ id: item.id, text: result.text.trim(), start: item.start, end: item.end, source: 'gemini-audio', model: result.model });
      this.queue.shift(); this.busy = false;
      if (this.queue.length) this.pump(); else this.listeningStatus();
    } catch (error) {
      this.busy = false; this.retryBlocked = true;
      this.store.log('speech.error', { id: item.id, error: error.message });
      this.onStatus(`${error.message} Audio saved locally; restart microphone to retry.`);
    }
  }
  async stop() {
    this.active = false; this.native?.stop(); this.native = null;
    if (this.vad) { await this.vad.pause(); await this.vad.destroy(); this.vad = null; }
    if (this.recorder?.state === 'recording') await new Promise(resolve => { this.recorder.onstop = resolve; this.recorder.stop(); });
    this.stream?.getTracks().forEach(track => track.stop()); await Promise.allSettled(this.assetWrites);
    this.onActivity(false); if (!this.busy) this.onStatus('Microphone off'); this.store.log('microphone.stop');
  }
}
