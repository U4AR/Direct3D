import {strokeDrawingIntent} from './drawing-intent.js';
import {initRuntimePerformance} from './runtime-performance.js';
import {attachStroke,recordAttachedPoint} from './design-frame.js';
import {requestImmersiveSession,bindImmersiveSession} from './xr-entry.js';
import {incidentalHandTap} from './drawing-concurrency.js';
import {tableContact,PalmCalibrationHold,boardReferenceTransform,boardInFront,recoveryAction,nearHandPanelHit} from './xr-calibration.js';
import {microphoneRecovery, microphoneActionAt, microphoneButton} from "./microphone-recovery.js";
import {drawAgentQuestion,questionOptionAt,questionActionAt} from "./agent-question-panel.js";
import {drawingView} from "./sketch-projection.js";
import {initSurfaceDrawing} from "./surface-drawing.js";
import * as T from "three";
import {desktopDrawingTarget} from './desktop-drawing-target.js';
import { XR_BUTTONS, buttonsForMode, panelAction, historyShortcut, microgesture, nearIndexSide, drawingInView, drawingAttentionGate, closedFist, previewAcceptGesture } from "./xr-input.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";

class StrokeMesh extends T.Mesh {
  constructor(stroke) {
    const geometry = new T.BufferGeometry(),
      capacity = 2048,
      sides = 8;
    geometry.setAttribute(
      "position",
      new T.BufferAttribute(new Float32Array(capacity * sides * 3), 3).setUsage(
        T.DynamicDrawUsage,
      ),
    );
    geometry.setAttribute(
      "normal",
      new T.BufferAttribute(new Float32Array(capacity * sides * 3), 3).setUsage(
        T.DynamicDrawUsage,
      ),
    );
    const indices = [];
    for (let i = 1; i < capacity; i++)
      for (let j = 0; j < sides; j++) {
        const a = (i - 1) * sides + j,
          b = (i - 1) * sides + ((j + 1) % sides),
          c = i * sides + j,
          d = i * sides + ((j + 1) % sides);
        indices.push(a, b, c, b, d, c);
      }
    geometry.setIndex(indices);
    geometry.setDrawRange(0, 0);
    super(
      geometry,
      new T.MeshBasicMaterial({ color: stroke.color, side: T.DoubleSide }),
    );
    this.stroke = stroke;
    this.frustumCulled = false;
    this.count = 0;
    for (const p of stroke.points) this.append(p);
  }
  append(point) {
    const i = this.count++,
      p = new T.Vector3(...point),
      prev = i
        ? new T.Vector3(...this.stroke.points[i - 1])
        : p.clone().add(new T.Vector3(0, -1, 0));
    const tangent = p.clone().sub(prev).normalize();
    if (tangent.lengthSq() < 0.1) tangent.set(0, 1, 0);
    const axis =
        Math.abs(tangent.y) < 0.9
          ? new T.Vector3(0, 1, 0)
          : new T.Vector3(1, 0, 0),
      u = new T.Vector3().crossVectors(tangent, axis).normalize(),
      v = new T.Vector3().crossVectors(tangent, u).normalize();
    for (let j = 0; j < 8; j++) {
      const a = (j * Math.PI) / 4,
        n = u
          .clone()
          .multiplyScalar(Math.cos(a))
          .addScaledVector(v, Math.sin(a)),
        q = p.clone().addScaledVector(n, this.stroke.radius);
      this.geometry.attributes.position.setXYZ(i * 8 + j, q.x, q.y, q.z);
      this.geometry.attributes.normal.setXYZ(i * 8 + j, n.x, n.y, n.z);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, i) * 8 * 6);
  }
}
function dispose(object) {
  object.traverse((o) => {
    o.geometry?.dispose();
    if (o.material)
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        m.dispose();
  });
}
function canvasPanel(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const mesh = new T.Mesh(
    new T.PlaneGeometry(width / 900, height / 900),
    new T.MeshBasicMaterial({
      map: texture,
      side: T.DoubleSide,
      depthTest: false,
    }),
  );
  mesh.renderOrder = 10;
  return { canvas, texture, mesh };
}

