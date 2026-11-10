import {drawTracePreview} from "./trace-preview.js";
import { meshPath } from "./path-mesh.js";
import { meshProjection } from "./projection-mesh.js";
import { initReferencePlanes } from "./reference-planes.js";
import * as T from "three";
import { drawingView, projectStrokes, traceProjection } from "./sketch-projection.js";
import { sketchReference, validVector } from "./sketch-reference.js";
import { cadDiagnostics } from "./cad-diagnostics.js";
export function initProjectionTools({
  studio,
  store,
  models,
  renderer,
  refresh,
  ensure,
  settled,
  panel,
  report,
}) {
  const projections = new Map();
  const planes = initReferencePlanes({ studio, store, panel, report });
  const section = document.createElement("section");
  section.innerHTML =
    '<h3>Completed drawings</h3><button id="restore-drawings">Show completed drawings</button><p>Agents hide only the strokes used for a completed request. Recordings remain saved.</p>';
  panel.append(section);
  section.querySelector("button").onclick = () =>
    visibility({
      strokeIds: store.session.strokes.filter((s) => s.hidden).map((s) => s.id),
      visible: true,
    }).catch(report);
  function strokes(ids) {
    return ids ? store.session.strokes : store.session.strokes.filter((s) => !s.hidden);
  }
  function view(a) {
    if (a.source === "custom") {
      const c = a.camera;
      if (
        !c ||
        !validVector(c.position) ||
        !validVector(c.target) ||
        !validVector(c.up || [0, 1, 0]) ||
        new T.Vector3(...c.position).distanceTo(new T.Vector3(...c.target)) < 1e-6
      )
        throw Error("Custom view needs a finite position, target and up");
      const camera = new T.PerspectiveCamera(c.fov || 45, c.aspect || 1, 0.001, 1000);
      camera.position.fromArray(c.position);
      camera.up.fromArray(c.up || [0, 1, 0]);
      camera.lookAt(...c.target);
      camera.updateMatrixWorld(true);
      return {
        kind: "custom",
        cameraToWorld: camera.matrixWorld.toArray(),
        projectionMatrix: camera.projectionMatrix.toArray(),
        aspect: camera.aspect,
      };
    }
    if (a.source === "current") {
      const current = drawingView(studio);
      if (!current) throw Error("User viewpoint unavailable");
      return current;
    }
    const source = a.promptId
      ? store.session.transcripts.find((t) => t.id === a.promptId)
      : store.session.strokes.find((s) => s.id === (a.strokeId || a.strokeIds?.[0]));
    if (!source?.view)
      throw Error(
        "No recorded viewpoint for this stroke/prompt. Older drawings require an explicit current or custom view.",
      );
    return structuredClone(source.view);
  }
  async function saveImage(canvas, kind, data) {
    const image = canvas.toDataURL("image/png"),
      asset = `agent/${kind}/${crypto.randomUUID()}.png`;
    await store.asset(asset, await (await fetch(image)).blob(), { kind, ...data });
    return { image, asset };
  }
  async function userView(a) {
    const source = view(a),
      ids = a.strokeIds || (a.strokeId ? [a.strokeId] : undefined),
      ref = sketchReference(strokes(ids), ids),
      scene = new T.Scene();
    scene.background = new T.Color("#101923");
    for (const id of ref.strokeIds) {
      const m = studio.strokeMeshes.get(id);
      if (!m) continue;
      m.updateWorldMatrix(true, false);
      const copy = new T.Mesh(m.geometry, m.material);
      copy.matrix.copy(m.matrixWorld);
      copy.matrixAutoUpdate = false;
      copy.frustumCulled = false;
      scene.add(copy);
    }
    const camera = new T.PerspectiveCamera();
    camera.matrixAutoUpdate = false;
    camera.matrix.fromArray(source.cameraToWorld);
    camera.projectionMatrix.fromArray(source.projectionMatrix);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.updateMatrixWorld(true);
    const width = 768,
      height = Math.max(128, Math.min(1536, Math.round(width / (source.aspect || 1))));
    let image;
    try {
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
      image = renderer.domElement.toDataURL("image/png");
    } finally {
      renderer.setSize(320, 240);
    }
    const asset = `agent/user-view/${crypto.randomUUID()}.png`;
    await store.asset(asset, await (await fetch(image)).blob(), {
      kind: "recorded-user-view",
      source,
      strokeIds: ref.strokeIds,
    });
    return {
      image,
      asset,
      view: source,
      strokeIds: ref.strokeIds,
      sketchRevision: ref.revision,
      note:
        source.kind === "xr-head"
          ? "Head-centred rendering using recorded left-eye projection; approximate binocular POV."
          : "Recorded camera projection; user camera unchanged.",
    };
  }
  async function project(a) {
    const referencePlane = a.planeId ? planes.get(a.planeId) : null;
    if (referencePlane)
      a = {
        ...a,
        plane: {
          origin: referencePlane.frame.origin,
          normal: referencePlane.frame.normal,
          up: referencePlane.frame.yAxis,
        },
      };
    const ids = a.strokeIds || store.session.strokes.filter((s) => !s.hidden).map((s) => s.id);
    let source;
    if (a.mode !== "orthographic" || !a.plane) source = view({ ...a, strokeIds: ids });
    const result = projectStrokes(strokes(ids), { ...a, strokeIds: ids, view: source });
    if (referencePlane) {
      result.planeId = referencePlane.id;
      result.planeVersion = referencePlane.version;
    }
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 768;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#101923";
    ctx.fillRect(0, 0, 768, 768);
    const points = result.paths.flatMap((p) => p.points),
      min = [0, 1].map((i) => Math.min(...points.map((p) => p[i]))),
      max = [0, 1].map((i) => Math.max(...points.map((p) => p[i]))),
      scale = 640 / Math.max(0.001, max[0] - min[0], max[1] - min[1]);
    const pixel = (p) => [64 + (p[0] - min[0]) * scale, 704 - (p[1] - min[1]) * scale];
    result.imageMapping = {
      planeMin: min,
      planeMax: max,
      pixelsPerMetre: scale,
      pixelOrigin: [64, 704],
      vAxis: "up",
    };
    for (const [index, path] of result.paths.entries()) {
      ctx.strokeStyle = ["#bcf477", "#8cbcff", "#ffbd78", "#ed96be"][index % 4];
      ctx.lineWidth = 3;
      ctx.beginPath();
      path.points.forEach((p, i) => ctx[i ? "lineTo" : "moveTo"](...pixel(p)));
      ctx.stroke();
      const [x, y] = pixel(path.points[0]);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = "14px sans-serif";
      ctx.fillText(
        `${index + 1}: ${path.strokeId.slice(0, 8)}`,
        Math.min(600, x + 5),
        Math.max(55, y - 8),
      );
    }
    ctx.fillStyle = "#fff";
    ctx.font = "18px sans-serif";
    ctx.fillText(`${result.mode} projection · plane coordinates in metres`, 18, 28);
    ctx.font = "14px sans-serif";
    ctx.fillText(
      `u ${min[0].toFixed(3)} to ${max[0].toFixed(3)} m  |  v ${min[1].toFixed(3)} to ${max[1].toFixed(3)} m`,
      18,
      730,
    );
    ctx.fillText(
      `Depth deviation RMS ${(result.depthDeviation.rmsMetres * 1000).toFixed(2)} mm · inspect spatial parts separately`,
      18,
      752,
    );
    projections.set(result.id, result);
    await store.asset(
      `agent/projections/${result.id}.json`,
      new Blob([JSON.stringify(result)], { type: "application/json" }),
      { kind: "sketch-projection" },
    );
    return { ...result, ...(await saveImage(canvas, "projection", { projectionId: result.id })) };
  }
  async function getProjection(id) {
    let p = projections.get(id);
    if (!p) {
      const asset = await store.get("assets", [store.session.id, `agent/projections/${id}.json`]);
      if (!asset) throw Error("Projection not found");
      p = JSON.parse(await asset.blob.text());
      projections.set(id, p);
    }
    if (p.planeId && planes.get(p.planeId).version !== p.planeVersion)
      throw Error("Reference plane changed; reproject before tracing");
    if (sketchReference(store.session.strokes, p.strokeIds).revision !== p.sketchRevision)
      throw Error("Sketch changed; project it again before tracing");
    return p;
  }
  async function moveSketchPlane(a) {
    const p = planes.get(a.planeId),
      api = await ensure("cad"),
      d = api.document();
    if (d.version !== a.expectedVersion) throw Error("CAD version conflict");
    const scale = { mm: 1000, cm: 100, m: 1, inch: 1 / 0.0254 }[d.units],
      convert = (point, scale = 1) => ({
        x: point[0] * scale,
        y: -point[2] * scale,
        z: point[1] * scale,
      }),
      f = p.frame;
    const result = api.execute(
      "updateSketch",
      {
        sketchId: a.sketchId,
        planeRef: {
          type: "frame",
          frame: {
            origin: convert(f.origin, scale),
            xAxis: convert(f.xAxis),
            yAxis: convert(f.yAxis),
            zAxis: convert(f.normal),
          },
        },
      },
      d.version,
    );
    const updated = await settled(api);
    await refresh();
    return {
      ...result,
      planeId: p.id,
      planeVersion: p.version,
      diagnostics: cadDiagnostics(updated.derived),
    };
  }
  async function trace(a) {
    const projection=await getProjection(a.projectionId), result=traceProjection(projection,a);
    const canvas=document.createElement("canvas");canvas.width=canvas.height=768;
    const imageMapping=drawTracePreview(canvas,projection,result);
    const preview=await saveImage(canvas,"clean-profile",{projectionId:projection.id});
    await store.asset(`agent/traces/${crypto.randomUUID()}.json`,new Blob([JSON.stringify({...result,imageMapping,asset:preview.asset})],{type:"application/json"}),{kind:"clean-profile"});
    return {...result,imageMapping,...preview};
  }
  async function createCAD(a) {
    const p = await getProjection(a.projectionId),
      api = await ensure("cad"),
      doc = api.document();
    if (doc.version !== a.expectedVersion) throw Error("CAD version conflict");
    const tracing = traceProjection(p, { ...a, units: doc.units });
    const result = api.execute("addSketch", tracing.payload, a.expectedVersion);
    const updated = await settled(api);
    await refresh();
    const ids = result.command.payload.ids;
    return {
      ...result,
      trace: tracing,
      sketchId: ids.sketchId,
      sourceEntityIds: ids.objectNodeIds,
      warnings: updated.derived?.warnings || [],
      diagnostics: cadDiagnostics(updated.derived),
      extrudeExample: tracing.closed
        ? {
            operation: "extrudeSketch",
            expectedVersion: updated.version,
            payload: {
              name: "Extruded trace",
              bodyName: "Extruded trace",
              sketchId: ids.sketchId,
              distance:
                doc.units === "mm" ? 10 : doc.units === "m" ? 0.01 : doc.units === "cm" ? 1 : 0.4,
              operation: "new-body",
              profile: { all: true, sourceEntityIds: ids.objectNodeIds },
            },
          }
        : null,
    };
  }
  async function createSculpt(a) {
    const projection = await getProjection(a.projectionId);
    const api = await ensure("sculpt");
    if (api.status().revision !== a.expectedVersion) throw Error("Sculpt version conflict");
    // Validate every selected contour before importing any mesh.
    const meshes = meshProjection(projection, a), results = [];
    for (const [index, mesh] of meshes.entries()) {
      const name = (a.name || "Projected contour") + (meshes.length > 1 ? ` ${index + 1}` : "");
      const result = api.importMesh({ name, vertices: mesh.vertices, indices: mesh.indices, expectedVersion: api.status().revision });
      results.push({ ...result, modelId: `sculpt::${result.id}`, name, diagnostics: mesh.diagnostics });
    }
    store.log("sculpt.from-projection", { projectionId: projection.id, sketchRevision: projection.sketchRevision, results });
    await refresh();
    await store.flush();
    return {
      projectionId: projection.id,
      sketchRevision: projection.sketchRevision,
      results,
      modelIds: results.map(result => result.modelId),
      revision: api.status().revision,
      note: "Source sketches retained. Review contour error and sketch_views overlays from front and side before requesting user feedback.",
    };
  }
  async function createTube(a) {
    if ((a.points !== undefined) === (a.strokeId !== undefined)) throw Error("Supply either explicit world points or one strokeId");
    let points = a.points, source;
    if (a.strokeId !== undefined) {
      const stroke = store.session.strokes.find(s => s.id === a.strokeId);
      if (!stroke) throw Error("Selected stroke no longer exists");
      if ([...studio.active.values()].some(entry => entry.stroke?.id === stroke.id)) throw Error("Selected stroke is still being drawn");
      const start = a.start ?? 0, end = a.end ?? stroke.points.length - 1;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end >= stroke.points.length) throw Error("Invalid inclusive stroke range");
      const ref = sketchReference(store.session.strokes, [stroke.id]);
      if (a.expectedRevision && a.expectedRevision !== ref.revision) throw Error("Drawing changed; inspect it again before thickening");
      points = stroke.points.slice(start,end+1);
      source = { kind: "recorded-stroke", strokeId: stroke.id, start, end, sketchRevision: ref.revision };
      if(a.useLocalFit){
        if(a.start!==undefined||a.end!==undefined)throw Error("Local fit uses the full stroke; use explicit points for a partial interval");
        const fit=await studio.strokeWorkflow.fit(stroke);
        if(!Number.isInteger(a.expectedFitVersion)||a.expectedFitVersion!==stroke.fitVersion)throw Error("Local fit version changed; read stroke_reference again");
        if(!fit.selected?.accepted)throw Error("Fit exceeds tolerance; inspect or refit before creating a tube");
        points=fit.selected.path;source={...source,fitVersion:stroke.fitVersion,fitKind:fit.selected.kind,fitErrors:fit.selected.errors};
      }
    } else {
      if(a.useLocalFit||a.expectedFitVersion!==undefined)throw Error("Local fit requires strokeId");
      if (a.start !== undefined || a.end !== undefined) throw Error("Stroke ranges require strokeId");
      source = { kind: "explicit-agent-points", points: a.points, note: "Agent-specified geometry; compare against the user drawing and request feedback." };
    }
    const api = await ensure("sculpt");
    if (api.status().revision !== a.expectedVersion) throw Error("Sculpt version conflict");
    if (source.kind === "recorded-stroke" && sketchReference(store.session.strokes, [source.strokeId]).revision !== source.sketchRevision) throw Error("Drawing changed while the editor was loading; inspect it again");
    if(source.fitVersion){const s=store.session.strokes.find(s=>s.id===source.strokeId);if(s?.fitVersion!==source.fitVersion)throw Error("Fit changed while editor was loading; inspect again");}
    const mesh = meshPath(points,a), name = a.name || "Path tube";
    const result = api.importMesh({ name, vertices: mesh.vertices, indices: mesh.indices, expectedVersion: a.expectedVersion });
    const response = { ...result, modelId: `sculpt::${result.id}`, name, source, diagnostics: mesh.diagnostics };
    store.log("sculpt.tube", response);
    await refresh();
    await store.flush();
    return response;
  }
  async function visibility({ strokeIds, visible }) {
    if (
      !Array.isArray(strokeIds) ||
      new Set(strokeIds).size !== strokeIds.length ||
      strokeIds.some((id) => !store.session.strokes.some((s) => s.id === id))
    )
      throw Error("Select existing unique stroke IDs");
    if (strokeIds.some((id) => [...studio.active.values()].some((a) => a.stroke?.id === id)))
      throw Error("A selected stroke is still being drawn");
    for (const id of strokeIds) {
      store.session.strokes.find((s) => s.id === id).hidden = !visible;
      const m = studio.strokeMeshes.get(id);
      if (m) m.visible = visible;
    }
    store.session.revision++;
    studio.onChange();
    store.log("drawing.visibility", { strokeIds, visible });
    await store.flush();
    return { strokeIds, visible };
  }
  async function complete(a) {
    await refresh();
    if (
      !a.promptIds?.length ||
      a.promptIds.some((id) => !store.session.transcripts.some((t) => t.id === id))
    )
      throw Error("Select recorded prompt IDs");
    if (!a.resultModelIds?.length || a.resultModelIds.some((id) => !models.has(id)))
      throw Error("Select existing resulting model IDs");
    const ref = sketchReference(store.session.strokes, a.strokeIds);
    if (ref.revision !== a.expectedRevision)
      throw Error("Drawing changed; inspect it again before completing");
    if (a.resultModelIds.some((id) => a.expectedModelVersions?.[id] !== models.get(id).version))
      throw Error("Result model changed; inspect it before completing");
    const record = {
      id: crypto.randomUUID(),
      promptIds: a.promptIds,
      strokeIds: ref.strokeIds,
      sketchRevision: ref.revision,
      resultModelIds: a.resultModelIds,
      summary: a.summary || "",
      completedAt: new Date().toISOString(),
    };
    await visibility({ strokeIds: ref.strokeIds, visible: false });
    (store.session.completedRequests ??= []).push(record);
    store.log("request.completed", record);
    await store.flush();
    return record;
  }
  const names = [
    "cad_set_sketch_plane",
    "sketch_fit_plane",
    "sketch_plane_update",
    "sketch_planes",
    "sketch_user_view",
    "sketch_project",
    "sketch_trace",
    "cad_trace_projection",
    "sculpt_from_projection",
    "sculpt_tube",
    "request_complete",
    "sketch_visibility",
  ];
  return {
    names,
    dispatch(tool, a) {
      return {
        cad_set_sketch_plane: moveSketchPlane,
        sketch_fit_plane: planes.fit,
        sketch_plane_update: planes.update,
        sketch_planes: planes.list,
        sketch_user_view: userView,
        sketch_project: project,
        sketch_trace: trace,
        cad_trace_projection: createCAD,
        sculpt_from_projection: createSculpt,
        sculpt_tube: createTube,
        request_complete: complete,
        sketch_visibility: visibility,
      }[tool](a);
    },
  };
}
