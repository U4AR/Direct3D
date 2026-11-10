import {savedSessionCAD} from "./saved-session-cad.js";
import { instructionForm } from "./typed-input.js";
import { download } from "./storage.js";
import {isCadDocument,waitForCadEditor} from './cad-readiness.js';
import {loadingState} from './loading-state.js';
// Full parametric CAD runs in an isolated browser frame on the headset.
export function initFullCAD(studio, store, notice, addTranscript) {
  const selector = document.createElement("div");
  selector.className = "tool-tabs workspace-tabs";
  selector.innerHTML = '<button id="workspace-sketch" class="selected">Spatial drawing</button>';
  document.querySelector(".left-panel .intro").after(selector);
  const button = document.createElement("button");
  button.id = "workspace-full-cad";
  button.textContent = "Full CAD";
  selector.append(button);
  const shell = document.createElement("section");
  shell.id = "full-cad-workspace";
  shell.hidden = true;
  shell.innerHTML = `<div class="cad-topbar"><button id="cad-back">← Spatial drawing</button><strong>Full CAD · OpenZCAD</strong><span>Runs on this headset / browser · autosaves locally</span><button id="cad-context-toggle" aria-expanded="false">Drawing + speech</button><button id="cad-export-session">Export recording</button><a href="/cad/THIRD-PARTY-NOTICES.md" target="_blank">Licenses</a></div><p id="full-cad-status" role="status">Loading CAD workspace…</p><div class="cad-editor-body"><aside id="cad-context" hidden><h2>Drawing + speech</h2><img id="cad-sketch-reference" alt="Your spatial sketch reference"/><p id="cad-sketch-summary"></p><button id="cad-context-mic">Enable microphone</button><meter id="cad-context-level" min="0" max="1" aria-label="Microphone level"></meter><p id="cad-context-voice" role="status"></p><h3>Description</h3><p id="cad-context-transcript"></p><button id="cad-context-export">Export agent context</button><p class="hint">Sketch points, dimensions in metres, transcript and CAD revisions stay in your local recording. MCP agents can read this context and edit both workspaces.</p></aside><iframe title="Full parametric CAD workspace" allow="fullscreen; clipboard-write" sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-modals allow-popups"></iframe></div>`;
  document.body.append(shell);
  const frame = shell.querySelector("iframe"),
    status = shell.querySelector("#full-cad-status");
  const retry=document.createElement('button');retry.id='cad-retry';retry.textContent='Retry CAD';retry.hidden=true;status.after(retry);
  const loading=document.createElement('div');loading.id='cad-loading';loading.setAttribute('role','status');loading.innerHTML='<span class="loading-spinner" aria-hidden="true"></span><strong>Opening your CAD workspace</strong><p>Loading the editor and geometry tools…</p>';shell.querySelector('.cad-editor-body').append(loading);
  const progress=message=>{status.hidden=false;status.textContent=message;loading.hidden=false;loading.querySelector('p').textContent=message;shell.setAttribute('aria-busy','true');loadingState('cad',message);};
  const failed=error=>{status.hidden=false;status.textContent=error.message;loading.hidden=true;retry.hidden=false;shell.setAttribute('aria-busy','false');loadingState('cad',error.message,'error');};
  retry.onclick=()=>{initialization=null;initialized=false;ready=false;retry.hidden=true;progress('Retrying CAD editor…');frame.src='/cad/index.html?retry='+Date.now();};
  let ready = false,
    opening = false,
    latestDocument = null;
  function context() {
    return {
      schema: "draw3d.agent-context.v1",
      sessionId: store.session.id,
      units: "metres",
      strokes: structuredClone(store.session.strokes.filter(s=>!s.hidden)),
      archivedStrokes: structuredClone(store.session.strokes.filter(s=>s.hidden)),
      completedRequests: structuredClone(store.session.completedRequests||[]),
      transcripts: structuredClone(store.session.transcripts),
      cadEngine: "OpenZCAD",
      cadProject: store.session.activeCADProject || null,
    };
  }
  function updateContext() {
    shell.querySelector("#cad-sketch-summary").textContent =
      `${store.session.strokes.length} strokes · metric 3D sketch`;
    shell.querySelector("#cad-context-transcript").textContent =
      store.session.transcripts.map((t) => t.text || t.transcript || "").join("\n") ||
      "Your spoken description will appear here.";
    const mic = document.querySelector("#mic");
    shell.querySelector("#cad-context-mic").textContent = mic.textContent;
    shell
      .querySelector("#cad-context-mic")
      .setAttribute("aria-pressed", mic.getAttribute("aria-pressed") || "false");
    shell.querySelector("#cad-context-level").value =
      document.querySelector("#mic-level")?.value || 0;
    shell.querySelector("#cad-context-voice").textContent =
      document.querySelector("#speech-status")?.textContent || "";
  }
  const contextPanel = shell.querySelector("#cad-context");
  instructionForm(contextPanel, store, addTranscript, "cad-instruction");
  shell.querySelector("#cad-context-toggle").onclick = () => {
    contextPanel.hidden = !contextPanel.hidden;
    shell
      .querySelector("#cad-context-toggle")
      .setAttribute("aria-expanded", String(!contextPanel.hidden));
    updateContext();
  };
  shell.querySelector("#cad-context-mic").onclick = () => document.querySelector("#mic").click();
  shell.querySelector("#cad-context-export").onclick = async () => {
    try {
      const asset = store.session.activeCADProject?.asset;
      const saved =
        !latestDocument && asset ? await store.get("assets", [store.session.id, asset]) : null;
      const payload = {
        ...context(),
        cadDocument: latestDocument || (saved ? JSON.parse(await saved.blob.text()) : null),
        sketchReference: shell.querySelector("#cad-sketch-reference").src,
      };
      download(
        new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
        "draw3d-agent-context.json",
      );
    } catch (error) {
      notice(error.message, true);
    }
  };
  setInterval(() => {
    if (!shell.hidden) updateContext();
  }, 500);
  async function ensure() {
    if (!frame.getAttribute("src")){progress('Loading CAD editor and geometry tools…');frame.src = "/cad/index.html";}
  }
  async function open() {
    frame.style.cssText = "";
    window.dispatchEvent(new CustomEvent("draw3d-user-workspace", { detail: "cad" }));
    if (opening) return;
    opening = true;
    try {
      studio.endAll();
      const session = studio.renderer.xr.getSession();
      if (session) await session.end();
      studio.renderer.render(studio.scene, studio.camera);
      shell.querySelector("#cad-sketch-reference").src =
        studio.renderer.domElement.toDataURL("image/png");
      updateContext();
      store.log("cad.sketch-context", context());
      await store.flush();
      shell.hidden = false;
      studio.cadEditorOpen = true;
      button.classList.add("selected");
      store.log("workspace.mode", { mode: "full-cad", engine: "OpenZCAD", compute: "device" });
      if (!frame.getAttribute("src")) {
        const check = await fetch("/cad/integration.json", { signal: AbortSignal.timeout(10000) });
        if (!check.ok || !(await check.json()).commit)
          throw new Error("CAD assets are missing. Run npm run cad:bundle on the PC.");
        frame.src = "/cad/index.html";
      }
      if (ready) status.hidden = true;
    } catch (error) {
      status.hidden = false;
      status.textContent = error.message;
      notice(error.message, true);
    } finally {
      opening = false;
    }
  }
  function close() {
    window.dispatchEvent(new CustomEvent("draw3d-user-workspace", { detail: "sketch" }));
    shell.hidden = true;
    studio.cadEditorOpen = false;
    button.classList.remove("selected");
    store.log("workspace.mode", { mode: "sketch" });
    void store.flush().catch((error) => notice(error.message, true));
  }
  if(document.body.classList.contains('desktop-studio')){
    const sketchBar=document.createElement('div');sketchBar.className='cad-native-sketch-tools';sketchBar.innerHTML='<strong>Sketch</strong><select id="native-sketch-plane"><option>XY</option><option>XZ</option><option>YZ</option></select><button data-native-tool="line">Line</button><button data-native-tool="rectangle">Rectangle</button><button data-native-tool="circle">Circle</button><button id="native-sketch-face">Sketch on selected face</button><button id="native-ai-freehand">AI freehand workspace</button><span id="native-sketch-hint">Choose a plane and tool, or select a planar face, then sketch on it.</span>';shell.querySelector('.cad-topbar').after(sketchBar);
    const run=async fn=>{try{await ensure();const deadline=Date.now()+30000;while(!frame.contentWindow?.__draw3dCAD){if(Date.now()>deadline)throw Error('CAD is still loading');await new Promise(r=>setTimeout(r,100));}fn(frame.contentWindow.__draw3dCAD);sketchBar.querySelector('#native-sketch-hint').textContent='Sketch mode active. Click in the CAD viewport to draw. Finish Sketch when done.';}catch(e){sketchBar.querySelector('#native-sketch-hint').textContent=e.message;}};
    sketchBar.querySelectorAll('[data-native-tool]').forEach(b=>b.onclick=()=>void run(api=>api.startSketch(sketchBar.querySelector('select').value,b.dataset.nativeTool)));
    sketchBar.querySelector('#native-sketch-face').onclick=()=>void run(api=>api.sketchOnSelectedFace('line'));
    sketchBar.querySelector('#native-ai-freehand').onclick=()=>{close();document.querySelector('#desktop-3d').click();studio.beginSketch?.();};
  }
  studio.openNativeCAD = open;
  button.onclick = open;
  shell.querySelector("#cad-back").onclick = close;
  shell.querySelector("#cad-export-session").onclick = () =>
    document.querySelector("#export").click();
  let initialization, initialized = false, saveSequence = 0;
  const pause = () => new Promise(resolve => setTimeout(resolve, 50));
  async function initializeProject() {
    const api=await waitForCadEditor(frame,{onProgress:progress}),editor=()=>api;
    const deadline=Date.now()+180000;progress('Opening your saved CAD project…');
    const session = store.session;
    if (session.freshCAD) {
      await editor().create("Collaborative canvas " + session.id.slice(0,8), "mm");
      const doc = editor().document(), asset = "cad/initial-empty.json";
      await store.asset(asset, new Blob([JSON.stringify(doc)], {type:"application/json"}), {kind:"cad-project-revision",engine:"OpenZCAD"});
      session.activeCADProject = {projectId:doc.projectId, version:doc.version, asset};
      session.freshCAD = false;
      await store.flush();
    } else {
      const current = editor().document();
      const saved = await savedSessionCAD(store, current);
      if (saved && saved !== current) {
        for (;;) {
          try { editor().restore(saved); break; }
          catch (error) { if (error.message !== "CAD is busy" || Date.now() >= deadline) throw error; await pause(); }
        }
        if (editor().document()?.projectId !== saved.projectId) throw Error("CAD did not reopen the saved project");
        store.log("cad.project.reopened", {projectId:saved.projectId, version:saved.version});
      }
    }
    initialized = true;
    ready=true;status.hidden=true;loading.hidden=true;retry.hidden=true;shell.setAttribute('aria-busy','false');loadingState('cad','CAD workspace ready','ready');
  }
  function projectReady() {
    return initialization ||= initializeProject().catch(error => { initialization = null; failed(error);throw error; });
  }
  // The initial about:blank load is not a CAD launch. Starting its timeout can
  // produce a false failure before the real iframe is requested.
  frame.addEventListener("load", () => {if(isCadDocument(frame))void projectReady().catch(()=>{});});
  window.addEventListener("message", async (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== frame.contentWindow ||
      event.data?.channel !== "draw3d.cad"
    )
      return;
    const { type, data } = event.data;
    if (type === "ready") {
      try { await projectReady(); } catch { return; }
      ready = true;
      status.hidden = true;
    } else if(type==='command-error'){
      store.log('cad.command.error',data);
    } else if (type === "project") {
      if (!initialized || frame.contentWindow.__draw3dCAD?.document()?.projectId !== data.projectId) return;
      const sequence = ++saveSequence;
      latestDocument = data;
      const text = JSON.stringify(data);
      if (text.length > 64 * 1024 * 1024) {
        notice(
          "CAD revision is too large for the session recording; export it from CAD File menu.",
          true,
        );
        return;
      }
      const name = `cad/revisions/${Date.now()}-${crypto.randomUUID()}.json`;
      void store
        .asset(name, new Blob([text], { type: "application/json" }), {
          kind: "cad-project-revision",
          engine: "OpenZCAD",
        })
        .then(() => {
          if (sequence !== saveSequence) return;
          store.session.activeCADProject = {
            projectId: data.projectId,
            name: data.name,
            version: data.version,
            asset: name,
          };
          store.log("cad.project.saved", { asset: name });
          return store.flush();
        })
        .catch((error) => notice(error.message, true));
    } else if (type === "interaction") store.log("cad.interaction", data);
  });
  return {
    open,
    close,
    ensure,
    projectReady,
    get initialized() { return initialized; },
    frame,
    shell,
    context,
    action(action) {
      if (action === "workspace-toggle") {
        void open();
        return true;
      }
      return false;
    },
  };
}
