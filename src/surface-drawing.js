import * as T from "three";
import {meshTopology} from './desktop-topology.js';
import { planeFrame, drawingView } from "./sketch-projection.js";
export function initSurfaceDrawing(studio) {
  let selected = null,
    picking = false,selectedGeometry=null,pickedFaceIndices=null,defaultScope='face';const topologyCache=new WeakMap();
  const marker = new T.Mesh(
    new T.RingGeometry(0.018, 0.022, 32),
    new T.MeshBasicMaterial({ color: 0x78dfff, side: T.DoubleSide, depthTest: false }),
  );
  marker.visible = false;
  marker.renderOrder = 20;
  studio.scene.add(marker);
  const toolbar = document.createElement("div");
  toolbar.className = "surface-tools";
  toolbar.innerHTML =
    '<button id="surface-select">Select drawing surface</button><label>Draw on <select id="surface-scope"><option value="face">Clicked face</option><option value="body">Whole body · all surfaces</option></select></label><button id="surface-clear">New independent part / free space</button><p id="surface-status" role="status">Free-space drawing</p>';
  document.querySelector(".left-panel .tool-tabs:not(.workspace-tabs)").after(toolbar);
  const status = toolbar.querySelector("#surface-status");
  function clear() {
    studio.endAll();
    studio.tableDrawing=false;studio.tableCalibrationArmed=false;
    selected = null;
    studio.drawingGroupId=crypto.randomUUID();delete studio.store.session.agentModelFocus;
    picking = false;
    marker.visible = false;
    status.textContent = "New independent part · free-space drawing";
    studio.store.log("surface.clear");
  }
  function arm() {
    studio.endAll();
    picking = !picking;
    status.textContent = picking
      ? "Point and select a model surface. Trigger or pinch in VR."
      : selected
        ? "Drawing on selected surface"
        : "Free-space drawing";
    if (picking) studio.setMode("draw");
  }
  toolbar.querySelector("#surface-select").onclick = arm;
  toolbar.querySelector("#surface-clear").onclick = clear;
  function valid() {
    if (!selected) return null;
    const model = studio.surfaceModels?.().find((m) => m.id === selected.modelId);
    if (!model || model.hidden || !model.mesh.visible || model.mesh.geometry!==selectedGeometry) {
      clear();
      status.textContent = "Surface changed. Select it again.";
      return null;
    }
    if(selected.nativeFrame){model.mesh.updateWorldMatrix(true,false);const a=selected.nativeFrame,normal=new T.Vector3(...a.normal).applyNormalMatrix(new T.Matrix3().getNormalMatrix(model.mesh.matrixWorld)).normalize();selected.frame=planeFrame({origin:new T.Vector3(...a.origin).applyMatrix4(model.mesh.matrixWorld).toArray(),normal:normal.toArray(),up:new T.Vector3(...a.yAxis).transformDirection(model.mesh.matrixWorld).toArray()});selected.modelVersion=model.version;marker.position.fromArray(selected.frame.origin);marker.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),normal);}
    return model;
  }
  function choose(hit, model, faceIndices, {scope=defaultScope}={}) {
    studio.endAll();
    if(!['face','body'].includes(scope))throw Error('Choose face or body drawing');model.mesh.updateWorldMatrix(true,false);
    if(!faceIndices){const native=model.blender?.metrics?.faces?.find(f=>hit.faceIndex>=f.triangleStart&&hit.faceIndex<f.triangleStart+f.triangleCount);if(native)faceIndices=Array.from({length:native.triangleCount},(_,i)=>native.triangleStart+i);else{let topology=topologyCache.get(model.mesh.geometry);if(!topology){topology=meshTopology(model.mesh.geometry);topologyCache.set(model.mesh.geometry,topology);}faceIndices=topology.patch(hit.faceIndex);}}pickedFaceIndices=[...faceIndices];
    const normal = hit.face.normal
      .clone()
      .applyNormalMatrix(new T.Matrix3().getNormalMatrix(model.mesh.matrixWorld))
      .normalize();
    selected = {
      scope,projection:scope==='body'?'visible-body-surfaces':'selected-face',planar:scope==='body'?false:undefined,
      modelId: model.id,
      modelVersion: model.version,geometryVersion:model.geometryVersion||1,
      faceIndex: hit.faceIndex,
      ...(scope==='face' ? {faceIndices:[...faceIndices]} : {}),
      frame: planeFrame({ origin: hit.point.toArray(), normal: normal.toArray() }),
    };
    studio.drawingGroupId=crypto.randomUUID();
    selectedGeometry=model.mesh.geometry;model.mesh.updateWorldMatrix(true,false);const inverse=model.mesh.matrixWorld.clone().invert();selected.nativeFrame=planeFrame({origin:hit.point.clone().applyMatrix4(inverse).toArray(),normal:normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(inverse)).normalize().toArray(),up:new T.Vector3(...selected.frame.yAxis).transformDirection(inverse).toArray()});
    picking = false;
    marker.position.copy(hit.point);
    marker.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
    marker.visible = true;
    studio.objects?.select(model.id);defaultScope=scope;toolbar.querySelector('#surface-scope').value=scope;status.textContent = 'Drawing on '+model.name+(scope==='body'?' · all visible surfaces; rotate to reach another side':' · clicked face only')+' · Free-space drawing to unselect';
    window.dispatchEvent(new CustomEvent('draw3d-surface-selected',{detail:structuredClone(selected)}));
    studio.store.log("surface.select", selected);
    return selected;
  }
  function hit(ray, chooseSurface = false) {
    const selecting=chooseSurface===true||chooseSurface==='hover'&&picking;const models = selecting ? (studio.surfaceModels?.() || []).filter(m=>!m.hidden&&m.mesh.visible) : [valid()].filter(Boolean);
    const caster = new T.Raycaster(ray.origin, ray.direction, 0, 100);
    for (const m of models) m.mesh.updateWorldMatrix(true, false);
    const intersections = caster.intersectObjects(models.map(m=>m.mesh),false),front=intersections[0]?.distance;
    const hits = intersections.filter(h=>selecting || (h.distance<=front+.00001&&(selected?.scope==='body'||!selected?.faceIndices||selected.faceIndices.includes(h.faceIndex))));
    if (!hits.length) return null;
    const h = hits[0],
      model = models.find((m) => m.mesh === h.object);
    if (chooseSurface === true) return choose(h, model);
    if (chooseSurface === "hover") return { point: h.point };
    return h.point.toArray();
  }
  function setScope(scope){if(!['face','body'].includes(scope))throw Error('Choose face or body drawing');studio.endAll();defaultScope=scope;toolbar.querySelector('#surface-scope').value=scope;if(selected){selected.scope=scope;selected.projection=scope==='body'?'visible-body-surfaces':'selected-face';selected.planar=scope==='body'?false:undefined;if(scope==='face')selected.faceIndices=[...pickedFaceIndices];else delete selected.faceIndices;status.textContent=scope==='body'?'Drawing on whole body · all visible surfaces':'Drawing on the clicked face only';studio.store.log('surface.scope',{modelId:selected.modelId,scope});}studio.updateHUD?.();}
  toolbar.querySelector('#surface-scope').onchange=e=>setScope(e.target.value);
  studio.surface = {
    setScope,
    resume(saved){const m=studio.surfaceModels?.().find(m=>m.id===saved.modelId&&!m.hidden);if(!m||!saved.nativeFrame||saved.geometryVersion&&(m.geometryVersion||1)!==saved.geometryVersion){status.textContent='Surface geometry changed. Click it again to draw.';return false;}m.mesh.updateWorldMatrix(true,false);return choose({point:new T.Vector3(...saved.nativeFrame.origin).applyMatrix4(m.mesh.matrixWorld),face:{normal:new T.Vector3(...saved.nativeFrame.normal)},faceIndex:saved.faceIndex},m,saved.faceIndices,{scope:saved.scope||'face'});},
    arm,
    syncPlacement:model=>{if(selected?.modelId===model.id)valid();},
    choose,
    clear,
    get picking() {
      return picking;
    },
    get selected() {
      valid();
      return selected;
    },
    pick: (ray) => hit(ray, true),
    hover: (ray) => hit(ray, "hover"),
    point: (ray) => {
      const had = !!selected;
      const p = hit(ray);
      return had ? p : null;
    },
    project(point) {
      if (!selected) return point;
      const view = drawingView(studio);
      if (!view) return null;
      const eye = new T.Vector3().setFromMatrixPosition(
          new T.Matrix4().fromArray(view.cameraToWorld),
        ),
        d = new T.Vector3(...point).sub(eye);
      if (d.lengthSq() < 1e-10) return null;
      return hit(new T.Ray(eye, d.normalize()));
    },
  };
}
