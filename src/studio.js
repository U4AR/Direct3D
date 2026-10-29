import * as T from "three";
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
  constructor(container, store, onChange, onAction) {
    Object.assign(this, { container, store, onChange, onAction });
    this.active = new Map();
    this.redoStack = [];
    this.color = "#bcf477";
    this.radius = 0.004;
    this.mode = "draw";
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
    this.bindPointer();
    this.setupXR();
    for (const s of store.session.strokes) this.addStrokeMesh(s);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop((time, frame) => {
      if (frame) this.updateXR(time, frame);
      else this.controls.update();
      this.renderer.render(this.scene, this.camera);
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
    this.drawing.add(mesh);
    this.strokeMeshes.set(s.id, mesh);
    return mesh;
  }
  begin(key, point) {
    if (this.active.has(key)) return;
    this.redoStack = [];
    const stroke = {
      id: crypto.randomUUID(),
      color: this.color,
      radius: this.radius,
      input: key,
      points: [],
      times: [],
      started: this.store.elapsed(),
    };
    this.store.session.strokes.push(stroke);
    const mesh = this.addStrokeMesh(stroke);
    this.active.set(key, { stroke, mesh });
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
    a.stroke.ended = this.store.elapsed();
    this.store.log("stroke.end", { id: a.stroke.id });
    if (a.stroke.points.length < 2) {
      this.store.session.strokes = this.store.session.strokes.filter(
        (s) => s.id !== a.stroke.id,
      );
      this.drawing.remove(a.mesh);
      dispose(a.mesh);
      this.strokeMeshes.delete(a.stroke.id);
    }
    this.onChange();
    this.store.flush().catch(() => {});
  }
  endAll() {
    for (const key of [...this.active.keys()]) this.end(key);
  }
  setMode(mode) {
    this.endAll();
    this.mode = mode;
    this.controls.enabled = mode === "orbit";
    this.renderer.domElement.style.cursor =
      mode === "draw" ? "crosshair" : "grab";
    this.store.log("tool.mode", { mode });
  }
  undo() {
    this.endAll();
    const s = this.store.session.strokes.pop();
    if (!s) return;
    this.redoStack.push(s);
    const mesh = this.strokeMeshes.get(s.id);
    this.drawing.remove(mesh);
    dispose(mesh);
    this.strokeMeshes.delete(s.id);
    this.store.session.revision++;
    this.store.log("stroke.undo", { id: s.id });
    this.onChange();
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.store.session.strokes.push(s);
    this.addStrokeMesh(s);
    this.store.session.revision++;
    this.store.log("stroke.redo", { id: s.id });
    this.onChange();
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
      this.plane.constant = -this.planeZ;
      const p = this.raycaster.ray.intersectPlane(this.plane, new T.Vector3());
      return p?.toArray();
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (
        this.mode !== "draw" ||
        e.button !== 0 ||
        this.renderer.xr.isPresenting
      )
        return;
      const p = point(e);
      if (!p) return;
      canvas.setPointerCapture(e.pointerId);
      this.begin("pointer", p);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.mode !== "draw") return;
      const p = point(e);
      if (p) {
        this.cursor.visible = true;
        this.cursor.position.fromArray(p);
        this.sample("pointer", p);
      }
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
    this.xrPanel = canvasPanel(720, 450);
    this.xrPanel.mesh.position.set(-0.85, 1.55, -1.1);
    this.xrPanel.mesh.rotation.y = 0.25;
    this.xrPanel.mesh.visible = false;
    this.scene.add(this.xrPanel.mesh);
    this.xrText =
      "Describe your object. Enable microphone to transcribe locally.";
    this.xrStatus = "Pinch to draw · trigger draws from bottom of grip";
    this.updateHUD();
    this.renderer.xr.addEventListener("sessionstart", () => {
      this.xrPanel.mesh.visible = true;
      this.cursor.visible = false;
      this.store.log("xr.start");
      this.onAction("xr-start");
    });
    this.renderer.xr.addEventListener("sessionend", () => {
      this.endAll();
      this.inputs.clear();
      this.xrPanel.mesh.visible = false;
      this.store.log("xr.end");
      this.onAction("xr-end");
    });
  }
  updateHUD(text = this.xrText, status = this.xrStatus) {
    this.xrText = text;
    this.xrStatus = status;
    const { canvas, texture } = this.xrPanel,
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "#18212d";
    ctx.fillRect(0, 0, 720, 450);
    ctx.fillStyle = "#bcf477";
    ctx.font = "bold 32px sans-serif";
    ctx.fillText("DRAW3D  /  SPATIAL STUDIO", 28, 48);
    ctx.font = "22px sans-serif";
    ctx.fillStyle = "#e6ecf2";
    const words = text.slice(-330).split(" ");
    let line = "",
      y = 100;
    for (const word of words) {
      if (ctx.measureText(line + word).width > 650) {
        ctx.fillText(line, 28, y);
        line = "";
        y += 32;
        if (y > 250) break;
      }
      line += word + " ";
    }
    ctx.fillText(line, 28, y);
    ctx.fillStyle = "#aab9c9";
    ctx.font = "18px sans-serif";
    ctx.fillText(status.slice(0, 75), 28, 294);
    ["Undo", "Capture", "Rebuild", "Mic"].forEach((label, i) => {
      ctx.fillStyle = "#344357";
      ctx.fillRect(22 + i * 175, 326, 157, 76);
      ctx.fillStyle = "#fff";
      ctx.font = "24px sans-serif";
      ctx.fillText(label, 38 + i * 175, 373);
    });
    ctx.font = "17px sans-serif";
    ctx.fillStyle = "#aab9c9";
    ctx.fillText("Point at a button and pinch / press trigger", 28, 431);
    texture.needsUpdate = true;
  }
  async enterVR() {
    if (!navigator.xr)
      throw new Error(
        "WebXR is unavailable. Open this app in Quest Browser over HTTPS.",
      );
    if (!(await navigator.xr.isSessionSupported("immersive-vr")))
      throw new Error("No immersive VR headset is available in this browser.");
    this.endAll();
    const session = await navigator.xr.requestSession("immersive-vr", {
      requiredFeatures: ["local-floor"],
      optionalFeatures: ["hand-tracking"],
    });
    await this.renderer.xr.setSession(session);
  }
  updateXR(time, frame) {
    const ref = this.renderer.xr.getReferenceSpace(),
      session = frame.session,
      seen = new Set(),
      poseLog = [];
    for (const source of session.inputSources) {
      const key = `${source.handedness}-${source.hand ? "hand" : "controller"}`;
      seen.add(key);
      let state = this.inputs.get(key);
      if (!state) {
        state = { pressed: false, ui: false };
        this.inputs.set(key, state);
      }
      let point = null,
        pressed = false,
        joints;
      if (source.hand) {
        const thumb = frame.getJointPose(source.hand.get("thumb-tip"), ref),
          index = frame.getJointPose(source.hand.get("index-finger-tip"), ref);
        if (thumb && index) {
          const a = thumb.transform.position,
            b = index.transform.position,
            d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
          pressed = d < (state.pressed ? 0.032 : 0.022);
          point = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
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
        if (pose) {
          point = new T.Vector3(...this.penOffset)
            .applyMatrix4(new T.Matrix4().fromArray(pose.transform.matrix))
            .toArray();
          pressed = !!source.gamepad?.buttons[0]?.pressed;
        }
      }
      if (pressed && !state.pressed) {
        const ray = frame.getPose(source.targetRaySpace, ref);
        if (ray) {
          const m = new T.Matrix4().fromArray(ray.transform.matrix);
          this.raycaster.ray.origin.setFromMatrixPosition(m);
          this.raycaster.ray.direction.set(0, 0, -1).transformDirection(m);
          const hit = this.raycaster.intersectObject(this.xrPanel.mesh)[0];
          if (hit && hit.uv.y > 1 - 402 / 450 && hit.uv.y < 1 - 326 / 450) {
            const i = Math.floor((hit.uv.x * 720 - 22) / 175);
            if (i >= 0 && i < 4) {
              state.ui = true;
              this.onAction(["undo", "capture", "reconstruct", "mic"][i]);
            }
          }
        }
        if (!state.ui && point) this.begin(key, point);
      } else if (pressed && point && !state.ui) this.sample(key, point);
      if (!pressed) {
        this.end(key);
        state.ui = false;
      }
      state.pressed = pressed;
      if (time - this.lastPose > 33) {
        const grip = source.gripSpace
          ? frame.getPose(source.gripSpace, ref)
          : null;
        poseLog.push({
          key,
          point,
          pressed,
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
        });
      }
    }
    for (const key of this.inputs.keys())
      if (!seen.has(key)) {
        this.end(key);
        this.inputs.delete(key);
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
