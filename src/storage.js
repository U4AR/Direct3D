import {createSessionWriter,automaticSessionSnapshotDue} from './session-writer.js';
import {migrateActivityDetails} from './activity-summary.js';
import { zipSync, strToU8 } from "fflate";
export class SessionStore {
  constructor(onStatus, { namespace = "draw3d" } = {}) {
    this.namespace = globalThis.DRAW3D_USER_NAMESPACE ? `${namespace}.${globalThis.DRAW3D_USER_NAMESPACE}` : namespace;
    this.onStatus = onStatus;
    this.pending = [];
    this.started = performance.now();
    this.sequence = 0;
    this.flushChain = Promise.resolve();
  }
  async open() {
    if (navigator.locks) {
      await new Promise((resolve, reject) => {
        this.writerLock = navigator.locks.request(`${this.namespace}.active-writer`, { ifAvailable: true }, lock => {
          if (!lock) { reject(new Error("Draw3D is already open in another tab. Use that tab or close it, then reload here.")); return; }
          resolve();
          return new Promise(release => { this.releaseWriter = release; });
        }).catch(reject);
      });
    }
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(`${this.namespace}-studio`, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore("sessions", { keyPath: "id" });
        db.createObjectStore("events", { keyPath: ["sessionId", "seq"] });
        db.createObjectStore("assets", { keyPath: ["sessionId", "name"] });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const requestedId = new URL(location.href).searchParams.get("session");
    const oldId = requestedId && /^[a-f0-9-]{36}$/i.test(requestedId) ? requestedId : localStorage.getItem(`${this.namespace}.active`);
    this.session = oldId ? await this.get("sessions", oldId) : null;
    if (!this.session)
      this.session = {
        id: requestedId && /^[a-f0-9-]{36}$/i.test(requestedId) ? requestedId : crypto.randomUUID(),
        created: new Date().toISOString(),
        schema: "draw3d.session.v1",
        strokes: [],
        transcripts: [],
        revision: 0,
        collaborativeModeling: true,
        freshCAD: true,
      };
    // Event batches may be newer than the batched session snapshot after a power loss.
    const tail=await new Promise((resolve,reject)=>{const range=IDBKeyRange.bound([this.session.id],[this.session.id,[]]),r=this.db.transaction('events').objectStore('events').openCursor(range,'prev');r.onsuccess=()=>resolve(r.result?.value);r.onerror=()=>reject(r.error);});
    this.sequence = Math.max(this.session.sequence||0,tail?.seq||0);
    this.offset = Math.max(this.session.elapsedMs||0,tail?.t||0);
    localStorage.setItem(`${this.namespace}.active`, this.session.id);
    await migrateActivityDetails(this);
    await this.put("sessions", this.session);
    this.writer=createSessionWriter(`${this.namespace}-studio`);
    this.lastSnapshotAt=performance.now();
    this.timer = setInterval(() => this.flush({automatic:true}).catch(() => {}), 1000);
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
  flush({automatic=false}={}) {
    this.flushChain = this.flushChain
      .catch(() => {})
      .then(async () => {
        const batch = this.pending.splice(0);
        this.session.sequence = this.sequence;
        this.session.elapsedMs = this.elapsed();
        this.session.updated = new Date().toISOString();
        const persistSession=!automatic||automaticSessionSnapshotDue(performance.now(),this.lastSnapshotAt);
        if(!persistSession&&!batch.length)return;
        const started=performance.now();
        // JSON data is captured once. IndexedDB's second deep serialization happens in a worker.
        let snapshot,serializationMs;
        try {
          const serializeStarted=performance.now();snapshot=persistSession?JSON.stringify(this.snapshotForPersistence?.()||this.session):null;serializationMs=performance.now()-serializeStarted;
          if(this.writer&&!this.writer.failed)await this.writer.write(snapshot,batch);
          else await new Promise((resolve, reject) => {
            const tx = this.db.transaction(persistSession?["events", "sessions"]:["events"], "readwrite");
            batch.forEach((e) => tx.objectStore("events").put(e));
            if(snapshot)tx.objectStore("sessions").put(JSON.parse(snapshot));
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () =>
              reject(tx.error || new Error("Storage transaction aborted"));
          });
          if(persistSession)this.lastSnapshotAt=performance.now();
          this.lastSaveTiming={elapsedMs:performance.now()-started,mainSerializationMs:serializationMs,sessionSnapshot:persistSession,sessionCharacters:snapshot?.length||0,eventCount:batch.length,background:!!this.writer&&!this.writer.failed};
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
      "session.json": strToU8(JSON.stringify(this.snapshotForPersistence?.()||this.session, null, 2)),
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
