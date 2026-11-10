import {strokeAliases,strokeLabel,strokeColor} from "./stroke-variables.js";
import * as T from "three";
import {
  sketchReference,
  publicReference,
  makePlan,
  comparePlan,
  planMatrix,
  worldPoint,
  nativePoint,
  alignmentMatrix,
} from "./sketch-reference.js";
const VIEWS = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0],
  perspective: [1, 0.7, 1],
};
export function initSketchTools({
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
}) {
  const overlay = new T.Group();
  overlay.name = "Agent proposed build region";
  studio.scene.add(overlay);
  let plan = store.session.placementPlan || null;
  const section = document.createElement("section");
  section.innerHTML =
    '<h3>Sketch reference and placement</h3><button id="agent-sketch-fit">View sketch</button><button id="agent-plan-sketch">Preview sketch region</button><button id="agent-align-sketch">Fit selected model to region</button><button id="agent-hide-region">Hide region</button><p id="agent-plan-status" role="status">No build region proposed yet.</p>';
  panel.querySelector("#agent-transform").before(section);
  const status = section.querySelector("#agent-plan-status");
  function reference(ids) {
    return sketchReference(ids?store.session.strokes:store.session.strokes.filter(s=>!s.hidden), ids);
  }
  function currentPlan(id) {
    if (!plan || plan.id !== id)
      throw Error("Placement plan not found; propose a build region first");
    return plan;
  }
  function release(object) {
    object.traverse((o) => {
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose();
    });
  }
  function drawBox(p, root, color = 0xffd27b) {
    const wire = new T.LineSegments(
      new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)),
      new T.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    wire.matrix.copy(planMatrix(p));
    wire.matrixAutoUpdate = false;
    wire.renderOrder = 100;
    root.add(wire);
    const axes = new T.AxesHelper(Math.max(...p.size) * 0.3);
    axes.position.fromArray(worldPoint(p, [0, 0, 0]));
    axes.quaternion.setFromEuler(new T.Euler(...p.rotationDeg.map(T.MathUtils.degToRad)));
    root.add(axes);
  }
  function drawPlan() {
    for (const child of [...overlay.children]) {
      overlay.remove(child);
      release(child);
    }
    if (plan) {
      drawBox(plan, overlay);
      overlay.visible = true;
      status.textContent = `Region centre: ${plan.center.map((n) => n.toFixed(3)).join(", ")} m\nSize: ${plan.size.map((n) => n.toFixed(3)).join(" × ")} m`;
    }
  }
  drawPlan();
  function focusSketch() {
    const r = reference();
    const radius = Math.max(0.05, Math.hypot(...r.bounds.size));
    const center = new T.Vector3(...r.bounds.center);
    viewCamera.position.copy(center).add(new T.Vector3(radius, radius * 0.7, radius));
    controls.target.copy(center);
    controls.update();
  }
  async function propose(args = {}) {
    const r = reference(args.strokeIds);
    plan = makePlan(r, args);
    store.session.placementPlan = plan;
    store.log("agent.placement.proposed", plan);
    drawPlan();
    await store.flush();
    return { plan, comparison: comparePlan(r, plan), reference: publicReference(r) };
  }
  function selected(ids) {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
      throw Error("Select unique model IDs");
    return ids.map((id) => {
      const m = models.get(id);
      if (!m) throw Error("Model no longer exists: " + id);
      return m;
    });
  }
  function modelBox(items) {
    const box = new T.Box3();
    for (const m of items) {
      apply(m);
      box.expandByObject(m.mesh, true);
    }
    return box;
  }
  function compare(args) {
    const p = currentPlan(args.planId),
      missingStrokeIds = p.strokeIds.filter(
        (id) => !store.session.strokes.some((s) => s.id === id),
      ),
      data = {
        plan: p,
        sketch: missingStrokeIds.length
          ? {
              stale: true,
              missingStrokeIds,
              note: "Planned strokes were removed; inspect the drawing and propose a new region.",
            }
          : comparePlan(reference(p.strokeIds), p),
      };
    if (args.modelIds) {
      const box = modelBox(selected(args.modelIds)),
        center = box.getCenter(new T.Vector3()),
        size = box.getSize(new T.Vector3());
      data.model = {
        bounds: {
          min: box.min.toArray(),
          max: box.max.toArray(),
          center: center.toArray(),
          size: size.toArray(),
        },
        centerErrorMetres: center.distanceTo(new T.Vector3(...p.center)),
        note: "Bounds comparison only; inspect overlay views to judge the shape.",
      };
    }
    return data;
  }
  async function align(args) {
    await refresh();
    const p = currentPlan(args.planId),
      r = reference(p.strokeIds);
    if (r.revision !== p.sketchRevision)
      throw Error(
        "Sketch changed since the region was proposed; inspect and re-plan before aligning",
      );
    const items = selected(args.modelIds);
    if (!args.expectedVersions || items.some((m) => args.expectedVersions[m.id] !== m.version))
      throw Error("Model version conflict; read scene_models again");
    const before = items.map((m) => ({
      id: m.id,
      position: [...m.position],
      rotationDeg: [...m.rotationDeg],
      scale: [...m.scale],
    }));
    const matrix = alignmentMatrix(modelBox(items), p);
    for (const m of items) {
      const next = matrix.clone().multiply(m.mesh.matrixWorld),
        position = new T.Vector3(),
        q = new T.Quaternion(),
        scale = new T.Vector3();
      next.decompose(position, q, scale);
      m.position = position.toArray();
      m.rotationDeg = new T.Euler()
        .setFromQuaternion(q)
        .toArray()
        .slice(0, 3)
        .map(T.MathUtils.radToDeg);
      m.scale = scale.toArray();
      m.version++;
      apply(m);
    }
    await persist();
    store.log("agent.placement.applied", { planId: p.id, modelIds: args.modelIds, before });
    return {
      ...compare(args),
      models: items.map((m) => ({
        id: m.id,
        version: m.version,
        position: m.position,
        rotationDeg: m.rotationDeg,
        scale: m.scale,
      })),
      scope:
        "Shared scene placement. Native authoring geometry is unchanged; transfer bakes placement into a mesh copy.",
    };
  }
  function label(ctx, camera, point, text, color, width, height, slot = 0) {
    const v = new T.Vector3(...point).project(camera);
    if (v.z < -1 || v.z > 1) return;
    const x = ((v.x + 1) * width) / 2,
      y = ((1 - v.y) * height) / 2;
    ctx.font = `bold ${Math.max(10, Math.min(14, width / 40))}px sans-serif`;
    const w = ctx.measureText(text).width + 10,
      occupied = (ctx.referenceLabels ??= []);
    let tx = Math.max(8, Math.min(width - w - 8, x + 12)),
      ty = Math.max(58, Math.min(height - 18, y + slot * 22)),
      found = false;
    for (let step = 0; step < height / 22 && !found; step++)
      for (const direction of [1, -1]) {
        const candidate = Math.max(58, Math.min(height - 18, ty + step * 22 * direction));
        if (
          !occupied.some(
            (r) =>
              tx < r.x + r.w && tx + w > r.x && candidate - 16 < r.y + 21 && candidate + 5 > r.y,
          )
        ) {
          ty = candidate;
          found = true;
          break;
        }
      }
    occupied.push({ x: tx - 4, y: ty - 16, w: w + 8 });
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty - 6);
    ctx.stroke();
    ctx.fillStyle = "#0b1322ed";
    ctx.fillRect(tx - 4, ty - 15, w, 20);
    ctx.fillStyle = color;
    ctx.fillText(text, tx, ty);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  async function views({
    strokeIds,
    views = ["front", "right", "top", "perspective"],
    colorMode = "stroke",
    planId,
    modelIds,
    width = 768,
    height = 768,
  } = {}) {
    if (
      !Array.isArray(views) ||
      !views.length ||
      views.length > 6 ||
      views.some((v) => !Object.hasOwn(VIEWS, v))
    )
      throw Error("Choose 1–6 named views");
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 256 ||
      height < 256 ||
      width > 1024 ||
      height > 1024
    )
      throw Error("Reference frames must be 256–1024 pixels per side");
    await refresh();
    const p = planId ? currentPlan(planId) : null;
    if (
      p &&
      strokeIds &&
      JSON.stringify([...strokeIds].sort()) !== JSON.stringify([...p.strokeIds].sort())
    )
      throw Error("Plan and capture refer to different strokes");
    if (!["stroke","original"].includes(colorMode)) throw Error("Invalid stroke color mode");
    const aliases=strokeAliases(store.session);
    const r = reference(strokeIds || p?.strokeIds),
      scene = new T.Scene();
    scene.background = new T.Color("#101923");
    scene.add(new T.HemisphereLight(0xffffff, 0x334455, 2.4));
    const light = new T.DirectionalLight(0xffffff, 2);
    light.position.set(2, 4, 3);
    scene.add(light);
    const box = new T.Box3(new T.Vector3(...r.bounds.min), new T.Vector3(...r.bounds.max));
    for (const id of r.strokeIds) {
      const original = studio.strokeMeshes.get(id);
      if (!original) throw Error("Sketch rendering is not ready");
      original.updateWorldMatrix(true, false);
      const mesh = new T.Mesh(original.geometry.clone(), original.material.clone());
      if(colorMode === "stroke") mesh.material.color.set(strokeColor(store.session.strokes,id,aliases));
      mesh.matrix.copy(original.matrixWorld);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    const referencePlan = {
      center: r.bounds.center,
      size: r.bounds.size.map((v) => Math.max(0.001, v)),
      rotationDeg: [0, 0, 0],
    };
    drawBox(referencePlan, scene, 0x8dccff);
    if (p) {
      drawBox(p, scene);
      for (let x = 0; x <= 1; x++)
        for (let y = 0; y <= 1; y++)
          for (let z = 0; z <= 1; z++)
            box.expandByPoint(new T.Vector3(...worldPoint(p, [x, y, z])));
    }
    if (modelIds)
      for (const m of selected(modelIds)) {
        apply(m);
        const mesh = new T.Mesh(
          m.mesh.geometry.clone(),
          new T.MeshStandardMaterial({
            color: 0xffbe70,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            side: T.DoubleSide,
          }),
        );
        mesh.matrix.copy(m.mesh.matrixWorld);
        mesh.matrixAutoUpdate = false;
        scene.add(mesh);
        box.union(new T.Box3().setFromObject(m.mesh, true));
      }
    const center = box.getCenter(new T.Vector3()),
      aspect = width / height,
      radius =
        Math.max(0.02, box.getSize(new T.Vector3()).length() / 2) * 1.45 * Math.max(1, 1 / aspect),
      frames = [];
    try {
      for (const name of views) {
        const cam = new T.OrthographicCamera(
          -radius * aspect,
          radius * aspect,
          radius,
          -radius,
          0.001,
          radius * 10 + 1,
        );
        cam.position
          .copy(center)
          .add(new T.Vector3(...VIEWS[name]).normalize().multiplyScalar(radius * 3));
        if (name === "top") cam.up.set(0, 0, -1);
        cam.lookAt(center);
        cam.updateMatrixWorld(true);
        renderer.setSize(width, height, false);
        renderer.render(scene, cam);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(renderer.domElement, 0, 0);
        ctx.fillStyle = "#07101de8";
        ctx.fillRect(0, 0, width, 40);
        ctx.fillStyle = "#f1f7ff";
        ctx.font = "bold 15px sans-serif";
        ctx.fillText(`${name.toUpperCase()} · metres · world XYZ / Y up`, 12, 25);
        for (const id of r.strokeIds) {
          const stroke=store.session.strokes.find(s=>s.id===id);
          label(ctx,cam,stroke.points[Math.floor(stroke.points.length/2)],strokeLabel(store.session.strokes,id,aliases),strokeColor(store.session.strokes,id,aliases),width,height);
        }
        let slot = 0;
        for (const e of Object.values(r.extrema)) {
          label(
            ctx,
            cam,
            e.position,
            `${e.label} (${e.position.map((n) => n.toFixed(3)).join(", ")})`,
            "#9ad7ff",
            width,
            height,
            (slot++ % 3) - 1,
          );
        }
        if (p) {
          label(ctx, cam, worldPoint(p, [0, 0, 0]), "BUILD ORIGIN", "#ffd27b", width, height);
          for (const [name, point, color] of [
            ["X", [1, 0, 0], "#ff9988"],
            ["Y", [0, 1, 0], "#aaff99"],
            ["Z", [0, 0, 1], "#99bbff"],
          ])
            label(ctx, cam, worldPoint(p, point), "BUILD +" + name, color, width, height);
        }
        const image = canvas.toDataURL("image/png"),
          asset = `agent/sketch/${Date.now()}-${crypto.randomUUID()}-${name}.png`;
        const metadata = {
          view: name,
          projection: "orthographic",
          units: "metres",
          up: cam.up.toArray(),
          width,
          height,
          cameraToWorld: cam.matrixWorld.toArray(),
          projectionMatrix: cam.projectionMatrix.toArray(),
          sketchRevision: r.revision,
          colorMode,
          strokes:r.strokeIds.map(id=>({id,variable:strokeLabel(store.session.strokes,id,aliases),color:colorMode==="stroke"?strokeColor(store.session.strokes,id,aliases):store.session.strokes.find(s=>s.id===id).color})),
        };
        await store.asset(asset, await (await fetch(image)).blob(), {
          kind: "agent-sketch-reference",
          ...metadata,
        });
        frames.push({ image, asset, ...metadata });
      }
    } finally {
      renderer.setSize(320, 240);
      release(scene);
    }
    const comparison = p ? comparePlan(r, p) : undefined;
    store.log("agent.sketch.views", { sketchRevision: r.revision, views, planId, modelIds });
    return {
      reference: publicReference(r),
      plan: p,
      comparison,
      frames,
      legend:
        "Blue labels and box: sketch extrema. Gold box: proposed build region. Translucent gold: selected model geometry. Stroke geometry is frozen consistently across these frames.",
    };
  }
  section.querySelector("#agent-sketch-fit").onclick = () => {
    try {
      focusSketch();
    } catch (e) {
      report(e);
    }
  };
  section.querySelector("#agent-plan-sketch").onclick = () =>
    propose().then(focusSketch).catch(report);
  section.querySelector("#agent-hide-region").onclick = () => (overlay.visible = false);
  section.querySelector("#agent-align-sketch").onclick = async () => {
    try {
      const id = panel.querySelector("#agent-models").value;
      if (!plan) await propose();
      const m = models.get(id);
      if (!m) throw Error("Select a model first");
      await align({ planId: plan.id, modelIds: [id], expectedVersions: { [id]: m.version } });
    } catch (e) {
      report(e);
    }
  };
  return {
    names: [
      "sketch_analyze",
      "sketch_views",
      "placement_plan",
      "placement_compare",
      "placement_points",
      "model_align_to_sketch",
    ],
    summary() {
      try {
        return { reference: publicReference(reference()), plan };
      } catch {
        return { reference: null, plan };
      }
    },
    async dispatch(tool, a) {
      switch (tool) {
        case "sketch_analyze":
          return publicReference(reference(a.strokeIds));
        case "sketch_views":
          return views(a);
        case "placement_plan":
          return propose(a);
        case "placement_compare":
          await refresh();
          return compare(a);
        case "placement_points": {
          const p = currentPlan(a.planId);
          if (reference(p.strokeIds).revision !== p.sketchRevision)
            throw Error("Sketch changed; inspect and re-plan before mapping construction points");
          if (!Array.isArray(a.points) || !a.points.length || a.points.length > 128)
            throw Error("Provide 1–128 points");
          return {
            planId: p.id,
            points: a.points.map((point) => ({
              normalized: point,
              ...nativePoint(worldPoint(p, point)),
            })),
          };
        }
        case "model_align_to_sketch":
          return align(a);
      }
    },
  };
}
