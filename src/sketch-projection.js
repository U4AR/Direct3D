import * as T from "three";
import {sampleTraceObjects, traceDiagnostics} from "./trace-preview.js";
import { validVector, sketchReference } from "./sketch-reference.js";
const v = (a) => new T.Vector3(...a);
export function drawingView(studio) {
  if (studio.renderer?.xr?.isPresenting)
    return studio.viewerView ? structuredClone(studio.viewerView) : null;
  const c = studio.camera;
  if (!c) return null;
  c.updateMatrixWorld(true);
  return {
    kind: "desktop",
    cameraToWorld: c.matrixWorld.toArray(),
    projectionMatrix: c.projectionMatrix.toArray(),
    aspect: c.isOrthographicCamera ? (c.right-c.left)/(c.top-c.bottom) : c.aspect,
    viewportSize: studio.renderer?.domElement ? [studio.renderer.domElement.clientWidth,studio.renderer.domElement.clientHeight] : undefined,
    recordedAt: studio.store?.elapsed?.(),
  };
}
export function planeFrame({ origin, normal, up = [0, 1, 0] }) {
  if (!validVector(origin) || !validVector(normal) || !validVector(up) || v(normal).length() < 1e-8)
    throw Error("Plane needs finite origin, nonzero normal and up");
  const n = v(normal).normalize();
  let u = v(up).cross(n);
  if (u.length() < 1e-8) u = new T.Vector3(1, 0, 0).cross(n);
  if (u.length() < 1e-8) throw Error("Invalid plane basis");
  u.normalize();
  const w = n.clone().cross(u).normalize();
  return {
    origin: [...origin],
    xAxis: u.toArray(),
    yAxis: w.toArray(),
    normal: n.toArray(),
    units: "metres",
  };
}
export function viewPlane(reference, view) {
  const matrix = new T.Matrix4().fromArray(view.cameraToWorld);
  return planeFrame({
    origin: reference.bounds.center,
    normal: new T.Vector3(0, 0, 1).transformDirection(matrix).toArray(),
    up: new T.Vector3(0, 1, 0).transformDirection(matrix).toArray(),
  });
}
export function projectStrokes(
  strokes,
  { strokeIds, plane, view, mode = "perspective", ranges } = {},
) {
  if (!["perspective", "orthographic"].includes(mode)) throw Error("Unknown projection mode");
  const ref = sketchReference(strokes, strokeIds);
  const frame = plane ? planeFrame(plane) : viewPlane(ref, view);
  if (mode === "perspective" && !view) throw Error("Perspective projection needs a viewpoint");
  const origin = v(frame.origin),
    normal = v(frame.normal),
    u = v(frame.xAxis),
    w = v(frame.yAxis),
    eye = view
      ? new T.Vector3().setFromMatrixPosition(new T.Matrix4().fromArray(view.cameraToWorld))
      : null;
  if (mode === "perspective" && Math.abs(eye.clone().sub(origin).dot(normal)) < 1e-6)
    throw Error("Viewpoint lies in projection plane");
  const paths = [];
  let sum = 0,
    max = 0,
    count = 0;
  if (
    ranges &&
    (!Array.isArray(ranges) ||
      ranges.some(
        (r) =>
          !ref.strokeIds.includes(r.strokeId) ||
          !Number.isInteger(r.start) ||
          !Number.isInteger(r.end) ||
          r.start < 0 ||
          r.end <= r.start ||
          r.end >= strokes.find((s) => s.id === r.strokeId).points.length,
      ))
  )
    throw Error("Invalid inclusive stroke sample ranges");
  for (const stroke of strokes.filter((s) => ref.strokeIds.includes(s.id))) {
    const slices = ranges
      ? ranges.filter((r) => r.strokeId === stroke.id)
      : [{ start: 0, end: stroke.points.length - 1 }];
    for (const slice of slices) {
      const points = [];
      for (let i = slice.start; i <= slice.end; i++) {
        const p = v(stroke.points[i]),
          distance = p.clone().sub(origin).dot(normal);
        let projected;
        if (mode === "perspective") {
          const d = p.clone().sub(eye),
            den = d.dot(normal);
          const t = origin.clone().sub(eye).dot(normal) / den;
          if (!Number.isFinite(t) || t <= 0 || Math.abs(den) < 1e-9)
            throw Error(
              "Projection crosses or is parallel to the camera plane; split the sketch or choose a different view",
            );
          projected = eye.clone().addScaledVector(d, t);
        } else projected = p.clone().addScaledVector(normal, -distance);
        const q = projected.sub(origin);
        points.push([q.dot(u), q.dot(w)]);
        sum += distance * distance;
        max = Math.max(max, Math.abs(distance));
        count++;
      }
      paths.push({ strokeId: stroke.id, start: slice.start, end: slice.end, points });
    }
  }
  if (count < 2) throw Error("Select at least two samples");
  return {
    id: crypto.randomUUID(),
    sketchRevision: ref.revision,
    strokeIds: ref.strokeIds,
    frame,
    view,
    mode,
    paths,
    depthDeviation: { rmsMetres: Math.sqrt(sum / count), maxMetres: max },
    note: "A projection loses depth. Split spatial drawings into meaningful parts and inspect other views before tracing.",
  };
}
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Set([0, points.length - 1]),
    stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(),
      line = new T.Line3(new T.Vector3(...points[a], 0), new T.Vector3(...points[b], 0));
    let distance = tolerance,
      index = -1;
    for (let i = a + 1; i < b; i++) {
      const p = new T.Vector3(...points[i], 0),
        d =
          line.start.distanceToSquared(line.end) < 1e-20
            ? line.start.distanceTo(p)
            : line.closestPointToPoint(p, true, new T.Vector3()).distanceTo(p);
      if (d > distance) {
        distance = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep.add(index);
      stack.push([a, index], [index, b]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}
export function traceProjection(
  projection,
  {
    kind = "polyline",
    closed = false,
    toleranceMetres = 0.001,
    smoothingIterations = 0,
    name = "Projected sketch",
    units = "mm",
  } = {},
) {
  const unit = { mm: 1000, cm: 100, m: 1, inch: 1 / 0.0254 }[units];
  if (!unit) throw Error("Unknown CAD units");
  if (
    !["polyline", "smooth", "spline", "circle", "rectangle"].includes(kind) ||
    !Number.isFinite(toleranceMetres) ||
    toleranceMetres < 0.00001 ||
    toleranceMetres > 0.1 || !Number.isInteger(smoothingIterations) || smoothingIterations < 0 || smoothingIterations > 5
  )
    throw Error("Invalid trace kind or tolerance");
  const objects = [],
    traces = [];
  for (const path of projection.paths) {
    const objectStart=objects.length;
    let cleaned=path.points.map(p=>[...p]);
    if(closed && Math.hypot(cleaned[0][0]-cleaned.at(-1)[0],cleaned[0][1]-cleaned.at(-1)[1]) < toleranceMetres) cleaned.pop();
    if(!["circle","rectangle"].includes(kind)) for(let pass=0;pass<smoothingIterations;pass++) {
      cleaned=cleaned.map((p,i,a)=>!closed&&(i===0||i===a.length-1) ? p : [0,1].map(axis=>.5*p[axis]+.25*(a[(i+a.length-1)%a.length][axis]+a[(i+1)%a.length][axis])));
    }
    if(closed && cleaned.length>2) cleaned.push([...cleaned[0]]);
    let pts = simplify(cleaned, toleranceMetres);
    if (pts.length < 2) throw Error("Each trace needs at least two distinct points");
    if (
      closed &&
      pts.length > 2 &&
      new T.Vector2(...pts[0]).distanceTo(new T.Vector2(...pts.at(-1))) < toleranceMetres
    )
      pts.pop();
    if (kind === "circle" || kind === "rectangle") {
      const min = [0, 1].map((i) => Math.min(...path.points.map((p) => p[i]))),
        max = [0, 1].map((i) => Math.max(...path.points.map((p) => p[i]))),
        center = min.map((n, i) => (n + max[i]) / 2),
        size = min.map((n, i) => max[i] - n);
      if (Math.min(...size) < toleranceMetres) throw Error("Degenerate fitted profile");
      if (kind === "circle") {
        const radius =
          path.points.reduce((s, p) => s + Math.hypot(p[0] - center[0], p[1] - center[1]), 0) /
          path.points.length;
        objects.push({
          objectKind: "circle",
          centerX: center[0] * unit,
          centerY: center[1] * unit,
          radius: radius * unit,
        });
        traces.push({
          strokeId: path.strokeId, objectStart, objectCount:objects.length-objectStart,
          maxFitErrorMetres: Math.max(
            ...path.points.map((p) =>
              Math.abs(Math.hypot(p[0] - center[0], p[1] - center[1]) - radius),
            ),
          ),
        });
      } else {
        objects.push({
          objectKind: "rectangle",
          centerX: center[0] * unit,
          centerY: center[1] * unit,
          width: size[0] * unit,
          height: size[1] * unit,
        });
        traces.push({
          strokeId: path.strokeId, objectStart, objectCount:objects.length-objectStart,
          maxFitErrorMetres: Math.max(
            ...path.points.map((p) =>
              Math.min(p[0] - min[0], max[0] - p[0], p[1] - min[1], max[1] - p[1]),
            ),
          ),
        });
      }
      continue;
    }
    if (kind === "smooth" || kind === "spline") {
      if (pts.length < 3) throw Error("Spline trace requires three distinct points");
      const n = pts.length,
        point = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]),
        segments = [];
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = point(i),
          b = point(i + 1),
          previous = point(i - 1),
          next = point(i + 2);
        segments.push({
          points: [
            ...a,
            a[0] + (b[0] - previous[0]) / 6,
            a[1] + (b[1] - previous[1]) / 6,
            b[0] - (next[0] - a[0]) / 6,
            b[1] - (next[1] - a[1]) / 6,
            ...b,
          ].map((v) => v * unit),
        });
      }
      if (segments.length > 128)
        throw Error(
          "Spline needs at most 128 spans; increase simplification tolerance or split the drawing",
        );
      objects.push({ objectKind: "spline", segments, closed });
      traces.push({ strokeId: path.strokeId, objectStart, objectCount:objects.length-objectStart, points: pts, closed, spanCount: segments.length });
      continue;
    }
    if (closed && new T.Vector2(...pts[0]).distanceTo(new T.Vector2(...pts.at(-1))) > 1e-9)
      pts.push(pts[0]);
    for (let i = 1; i < pts.length; i++)
      if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > 1e-9)
        objects.push({
          objectKind: "line",
          x1: pts[i - 1][0] * unit,
          y1: pts[i - 1][1] * unit,
          x2: pts[i][0] * unit,
          y2: pts[i][1] * unit,
        });
    traces.push({ strokeId: path.strokeId, objectStart, objectCount:objects.length-objectStart, points: pts, closed });
  }
  if (!objects.length || objects.length > 1024)
    throw Error("Trace must have 1–1024 entities; split the drawing or increase tolerance");
  const convert = (p, scale = 1) => ({ x: p[0] * scale, y: -p[2] * scale, z: p[1] * scale });
  const f = projection.frame;
  const previewPaths=sampleTraceObjects(objects, units);
  for(const trace of traces) {
    const path=projection.paths[traces.indexOf(trace)];
    trace.fit=traceDiagnostics(path.points, previewPaths.slice(trace.objectStart,trace.objectStart+trace.objectCount));
  }
  return {
    projectionId: projection.id,
    kind,
    closed: closed || ["circle", "rectangle"].includes(kind),
    units,
    traces,
    previewPaths,
    smoothingIterations,
    entityCount: objects.length,
    nativeCurveType: ["smooth", "spline"].includes(kind)
      ? "native cubic spline with exact Bezier/NURBS edges"
      : kind,
    toleranceMetres,
    note: "Inspect fit before extrusion. Spline control points interpolate the simplified knots with uniform Catmull-Rom tangents; native CAD keeps the cubic spans exact. Tolerance applies to input-knot simplification, not intent or final-fit accuracy.",
    payload: {
      name,
      planeRef: {
        type: "frame",
        frame: {
          origin: convert(f.origin, unit),
          xAxis: convert(f.xAxis),
          yAxis: convert(f.yAxis),
          zAxis: convert(f.normal),
        },
      },
      objects,
    },
  };
}

