import { zipSync, strToU8 } from "fflate";
export class SessionStore {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.pending = [];
    this.started = performance.now();
    this.sequence = 0;
    this.flushChain = Promise.resolve();
  }
  async open() {
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("draw3d-studio", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("sessions", { keyPath: "id" });
        db.createObjectStore("events", { keyPath: ["sessionId", "seq"] });
        db.createObjectStore("assets", { keyPath: ["sessionId", "name"] });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const oldId = localStorage.getItem("draw3d.active");
    this.session = oldId ? await this.get("sessions", oldId) : null;
    if (!this.session)
      this.session = {
        id: crypto.randomUUID(),
        created: new Date().toISOString(),
        schema: "draw3d.session.v1",
        strokes: [],
        transcripts: [],
        revision: 0,
      };
    this.sequence = this.session.sequence || 0;
    this.offset = this.session.elapsedMs || 0;
    localStorage.setItem("draw3d.active", this.session.id);
    await this.put("sessions", this.session);
    this.timer = setInterval(() => this.flush().catch(() => {}), 1000);
    this.log("session.open", { recovered: !!oldId });
    return this.session;
  }
  get(store, key) {
    return new Promise((res, rej) => {
      const r = this.db.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  put(store, value) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(store, "readwrite");
      tx.objectStore(store).put(value);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  elapsed() {
    return this.offset + performance.now() - this.started;
  }
  log(type, data = {}) {
    this.pending.push({
      sessionId: this.session.id,
      seq: ++this.sequence,
      t: this.elapsed(),
      wallTime: new Date().toISOString(),
      type,
      data,
    });
  }
  async asset(name, blob, metadata = {}) {
    try {
      await this.put("assets", {
        sessionId: this.session.id,
        name,
        blob,
        metadata,
      });
    } catch (e) {
      this.onStatus("Storage full or unavailable — export now", true);
      throw e;
    }
  }
  flush() {
    this.flushChain = this.flushChain
      .catch(() => {})
      .then(async () => {
        const batch = this.pending.splice(0);
        this.session.sequence = this.sequence;
        this.session.elapsedMs = this.elapsed();
        this.session.updated = new Date().toISOString();
        const snapshot = structuredClone(this.session);
        try {
          await new Promise((resolve, reject) => {
            const tx = this.db.transaction(["events", "sessions"], "readwrite");
            batch.forEach((e) => tx.objectStore("events").put(e));
            tx.objectStore("sessions").put(snapshot);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () =>
              reject(tx.error || new Error("Storage transaction aborted"));
          });
          this.onStatus("Saved on this device", false);
        } catch (e) {
          this.pending.unshift(...batch);
          this.onStatus("Local save failed — export before closing", true);
          throw e;
        }
      });
    return this.flushChain;
  }
  async rows(store) {
    return new Promise((res, rej) => {
      const range = IDBKeyRange.bound([this.session.id], [this.session.id, []]);
      const r = this.db.transaction(store).objectStore(store).getAll(range);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async export() {
    this.log("session.export");
    await this.flush();
    const files = {
      "session.json": strToU8(JSON.stringify(this.session, null, 2)),
    };
    files["events.jsonl"] = strToU8(
      (await this.rows("events")).map((e) => JSON.stringify(e)).join("\n"),
    );
    const manifest = [];
    for (const asset of await this.rows("assets")) {
      files[`assets/${asset.name}`] = new Uint8Array(
        await asset.blob.arrayBuffer(),
      );
      manifest.push({ name: asset.name, ...asset.metadata });
    }
    files["assets.json"] = strToU8(JSON.stringify(manifest, null, 2));
    return new Blob([zipSync(files, { level: 1 })], {
      type: "application/zip",
    });
  }
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
