export function speechRecognitionClass() {
  return (
    globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null
  );
}

// Platform dictation and the Web Speech API are distinct capabilities. Detect
// this API directly, never infer availability from a Quest/Chromium user agent.
export class BrowserSpeech {
  constructor({
    onFinal,
    onInterim,
    onStatus,
    onEvent,
    now,
    onUnavailable = () => {},
  }) {
    Object.assign(this, {
      onFinal,
      onInterim,
      onStatus,
      onEvent,
      now,
      onUnavailable,
    });
    this.running = false;
    this.restartCount = 0;
  }

  async start() {
    const Recognition = speechRecognitionClass();
    if (!Recognition)
      throw new Error("This browser does not expose speech recognition.");
    this.recognition = new Recognition();
    this.recognition.lang = "en-US";
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    this.running = true;
    this.startedAt = this.now();
    this.local = false;
    // Prefer an already installed native language pack; never silently download
    // one or claim platform dictation is local without checking it.
    if (
      "processLocally" in this.recognition &&
      typeof Recognition.available === "function"
    ) {
      try {
        const availability = await Recognition.available({
          langs: ["en-US"],
          processLocally: true,
        });
        if (availability === "available") {
          this.recognition.processLocally = true;
          this.local = true;
        }
      } catch {
        /* The browser's standard recognizer is still usable. */
      }
    }
    this.recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i],
          text = result[0].transcript.trim();
        if (result.isFinal && text) {
          this.onFinal({
            id: crypto.randomUUID(),
            text,
            start: this.startedAt,
            end: this.now(),
            source: this.local ? "browser-on-device" : "browser-speech",
            confidence: result[0].confidence,
          });
          this.startedAt = this.now();
        } else if (text) interim += text + " ";
      }
      this.restartCount = 0;
      this.onInterim(interim.trim());
    };
    this.recognition.onend = () => {
      this.onInterim("");
      if (!this.running) return;
      if (++this.restartCount > 3) {
        this.running = false;
        this.onStatus(
          "Browser dictation stopped. Restart microphone or use typed input.",
        );
        this.onUnavailable();
        return;
      }
      this.restartTimer = setTimeout(() => {
        if (!this.running) return;
        try {
          this.recognition.start();
        } catch (error) {
          this.running = false;
          this.onStatus(error.message);
        }
      }, 500);
    };
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stop();
        reject(
          new Error(
            "Browser speech recognition did not start. Its service may be unavailable on this device.",
          ),
        );
      }, 10000);
      let ready = false;
      this.recognition.onstart = () => {
        clearTimeout(timeout);
        ready = true;
        this.onStatus(
          this.local
            ? "Listening · browser on-device speech"
            : "Listening · browser speech (may use network)",
        );
        resolve();
      };
      this.recognition.onerror = (event) => {
        this.onEvent("browser-speech.error", { error: event.error });
        if (event.error === "no-speech" && ready) return;
        clearTimeout(timeout);
        this.running = false;
        const error = new Error(
          `Browser speech: ${event.error}. Dictation may be unavailable; audio remains recorded locally.`,
        );
        this.onStatus(error.message);
        if (!ready) reject(error);
        else this.onUnavailable(error);
      };
      try {
        this.recognition.start();
      } catch (error) {
        clearTimeout(timeout);
        this.running = false;
        reject(error);
      }
    });
  }

  stop() {
    this.running = false;
    clearTimeout(this.restartTimer);
    try {
      this.recognition?.stop();
    } catch {
      /* Already stopped. */
    }
    this.onInterim("");
  }
}
