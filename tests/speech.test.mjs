import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, blobToBase64 } from '../src/audio.js';
import { BrowserSpeech } from '../src/browser-speech.js';
import { buildTranscriptionInput } from '../scripts/model-bridge.mjs';

test('VAD samples become valid PCM16 WAV accepted by the Gemini transcription endpoint', async () => {
  const wav = encodeWav(new Float32Array([-1, 0, 1]));
  const view = new DataView(await wav.arrayBuffer());
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(48, true), 32767);
  const input = buildTranscriptionInput({ audio: await blobToBase64(wav), mimeType: 'audio/wav' });
  assert.equal(input[1].type, 'audio');
  assert.throws(() => buildTranscriptionInput({ audio: 'YWJj', mimeType: 'audio/wav' }));
});

test('native speech emits interim and final transcripts and stops without restarting', async () => {
  const original = globalThis.SpeechRecognition;
  class Recognition { start() { queueMicrotask(() => this.onstart()); } stop() { this.onend?.(); } }
  globalThis.SpeechRecognition = Recognition;
  const finals = [], interims = [];
  const speech = new BrowserSpeech({ onFinal: v => finals.push(v), onInterim: v => interims.push(v), onStatus() {}, onEvent() {}, now: () => 1234 });
  try {
    await speech.start();
    const interim = [{ transcript: 'a rounded', confidence: .9 }]; interim.isFinal = false;
    speech.recognition.onresult({ resultIndex: 0, results: [interim] });
    const final = [{ transcript: 'a rounded vase', confidence: .9 }]; final.isFinal = true;
    speech.recognition.onresult({ resultIndex: 0, results: [final] });
    assert.equal(interims[0], 'a rounded');
    assert.equal(finals[0].text, 'a rounded vase');
    assert.equal(finals[0].source, 'browser-speech');
    speech.stop(); assert.equal(speech.running, false); assert.equal(speech.restartTimer, undefined);
  } finally { globalThis.SpeechRecognition = original; }
});
