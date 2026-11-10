import {recordSessionActivity} from './session-activity.js';
import {coordinateChildPlacements} from './body-selection.js';
import {initBodyColors} from './body-colors.js';
import {syncAttachedStrokes} from './design-frame.js';
import {readSpeechProgress} from './speech-progress.js';
import {retryJSON} from './request-recovery.js';
import {initBlenderWorkspace} from './blender-workspace.js';
import {validateDesktopEdit} from './desktop-edit-contract.js';
import {validateSpatialEdit} from './spatial-edit-contract.js';
import {initSpatialWorkflow} from './spatial-workflow.js';
import {initDesktopHistory} from './desktop-history.js';
import {prepareDesktopEvidence,applyDesktopEdit,assertDesktopCurrent} from './desktop-direct.js';
import {initDesktopDrawing} from './desktop-drawing.js';
import {initStrokeReferenceTools} from './stroke-reference-tools.js';
import {polygonFromPoints} from "./fitted-polygon.js";
import {completeLineProfile} from "./cad-profile.js";
import {primitiveFromPoints} from "./fitted-primitive.js";
import {modelFrame,convertFrame,measureModels,matchMatrix} from "./model-spatial.js";
import {sketchReference} from "./sketch-reference.js";
import {initObjectManipulation} from "./object-manipulation.js";
import {initSurfaceTools} from "./surface-tools.js";
import {initModelPatternTools} from "./model-pattern-tools.js";
import {initStrokeVariables} from "./stroke-variables.js";
import { sketchAnalysis } from "./sketch-analysis-tools.js";
import { initModelAgentUI } from "./model-agent-ui.js";
import { initProjectionTools } from "./projection-tools.js";
import { instructionForm } from "./typed-input.js";
import { initSketchTools } from "./sketch-tools.js";
import { cadDiagnostics } from "./cad-diagnostics.js";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const finiteVec = (v, positive = false) =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && (!positive || n > 0));
export function initAgentWorkspaces(studio, store, cad, notice, addTranscript) {
  let userWorkspace = "sketch",
    agentWorkspace = "cad",
    paused = false,
    executing = false,
    lastInput = 0,
    held = false,
    connected = false,
    registration;
  const registrationKey = "draw3d.agent.session." + store.session.id;
  try { registration = JSON.parse(sessionStorage.getItem(registrationKey) || "null"); } catch {}
  const models = new Map(),
    group = new T.Group();
  group.name = "Shared CAD and sculpt models";
  studio.scene.add(group);
  const bodyColors=initBodyColors(studio,store,models);
  const sculpt = document.createElement("iframe");
  sculpt.title = "Non-parametric sculpting workspace";
  sculpt.setAttribute(
    "sandbox",
    "allow-scripts allow-same-origin allow-downloads allow-forms allow-modals",
  );
  const sculptTab = document.createElement("button");
  sculptTab.id = "workspace-sculpt";
  sculptTab.textContent = "Sculpt";
  document.querySelector(".workspace-tabs").append(sculptTab);
  const bar = cad.shell.querySelector(".cad-topbar");
  const cadSwitch = document.createElement("button");
  cadSwitch.textContent = "CAD";
  const sculptSwitch = document.createElement("button");
  sculptSwitch.textContent = "Sculpt";
  bar.insertBefore(cadSwitch, bar.children[1]);
  bar.insertBefore(sculptSwitch, bar.children[2]);
  const splineButton = document.createElement("button");
  splineButton.id = "cad-new-spline";
  splineButton.textContent = "+ Spline";
  bar.append(splineButton);
  const splineSelect = document.createElement("select");
  splineSelect.id = "cad-spline-list";
  splineSelect.setAttribute("aria-label", "Editable spline");
  bar.append(splineSelect);
  const editSplineButton = document.createElement("button");
  editSplineButton.id = "cad-edit-spline";
  editSplineButton.textContent = "Edit spline";
  bar.append(editSplineButton);
  splineButton.onclick = async () => {
    try {
      await show("cad");
      let api = await ensure("cad");
      if (!api.document()) {
        await api.create("Spline design", "mm");
        await settled(api);
        api = await ensure("cad");
      }
      const d = api.document(),
        scale = { mm: 1, cm: 0.1, m: 0.001, inch: 1 / 25.4 }[d.units],
        r = 25 * scale,
        k = 0.5522847498 * r;
      const segments = [
        [r, 0, r, k, k, r, 0, r],
        [0, r, -k, r, -r, k, -r, 0],
        [-r, 0, -r, -k, -k, -r, 0, -r],
        [0, -r, k, -r, r, -k, r, 0],
      ].map((points) => ({ points }));
      const result = api.execute(
        "addSketch",
        {
          name: "Cubic spline",
          planeRef: { type: "canonical", plane: "XY", offset: 0 },
          objects: [{ objectKind: "spline", closed: true, segments }],
        },
        d.version,
      );
      await settled(api);
      await refresh();
      (await ensure("cad")).openSplineEditor(result.command.payload.ids.objectNodeIds[0]);
    } catch (e) {
      report(e);
    }
  };
  editSplineButton.onclick = async () => {
    try {
      await show("cad");
      (await ensure("cad")).openSplineEditor(splineSelect.value);
    } catch (e) {
      report(e);
    }
  };
  const panel = document.createElement("aside");
  panel.id = "agent-panel";
  panel.hidden = true;
  panel.innerHTML = `<div class="agent-panel-head"><strong>Shared models + agent</strong><button id="agent-close">×</button></div><p id="agent-connection">Connecting local MCP bridge…</p><button id="agent-pause">Pause agent edits</button><button id="agent-follow">Show agent workspace</button><p>Agent tools edit the shared models. Your camera stays independent.</p><div id="agent-preview"></div><button id="agent-fit">Fit models</button><select id="agent-models" aria-label="Shared model"></select><div id="agent-transform"></div><button id="agent-place">Apply placement</button><button id="agent-transfer">Copy to other editor</button><p id="agent-activity" role="status">No agent commands yet.</p><p class="hint">Placement uses metres and degrees. Imported copies have mesh geometry; original CAD features and sculpt files stay saved.</p>`;
  document.body.append(panel);
  function toggle() {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      refresh().then(fit).catch(report);
    }
  }
  for (const parent of [document.querySelector(".workspace-tabs"), bar]) {
    const b = document.createElement("button");
    b.textContent = "Models + agent";
    b.onclick = toggle;
    parent.append(b);
  }
  const visibilityButton=document.createElement("button");
  visibilityButton.id="agent-model-visibility"; visibilityButton.textContent="Show / hide selected model";
  panel.querySelector("#agent-models").after(visibilityButton);
  visibilityButton.onclick=async()=>{try{await refresh();const m=models.get(panel.querySelector("#agent-models").value);if(m)await dispatch("model_visibility",{modelIds:[m.id],visible:!!m.hidden,expectedVersions:{[m.id]:m.version}});}catch(e){report(e);}};
  panel.querySelector("#agent-close").onclick = () => (panel.hidden = true);
  const activity = panel.querySelector("#agent-activity"),
    status = panel.querySelector("#agent-connection");
  function report(e) {
    activity.textContent = e.message;
    notice(e.message, true);
  }
  const camera = new T.PerspectiveCamera(45, 1, 0.001, 1000);
  camera.position.set(0.25, 0.2, 0.3);
  camera.lookAt(0, 0, 0);
  let target = [0, 0, 0], cameraAttachment = null;
  const viewCamera = camera.clone();
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(320, 240);
  panel.querySelector("#agent-preview").append(renderer.domElement);
  const controls = new OrbitControls(viewCamera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();
  const instructionInput = instructionForm(panel, store, addTranscript, "agent-instruction");
  const blender=initBlenderWorkspace({studio,store,models,renderer,put,applyModel:apply,remove,persist,updateList,onWorkspaceChange:()=>cad.close()});
  const isDesktop=document.body.classList.contains('desktop-studio');
  const baseAdapter=isDesktop?{assertCurrent:e=>assertDesktopCurrent(studio,store,e),prepare:(promptId,requestedSketchIds)=>prepareDesktopEvidence({studio,store,reference:strokeReference,context:()=>dispatch('draw3d_context'),promptId,requestedSketchIds}),apply:(edit,evidence,record,cancelled,runId)=>applyDesktopEdit({studio,store,edit,evidence,record,cancelled,dispatch,runId})}:{workspace:'vr',assertCurrent:e=>studio.spatialWorkflow.assertCurrent(e),prepare:promptId=>studio.spatialWorkflow.prepare(promptId),apply:(edit,evidence,record,cancelled,runId)=>studio.spatialWorkflow.apply(edit,evidence,record,cancelled,runId)};
  const modelingAdapter={workspace:baseAdapter.workspace,assertCurrent:baseAdapter.assertCurrent,prepare:async(...args)=>blender.evidence(await baseAdapter.prepare(...args)),apply:(edit,evidence,...args)=>{if(edit.modelEdits?.length){(isDesktop?validateDesktopEdit:validateSpatialEdit)(edit,evidence);const [record,cancelled,runId]=args;return blender.apply(edit.modelEdits,evidence,record,()=>{baseAdapter.assertCurrent(evidence);return cancelled?.();},runId);}return baseAdapter.apply(edit,evidence,...args);}};
  if(isDesktop){
    let draftCAD=null;
    store.draftSceneDocument=()=>draftCAD?.document?.()||null;
    studio.desktopDraftState={
      async capture({documentOnly=false}={}){await studio.modelsReady;await studio.desktopHistory?.ready;draftCAD=await ensure('cad');let doc=draftCAD.document();if(!doc||!documentOnly&&draftCAD.busy()&&Object.values(doc.nodes).some(n=>n.kind==='body'))doc=await settled(draftCAD);return {document:doc,models:JSON.parse(JSON.stringify(summaries(true)))};},
      async restore(session,scene){
        studio.endAll();draftCAD=await ensure('cad');
        if(scene.document&&draftCAD.restore){
          const deadline=performance.now()+3500;
          for(;;){
            try{draftCAD.restore(structuredClone(scene.document));break;}
            catch(error){if(error.message!=='CAD is busy'||performance.now()>=deadline)throw error;await sleep(60);draftCAD=await ensure('cad');}
          }
          if(Object.values(scene.document.nodes).some(n=>n.kind==='body'))await settled(draftCAD);
        }else if(!scene.document){await draftCAD.create('Design','mm');await settled(draftCAD);}
        for(const key of Object.keys(store.session))if(!(key in session))delete store.session[key];
        for(const [key,value]of Object.entries(session)){if(Array.isArray(value)&&Array.isArray(store.session[key]))store.session[key].splice(0,store.session[key].length,...structuredClone(value));else store.session[key]=structuredClone(value);}
        for(const m of [...models.values()])remove(m.id);
        for(const row of scene.models||[]){const m=put(row.source,row.nativeId,row.vertices,row.indices,row.name,row.owner);const {vertices,indices,...metadata}=row;Object.assign(m,structuredClone(metadata));apply(m);}
        for(const mesh of studio.strokeMeshes.values()){mesh.removeFromParent();mesh.geometry?.dispose();mesh.material?.dispose();}studio.strokeMeshes.clear();
        for(const s of store.session.strokes)studio.addStrokeMesh(s);
        studio.desktopDrawing.restoreFigures(structuredClone(store.session.desktopFigures||[]),{preserveVersions:true});
        studio.desktopSketches?.restore(structuredClone(store.session.desktopSketches||[]),store.session.activeDesktopSketchId,structuredClone(store.session.selectedDesktopSketchIds||[]));
        if(store.session.desktopPlanes&&store.session.desktopPlane)studio.planeEditor?.restore(structuredClone(store.session.desktopPlanes),structuredClone(store.session.desktopPlane));
        studio.desktopHistory?.resetPreviewCursor?.(store.session.desktopHistoryCursor);studio.undoStack=[];studio.redoStack=[];
        updateList();studio.modeling?.sync();studio.strokeWorkflow.sync(true);studio.onChange();
      }
    };
  }
  const aiUI = initModelAgentUI({
    dispatch,
    desktop:modelingAdapter,
    studio,
    panel,
    store,
    input: instructionInput,
    addTranscript,
    request: (route, data, options) => {
      if (!registration) throw Error("Wait for the local bridge to connect");
      return api(route + "?session=" + registration.id, data, options);
    },
  });
  studio.modelAgent = aiUI;
  window.draw3dServerCadJob=(job,signal)=>{
    if(!registration)throw Error('Connect to the backend to rebuild CAD');
    return api('cad-worker?session='+registration.id,job,{signal});
  };
  recordSessionActivity(store,data=>{
    if(!registration)throw Error('Waiting for recording connection');
    return api('session-activity?session='+registration.id,data);
  });
  const typeButton = document.createElement("button");
  typeButton.textContent = "Type instructions";
  document.querySelector(".workspace-tabs").append(typeButton);
  async function openTyping() {
    studio.endAll();
    const session = studio.renderer.xr.getSession();
    if (session) await session.end();
    panel.hidden = false;
    if(studio.spatialWorkflow)document.querySelector("#vr-instructions").open=true;
    const targetInput=document.querySelector("#agent-question:not([hidden]) #agent-answer-text")||instructionInput;
    targetInput.scrollIntoView({ block: "nearest" });
    targetInput.focus();
  }
  typeButton.onclick = () => openTyping().catch(report);
  window.addEventListener("draw3d-type-request", () => openTyping().catch(report));
  panel.addEventListener("input", () => {
    lastInput = performance.now();
  });
  cad.shell.querySelector("#cad-context").addEventListener("input", () => {
    lastInput = performance.now();
  });
  const drawingTools=document.body.classList.contains("desktop-studio")?initDesktopDrawing({studio,store,ensure,settled,refresh:()=>refresh(true),renderer}):null;
  if(drawingTools)initDesktopHistory({studio,store,ensure,settled,refresh:()=>refresh(true),dispatch});
  const strokeVariables = initStrokeVariables({store});
  const surfaceTools = initSurfaceTools({store,ensure,refresh});
  const patternTools = initModelPatternTools({models,ensure,refresh,store,persist,apply,evaluateSurface:surfaceTools.evaluate});
  const sketchTools = initSketchTools({
    studio,
    store,
    models,
    renderer,
    refresh,
    persist,
    apply,
    panel,
    viewCamera,
    controls,
    report,
  });
  studio.surfaceModels = () => [...models.values()];
  studio.newCanvas=async()=>{
    window.dispatchEvent(new Event('draw3d-stop-ai'));
    const started=Date.now();while(studio.modelAgent?.busy&&Date.now()-started<10000)await new Promise(r=>setTimeout(r,50));
    if(studio.modelAgent?.busy)throw Error('AI is stopping; try New canvas again in a moment');
    studio.endAll();await store.asset('canvas-backups/'+Date.now()+'.json',new Blob([JSON.stringify(store.session)],{type:'application/json'}));
    studio.objects?.finish();studio.objects?.select(null);studio.objects?.setEnabled(false);studio.surface?.clear();
    for(const m of models.values()){m.hidden=true;m.version++;apply(m);}
    studio.clear();store.session.spatialObjects=[];store.session.lastDeterministicCAD=null;store.session.spatialFit=null;
    await persist();updateList();studio.setMode('draw');studio.setXRMenuVisible(false);studio.onChange();
  };

  const projectionTools = initProjectionTools({
    studio,
    store,
    models,
    renderer,
    refresh,
    ensure,
    settled,
    panel,
    report,
  });
  const moveSplinePlane = document.createElement("button");
  moveSplinePlane.id = "cad-spline-plane";
  moveSplinePlane.textContent = "Use reference plane";
  bar.append(moveSplinePlane);
  moveSplinePlane.onclick = async () => {
    try {
      const api = await ensure("cad"),
        d = api.document(),
        sketch = Object.values(d.nodes).find(
          (n) => n.kind === "sketch" && n.objectIds.includes(splineSelect.value),
        ),
        planeId = panel.querySelector("#reference-plane-list").value;
      if (!sketch || !planeId) throw Error("Select a spline and an agent reference plane first");
      const result = await projectionTools.dispatch("cad_set_sketch_plane", {
        planeId,
        sketchId: sketch.sketchId,
        expectedVersion: d.version,
      });
      if (result.diagnostics.length)
        throw Error(result.diagnostics.map((d) => d.message).join("; "));
      notice("Sketch moved to the reference plane.");
    } catch (e) {
      report(e);
    }
  };
  const select = panel.querySelector("#agent-models");
  for (const [name, initial] of [
    ["position", [0, 0, 0]],
    ["rotationDeg", [0, 0, 0]],
    ["scale", [1, 1, 1]],
  ]) {
    const label = document.createElement("label");
    label.textContent = name === "rotationDeg" ? "Rotation °" : name;
    const row = document.createElement("div");
    row.className = "agent-vector";
    for (let i = 0; i < 3; i++) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = name === "position" ? "0.01" : "1";
      input.value = initial[i];
      input.dataset.vector = name;
      input.dataset.axis = i;
      input.setAttribute("aria-label", name + " " + ["X", "Y", "Z"][i]);
      row.append(input);
    }
    label.append(row);
    panel.querySelector("#agent-transform").append(label);
  }
  function fields() {
    const m = models.get(select.value);
    if (!m) return;
    for (const el of panel.querySelectorAll("[data-vector]"))
      el.value = m[el.dataset.vector][el.dataset.axis];
  }
  select.onchange = fields;
  panel.querySelector("#agent-place").onclick = () => {
    const m = models.get(select.value);
    if (!m) return;
    const args = { modelId: m.id, expectedVersion: m.version };
    for (const k of ["position", "rotationDeg", "scale"])
      args[k] = [...panel.querySelectorAll(`[data-vector="${k}"]`)].map((e) => Number(e.value));
    transform(args).catch(report);
  };
  panel.querySelector("#agent-transfer").onclick = () => {
    const m = models.get(select.value);
    if (m) transfer({ modelId: m.id, target: m.source === "cad" ? "sculpt" : "cad" }).catch(report);
  };
  panel.querySelector("#agent-pause").onclick = () => {
    paused = !paused;
    panel.querySelector("#agent-pause").textContent = paused
      ? "Resume agent edits"
      : "Pause agent edits";
    store.log("agent.pause", { paused });
  };
  panel.querySelector("#agent-follow").onclick = () => show(agentWorkspace).catch(report);
  function backgroundFrame(frame) {
    // Keep browsing contexts mounted: reparenting an iframe reloads its editor.
    if (!frame.parentNode) cad.shell.querySelector(".cad-editor-body").append(frame);
    frame.style.cssText =
      "position:fixed;left:-20000px;top:0;width:1024px;height:768px;border:0;visibility:hidden;pointer-events:none";
  }
  window.addEventListener("draw3d-user-workspace", (event) => {
    userWorkspace = event.detail;
    if (userWorkspace === "cad") {
      backgroundFrame(sculpt);
      cad.shell.querySelector("strong").textContent = "Full CAD · OpenZCAD";
    } else {
      backgroundFrame(cad.frame);
      backgroundFrame(sculpt);
    }
  });
  async function show(mode) {
    if (mode === "sketch") {
      cad.close();
      return;
    }
    if (mode === "cad") {
      await cad.open();
      return;
    }
    studio.endAll();
    if (studio.renderer.xr.getSession()) await studio.renderer.xr.getSession().end();
    studio.renderer.render(studio.scene, studio.camera);
    cad.shell.querySelector("#cad-sketch-reference").src =
      studio.renderer.domElement.toDataURL("image/png");
    backgroundFrame(cad.frame);
    if (!sculpt.parentNode) cad.shell.querySelector(".cad-editor-body").append(sculpt);
    sculpt.style.cssText = "";
    cad.shell.hidden = false;
    cad.shell.querySelector("#full-cad-status").hidden = true;
    cad.shell.querySelector("strong").textContent = "Non-parametric · SculptGL";
    studio.cadEditorOpen = true;
    userWorkspace = "sculpt";
    store.log("workspace.mode", { mode: "sculpt" });
    await ensure("sculpt");
  }
  sculptTab.textContent='Non-parametric';sculptTab.onclick=sculptSwitch.onclick=()=>blender.activate('blender');
  const nativeCADTab=document.querySelector('#workspace-full-cad');nativeCADTab.textContent='Parametric CAD';nativeCADTab.onclick=cadSwitch.onclick=()=>blender.activate('freecad');
  const legacy=document.createElement('details');legacy.innerHTML='<summary>Additional browser editors</summary><button data-editor="cad">Open browser CAD editor</button><button data-editor="sculpt">Open sculpt brush editor</button>';document.querySelector('#blender-workspace').append(legacy);legacy.querySelectorAll('button').forEach(b=>b.onclick=()=>show(b.dataset.editor).catch(report));
  function watch(frame) {
    frame.addEventListener("load", () => {
      for (const type of ["pointerdown", "pointerup", "pointercancel", "keydown"])
        frame.contentWindow.addEventListener(
          type,
          () => {
            lastInput = performance.now();
            if (type === "pointerdown") held = true;
            if (type === "pointerup" || type === "pointercancel") held = false;
          },
          true,
        );
    });
  }
  watch(cad.frame);
  watch(sculpt);
  window.addEventListener("pointerup", () => (held = false), true);
  async function ensure(mode) {
    const frame = mode === "cad" ? cad.frame : sculpt,
      key = mode === "cad" ? "__draw3dCAD" : "__draw3dSculpt";
    if (!frame.getAttribute("src")) {
      if (mode !== userWorkspace) backgroundFrame(frame);
      frame.src = mode === "cad" ? "/cad/index.html" : "/sculpt/index.html";
    }
    const deadline = Date.now() + 180000;
    while (!frame.contentWindow?.[key] || (mode === "sculpt" && sculptRestoring)) {
      if (Date.now() > deadline) throw Error(mode + " editor did not load");
      await sleep(150);
    }
    if (mode === "cad") await cad.projectReady();
    return frame.contentWindow[key];
  }
  function put(source, native, vertices, indices, name, owner = "") {
    const id = source + ":" + owner + ":" + native;
    let m = models.get(id);
    // Native editors may republish unchanged meshes after another part changes or a reload.
    // Keep their versions stable so an unchanged reviewed draft remains acceptable.
    if (m && m.name === name && m.vertices?.length === vertices.length && m.indices?.length === indices.length && m.vertices.every((v,i)=>v===vertices[i]) && m.indices.every((v,i)=>v===indices[i])) {
      apply(m);
      return m;
    }
    if (m) {
      m.mesh.geometry.dispose();
    } else {
      m = {
        id,
        source,
        nativeId: native,
        owner,
        name,
        position: [0, 0, 0],
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
        version: 0,
      };
      m.mesh = new T.Mesh(
        undefined,
        new T.MeshStandardMaterial({
          color: source === "cad" ? 0x79bce8 : 0xe6ad79,
          roughness: 0.6,
          side: T.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: source === "cad" ? 1 : 2,
          polygonOffsetUnits: 1,
        }),
      );
      group.add(m.mesh);
      models.set(id, m);
    }
    m.vertices = vertices;
    m.indices = indices;
    m.name = name;
    m.version++;m.geometryVersion=(m.geometryVersion||0)+1;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    m.mesh.geometry = geometry;
    apply(m);
    return m;
  }
  function apply(m,fromParent=false,visited=new Set(),motionOptions={}) {
    bodyColors.apply(m);
    if(visited.has(m.id))return;visited.add(m.id);
    m.mesh.visible = !m.hidden;
    m.mesh.position.fromArray(m.position);
    m.mesh.rotation.set(...m.rotationDeg.map(T.MathUtils.degToRad));
    m.mesh.scale.fromArray(m.scale);
    m.mesh.updateMatrixWorld(true);
    if(m.coordinateParent&&!fromParent){const parent=models.get(m.coordinateParent.modelId);if(parent){parent.mesh.updateWorldMatrix(true,false);m.coordinateParent.relativeMatrix=parent.mesh.matrixWorld.clone().invert().multiply(m.mesh.matrixWorld).toArray();}}
    syncAttachedStrokes(studio,m);
    for(const update of coordinateChildPlacements(m,models.values(),motionOptions)){const child=update.model;if(visited.has(child.id))continue;Object.assign(child,{position:update.position,rotationDeg:update.rotationDeg,scale:update.scale,version:child.version+1});apply(child,true,visited,motionOptions);studio.nativeSelection?.syncTransform?.(child);}

  }
  let cadSignature = "",
    sculptRevision = -1,
    refreshing,
    sculptRestoring = true;
  async function refresh(force=false) {
    if(force===true&&refreshing){await refreshing;return refresh(true);}
    if(force===true)cadSignature="";
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const api = cad.frame.contentWindow?.__draw3dCAD;
      if (cad.initialized && api && !api.busy()) {
        const d = api.document();
        if (d) {
          const splines = Object.values(d.nodes || {}).filter(
            (n) => n.kind === "sketch-object" && n.data?.objectKind === "spline",
          );
          const selection = splineSelect.value;
          const signature = splines.map((n) => n.id + ":" + n.name).join("|");
          if (splineSelect.dataset.signature !== signature) {
            splineSelect.replaceChildren(...splines.map((n) => new Option(n.name, n.id)));
            splineSelect.dataset.signature = signature;
            if (splines.some((n) => n.id === selection)) splineSelect.value = selection;
          }
          editSplineButton.disabled = !splines.length;
          const sig =
            d.projectId +
            ":" +
            d.version +
            ":" +
            JSON.stringify([d.derived?.projectionRevision||"",d.derived?.updatedAt,Object.values(d.derived?.bodyRepresentations||{}).map(b=>[b.bodyId,b.mesh?.vertices?.length,b.mesh?.indices?.length,b.consumed])]);
          if (sig !== cadSignature) {
            const unit = { mm: 0.001, cm: 0.01, m: 1, inch: 0.0254 }[d.units];
            const seen = new Set();
            for (const b of Object.values(d.derived?.bodyRepresentations || {})) {
              if (b.consumed || !b.mesh?.vertices?.length) continue;
              const raw = Array.from(b.mesh.vertices),
                v = [];
              for (let i = 0; i < raw.length; i += 3)
                v.push(raw[i] * unit, raw[i + 2] * unit, -raw[i + 1] * unit);
              const m = put("cad", b.bodyId, v, Array.from(b.mesh.indices), b.name, d.projectId);
              seen.add(m.id);
            }
            for (const [id, m] of models)
              if (m.source === "cad" && m.owner === d.projectId && !seen.has(id)) remove(id);
            cadSignature = sig;
            await persist();
          }
        }
      }
      const s = sculpt.contentWindow?.__draw3dSculpt;
      if (s && !sculptRestoring) {
        const rev = s.status().revision;
        if (rev !== sculptRevision) {
          const seen = new Set();
          for (const m of s.meshes()) {
            const item = put("sculpt", m.id, m.vertices, m.indices, m.name);
            seen.add(item.id);
          }
          for (const [id, m] of models) if (m.source === "sculpt" && !seen.has(id)) remove(id);
          sculptRevision = rev;
          await store.asset("sculpt/current.sgl", s.save(), {
            kind: "sculpt-project",
            engine: "SculptGL",
          });
          store.session.sculptProject = "sculpt/current.sgl";
          await persist();
        }
      }
      updateList();
      return summaries();
    })();
    try {
      return await refreshing;
    } finally {
      refreshing = null;
    }
  }
  function remove(id) {
    const m = models.get(id);
    group.remove(m.mesh);
    m.mesh.geometry.dispose();
    m.mesh.material.dispose();
    models.delete(id);
  }
  function summaries(geometry = false) {
    return [...models.values()].map(({ mesh, vertices, indices, ...m }) => ({
      ...m,
      vertexCount: vertices.length / 3,
      triangleCount: indices.length / 3,
      ...(geometry ? { vertices, indices } : {}),
    }));
  }
  function updateList() {
    const prev = select.value;
    select.replaceChildren(
      ...[...models.values()].map((m) => {
        const o = document.createElement("option");
        o.value = m.id;
        o.textContent = m.name + " · " + m.source + (m.hidden ? " · hidden" : "");
        return o;
      }),
    );
    if (models.has(prev)) select.value = prev;
    fields();
  }
  async function persist() {
    const assetName=store.assetPathForWrite?.('shared/models.json')||'shared/models.json';
    await store.asset(
      assetName,
      new Blob([JSON.stringify(summaries(true))], { type: "application/json" }),
      { kind: "shared-models" },
    );
    store.session.sharedModels = assetName;
    await store.flush();
  }
  async function transform({ modelId, position, rotationDeg, scale, expectedVersion }) {
    const m = models.get(modelId);
    if (!m) throw Error("Model not found");
    if (m.version !== expectedVersion) throw Error("Model version conflict");
    if (!finiteVec(position) || !finiteVec(rotationDeg) || !finiteVec(scale, true))
      throw Error("Invalid transform");
    Object.assign(m, { position, rotationDeg, scale, version: m.version + 1 });
    apply(m);
    await persist();
    fields();
    store.log("model.transform", { modelId, position, rotationDeg, scale });
    return summaries().find((v) => v.id === modelId);
  }
  function placed(m) {
    apply(m);
    const v = [],
      pt = new T.Vector3();
    for (let i = 0; i < m.vertices.length; i += 3) {
      pt.fromArray(m.vertices, i).applyMatrix4(m.mesh.matrixWorld);
      v.push(...pt);
    }
    return v;
  }
  async function settled(api) {
    await sleep(300);
    api = cad.frame.contentWindow.__draw3dCAD;
    const deadline = Date.now() + 60000;
    while (api.busy()) {
      const state=api.geometryStatus?.();
      if(state?.phase==='failed')throw Error('CAD rebuild failed: '+(state.error||'geometry worker stopped'));
      if (Date.now() > deadline) throw Error("CAD geometry is still rebuilding");
      await sleep(200);
      api = cad.frame.contentWindow.__draw3dCAD;
    }
    return cad.frame.contentWindow.__draw3dCAD.document();
  }
  async function transfer({ modelId, target: dest }) {
    await refresh();
    const m = models.get(modelId);
    if (!m) throw Error("Model not found");
    if (m.source === dest) throw Error("Choose the other editor");
    const v = placed(m);
    let result;
    if (dest === "sculpt") {
      const api = await ensure("sculpt");
      result = api.importMesh({
        name: m.name + " (CAD copy)",
        vertices: v,
        indices: m.indices,
        expectedVersion: api.status().revision,
      });
    } else {
      const api = await ensure("cad");
      let d = api.document();
      if (!d) {
        await api.create("Transferred meshes", "mm");
        await sleep(250);
        d = cad.frame.contentWindow.__draw3dCAD.document();
      }
      const unit = { mm: 0.001, cm: 0.01, m: 1, inch: 0.0254 }[d.units],
        vertices = [];
      for (let i = 0; i < v.length; i += 3)
        vertices.push(v[i] / unit, -v[i + 2] / unit, v[i + 1] / unit);
      result = cad.frame.contentWindow.__draw3dCAD.execute(
        "importMesh",
        {
          name: m.name + " (sculpt copy)",
          artifactId: "artifact_local_" + crypto.randomUUID(),
          sourceName: m.name + ".mesh",
          triangleCount: m.indices.length / 3,
          vertices,
          indices: m.indices,
        },
        d.version,
      );
      await settled(api);
    }
    store.log("model.transfer", { modelId, target: dest, result });
    await refresh();
    return result;
  }
  function fit() {
    const box = new T.Box3().setFromObject(group);
    if (box.isEmpty()) return;
    const center = box.getCenter(new T.Vector3()),
      r = Math.max(0.03, box.getSize(new T.Vector3()).length());
    viewCamera.position.copy(center).add(new T.Vector3(r, r * 0.7, r));
    controls.target.copy(center);
    controls.update();
  }
  panel.querySelector("#agent-fit").onclick = fit;
  function requireModel(id,version){const m=models.get(id);if(!m)throw Error("Unknown model");if(version!==undefined&&m.version!==version)throw Error("Model frame/version changed; read model_frame again");return m;}
  function followObjectCamera(){
    if(!cameraAttachment)return;
    const frame=modelFrame(requireModel(cameraAttachment.modelId));
    const [position,look]=convertFrame(frame,[cameraAttachment.position,cameraAttachment.target]);
    camera.position.fromArray(position);target=look;camera.up.fromArray(convertFrame(frame,[cameraAttachment.up||[0,1,0]],"object","world","vector")[0]).normalize();camera.lookAt(...target);
    cameraAttachment.version=frame.version;
  }
  studio.objects=initObjectManipulation({studio,store,models,apply,persist,report,canGrab:()=>!executing,onSelection:ids=>{if(ids[0]){select.value=ids[0];fields();}}});
  function cameraState() {
    followObjectCamera();
    return {
      position: camera.position.toArray(),
      target,
      referenceFrame: cameraAttachment ? {...cameraAttachment,frame:modelFrame(requireModel(cameraAttachment.modelId))} : {kind:"world",units:"metres",up:"Y"},
      fov: camera.fov,
      units: "metres",
      up: "Y",
    };
  }
  async function capture({ width = 768, height = 768, modelIds } = {}) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 64 ||
      height < 64 ||
      width > 1536 ||
      height > 1536
    )
      throw Error("Capture size must be 64–1536 pixels");
    await refresh();
    followObjectCamera();
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const visibility = [...models.values()].map((m) => [m.mesh, m.mesh.visible]);
    let image;
    try {
      if (modelIds) {
        if (!Array.isArray(modelIds) || modelIds.some((id) => !models.has(id)))
          throw Error("Unknown capture model ID");
        for (const m of models.values()) m.mesh.visible = modelIds.includes(m.id);
      }
      renderer.render(studio.scene, camera);
      image = renderer.domElement.toDataURL("image/png");
    } finally {
      for (const [mesh, visible] of visibility) mesh.visible = visible;
      renderer.setSize(320, 240);
    }
    const asset = "agent/camera/" + Date.now() + "-" + crypto.randomUUID() + ".png";
    await store.asset(asset, await (await fetch(image)).blob(), {
      kind: "agent-camera",
      camera: cameraState(),
    });
    return { image, asset, camera: cameraState(), modelFrames:[...models.values()].filter(m=>modelIds?modelIds.includes(m.id):!m.hidden).map(modelFrame), width, height };
  }
  const strokeReference=initStrokeReferenceTools({studio,store,models,renderer,refresh});
  const spatialWorkflow=!drawingTools?initSpatialWorkflow({studio,store,reference:strokeReference,models,renderer,put,applyModel:apply,remove,persist,updateList,aiUI,input:instructionInput,changed:()=>studio.onChange?.()}):null;
  const reads = new Set([
    "drawing_list",
    "stroke_reference",
    "model_frame", "frame_convert", "model_fit_check",
    "draw3d_context",
    "cad_document",
    "sculpt_document",
    "scene_models",
    "agent_status",
    "agent_capture",
    "agent_camera",
    "sketch_planes",
    "sketch_user_view",
    "sketch_project",
    "sketch_trace",
    "stroke_catalog", "stroke_load", "math_variables", "math_evaluate",
    "surface_get", "surface_list", "surface_sample",
    "sketch_analyze",
    "sketch_regions",
    "sketch_pca",
    "sketch_fit_primitive",
    "sketch_views",
    "placement_compare",
    "placement_points",
    "workspace_select",
  ]);
  async function dispatch(tool, a = {}) {
    if (!reads.has(tool)) {
      if (paused) throw Error("Agent edits paused by user");
      const deadline = Date.now() + 10000;
      while (held || studio.objects?.grabbing || performance.now() - lastInput < 800) {
        if (Date.now() > deadline) throw Error("User is editing; retry later");
        await sleep(150);
      }
    }
    if (["sketch_regions", "sketch_pca", "sketch_fit_primitive"].includes(tool)) return sketchAnalysis(store.session.strokes, tool, a);
    if (drawingTools?.names.includes(tool))return drawingTools.dispatch(tool,a);
    if (surfaceTools.names.includes(tool)) return surfaceTools.dispatch(tool,a);
    if (tool === "model_mirror") return patternTools.mirror(a);
    if (tool === "model_pattern") return patternTools.pattern(a);
    if (strokeVariables.names.includes(tool)) return strokeVariables.dispatch(tool,a);
    if (projectionTools.names.includes(tool)) return projectionTools.dispatch(tool, a);
    if (sketchTools.names.includes(tool)) return sketchTools.dispatch(tool, a);
    if(tool==="stroke_reference") return strokeReference(a);
    switch (tool) {
      case "model_visibility": {
        await refresh();
        const selected=a.modelIds.map(id=>models.get(id));
        if(selected.some(m=>!m)) throw Error("Unknown model ID");
        if(selected.some(m=>a.expectedVersions?.[m.id]!==m.version)) throw Error("Model version conflict");
        for(const m of selected) {m.hidden=!a.visible;m.version++;apply(m);}
        await persist();updateList();
        return {models:summaries().filter(m=>a.modelIds.includes(m.id))};
      }
      case "primitive_from_strokes": {
        const ref=sketchReference(store.session.strokes,a.strokeIds);
        if(a.expectedRevision&&a.expectedRevision!==ref.revision)throw Error("Source strokes changed");
        if(a.useSelectedSurface){const selected=studio.surface?.selected;if(!selected)throw Error("Select a surface first or supply supportPlane");a={...a,supportPlane:{origin:selected.frame.origin,normal:selected.frame.normal,up:selected.frame.yAxis}};}
        const fitted=(a.shape==="polygon"?polygonFromPoints:primitiveFromPoints)(ref.points,a),mode=a.workspace||"cad",api=await ensure(mode);
        if(sketchReference(store.session.strokes,a.strokeIds).revision!==ref.revision)throw Error("Drawing changed during editor load; retry with current strokes");
        let nativeId,nativeValidation;
        if(mode==="cad"){
          const doc=api.document(),unit={mm:1000,cm:100,m:1,inch:1/.0254}[doc.units];
          const [x,y,z]=fitted.size.map(v=>v*unit),dimensions=a.shape==="box"?{width:x,height:z,depth:y}:a.shape==="sphere"?{radius:x/2}:{radius:x/2,height:y};
          let result;
          if(a.shape==="polygon"){
            const vertices=fitted.polygon.vertices,objects=vertices.map((p,i)=>{const q=vertices[(i+1)%vertices.length];return {objectKind:"line",x1:p[0]*unit,y1:-p[1]*unit,x2:q[0]*unit,y2:-q[1]*unit};});
            const sketch=api.execute("addSketch",{name:a.name||"Fitted polygon",planeRef:{type:"canonical",plane:"XY",offset:0},objects},doc.version);await settled(api);
            result=api.execute("extrudeSketch",{name:a.name||"Polygon plate",bodyName:a.name||"Polygon plate",sketchId:sketch.command.payload.ids.sketchId,distance:y,operation:"new-body",profile:{all:true,sourceEntityIds:sketch.command.payload.ids.objectNodeIds}},api.document().version);
          }else result=api.execute("addPrimitive",{name:a.name||"Fitted "+a.shape,primitiveKind:a.shape,dimensions},doc.version);
          nativeId=result.command.payload.ids.bodyId;
          const updated=await settled(api),body=updated.derived?.bodyRepresentations?.[nativeId];
          nativeValidation={bodyId:nativeId,exportableStep:body?.exportableStep===true,volume:body?.volume,faceCount:body?.faceCount,diagnostics:cadDiagnostics(updated.derived)};
          if(!nativeValidation.exportableStep||!(body.volume>0))throw Error("CAD feature committed but no valid solid was produced. Inspect before retrying: "+JSON.stringify(nativeValidation));
        }else if(a.shape==="polygon"){
          const shape=new T.Shape(fitted.polygon.vertices.map(p=>new T.Vector2(p[0],-p[1]))),g=new T.ExtrudeGeometry(shape,{depth:fitted.size[1],bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);const vertices=Array.from(g.attributes.position.array),indices=Array.from({length:vertices.length/3},(_,i)=>i);const result=api.importMesh({name:a.name||"Polygon plate",vertices,indices,expectedVersion:api.status().revision});nativeId=result.id;g.dispose();
        }else{const result=api.create({shape:a.shape,name:a.name||"Fitted "+a.shape,sizeMm:fitted.size.map(v=>v*1000),positionMm:[0,0,0],expectedVersion:api.status().revision});nativeId=result.id;}
        if(refreshing)await refreshing;await refresh();const m=[...models.values()].find(m=>m.source===mode&&m.nativeId===nativeId);if(!m)throw Error("Created primitive did not publish a mesh; inspect scene before retrying");
        m.mesh.geometry.computeBoundingBox();const localCenter=m.mesh.geometry.boundingBox.getCenter(new T.Vector3()),rotation=new T.Quaternion().setFromEuler(new T.Euler(...fitted.rotationDeg.map(T.MathUtils.degToRad)));
        m.position=new T.Vector3(...fitted.center).sub(localCenter.applyQuaternion(rotation)).toArray();m.rotationDeg=fitted.rotationDeg;m.scale=[1,1,1];m.version++;apply(m);await persist();
        cameraAttachment=null;const radius=Math.max(.03,...fitted.size)*1.8;camera.position.fromArray(fitted.center).add(new T.Vector3(radius,radius*.7,radius));target=[...fitted.center];camera.up.set(0,1,0);camera.lookAt(...target);
        const verification=measureModels([m],ref.points),rendered=await capture({modelIds:[m.id],width:512,height:512});
        store.log("primitive.from-strokes",{strokeIds:a.strokeIds,sketchRevision:ref.revision,modelId:m.id,fitted});
        return {...rendered,modelIds:[m.id],models:summaries().filter(v=>v.id===m.id),strokeIds:a.strokeIds,sketchRevision:ref.revision,fitted,verification,nativeValidation};
      }
      case "model_frame":
        await refresh();return modelFrame(requireModel(a.modelId));
      case "frame_convert": {
        await refresh();const frame=modelFrame(requireModel(a.modelId,a.expectedVersion));return {frame,from:a.from,to:a.to,kind:a.kind||"point",points:convertFrame(frame,a.points,a.from,a.to,a.kind)};
      }
      case "model_fit_check":
      case "model_match_sketch": {
        await refresh();const ref=sketchReference(store.session.strokes,a.strokeIds),items=a.modelIds.map(id=>requireModel(id));
        const before=measureModels(items,ref.points);
        if(tool==="model_fit_check")return {...before,sketchRevision:ref.revision,modelVersions:Object.fromEntries(items.map(m=>[m.id,m.version]))};
        if(ref.revision!==a.expectedRevision)throw Error("Source drawing changed; inspect again");
        for(const m of items)requireModel(m.id,a.expectedVersions?.[m.id]??-1);
        // Rotate the entire assembly first, then remeasure its extents for uniform scaling.
        const old=items.map(m=>({id:m.id,position:[...m.position],rotationDeg:[...m.rotationDeg],scale:[...m.scale]}));
        let matrix=matchMatrix({...before,recommendedUniformScale:1},a.rotationDeltaDeg||[0,0,0]);
        const applyMatrix=delta=>{for(const m of items){m.mesh.updateWorldMatrix(true,false);const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();delta.clone().multiply(m.mesh.matrixWorld).decompose(p,q,s);m.position=p.toArray();m.rotationDeg=new T.Euler().setFromQuaternion(q).toArray().slice(0,3).map(T.MathUtils.radToDeg);m.scale=s.toArray();apply(m);}};
        applyMatrix(matrix);matrix=matchMatrix(measureModels(items,ref.points));applyMatrix(matrix);items.forEach(m=>m.version++);
        await persist();store.log("model.match-sketch",{modelIds:a.modelIds,strokeIds:a.strokeIds,before:old,after:items.map(m=>({id:m.id,position:m.position,rotationDeg:m.rotationDeg,scale:m.scale}))});
        return {...measureModels(items,ref.points),sketchRevision:ref.revision,modelVersions:Object.fromEntries(items.map(m=>[m.id,m.version]))};
      }
      case "draw3d_context":
        return {
          ...cad.context(),
          supervision:studio.aiSupervision?.evidence()||{level:'balanced'},
          spatialDrawing:spatialWorkflow?{fit:spatialWorkflow.result,figures:store.session.spatialObjects,featureWeights:spatialWorkflow.weights}:undefined,
          capabilities:{spatialTools:true,objectManipulation:true,strokeReferences:true,spatialDrawing:!!spatialWorkflow,drawingTools:!!drawingTools},
          strokeWorkflow:studio.strokeWorkflow?.summary(),
          coordinateFrames:{world:{units:"metres",up:"Y"},objects:summaries().map(m=>modelFrame(models.get(m.id))),userSelection:studio.objects.selectedIds},
          collaboration: store.session.collaborativeModeling ? "autonomous collaboration: execute the requested scope, inspect results and correct until requirements are met; ask only for unresolved consequential ambiguity, never for routine step approval; show progress and accept human steering" : "standard",
          drawingFigures:drawingTools?.summary()||[],
          selectedSurface: studio.surface?.selected || null,
          desktopSelection: studio.desktopSelection?.summary() || null,
          models: await refresh(),
          userWorkspace,
          agentWorkspace,
          ...sketchTools.summary(),
        };
      case "workspace_select":
        if (!["cad", "sculpt", "sketch"].includes(a.workspace)) throw Error("Unknown workspace");
        agentWorkspace = a.workspace;
        if (agentWorkspace !== "sketch") await ensure(agentWorkspace);
        return { agentWorkspace, userWorkspace };
      case "cad_create_project": {
        const api = await ensure("cad");
        await api.create(a.name, a.units || "mm");
        await settled(api);
        await refresh();
        return cad.frame.contentWindow.__draw3dCAD.document();
      }
      case "cad_document": {
        const api = await ensure("cad"),
          d = api.document();
        if (d && !a.includeGeometry)
          for (const b of Object.values(d.derived?.bodyRepresentations || {})) delete b.mesh;
        return { document: d, operations: api.operations() };
      }
      case "cad_execute": {
        const api = await ensure("cad");
        const payload = completeLineProfile(a.operation, a.payload, api.document());
        const result = api.execute(a.operation, payload, a.expectedVersion);
        const d = await settled(api);
        await refresh();
        return {
          ...result,
          warnings: d?.derived?.warnings || [],
          diagnostics: cadDiagnostics(d?.derived),
          models: summaries(),
        };
      }
      case "cad_undo":
      case "cad_redo": {
        const api = await ensure("cad");
        if (api.document()?.version !== a.expectedVersion) throw Error("CAD version conflict");
        api[tool === "cad_undo" ? "undo" : "redo"]();
        await settled(api);
        await refresh();
        return { version: cad.frame.contentWindow.__draw3dCAD.document()?.version };
      }
      case "sculpt_document":
        return (await ensure("sculpt")).status();
      case "sculpt_create":
      case "sculpt_brush":
      case "sculpt_undo":
      case "sculpt_redo": {
        const api = await ensure("sculpt");
        if (api.status().revision !== a.expectedVersion) throw Error("Sculpt version conflict");
        if (a.sizeMm && !finiteVec(a.sizeMm, true)) throw Error("Invalid size");
        if (a.positionMm && !finiteVec(a.positionMm)) throw Error("Invalid position");
        if (
          tool === "sculpt_brush" &&
          (!finiteVec(a.centerMm) ||
            !finiteVec(a.displacementMm) ||
            !Number.isFinite(a.radiusMm) ||
            a.radiusMm <= 0)
        )
          throw Error("Invalid brush");
        const result =
          api[
            {
              sculpt_create: "create",
              sculpt_brush: "brush",
              sculpt_undo: "undo",
              sculpt_redo: "redo",
            }[tool]
          ](a);
        await refresh();
        return result;
      }
      case "scene_models":
        await refresh();
        return { models: summaries(a.includeGeometry) };
      case "model_transform":
        return transform(a);
      case "model_transfer":
        return transfer(a);
      case "agent_camera":
        if(a.referenceFrame==="object"){
          requireModel(a.modelId,a.expectedVersion??-1);
          if(!finiteVec(a.position)||!finiteVec(a.target)||new T.Vector3(...a.position).distanceTo(new T.Vector3(...a.target))<.0001)throw Error("Camera needs distinct finite local position and target");
          if(a.up&&(!finiteVec(a.up)||Math.hypot(...a.up)<1e-8))throw Error("Invalid local up");
          cameraAttachment={kind:"object",modelId:a.modelId,position:a.position,target:a.target,up:a.up||[0,1,0]};
          followObjectCamera();camera.fov=Math.max(10,Math.min(120,a.fov||45));camera.updateProjectionMatrix();return cameraState();
        }
        cameraAttachment=null;
        if (
          !finiteVec(a.position) ||
          !finiteVec(a.target) ||
          new T.Vector3(...a.position).distanceTo(new T.Vector3(...a.target)) < 0.0001
        )
          throw Error("Camera needs distinct finite position and target");
        if (a.up) {
          if (!finiteVec(a.up) || new T.Vector3(...a.up).lengthSq() < 1e-8)
            throw Error("Invalid camera up");
          camera.up.fromArray(a.up).normalize();
        }
        camera.position.fromArray(a.position);
        target = a.target;
        camera.lookAt(...target);
        camera.fov = Math.max(10, Math.min(120, a.fov || 45));
        camera.updateProjectionMatrix();
        return cameraState();
      case "agent_capture":
        return capture(a);
      case "agent_status":
        return {
          paused,
          executing,
          userWorkspace,
          agentWorkspace,
          camera: cameraState(),
          userCamera: {
            position: studio.camera.position.toArray(),
            quaternion: studio.camera.quaternion.toArray(),
          },
          models: summaries(),
        };
      default:
        throw Error("Unknown agent tool");
    }
  }
  async function api(route, data, options={}) {
    const requestRegistration=registration;
    if (route.startsWith('concept-transcribe?') && options.onTranscript) {
      const response=await fetch('/api/agent/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Draw3D-Capability':requestRegistration.token},body:JSON.stringify(data),signal:AbortSignal.timeout(90000)});
      if(response.status===401&&registration===requestRegistration){registration=undefined;sessionStorage.removeItem(registrationKey);}
      return readSpeechProgress(response,options.onTranscript,options.onRetry);
    }
    const {response:r,value}=await retryJSON('/api/agent/'+route,()=>({method:'POST',headers:{'Content-Type':'application/json',...(requestRegistration?{'X-Draw3D-Capability':requestRegistration.token}:{})},body:JSON.stringify(data),signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(route.startsWith('cad-worker')?55000:/^sketch-(refine|command)/.test(route)?110000:15000)]):AbortSignal.timeout(route.startsWith('desktop-edit')?270000:/^sketch-(refine|command)/.test(route)?110000:route.startsWith('concept-transcribe')?90000:15000)}),{attempts:/^(desktop-edit|desktop-applied|ai-answer|audio-log)/.test(route)?7:2,cancelled:()=>options.signal?.aborted||/^(desktop-edit|desktop-applied)/.test(route)&&studio.modelAgent?.stopped,onRetry:detail=>{if(/^(desktop-edit|desktop-applied|ai-answer)/.test(route))window.dispatchEvent(new CustomEvent('draw3d-ai-log',{detail:{message:detail.message,kind:'connection',details:{route:route.split('?')[0],attempt:detail.attempt,waitMs:detail.waitMs}}}));}});
    if(r.status===401){if(registration===requestRegistration){registration=undefined;sessionStorage.removeItem(registrationKey);}throw Error("Browser session expired; reconnecting to backend");}
    if (!r.ok) {
      if (r.status === 401) { registration = null; sessionStorage.removeItem(registrationKey); }
      throw Error(value.error || "MCP bridge unavailable");
    }
    return value;
  }
  async function poll() {
    try {
      if (!registration) {
        registration = await api("register", {
          label: navigator.userAgent,
          recordingId: store.session.id,
        });
        sessionStorage.setItem(registrationKey,JSON.stringify(registration));
      }
      const { job, ai } = drawingTools?{job:null,ai:await api("ai-status?session="+registration.id,{})}:await api("poll?session=" + registration.id, {
        userWorkspace,
        agentWorkspace,
        paused,
        recordingId: store.session.id,
      });
      aiUI.update(ai);
      if(!connected)window.dispatchEvent(new Event("draw3d-backend-connected"));
      connected = true;
      status.textContent = "PC connected · " + registration.id.slice(0, 8);
      if (job) {
        executing = true;
        activity.textContent = "Agent: " + job.tool;
        store.log("agent.command.start", { id: job.id, tool: job.tool, args: job.args });
        let result, error;
        try {
          result = await dispatch(job.tool, job.args);
        } catch (e) {
          error = e.message;
        }
        executing = false;
        activity.textContent = error ? "Agent error: " + error : "Completed: " + job.tool;
        store.log("agent.command.end", { id: job.id, tool: job.tool, error });
        await api("result?session=" + registration.id, { id: job.id, result, error });
      }
    } catch (e) {
      connected = false;
      status.textContent = "PC connection lost · reconnecting automatically";
    } finally {
      setTimeout(poll, connected ? (drawingTools?1500:350) : 3000);
    }
  }
  window.addEventListener("message", async (event) => {
    if (
      event.origin !== location.origin ||
      event.source !== sculpt.contentWindow ||
      event.data?.channel !== "draw3d.sculpt"
    )
      return;
    if (event.data.type === "ready") {
      try {
        const asset = store.session.sculptProject;
        if (asset) {
          const saved = await store.get("assets", [store.session.id, asset]);
          if (saved)
            sculpt.contentWindow.__draw3dSculpt.restore(
              await saved.blob.arrayBuffer(),
              summaries().filter((m) => m.source === "sculpt"),
            );
        }
        sculptRestoring = false;
        await refresh();
      } catch (e) {
        sculptRestoring = false;
        report(e);
      }
    }
  });
  studio.modelsReady=(async () => {
    const asset = store.session.sharedModels;
    if (asset) {
      const saved = await store.get("assets", [store.session.id, asset]);
      if (saved)
        for (const m of JSON.parse(await saved.blob.text())) {
          const item = put(m.source, m.nativeId, m.vertices, m.indices, m.name, m.owner);
          Object.assign(item, {
            hidden: m.hidden,
            blender: m.blender,
            geometryVersion:m.geometryVersion??item.geometryVersion,
            coordinateParent:structuredClone(m.coordinateParent)||null,
            parametricKind:m.parametricKind,
            spatialFigureId:m.spatialFigureId,
            position: m.position,
            rotationDeg: m.rotationDeg,
            scale: m.scale,
            version: m.version,
          });
          apply(item);
        }
      updateList();studio.modeling?.sync();
    }
    if(spatialWorkflow)await spatialWorkflow.restore();
    poll();
  })().catch(report);
  setInterval(() => {
    if (!executing)
      refresh().catch((e) => {
        activity.textContent = e.message;
      });
    if (!panel.hidden) {
      viewCamera.aspect = 4 / 3;
      viewCamera.updateProjectionMatrix();
      controls.update();
      renderer.render(studio.scene, viewCamera);
    }
  }, 1500);
  return { show, dispatch, refresh };
}