export class Studio {
  get drawHand(){return this._drawHand||'right';}
  set drawHand(value){this._drawHand=value==='left'?'left':'right';this._grabHand=this._drawHand==='right'?'left':'right';}
  get grabHand(){return this._grabHand||(this.drawHand==='right'?'left':'right');}
  set grabHand(value){this._grabHand=value==='right'?'right':'left';}
  constructor(container, store, onChange, onAction) {
    Object.assign(this, { container, store, onChange, onAction });
    this.drawHand=store.session.drawHand==='left'?'left':'right';this.grabHand=this.drawHand==='right'?'left':'right';
    this.active = new Map();
    this.redoStack = [];
    this.undoStack = store.session.strokes.map((stroke,index)=>({kind:"draw",items:[{stroke,index}]}));
    this.color = "#bcf477";
    this.radius = 0.004;
    this.mode = "draw";
    this.workspaceMode="sketch";
    this.planeZ = -0.6;
    this.penOffset = [0, -0.11, 0.025];
    this.lastPose = 0;
    this.inputs = new Map();
    this.review = null;
    this.scene = new T.Scene();
    this.scene.background = new T.Color("#10151d");
    this.scene.fog = new T.Fog("#10151d", 5, 15);
    this.camera = new T.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.position.set(1.5, 2.1, 2.3);
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local-floor");
    container.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.15, -0.6);
    this.controls.enableDamping = true;
    this.controls.enabled = false;
    this.drawing = new T.Group();
    this.scene.add(this.drawing);
    this.strokeMeshes = new Map();
    this.scene.add(new T.HemisphereLight(0xddeeff, 0x252b31, 2.4));
    const light = new T.DirectionalLight(0xffffff, 3);
    light.position.set(2, 4, 3);
    this.scene.add(light);
    const grid = new T.GridHelper(12, 120, 0x364451, 0x202b36);
    this.scene.add(grid);
    const stage = new T.Mesh(
      new T.CylinderGeometry(0.57, 0.6, 0.035, 80),
      new T.MeshStandardMaterial({
        color: 0x222e3c,
        metalness: 0.2,
        roughness: 0.7,
      }),
    );
    stage.position.set(0, 0.7, -0.6);
    this.scene.add(stage);
    this.board=stage;
    this.reviewStage = new T.Mesh(
      new T.CylinderGeometry(0.43, 0.46, 0.035, 64),
      new T.MeshStandardMaterial({
        color: 0x26384b,
        metalness: 0.2,
        roughness: 0.7,
      }),
    );
    this.reviewStage.position.set(0.95, 0.7, -0.6);
    this.reviewStage.visible = false;
    this.scene.add(this.reviewStage);
    const rim = new T.Mesh(
      new T.TorusGeometry(0.568, 0.002, 6, 96),
      new T.MeshBasicMaterial({ color: 0x78975a }),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(stage.position);
    rim.position.y += 0.02;
    this.scene.add(rim);
    this.cursor = new T.Mesh(
      new T.SphereGeometry(0.007, 12, 8),
      new T.MeshBasicMaterial({ color: this.color }),
    );
    this.cursor.visible = false;
    this.scene.add(this.cursor);
    this.raycaster = new T.Raycaster();
    this.plane = new T.Plane(new T.Vector3(0, 0, 1), -this.planeZ);
    initSurfaceDrawing(this);
    this.bindPointer();
    this.setupXR();
    for (const s of store.session.strokes) this.addStrokeMesh(s);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    const timings=initRuntimePerformance(this,store);
    this.renderer.setAnimationLoop((time, frame) => {
      if (this.cadEditorOpen) return;
      timings.begin(time);const start=performance.now();
      if (frame) this.updateXR(time, frame);
      else this.controls.update();
      const inputDone=performance.now();this.strokeWorkflow?.sync();const fitsDone=performance.now();
      this.renderer.render(this.scene, this.camera);
      timings.end(inputDone-start,fitsDone-inputDone,performance.now()-fitsDone);
    });
  }
  resize() {
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  addStrokeMesh(s) {
    const mesh = new StrokeMesh(s);
    mesh.visible=!s.hidden;
    if(s.objectAttachment)mesh.userData.attachmentMatrix=structuredClone(s.objectAttachment.currentNativeToWorld||s.objectAttachment.nativeToWorldAtDraw);
    this.drawing.add(mesh);
    this.strokeMeshes.set(s.id, mesh);
    this.strokeWorkflow?.restore(s);
    return mesh;
  }
  begin(key, point) {
    if(this.objects?.enabled||this.workspaceMode==="cad"||this.surface?.picking) return;
    if (this.active.has(key)) return;
    if (this.mode === "erase") {
      this.active.set(key, { erasing: true, items: [] });
      this.sample(key, point);
      return;
    }
    const stroke = {
      id: crypto.randomUUID(),
      color: this.color,
      radius: this.radius,
      input: key,
      points: [],
      times: [],
      started: this.store.elapsed(),
      view: drawingView(this),
      surface: this.surface?.selected ? structuredClone(this.surface.selected) : null,
    };
    stroke.drawingIntent=strokeDrawingIntent(this,stroke.surface);
    if(stroke.drawingIntent.mode==='independent-part'&&!this.store.session.strokes.some(s=>s.drawingIntent?.groupId===stroke.drawingIntent.groupId)){delete this.store.session.agentModelFocus;}
    attachStroke(this,stroke,point);
    if(this.spatialWorkflow)stroke.spatialRole=this.spatialStrokeRole||"edge";
    this.store.session.strokes.push(stroke);
    const mesh = this.addStrokeMesh(stroke);
    this.active.set(key, { stroke, mesh });
    if(this.desktopPlane&&!this.surface?.selected)stroke.drawingPlane=structuredClone(this.desktopPlane);
    if(this.desktopPlane)stroke.drawingTarget=desktopDrawingTarget({plane:structuredClone(this.desktopPlane),explicit:this.desktopPlaneExplicit===true,surface:stroke.surface});
    if(this.desktopInkFrame&&key==='pointer'){
      stroke.drawingPlane=structuredClone(this.desktopInkFrame);
      stroke.drawingTarget={...desktopDrawingTarget({plane:stroke.drawingPlane}),preferredPlaneId:this.desktopPlane.id,captureOnly:true};
    }else if(this.desktopSketches)stroke.desktopSketchId=this.desktopSketches.ensure().id;
    this.store.log("stroke.begin", {
      id: stroke.id,
      input: key,
      color: this.color,
      radius: this.radius,
    });
    this.sample(key, point);
  }
  sample(key, point) {
    const active = this.active.get(key);
    if (!active) return;
    if(this.surface?.selected){point=this.surface.project(point);if(!point){this.end(key);return;}}
    if(this.active.get(key)!==active)return;
    if (active.erasing) { this.eraseAt(key, point); return; }
    const { stroke, mesh } = active;
    const prev = stroke.points.at(-1);
    if (
      prev &&
      new T.Vector3(...prev).distanceTo(new T.Vector3(...point)) < 0.002
    )
      return;
    if (
      prev &&
      new T.Vector3(...prev).distanceTo(new T.Vector3(...point)) > 0.2
    ) {
      this.end(key);
      this.begin(key, point);
      return;
    }
    if (stroke.points.length >= 2048) {
      this.end(key);
      this.begin(key, point);
      return;
    }
    this.lastDrawingInputAt=performance.now();
    recordAttachedPoint(this,stroke,point);
    stroke.points.push(point);
    stroke.times.push(this.store.elapsed());
    mesh.append(point);
    this.store.log("stroke.point", { id: stroke.id, point });
    this.store.session.revision++;
    this.onChange();
  }
  end(key) {
    const a = this.active.get(key);
    if (!a) return;
    this.active.delete(key);
    if (a.erasing) {
      if(a.items.length) this.undoStack.push({kind:"erase",items:a.items});
      this.onChange();
      this.store.flush().catch(()=>{});
      return;
    }
    a.stroke.ended = this.store.elapsed();
    a.stroke.endView=drawingView(this);
    if(a.stroke.objectAttachment&&a.stroke.endView){const m=this.surfaceModels?.().find(m=>m.id===a.stroke.objectAttachment.modelId);if(m){m.mesh.updateWorldMatrix(true,false);a.stroke.objectAttachment.endCameraToNative=m.mesh.matrixWorld.clone().invert().multiply(new T.Matrix4().fromArray(a.stroke.endView.cameraToWorld)).toArray();}}
    this.store.log("stroke.end", { id: a.stroke.id });
    const incidental=incidentalHandTap(a.stroke);
    this.lastDrawingInputAt=performance.now();
    if(incidental)this.store.log('gesture.ignored',{reason:'brief stationary hand pinch',stroke:a.stroke});
    if (a.stroke.points.length < 2||incidental) {
      this.store.session.strokes = this.store.session.strokes.filter(
        (s) => s.id !== a.stroke.id,
      );
      this.drawing.remove(a.mesh);
      dispose(a.mesh);
      this.strokeMeshes.delete(a.stroke.id);
    }
    if(a.stroke.points.length>=2&&!incidental){this.redoStack=[];this.strokeWorkflow?.completed(a.stroke);}
    if(a.stroke.points.length>=2&&!incidental) this.undoStack.push({kind:"draw",items:[{stroke:a.stroke,index:this.store.session.strokes.indexOf(a.stroke)}]});
    this.onChange();
    this.store.flush().catch(() => {});
  }
  eraseAt(key, point) {
    const active=this.active.get(key);
    const p=new T.Vector3(...point), closest=new T.Vector3();
    // Erase whole touched strokes, including between their recorded samples.
    for(const stroke of this.store.session.strokes.slice()) {
      if(stroke.hidden) continue;
      if([...this.active.values()].some(a=>a.stroke===stroke)) continue;
      const radius=this.radius+stroke.radius;
      const hit=stroke.points.some((position,i)=>{
        const a=new T.Vector3(...position);
        if(i) new T.Line3(new T.Vector3(...stroke.points[i-1]),a).closestPointToPoint(p,true,closest);
        else closest.copy(a);
        return closest.distanceToSquared(p)<=radius*radius;
      });
      if(!hit) continue;
      this.redoStack=[];
      active.items.push({stroke,index:this.store.session.strokes.indexOf(stroke)});
      this.removeStroke(stroke);
      this.store.session.revision++;
      this.store.log("stroke.erase",{input:key,stroke,point,radius:this.radius});
      this.onChange();
    }
  }
  removeStroke(stroke) {
    this.store.session.strokes=this.store.session.strokes.filter(s=>s.id!==stroke.id);
    const mesh=this.strokeMeshes.get(stroke.id);
    if(mesh) {this.drawing.remove(mesh);dispose(mesh);this.strokeMeshes.delete(stroke.id);}
  }
  endAll() {
    for (const key of [...this.active.keys()]) this.end(key);
  }
  setMode(mode) {
    this.objects?.setEnabled(false);
    this.endAll();
    this.mode = mode;
    if(mode==="draw" || mode==="erase")this.nativeSelection?.deactivate();
    this.controls.enabled = !!this.desktopPlane || mode === "orbit";
    this.renderer.domElement.style.cursor =
      mode === "orbit" ? "grab" : "crosshair";
    this.store.log("tool.mode", { mode });
  }
  applyHistory(command, reverse) {
    if(command.kind==='trim'){
      for(const stroke of this.store.session.strokes.slice())this.removeStroke(stroke);
      this.store.session.strokes=structuredClone(reverse?command.before:command.after);
      for(const stroke of this.store.session.strokes)this.addStrokeMesh(stroke);
      this.store.session.revision++;this.store.log(reverse?'stroke.undo':'stroke.redo',{kind:'trim'});this.onChange();this.store.flush().catch(()=>{});return;
    }
    const restore=(command.kind==="draw")!==reverse;
    const items=restore && command.kind==="erase" ? [...command.items].reverse() : command.items;
    for(const {stroke,index} of items) {
      if(restore) { this.store.session.strokes.splice(index,0,stroke);this.addStrokeMesh(stroke); }
      else this.removeStroke(stroke);
    }
    this.store.session.revision++;
    this.store.log(reverse ? "stroke.undo" : "stroke.redo",{kind:command.kind,ids:command.items.map(i=>i.stroke.id)});
    this.onChange();
    this.store.flush().catch(()=>{});
  }
  undo() {
    this.endAll();
    const command=this.undoStack.pop();
    if(!command) return;
    this.redoStack.push(command);
    this.applyHistory(command,true);
  }
  redo() {
    this.endAll();
    const command=this.redoStack.pop();
    if(!command) return;
    this.undoStack.push(command);
    this.applyHistory(command,false);
  }
  clear() {
    this.endAll();
    this.store.log("drawing.clear", {
      strokeIds: this.store.session.strokes.map((s) => s.id),
    });
    for (const m of this.drawing.children.slice()) {
      this.drawing.remove(m);
      dispose(m);
    }
    this.strokeMeshes.clear();
    this.store.session.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.store.session.revision++;
    this.setReview(null);
    this.onChange();
  }
  bindPointer() {
    const canvas = this.renderer.domElement;
    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(
        new T.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        this.camera,
      );
      if(this.surface?.picking)return null;
      if(this.surface?.selected)return this.surface.point(this.raycaster.ray);
      if(this.desktopPoint)return this.desktopPoint(this.raycaster.ray);
      this.plane.constant = -this.planeZ;
      const p = this.raycaster.ray.intersectPlane(this.plane, new T.Vector3());
      return p?.toArray();
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (
        this.mode === "orbit" ||
        e.button !== 0 ||
        this.renderer.xr.isPresenting
      )
        return;
      const p = point(e);
      if(this.surface?.picking){this.surface.pick(this.raycaster.ray);return;}
      if (!p) return;
      canvas.setPointerCapture(e.pointerId);
      this.begin("pointer", p);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.mode === "orbit") return;
      const p = point(e);
      if (p) {
        this.cursor.visible = true;
        this.cursor.position.fromArray(p);
        this.sample("pointer", p);
      }else if(this.surface?.selected&&this.active.has("pointer")){this.cursor.visible=false;this.end("pointer");}
    });
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      canvas.addEventListener(event, () => this.end("pointer"));
    canvas.addEventListener("pointerleave", () => {
      this.cursor.visible = false;
    });
    this.controls.addEventListener("end", () =>
      this.store.log("camera.orbit", {
        position: this.camera.position.toArray(),
        target: this.controls.target.toArray(),
      }),
    );
  }
  setupXR() {
    const controllers = new XRControllerModelFactory(),
      hands = new XRHandModelFactory();
    for (let i = 0; i < 2; i++) {
      const grip = this.renderer.xr.getControllerGrip(i);
      grip.add(controllers.createControllerModel(grip));
      const nib = new T.Mesh(
        new T.ConeGeometry(0.007, 0.025, 8),
        new T.MeshBasicMaterial({ color: 0xbcf477 }),
      );
      nib.rotation.z = Math.PI;
      nib.position.fromArray(this.penOffset);
      grip.add(nib);
      grip.userData.nib = nib;
      this.scene.add(grip);
      const hand = this.renderer.xr.getHand(i);
      hand.add(hands.createHandModel(hand, "spheres"));
      this.scene.add(hand);
    }
    this.xrQuestion=canvasPanel(900,720);this.xrQuestion.mesh.scale.setScalar(.65);this.xrQuestion.mesh.visible=false;this.xrQuestion.mesh.renderOrder=30;this.scene.add(this.xrQuestion.mesh);
    this.xrVoice = canvasPanel(900,285);
    this.xrVoice.mesh.scale.setScalar(.95);
    this.xrVoice.mesh.visible=false;
    this.xrVoice.mesh.renderOrder=20;
    this.xrCreation=canvasPanel(720,420);this.xrCreation.mesh.scale.setScalar(1.2);this.xrCreation.mesh.visible=false;this.xrCreation.mesh.renderOrder=21;this.scene.add(this.xrCreation.mesh);
    this.scene.add(this.xrVoice.mesh);
    this.voiceState={status:"Microphone off",phase:"off",level:0,probability:0,speaking:false};
    this.drawVoiceHUD();
    this.palmCalibration=new PalmCalibrationHold();
    this.xrRecovery=canvasPanel(600,108);this.xrRecovery.mesh.scale.setScalar(.75);this.xrRecovery.mesh.visible=false;this.xrRecovery.mesh.renderOrder=40;this.scene.add(this.xrRecovery.mesh);
    this.drawRecoveryHUD();
    this.xrPointers = new Map();
    this.xrHovered = new Set();
    this.xrPanel = canvasPanel(720, 450);
    this.xrPanel.mesh.scale.setScalar(.85);
    this.xrPanel.mesh.position.set(-0.85, 1.55, -1.1);
    this.xrPanel.mesh.rotation.y = 0.25;
    this.xrPanel.mesh.visible = false;
    this.scene.add(this.xrPanel.mesh);
    this.xrText =
      "Describe a change.";
    this.xrStatus = `Draw hand: ${this.drawHand} | Grab hand: ${this.grabHand}`;
    this.updateHUD();
    this.renderer.xr.addEventListener("sessionstart", () => {
      this.xrBaseSpace=this.renderer.xr.getReferenceSpace();
      this.xrNeedsRecenter=true;this.xrHUDAnchor=null;this.palmCalibration.reset();
      this.xrBaseSpace?.addEventListener?.('reset',()=>{this.endAll();this.tableDrawing=false;this.tableCalibrationArmed=false;this.xrNeedsRecenter=true;this.palmCalibration.reset();});
      this.setXRMenuVisible(false);
      this.cursor.visible = false;
      this.xrDrawReleaseRequired=new Set([this.drawHand+'-hand',this.drawHand+'-controller']);
      this.store.log("xr.start");
      this.onAction("xr-start");
    });
    this.renderer.xr.addEventListener("sessionend", () => {
      this.objects?.cancelLasso?.();
      this.xrDrawReleaseRequired=new Set([this.drawHand+'-hand',this.drawHand+'-controller']);
      this.endAll();
      this.inputs.clear();
      for(const tip of this.xrPenTips?.values()||[])tip.visible=false;
      for (const pointer of this.xrPointers.values()) pointer.group.visible = false;
      this.xrHovered.clear();
      this.xrPanel.mesh.visible = false;
      this.objects?.finish();
      this.tableDrawing=false;this.tableCalibrationArmed=false;this.xrBaseSpace=null;this.xrNeedsRecenter=false;this.xrRecovery.mesh.visible=false;this.palmCalibration.reset();
      this.xrVoice.mesh.visible=false;this.xrCreation.mesh.visible=false;
      this.xrQuestion.mesh.visible=false;if(this.conceptPicker)this.conceptPicker.mesh.visible=false;
      this.store.log("xr.end");
      this.onAction("xr-end");
    });
  }
  setAgentQuestion(question){
    if(!question){this.agentQuestion=null;if(this.xrQuestion)this.xrQuestion.mesh.visible=false;return;}
    if(this.agentQuestion?.id===question.id)return;this.agentQuestion={...question,options:Array.isArray(question.options)?question.options:[]};
    if(!this.xrQuestion)return;this.endAll();this.xrQuestion.mesh.visible=!!question&&this.renderer.xr.isPresenting;
    if(question){drawAgentQuestion(this.xrQuestion.canvas,question);this.xrQuestion.texture.needsUpdate=true;}
  }
  setAgentState(update) {
    this.agentState=update;
    if(this.xrVoice)this.drawVoiceHUD();this.drawCreationHUD();
  }
  drawCreationHUD(){
    if(!this.xrCreation)return;const {canvas,texture}=this.xrCreation,c=canvas.getContext('2d'),state=this.agentState||{},timeline=this.creationTimeline||this.store.session.creationTimeline||[];const paintSignature=JSON.stringify([state.status,state.busy,state.step,state.busy?Math.floor((Date.now()-(state.moveStartedAt||Date.now()))/250):0,state.plan,timeline.map(s=>[s.at,s.label,s.phase])]);if(paintSignature===this.creationPaintSignature)return;this.creationPaintSignature=paintSignature;
    c.fillStyle='#112333';c.fillRect(0,0,720,420);c.strokeStyle='#8cbcff';c.lineWidth=3;c.strokeRect(2,2,716,416);
    c.fillStyle='#bcf477';c.font='bold 27px sans-serif';c.fillText('LIVE CONSTRUCTION',20,38);
    c.fillStyle='#eff5ff';c.font='23px sans-serif';c.fillText((state.status||'Ready').slice(0,54),20,77);
    const elapsed=Math.max(0,(Date.now()-(state.moveStartedAt||Date.now()))/1000);
    c.fillStyle='#adc7dd';c.font='20px sans-serif';c.fillText(state.busy?('Move '+(state.step||1)+' · '+elapsed.toFixed(1)+'s · target '+((state.targetMoveMs||5000)/1000)+'s'):'Last applied steps',20,111);
    const applied=(this.creationTimeline||this.store.session.creationTimeline||[]).filter(s=>s.phase==='applied').slice(-3);
    c.font='21px sans-serif';applied.forEach((s,i)=>{c.fillStyle='#bcf477';c.fillText('✓ '+s.label.slice(0,53),20,153+i*32);});
    const next=(state.plan||[]).filter(s=>s.state!=='completed').slice(0,3);next.forEach((s,i)=>{c.fillStyle=s.state==='active'?'#fff':'#a9bdd1';c.fillText((s.state==='active'?'→ ':'· ')+s.label.slice(0,54),20,265+i*30);});
    c.fillStyle='#8cbcff';c.font='18px sans-serif';c.fillText('Speak or type a change to pause before the next step.',20,386);texture.needsUpdate=true;
  }
  voicePanelAction(uv){
    if(uv&&(this.agentState?.busy||this.agentState?.canRun)){const x=uv.x*900,y=(1-uv.y)*285;if(x>=24&&x<=204&&y>=156&&y<=199)return this.agentState.busy?'ai-stop':'ai-run';}
    return microphoneActionAt(uv,this.voiceState?.phase);
  }
  voicePanelInteractive(){return !!(this.agentState?.busy||this.agentState?.canRun)||microphoneRecovery(this.voiceState?.phase);}
  setVoiceState(update) {
    Object.assign(this.voiceState,update);
    this.drawVoiceHUD();
  }
  drawVoiceHUD() {
    if(!this.xrVoice)return;
    const {canvas,texture}=this.xrVoice,ctx=canvas.getContext("2d"),state=this.voiceState;
    ctx.fillStyle="#111c29";ctx.fillRect(0,0,900,285);
    const color=state.speaking ? "#bcf477" : ["error","no-signal","stalled","muted"].includes(state.phase) ? "#ffbd78" : "#8cbcff";
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(30,36,10,0,Math.PI*2);ctx.fill();
    ctx.font="bold 27px sans-serif";
    ctx.fillText(state.speaking ? "SPEECH DETECTED" : state.transcribing ? "TRANSCRIBING…" : state.phase==="off" ? "MIC OFF" : state.phase==="listening" ? "VAD LISTENING" : state.phase.toUpperCase().replaceAll("-"," "),52,45);
    ctx.font="24px sans-serif";ctx.fillText(`${this.workspaceMode==="cad" ? "CAD SOLIDS" : `${this.mode=== "erase" ? "ERASER" : "PEN"}  ${Math.round(this.radius*2000)} mm`}`,620,45);
    ctx.font="22px sans-serif";ctx.fillStyle="#e6ecf2";
    ctx.fillText(state.status.slice(0,78),22,80);
    ctx.fillStyle="#344357";ctx.fillRect(22,97,580,14);
    ctx.fillStyle=color;ctx.fillRect(22,97,580*Math.max(0,Math.min(1,state.level)),14);
    ctx.fillStyle="#aab9c9";ctx.font="20px sans-serif";
    ctx.fillText(`Mic level   |   VAD ${Math.round((state.probability||0)*100)}%`,620,111);
    ctx.fillStyle="#e6ecf2";ctx.font="21px sans-serif";
    ctx.fillText((this.xrText||"Say what you are drawing, then pause.").slice(-88),22,147);
    ctx.fillStyle="#aab9c9";ctx.font="19px sans-serif";
    ctx.fillText(microphoneRecovery(state.phase) ? "Point + pinch / trigger to enable mic" : `Draw: ${this.drawHand} | Grab: ${this.grabHand} · pinch body / 2× face / 3× edge · fist: move`,22,186);
    if(microphoneRecovery(state.phase)) {
      const b=microphoneButton;ctx.fillStyle="#bcf477";ctx.fillRect(b.x,b.y,b.width,b.height);
      ctx.fillStyle="#10151d";ctx.font="bold 24px sans-serif";ctx.fillText("Enable microphone",b.x+12,b.y+29);
    }
    if(this.agentState?.busy||this.agentState?.canRun){ctx.fillStyle=this.agentState.busy?'#bd6d57':'#617d3f';ctx.fillRect(24,156,180,43);ctx.fillStyle='#fff';ctx.font='bold 23px sans-serif';ctx.fillText(this.agentState.busy?'Stop AI':'Run AI',45,185);}
    ctx.fillStyle=this.agentState?.error ? "#ffbd78" : "#bcf477";ctx.font="bold 23px sans-serif";
    ctx.fillText((this.agentState?.status||"AI ready · speak a request, then pause").slice(0,76),22,225);
    ctx.fillStyle="#c8d4e2";ctx.font="20px sans-serif";
    ctx.fillText((this.objects?.snapStatus||this.calibrationStatus||this.fitStatus||this.agentState?.detail||"").slice(0,88),22,261);
    texture.needsUpdate=true;
  }
  drawRecoveryHUD(){
    if(!this.xrRecovery)return;
    const ctx=this.xrRecovery.canvas.getContext('2d');ctx.fillStyle='#142334';ctx.fillRect(0,0,600,108);
    ['Menu','Recenter board','Exit VR'].forEach((text,i)=>{
      const hover=this.xrHovered?.has(['menu-recover','board-recenter','exit-vr'][i]);
      ctx.fillStyle=hover?'#bcf477':'#34516b';ctx.fillRect(8+i*199,8,186,92);
      ctx.fillStyle=hover?'#10151d':'#f0f4f8';ctx.font='bold 23px sans-serif';ctx.textAlign='center';ctx.fillText(text,101+i*199,48);ctx.font='18px sans-serif';ctx.fillText('Point + pinch',101+i*199,78);
    });this.xrRecovery.texture.needsUpdate=true;
  }
  anchorXRHUD(matrix){
    if(this.xrHUDAnchor)return;
    const head=new T.Vector3().setFromMatrixPosition(matrix),forward=new T.Vector3(0,0,-1).transformDirection(matrix);forward.y=0;
    if(forward.lengthSq()<.01)forward.set(0,0,-1);forward.normalize();this.xrHUDAnchor=new T.Matrix4().makeRotationY(Math.atan2(-forward.x,-forward.z));this.xrHUDAnchor.setPosition(head);
    for(const [panel,offset]of [[this.xrVoice,[-.62,-.10,-2.1]],[this.xrCreation,[.62,-.10,-2.1]],[this.xrQuestion,[.62,.02,-2.08]],[this.xrRecovery,[-.95,-.48,-1.65]],[this.xrPanel,[0,-.42,-1.65]]])if(panel){panel.mesh.position.set(...offset).applyMatrix4(this.xrHUDAnchor);panel.mesh.quaternion.setFromRotationMatrix(this.xrHUDAnchor);}
  }
  updateVoicePose(frame, time = performance.now()) {
    if(!this.xrVoice) return;
    const pose=frame.getViewerPose(this.renderer.xr.getReferenceSpace());
    this.xrVoice.mesh.visible=!!pose;
    if(!pose){if(this.xrRecovery)this.xrRecovery.mesh.visible=false;return;}
    const matrix=new T.Matrix4().fromArray(pose.transform.matrix);
    this.anchorXRHUD(matrix);this.conceptPicker?.pose(this.xrHUDAnchor);
    if(this.xrCreation){this.xrCreation.mesh.visible=!this.agentQuestion;if(this.agentState?.busy&&time-(this.lastCreationPaint||0)>250){this.lastCreationPaint=time;this.drawCreationHUD();}}
    if(this.xrRecovery)this.xrRecovery.mesh.visible=true;
    this.xrQuestion.mesh.visible=!!this.agentQuestion;
  }
  updateHUD(text = this.xrText, status = this.xrStatus) {
    this.xrText = text;
    this.drawRecoveryHUD();
    if(this.xrVoice) this.drawVoiceHUD();
    this.xrStatus = status;
    const { canvas, texture } = this.xrPanel,
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "#18212d";
    ctx.fillRect(0, 0, 720, 450);
    ctx.fillStyle = "#bcf477";
    ctx.font = "bold 32px sans-serif";
    ctx.fillText("DRAW3D", 28, 48);
    ctx.font = "22px sans-serif";
    ctx.fillStyle = "#e6ecf2";
    const words = text.slice(-95).split(" ");
    let line = "",
      y = 90;
    for (const word of words) {
      if (ctx.measureText(line + word).width > 650) {
        ctx.fillText(line, 28, y);
        line = "";
        y += 32;
        if (y > 122) break;
      }
      line += word + " ";
    }
    ctx.fillText(line, 28, y);
    ctx.fillStyle = "#aab9c9";
    ctx.font = "18px sans-serif";
    ctx.fillText(`${this.mode === "erase" ? "ERASER" : "PEN"}  ${Math.round(this.radius*2000)} mm  |  ${status.slice(0, 52)}`, 28, 316);
    if(this.workspaceMode?.startsWith('native-')){const s=this.nativeSelection?.summary();ctx.fillStyle='#c4dcf0';ctx.font='20px sans-serif';ctx.fillText(s?`${s.edgeIndices.length} edges / ${s.faceIndices.length} faces selected`:'Select geometry, draw, or speak an instruction',28,145);}
    buttonsForMode(this.workspaceMode).forEach(({action, label, color, x, y, width, height}) => {
      const hovered = this.xrHovered.has(action);
      const selected=action===this.mode || action==='native-cad'&&this.workspaceMode==='native-cad' || action==='native-mesh'&&this.workspaceMode==='native-mesh' || action==='native-select-'+this.nativeSelection?.mode&&this.nativeSelection?.active || action===`color:${this.color}` || action==="spatial-ai-toggle"&&this.spatialWorkflow?.enabled;
      ctx.fillStyle = color || (selected ? "#617d3f" : hovered ? "#bcf477" : "#344357");
      ctx.fillRect(x, y, width, height);
      if(hovered || selected) {ctx.strokeStyle="#fff";ctx.lineWidth=3;ctx.strokeRect(x+2,y+2,width-4,height-4);}
      ctx.fillStyle = color || hovered ? "#10151d" : "#fff";
      ctx.font = height<=32?"18px sans-serif":"22px sans-serif";
      ctx.fillText(action==="record-example" ? (this.drawingRecorder?.recording?"Save example":"Record example") : action==="objects-snap-toggle" ? (this.objects?.magnetEnabled?"Magnet ON":"Magnet OFF") : action==="ai-supervision" ? ("Ask: "+({high:"HIGH",balanced:"MED",low:"LOW"}[this.aiSupervision?.value||"balanced"])) : action==="spatial-ai-toggle" ? (this.spatialWorkflow?.enabled?"AI on":"Enable AI") : action==="creation-toggle"&&this.spatialWorkflow ? ("Ink: "+this.spatialStrokeRole) : action==="workspace-toggle" ? (this.workspaceMode==="cad"?"Sketch mode":"Full CAD") : action==="capture"&&this.objects?.enabled ? "Select all" : label, x + 12, y + height/2+8);
    });
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#aab9c9";
    if(!this.spatialWorkflow)ctx.fillText(`Draw: ${this.drawHand} | Grab: ${this.grabHand} · pinch select · fist / grip move`, 22, 431);
    texture.needsUpdate = true;
  }
  async enterVR() {
    if(this.xrEntryPending)return this.xrEntryPending;
    const currentSession=this.renderer.xr.getSession();
    if(currentSession) { await currentSession.end(); return; }
    if (!navigator.xr)
      throw new Error(
        "WebXR is unavailable. Open this app in Quest Browser over HTTPS.",
      );
    // Request synchronously from the click: do not spend transient activation
    // awaiting support checks or microphone permission before entering XR.
    this.endAll();
    const pending=(async()=>{
    const session = await requestImmersiveSession(navigator.xr);
    await bindImmersiveSession(this.renderer.xr,session);
    // Native select events preserve the user gesture for audio and UI actions.
    session.addEventListener("selectstart", (event) => {
      const source = event.inputSource;
      const key = `${source.handedness}-${source.hand ? "hand" : "controller"}`;
      let state = this.inputs.get(key);
      if (!state) this.inputs.set(key, state = { pressed: false, ui: false });
      if(source.hand && (state.gestureConsuming||state.fistCandidate||state.fistSelectBlocked)) return;
      const hit = this.xrPanelHit(event.frame, source);
      if (hit && !state.ui && !state.selectPressed) {
        state.ui = true;
        const action = this.xrHitAction(hit);
        if (action) this.xrAction(action, source, "panel", event.frame);
      }
    });
    session.addEventListener("selectend", event => {
      const source=event.inputSource;
      const key=`${source.handedness}-${source.hand ? "hand" : "controller"}`;
      const state=this.inputs.get(key);
      if(state) state.ui=false;
    });
    })();this.xrEntryPending=pending;
    try{return await pending;}finally{if(this.xrEntryPending===pending)this.xrEntryPending=null;}
  }
  calibrateBoard(center,normal,head,reason){
    if(!this.xrBaseSpace?.getOffsetReferenceSpace)return;
    this.endAll();this.objects?.finish();
    const offset=boardReferenceTransform(center,normal,head);
    const space=this.xrBaseSpace.getOffsetReferenceSpace(new XRRigidTransform(offset.position,offset.orientation));
    this.renderer.xr.setReferenceSpace(space);
    this.store.log('xr.board-calibration',{reason,center:center.toArray(),normal:normal.toArray(),offsetPosition:offset.position.toArray(),offsetOrientation:offset.orientation.toArray(),units:'metres'});
    this.recoveryVisibleUntil=performance.now()+5000;
    this.inputs.clear();this.viewerView=undefined;this.xrMenuNeedsPlacement=this.xrPanel.mesh.visible;
    this.calibrationStatus=reason==='palms'?'Board aligned to your palms':'Board recentered';this.drawVoiceHUD?.();
  }
  updateBoardCalibration(time,frame){
    if(!this.xrBaseSpace||!this.palmCalibration)return false;
    const pose=frame.getViewerPose(this.xrBaseSpace);if(!pose)return false;
    const matrix=new T.Matrix4().fromArray(pose.transform.matrix);
    if(this.xrNeedsRecenter){this.xrNeedsRecenter=false;const target=boardInFront(matrix);this.calibrateBoard(target.center,target.normal,target.head,'recenter');return true;}
    const hands={};for(const source of frame.session.inputSources){if(!source.hand)continue;const points={};for(const[name,joint]of source.hand){const p=frame.getJointPose(joint,this.xrBaseSpace);if(p&&!p.emulatedPosition)points[name]=p.transform.position;}hands[source.handedness]=points;}
    const state=this.palmCalibration.update(hands,time),progress=Math.floor(state.progress*10);
    if(progress!==this.calibrationProgress){this.calibrationProgress=progress;if(progress||time>(this.calibrationMessageUntil||0))this.calibrationStatus=progress?'Keep both palms flat and still · '+progress*10+'%':'';this.drawVoiceHUD?.();}
    if(state.calibration){this.calibrationMessageUntil=time+2500;this.calibrateBoard(state.calibration.center,state.calibration.normal,new T.Vector3().setFromMatrixPosition(matrix),'palms');this.tableCalibrationArmed=false;this.tableDrawing=true;this.tableReadyAt=time+1000;this.calibrationStatus='Board aligned · pinch in space or lift index then touch table';this.drawVoiceHUD?.();return true;}
    return false;
  }
  setXRMenuVisible(visible, frame) {
    if(visible&&!this.xrHUDAnchor){
      let pose;try{pose=frame?.getViewerPose(this.renderer.xr.getReferenceSpace());}catch{}
      if(pose)this.anchorXRHUD(new T.Matrix4().fromArray(pose.transform.matrix));else this.xrMenuNeedsPlacement=true;
    }
    this.xrPanel.mesh.visible = visible;
    this.xrHovered.clear();
    if (!visible) {
      for (const pointer of this.xrPointers.values()) pointer.group.visible = false;
    }
    this.store.log("xr.menu", { visible });
    this.updateHUD();
  }
  xrAction(action, source, via, frame) {
    this.store.log("xr.action", { action, hand: source.handedness, via });
    if(action==='exit-vr'){void this.renderer.xr.getSession()?.end();return;}
    if(action==='board-recenter'){this.xrHUDAnchor=null;this.tableDrawing=false;this.tableCalibrationArmed=false;this.xrNeedsRecenter=true;this.xrMenuNeedsPlacement=true;this.xrPanel.mesh.visible=true;return;}
    if(action==='menu-recover'){this.endAll();this.setXRMenuVisible(true,frame);return;}
    if(action==="capture"&&this.objects?.enabled){this.objects.selectAll();return;}
    if(action==="objects-snap-toggle"){this.objects?.setMagnetEnabled(!this.objects.magnetEnabled);return;}
    if(action==="objects-toggle"){this.objects?.setEnabled(!this.objects.enabled);this.setXRMenuVisible(false);return;}
    if(action==="objects-clear"){this.objects?.select(null);return;}
    if(action==="objects-all"){this.objects?.selectAll();return;}
    if(action==="ai-run"){window.dispatchEvent(new Event("draw3d-run-ai"));return;}
    if(action==="ai-stop"){window.dispatchEvent(new Event("draw3d-stop-ai"));return;}
    if(action.startsWith("concept:")){window.dispatchEvent(new CustomEvent("draw3d-concept-action",{detail:action}));return;}
    if(action.startsWith("question:")){const option=this.agentQuestion?.options?.[Number(action.split(":")[1])];if(option)window.dispatchEvent(new CustomEvent("draw3d-question-option",{detail:{questionId:this.agentQuestion.id,answer:option}}));return;}
    if(this.workspaceMode==="cad" && ["draw","erase","toggle-brush","brush-larger","brush-smaller"].includes(action)) return;
    if(action==="menu-toggle") {this.endAll();this.setXRMenuVisible(!this.xrPanel.mesh.visible,frame);}
    else if(action==="surface-pick") {this.surface?.arm();this.setXRMenuVisible(false);}
    else if(action==="surface-clear") {this.tableDrawing=false;this.tableCalibrationArmed=false;this.calibrationStatus="Free-space drawing";this.drawVoiceHUD?.();this.surface?.clear();this.objects?.setEnabled(false);this.nativeSelection?.clear?.();this.setMode("draw");this.setXRMenuVisible(false);this.updateHUD();}
    else if(action==="menu-close") this.setXRMenuVisible(false);
    else if(action==="toggle-brush") {
      this.setMode(this.mode==="erase" ? "draw" : "erase");this.updateHUD();this.onChange();
    } else if(action==="draw" || action==="erase") {
      this.setMode(action);this.setXRMenuVisible(false);this.updateHUD();this.onChange();
    } else if(action.startsWith("color:")) {
      this.color=action.slice(6);this.cursor.material.color.set(this.color);
      this.store.log("brush.color",{color:this.color});
      this.setMode("draw");this.updateHUD();this.onChange();
    } else if(action==="brush-larger" || action==="brush-smaller") {
      this.endAll();
      this.radius=Math.max(0.001,Math.min(0.012,this.radius+(action==="brush-larger"?0.001:-0.001)));
      this.store.log("brush.radius",{radius:this.radius});this.updateHUD();this.onChange();
    } else this.onAction(action);
    source.gamepad?.hapticActuators?.[0]?.pulse(0.25, 35)?.catch?.(() => {});
  }
  xrHitAction(hit) {
    if (hit?.conceptPanel) return this.conceptPicker?.actionAt(hit.uv);
    if (hit?.recoveryPanel) return recoveryAction(hit.uv);
    if (hit?.voicePanel) return this.voicePanelAction(hit.uv);
    if (hit?.questionPanel) return questionActionAt(hit.uv)||(Number.isInteger(hit.questionOption)?"question:"+hit.questionOption:null);
    return panelAction(hit?.uv, this.workspaceMode);
  }
  xrNearHandHit(frame,source){
    if(!source.hand)return null;
    const joint=source.hand.get('index-finger-tip');if(!joint)return null;
    const pose=frame.getJointPose(joint,this.renderer.xr.getReferenceSpace());if(!pose||pose.emulatedPosition)return null;
    const point=new T.Vector3().copy(pose.transform.position);
    for(const [panel,kind]of [[this.conceptPicker,'conceptPanel'],[this.xrRecovery,'recoveryPanel'],[this.xrQuestion,'questionPanel'],[this.xrVoice,'voicePanel'],[this.xrPanel,'menuPanel']]){
      if(kind==='questionPanel'&&!this.agentQuestion)continue;
      if(kind==='voicePanel'&&!this.voicePanelInteractive())continue;
      if(kind==='conceptPanel'&&!this.conceptPicker?.pending)continue;
      const hit=nearHandPanelHit(panel?.mesh,point);if(!hit)continue;hit[kind]=true;
      if(kind==='questionPanel')hit.questionOption=questionOptionAt(hit.uv,this.agentQuestion?.options?.length||0);
      if(kind==='recoveryPanel'&&!recoveryAction(hit.uv)||kind==='voicePanel'&&!this.voicePanelAction(hit.uv))continue;
      return hit;
    }return null;
  }
  xrPanelHit(frame, source) {
    const near=this.xrNearHandHit(frame,source);if(near)return near;
    if (!this.xrRecovery?.mesh.visible && !this.xrPanel.mesh.visible && !this.xrQuestion.mesh.visible && !(this.xrVoice?.mesh.visible && this.voicePanelInteractive()) && !this.conceptPicker?.mesh.visible) return null;
    const pose = frame.getPose(source.targetRaySpace, this.renderer.xr.getReferenceSpace());
    if (!pose) return null;
    const matrix = new T.Matrix4().fromArray(pose.transform.matrix);
    this.raycaster.ray.origin.setFromMatrixPosition(matrix);
    this.raycaster.ray.direction.set(0, 0, -1).transformDirection(matrix);
    if(this.xrRecovery?.mesh.visible){this.xrRecovery.mesh.updateWorldMatrix(true,false);const hit=this.raycaster.intersectObject(this.xrRecovery.mesh,false)[0];if(hit&&recoveryAction(hit.uv)){hit.recoveryPanel=true;return hit;}}
    if(this.conceptPicker?.mesh.visible){this.conceptPicker.mesh.updateWorldMatrix(true,false);const hit=this.raycaster.intersectObject(this.conceptPicker.mesh,false)[0];if(hit&&this.conceptPicker.actionAt(hit.uv)){hit.conceptPanel=true;return hit;}}
    if(this.xrQuestion.mesh.visible&&this.agentQuestion){this.xrQuestion.mesh.updateWorldMatrix(true,false);const hit=this.raycaster.intersectObject(this.xrQuestion.mesh,false)[0];if(hit){hit.questionOption=questionOptionAt(hit.uv,(this.agentQuestion.options||[]).length);hit.questionPanel=true;return hit;}}
    if(this.xrVoice?.mesh.visible && this.voicePanelInteractive()){
      this.xrVoice.mesh.updateWorldMatrix(true,false);
      const hit=this.raycaster.intersectObject(this.xrVoice.mesh,false)[0];
      if(hit && this.voicePanelAction(hit.uv)){hit.voicePanel=true;return hit;}
    }
    if(!this.xrPanel.mesh.visible)return null;
    this.xrPanel.mesh.updateWorldMatrix(true, false);
    return this.raycaster.intersectObject(this.xrPanel.mesh, false)[0] ?? null;
  }
  updateXRPenTip(key,point,{visible=false,pressed=false}={}) {
    if(!this.scene)return;this.xrPenTips??=new Map();let tip=this.xrPenTips.get(key);
    if(!tip&&visible){tip=new T.Group();tip.name='XR pen tip · '+key;const core=new T.Mesh(new T.SphereGeometry(.0025,12,8),new T.MeshBasicMaterial({color:0x8cd1ff})),halo=new T.Mesh(new T.SphereGeometry(.004,12,8),new T.MeshBasicMaterial({color:0x8cd1ff,transparent:true,opacity:.22,depthWrite:false}));tip.add(core,halo);tip.renderOrder=45;this.scene.add(tip);this.xrPenTips.set(key,tip);}
    if(!tip)return;tip.visible=!!visible&&!!point&&point.length===3&&point.every(Number.isFinite);if(!tip.visible)return;tip.position.fromArray(point);const color=this.mode==='erase'?0xffbd78:pressed?0xbcf477:0x8cd1ff;for(const child of tip.children)child.material.color.setHex(color);
  }
  updateXRPointer(key, frame, source, hit) {
    let pointer = this.xrPointers.get(key);
    if (!pointer) {
      const group = new T.Group();
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.Float32BufferAttribute([0,0,0,0,0,0], 3));
      const line = new T.Line(geometry, new T.LineBasicMaterial({color: 0xaab9c9, transparent: true, opacity: 0.6, depthTest: false, depthWrite: false}));
      line.frustumCulled = false; line.renderOrder = 11;
      const dot = new T.Mesh(new T.SphereGeometry(0.005, 10, 8), new T.MeshBasicMaterial({color: 0xbcf477, depthTest: false, depthWrite: false}));
      dot.renderOrder = 12;
      group.add(line, dot); this.scene.add(group);
      this.xrPointers.set(key, pointer = {group, line, dot});
    }
    const pose = frame.getPose(source.targetRaySpace, this.renderer.xr.getReferenceSpace());
    pointer.group.visible = !!(pose||hit?.nearHandPoint) && (this.xrRecovery?.mesh.visible || this.xrPanel.mesh.visible || this.xrQuestion.mesh.visible || this.objects?.enabled || (this.xrVoice?.mesh.visible && this.voicePanelInteractive()) || this.surface?.picking || this.nativeSelection?.active || source.handedness===this.grabHand);
    if (!pointer.group.visible) return;
    const matrix = pose?new T.Matrix4().fromArray(pose.transform.matrix):new T.Matrix4();
    const origin = hit?.nearHandPoint?.clone() || new T.Vector3().setFromMatrixPosition(matrix);
    if(!hit&&this.surface?.picking)hit=this.surface.hover(new T.Ray(origin,new T.Vector3(0,0,-1).transformDirection(matrix)));
    const end = hit?.point ?? new T.Vector3(0,0,-1).transformDirection(matrix).multiplyScalar(1.5).add(origin);
    const positions = pointer.line.geometry.attributes.position;
    positions.setXYZ(0, origin.x, origin.y, origin.z); positions.setXYZ(1, end.x, end.y, end.z); positions.needsUpdate = true;
    pointer.line.material.color.set(this.xrHitAction(hit) ? 0xbcf477 : 0xaab9c9);
    pointer.dot.visible = !!hit; pointer.dot.position.copy(end);
  }
  updateXR(time, frame) {
    // The renderer applied the previous reference for this frame. Defer input
    // until the next frame after calibration to avoid mixing coordinate frames.
    if(this.updateBoardCalibration(time,frame))return;
    this.updateVoicePose(frame,time);
    this.recoveryHovered=false;
    if(this.xrMenuNeedsPlacement){this.xrMenuNeedsPlacement=false;this.setXRMenuVisible(true,frame);}
    this.objects?.beginFrame();
    const viewPose=frame.getViewerPose(this.renderer.xr.getReferenceSpace());
    if(viewPose?.transform?.matrix&&viewPose.views?.length)this.viewerView={kind:"xr-head",cameraToWorld:Array.from(viewPose.transform.matrix),projectionMatrix:Array.from(viewPose.views[0].projectionMatrix),aspect:Math.abs(viewPose.views[0].projectionMatrix[5]/viewPose.views[0].projectionMatrix[0]),recordedAt:this.store.elapsed()};
    const ref = this.renderer.xr.getReferenceSpace(),
      session = frame.session,
      seen = new Set(),
      poseLog = [],
      hovered = new Set();
    for (const source of session.inputSources) {
      const key = `${source.handedness}-${source.hand ? "hand" : "controller"}`;
      seen.add(key);
      let state = this.inputs.get(key);
      if (!state) {
        state = { pressed: false, ui: false,drawingAwaitRelease:!!this.xrDrawReleaseRequired?.has(key) };
        this.inputs.set(key, state);
      }
      let point = null,
        pressed = false,
        selectPressed = false,
        gesture = {action:null,consume:false},
        joints,grabPoint=null,grabPose=null,drawingTracked=false,drawingRelease=false;
      if (source.hand) {
        const points={};
        for(const [name,joint] of source.hand) {
          const pose=frame.getJointPose(joint,ref);
          if(pose && !pose.emulatedPosition) points[name]=pose.transform.position;
        }
        const fist=closedFist(points,!!state.fistHeld);
        if(fist===null&&state.fistHeld)state.fistNeedsOpen=true;
        if(fist===false)state.fistNeedsOpen=false;
        state.fistCandidate=fist===true;
        if(state.fistCandidate){state.fistSince??=time;state.fistSelectBlocked=true;}
        else state.fistSince=null;
        state.fistHeld=state.fistCandidate&&!state.fistNeedsOpen&&time-state.fistSince>=100;
        const wrist=source.hand.get('wrist')&&frame.getJointPose(source.hand.get('wrist'),ref);
        if(wrist&&!wrist.emulatedPosition&&state.fistCandidate){
          const palm=[points.wrist,...['index-finger','middle-finger','ring-finger','pinky-finger'].map(f=>points[f+'-phalanx-proximal'])];
          grabPoint=['x','y','z'].map(axis=>palm.reduce((n,p)=>n+p[axis],0)/palm.length);
          grabPose=new T.Matrix4().fromArray(wrist.transform.matrix).setPosition(...grabPoint);
        }
        const thumb = frame.getJointPose(source.hand.get("thumb-tip"), ref),
          index = frame.getJointPose(source.hand.get("index-finger-tip"), ref);
        const trackedTips=thumb && index && !thumb.emulatedPosition && !index.emulatedPosition;
        const tipGap=trackedTips?Math.hypot(thumb.transform.position.x-index.transform.position.x,thumb.transform.position.y-index.transform.position.y,thumb.transform.position.z-index.transform.position.z):Infinity;
        // Joint contact remains usable when Quest's select button flickers or
        // never asserts. Keep the native select signal for UI activation.
        drawingTracked=!!trackedTips;
        const wasTipPinching=!!state.tipPinching;
        state.tipPinching=tipGap < (wasTipPinching ? .032 : .022);drawingRelease=!!trackedTips&&!state.tipPinching&&!source.gamepad?.buttons[0]?.pressed;
        gesture=microgesture(source,state,time,{pinching:state.tipPinching||state.fistCandidate});
        if(state.fistCandidate){state.pendingThumbTap=null;gesture={supported:gesture.supported,action:null,consume:false};}
        state.gestureConsuming=gesture.consume;
        // A curled index can put its distal joint nearer the thumb than its
        // tip. Real fingertip contact must not be classified as a side swipe.
        gesture.consume ||= !state.fistCandidate && tipGap>=.022 && nearIndexSide(points);
        if(gesture.name) {
          this.store.log("hand.microgesture",{hand:source.handedness,name:gesture.name});
          this.updateHUD(undefined,`${source.handedness}: ${gesture.name}${gesture.action ? " / "+gesture.action : ""}`);
        }
        if(state.microSupported!==gesture.supported) {
          state.microSupported=gesture.supported;
          this.store.log("hand.microgesture-support",{hand:source.handedness,supported:gesture.supported,profiles:Array.from(source.profiles??[]),buttons:source.gamepad?.buttons.length??0});
        }
        if (trackedTips) {
          const a = thumb.transform.position, b = index.transform.position;
          selectPressed = source.handedness===this.grabHand ? !!source.gamepad?.buttons[0]?.pressed || state.tipPinching : source.gamepad?.buttons[0] ? !!source.gamepad.buttons[0].pressed : state.tipPinching;
          if(!state.fistCandidate&&!state.tipPinching&&!source.gamepad?.buttons[0]?.pressed)state.fistSelectBlocked=false;
          if(state.fistSelectBlocked)selectPressed=false;
          const drawingPinch=!state.fistSelectBlocked&&(selectPressed || state.tipPinching);
          if(gesture.consume && drawingPinch) state.waitPinchRelease=true;
          // A fresh native press also rearms after a completed microgesture;
          // an already held pinch cannot draw through the gesture or menu.
          if(!drawingPinch || !gesture.consume&&(selectPressed&&!state.selectPressed || state.tipPinching&&!wasTipPinching)) state.waitPinchRelease=false;
          pressed = drawingPinch && !gesture.consume && !state.waitPinchRelease;
          point = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
        }
        const acceptance=previewAcceptGesture(points,state,time,{available:source.handedness===this.grabHand&&!!this.liveShapes?.canAccept});state.previewAcceptFire=acceptance.fire;if(source.handedness===this.grabHand&&acceptance.held&&(this.liveShapes?.canAccept||state.previewAcceptLatched)){gesture={supported:gesture.supported,action:null,consume:true};state.gestureConsuming=true;state.pendingThumbTap=null;selectPressed=false;pressed=false;}
        if(this.tableDrawing && !this.objects?.enabled){
          const contact=index&&!index.emulatedPosition?tableContact(index.transform.position,index.radius,state.tableTouch):null;
          // Table contact supplements pinch drawing; never replaces it.
          // A tracked lift is required after alignment or tracking loss.
          if(!index || index.emulatedPosition)state.tableLifted=false;
          else if(!contact)state.tableLifted=true;
          const touching=!state.fistCandidate&&!!contact&&!!state.tableLifted&&time>this.tableReadyAt&&!gesture.consume&&!selectPressed;
          if(touching){pressed=true;point=contact;}
          state.tableTouch=touching;
        }
        if (time - this.lastPose > 33) {
          joints = {};
          for (const [name, joint] of source.hand) {
            const p = frame.getJointPose(joint, ref);
            if (p)
              joints[name] = {
                matrix: Array.from(p.transform.matrix),
                radius: p.radius,
              };
          }
        }
      } else {
        const pose = source.gripSpace
          ? frame.getPose(source.gripSpace, ref)
          : null;
        drawingTracked=!!pose;drawingRelease=!!pose&&!source.gamepad?.buttons[1]?.pressed;
        if (pose) {
          point = new T.Vector3(...this.penOffset)
            .applyMatrix4(new T.Matrix4().fromArray(pose.transform.matrix))
            .toArray();
          pressed = !!source.gamepad?.buttons[1]?.pressed;
          selectPressed = !!source.gamepad?.buttons[0]?.pressed;if(source.handedness===this.grabHand){grabPose=new T.Matrix4().fromArray(pose.transform.matrix);grabPoint=new T.Vector3().setFromMatrixPosition(grabPose).toArray();}
        }
      }
      const hit = this.xrPanelHit(frame, source);
      if(hit?.recoveryPanel)this.recoveryHovered=true;
      if(state.previewAcceptFire&&!hit&&!this.objects?.grabbing){state.previewAcceptFire=false;this.endAll();this.xrAction('shape-accept',source,'accept-gesture',frame);}
      if(this.objects?.enabled){
        const rayPose=frame.getPose(source.targetRaySpace,ref),grip=source.hand?frame.getJointPose(source.hand.get("wrist"),ref):source.gripSpace?frame.getPose(source.gripSpace,ref):null;
        const matrix=grip?new T.Matrix4().fromArray(grip.transform.matrix):null;
        if(matrix&&source.hand&&grabPoint)matrix.setPosition(...grabPoint);
        const rm=rayPose?new T.Matrix4().fromArray(rayPose.transform.matrix):null;
        this.objects.input({key,point,pose:matrix,ray:rm?new T.Ray(new T.Vector3().setFromMatrixPosition(rm),new T.Vector3(0,0,-1).transformDirection(rm)):null,pressed:source.hand?!!state.fistHeld:pressed,selectPressed,handFist:!!source.hand,time,blocked:!!hit&&selectPressed||gesture.consume||state.ui});
      }
      const action = this.xrHitAction(hit);
      this.updateXRPointer(key, frame, source, hit);
      if (action) hovered.add(action);
      const menuPressed=!source.hand&&!!source.gamepad?.buttons[3]?.pressed;
      const menuShortcut=menuPressed&&!state.menuHeld?'menu-recover':null;state.menuHeld=menuPressed;
      let shortcut = menuShortcut || (source.hand ? gesture.action : this.objects?.enabled&&!(source.handedness===this.drawHand&&this.liveShapes?.candidate) ? null : historyShortcut(source.gamepad, state));
      if(!source.hand&&source.handedness===this.drawHand&&shortcut==='undo'&&this.liveShapes?.candidate)shortcut='shape-accept';
      if (shortcut) {
        this.end(key);
        state.suppressed = pressed;
        this.xrAction(shortcut, source, source.hand ? "native-microgesture" : "shortcut", frame);
      }
      // Front trigger selects UI; the lower grip draws. Hands use pinch for
      // both; microgesture input is reserved only while its pulse/contact is active.
      if (selectPressed && !state.selectPressed && !state.gestureConsuming && hit && !state.ui) {
        state.ui = true;
        if (action) this.xrAction(action, source, "panel", frame);
      }
      // The grab hand selects geometry while the draw hand keeps the Pen.
      // UI and explicit surface picking take priority over ordinary selection.
      if(source.handedness===this.grabHand&&!this.objects?.enabled){
        const pose=frame.getPose(source.targetRaySpace,ref),rm=pose&&new T.Matrix4().fromArray(pose.transform.matrix),ray=rm&&new T.Ray(new T.Vector3().setFromMatrixPosition(rm),new T.Vector3(0,0,-1).transformDirection(rm));
        if(this.surface?.picking){if(selectPressed&&!state.selectPressed&&!state.ui&&!gesture.consume&&!hit&&ray){this.surface.pick(ray);state.ui=true;this.end(key);}}
        else if(this.objects?.pinchSelect)this.objects.pinchSelect({key,point,ray,pressed:selectPressed,blocked:!!hit||gesture.consume||state.ui||!!state.fistCandidate,time});else if(selectPressed&&!state.selectPressed&&!state.ui&&!gesture.consume&&!hit&&ray){this.nativeSelection?.pickXR?.(ray);state.ui=true;this.end(key);}
      }
      // Pinch selects body/face/edge. A deliberate fist moves the exact
      // body from the wrist pose, without a jump as the fingers close/open.
      if(source.handedness===this.grabHand&&(source.hand?state.fistHeld:pressed)&&!state.objectGrab&&time>=(state.nextGrabAttempt||0)&&!state.ui&&!(hit&&selectPressed)&&!gesture.consume&&!this.objects?.enabled&&!this.surface?.picking){
        state.nextGrabAttempt=time+150;if(grabPose)state.objectGrab=!!this.objects?.startXRGrab?.(key,grabPose);
      }
      if(state.objectGrab){
        const held=source.hand?!!state.fistHeld:pressed;
        this.objects?.directInput?.({key,pose:grabPose,time,pressed:held,blocked:!!hit&&selectPressed||gesture.consume});
        if(!held||!grabPoint||hit&&selectPressed||gesture.consume)state.objectGrab=false;
      }
      state.wasFistHeld=!!state.fistHeld;state.wasGrabGrip=!source.hand&&pressed;
      const wasBlocked=!!state.drawingAwaitRelease,attention=drawingAttentionGate(state,{point,viewerMatrix:viewPose?.transform?.matrix,projectionMatrix:viewPose?.views?.[0]?.projectionMatrix,pressed,trackingValid:drawingTracked,releaseObserved:drawingRelease}),drawingVisible=attention.visible;
      if(source.handedness===this.drawHand&&pressed&&attention.blocked&&!wasBlocked)this.store.log('gesture.ignored',{reason:'draw hand outside focused view or tracking lost; release before drawing',hand:source.handedness,point});
      if(source.handedness===this.drawHand){if(attention.blocked)(this.xrDrawReleaseRequired||=new Set()).add(key);else if(drawingRelease)this.xrDrawReleaseRequired?.delete(key);}
      pressed=attention.pressed&&source.handedness===this.drawHand;
      const penPoint=point&&this.surface?.selected?this.surface.project(point):point;
      this.updateXRPenTip(key,penPoint,{visible:source.handedness===this.drawHand&&drawingVisible&&!hit&&!state.ui&&!gesture.consume&&!this.objects?.enabled&&!this.surface?.picking&&this.workspaceMode!=='cad',pressed});
      const historyHeld = !source.hand && (state.menuHeld || state.undoHeld || state.redoHeld || state.stickLatched);
      if (gesture.consume || historyHeld || state.ui || (!source.hand && selectPressed)) {
        this.end(key);
        if(pressed) state.suppressed=true;
      }
      if (pressed && !state.pressed && !state.suppressed && !state.ui && !hit) {
        if(point) this.begin(key,point);
      } else if (pressed && point && !state.ui && !state.suppressed && !gesture.consume) this.sample(key,point);
      if (!pressed) {
        this.end(key);
        state.suppressed = false;
      }
      if (!selectPressed) state.ui=false;
      state.selectPressed=selectPressed;
      state.pressed = pressed;
      if (time - this.lastPose > 33) {
        const grip = source.gripSpace
          ? frame.getPose(source.gripSpace, ref)
          : null;
        poseLog.push({
          key,
          profiles: Array.from(source.profiles??[]),
          point,
          pressed,
          selectPressed,
          microgesture: gesture.name,
          gestureGuard: gesture.consume,
          fist:!!state.fistHeld,
          fistCandidate:!!state.fistCandidate,
          drawingVisible,
          drawingAwaitRelease:!!state.drawingAwaitRelease,
          grip: grip ? Array.from(grip.transform.matrix) : null,
          joints,
          buttons: source.gamepad
            ? source.gamepad.buttons.map((b) => ({
                pressed: b.pressed,
                touched: b.touched,
                value: b.value,
              }))
            : [],
          axes: source.gamepad ? Array.from(source.gamepad.axes) : [],
          hover: action,
        });
      }
    }
    this.objects?.endFrame();
    for (const key of this.inputs.keys())
      if (!seen.has(key)) {
        if(key.startsWith(this.drawHand+'-'))(this.xrDrawReleaseRequired||=new Set()).add(key);
        this.end(key);
        this.inputs.delete(key);this.updateXRPenTip(key,null);
        const pointer = this.xrPointers.get(key);
        if (pointer) pointer.group.visible = false;
      }
    if ([...hovered].sort().join() !== [...this.xrHovered].sort().join()) {
      this.xrHovered = hovered;
      this.updateHUD();
    }
    if (time - this.lastPose > 33) {
      const viewer = frame.getViewerPose(ref);
      this.store.log("xr.pose", {
        head: viewer ? Array.from(viewer.transform.matrix) : null,
        inputs: poseLog,
        referenceSpace: "local-floor",
      });
      this.lastPose = time;
    }
  }
  setWorkspaceMode(mode) {
    this.endAll();this.workspaceMode=mode;
    this.setMode(mode==="cad"?"orbit":"draw");
    this.drawing.visible=mode!=="cad";
    if(this.review)this.review.visible=mode!=="cad";
    this.reviewStage.visible=mode!=="cad" && !!this.review;
    if(this.cadObject)this.cadObject.visible=mode==="cad";
    this.updateHUD();this.onChange();
  }
  setCADMesh(mesh) {
    if(this.cadObject){this.scene.remove(this.cadObject);dispose(this.cadObject);this.cadObject=null;}
    if(!mesh?.vertices.length)return;
    const geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.Float32BufferAttribute(mesh.vertices.flat(),3));geometry.setIndex(mesh.triangles.flat());geometry.computeVertexNormals();geometry.computeBoundingBox();
    const bounds=geometry.boundingBox,center=bounds.getCenter(new T.Vector3());
    const object=new T.Mesh(geometry,new T.MeshStandardMaterial({color:0xbcf477,roughness:.4,metalness:.15}));
    object.position.set(-center.x,.72-bounds.min.y,-.6-center.z);object.visible=this.workspaceMode==="cad";
    this.scene.add(object);this.cadObject=object;
    if(!this.renderer.xr.isPresenting && this.workspaceMode==="cad") {
      const target=new T.Vector3(0,.72+(bounds.max.y-bounds.min.y)/2,-.6);
      const distance=Math.max(.4,bounds.getSize(new T.Vector3()).length()*2);
      this.controls.target.copy(target);this.camera.position.copy(target).add(new T.Vector3(.6,.4,1).normalize().multiplyScalar(distance));this.controls.update();
    }
  }
  setReview(mesh) {
    if (this.review) {
      this.scene.remove(this.review);
      dispose(this.review);
      this.review = null;
    }
    this.reviewStage.visible = false;
    if (!mesh?.vertices.length) return;
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(mesh.vertices.flat(), 3),
    );
    let object;
    if (mesh.triangles.length) {
      geometry.setIndex(mesh.triangles.flat());
      geometry.computeVertexNormals();
      object = new T.Mesh(
        geometry,
        new T.MeshStandardMaterial({
          color: 0x93bce9,
          roughness: 0.46,
          metalness: 0.12,
          side: T.DoubleSide,
        }),
      );
    } else
      object = new T.Points(
        geometry,
        new T.PointsMaterial({ color: 0x93bce9, size: 0.006 }),
      );
    geometry.computeBoundingBox();
    const box = geometry.boundingBox,
      center = box.getCenter(new T.Vector3());
    object.position.set(0.95 - center.x, 0.72 - box.min.y, -0.6 - center.z);
    this.review = object;
    this.scene.add(object);
    this.reviewStage.visible = true;
    this.store.log("review.placed", { translation: object.position.toArray() });
    if (!this.renderer.xr.isPresenting) {
      const bounds = new T.Box3().setFromObject(object);
      for (const s of this.store.session.strokes)
        for (const p of s.points) bounds.expandByPoint(new T.Vector3(...p));
      const target = bounds.getCenter(new T.Vector3()),
        size = bounds.getSize(new T.Vector3());
      const distance =
        (Math.max(size.y, size.x / this.camera.aspect) * 0.75) /
          Math.tan(T.MathUtils.degToRad(this.camera.fov / 2)) +
        size.z;
      this.controls.target.copy(target);
      this.camera.position
        .copy(target)
        .add(
          new T.Vector3(0.25, 0.3, 1)
            .normalize()
            .multiplyScalar(Math.max(distance, 1.8)),
        );
      this.controls.update();
    }
  }
  demo() {
    this.setMode("draw");
    this.clear();
    const c = [0, 1.22, -0.6];
    for (let ring = 0; ring < 9; ring++) {
      const latitude = (ring / 8 - 0.5) * Math.PI * 0.9,
        r = Math.cos(latitude) * 0.26,
        y = c[1] + Math.sin(latitude) * 0.3;
      for (let j = 0; j <= 100; j++) {
        const a = (j / 100) * Math.PI * 2,
          p = [c[0] + Math.cos(a) * r, y, c[2] + Math.sin(a) * r];
        if (!j) this.begin("demo", p);
        else this.sample("demo", p);
      }
      this.end("demo");
    }
    for (let ring = 0; ring < 6; ring++) {
      for (let j = 0; j <= 100; j++) {
        const a = (j / 100) * Math.PI * 2,
          b = (ring / 6) * Math.PI,
          p = [
            c[0] + Math.cos(a) * Math.cos(b) * 0.26,
            c[1] + Math.sin(a) * 0.3,
            c[2] + Math.cos(a) * Math.sin(b) * 0.26,
          ];
        if (!j) this.begin("demo", p);
        else this.sample("demo", p);
      }
      this.end("demo");
    }
    this.store.log("demo.loaded");
  }
}
