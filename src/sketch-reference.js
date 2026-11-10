import * as T from "three";
export const validVector = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
export function sketchReference(strokes, strokeIds) {
  if (
    strokeIds &&
    (!Array.isArray(strokeIds) || !strokeIds.length || new Set(strokeIds).size !== strokeIds.length)
  )
    throw Error("Provide unique stroke IDs");
  const selected = strokeIds ? strokes.filter((s) => strokeIds.includes(s.id)) : strokes;
  if (strokeIds && selected.length !== strokeIds.length)
    throw Error("A selected stroke no longer exists");
  const points = [],
    ends = [],
    extrema = {},
    min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  let hash = 2166136261;
  function feed(value) {
    for (const c of String(value)) {
      hash ^= c.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
  }
  for (const s of selected) {
    feed(s.id);
    feed(s.radius);
    let first, last;
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i];
      if (!validVector(p)) continue;
      feed("|" + p.join(","));
      const item = { strokeId: s.id, pointIndex: i, position: [...p] };
      points.push(p);
      first ??= item;
      last = item;
      for (let a = 0; a < 3; a++) {
        const axis = "XYZ"[a];
        if (p[a] < min[a]) {
          min[a] = p[a];
          extrema["min" + axis] = { label: axis + "−", ...item };
        }
        if (p[a] > max[a]) {
          max[a] = p[a];
          extrema["max" + axis] = { label: axis + "+", ...item };
        }
      }
    }
    if (first) ends.push({ strokeId: s.id, start: first.position, end: last.position });
  }
  if (!points.length) throw Error("Draw a sketch first");
  const size = min.map((v, i) => max[i] - v),
    center = min.map((v, i) => (v + max[i]) / 2);
  return {
    schema: "draw3d.sketch-reference.v1",
    revision: (hash >>> 0).toString(16),
    units: "metres",
    up: "Y",
    axes: { X: "world +X", Y: "up", Z: "world +Z" },
    strokeIds: selected.map((s) => s.id),
    pointCount: points.length,
    bounds: { min, max, center, size },
    extrema,
    endpoints: ends,
    degenerateAxes: size.map((s, i) => (s < 0.001 ? "XYZ"[i] : null)).filter(Boolean),
    points,
  };
}
export function publicReference(reference) {
  const { points, ...data } = reference;
  return data;
}
export function planMatrix(plan) {
  return new T.Matrix4().compose(
    new T.Vector3(...plan.center),
    new T.Quaternion().setFromEuler(new T.Euler(...plan.rotationDeg.map(T.MathUtils.degToRad))),
    new T.Vector3(...plan.size),
  );
}
export function worldPoint(plan, normalized) {
  if (!validVector(normalized)) throw Error("Expected a finite normalized XYZ point");
  return new T.Vector3(...normalized).subScalar(0.5).applyMatrix4(planMatrix(plan)).toArray();
}
export function nativePoint(world) {
  return {
    worldMetres: world,
    cadMillimetres: [world[0] * 1000, -world[2] * 1000, world[1] * 1000],
    sculptMillimetres: world.map((v) => v * 1000),
  };
}
export function makePlan(
  reference,
  {
    center = reference.bounds.center,
    size = reference.bounds.size.map((v) => Math.max(0.01, v)),
    rotationDeg = [0, 0, 0],
    expectedRevision,
  } = {},
) {
  if (expectedRevision && expectedRevision !== reference.revision)
    throw Error("Sketch changed; inspect it again before planning");
  if (
    !validVector(center) ||
    !validVector(size) ||
    !size.every((v) => v >= 0.001 && v <= 100) ||
    !validVector(rotationDeg)
  )
    throw Error("Build region needs finite coordinates and sizes from 0.001 to 100 metres");
  const plan = {
    schema: "draw3d.placement-plan.v1",
    id: crypto.randomUUID(),
    sketchRevision: reference.revision,
    strokeIds: reference.strokeIds,
    center: [...center],
    size: [...size],
    rotationDeg: [...rotationDeg],
    units: "metres",
    up: "Y",
    created: new Date().toISOString(),
  };
  plan.normalizedToWorld = planMatrix(plan)
    .multiply(new T.Matrix4().makeTranslation(-0.5, -0.5, -0.5))
    .toArray();
  plan.origin = nativePoint(worldPoint(plan, [0, 0, 0]));
  plan.frame = {
    X: worldPoint(plan, [1, 0, 0]).map((v, i) => v - plan.origin.worldMetres[i]),
    Y: worldPoint(plan, [0, 1, 0]).map((v, i) => v - plan.origin.worldMetres[i]),
    Z: worldPoint(plan, [0, 0, 1]).map((v, i) => v - plan.origin.worldMetres[i]),
  };
  return plan;
}
export function comparePlan(reference, plan) {
  const inverse = planMatrix(plan).invert();
  let inside = 0,
    maxOutsideMetres = 0;
  for (const p of reference.points) {
    const q = new T.Vector3(...p).applyMatrix4(inverse).toArray();
    const outside = q.map((n, i) => Math.max(0, Math.abs(n) - 0.5) * plan.size[i]);
    if (outside.every((n) => n < 1e-6)) inside++;
    maxOutsideMetres = Math.max(maxOutsideMetres, Math.hypot(...outside));
  }
  return {
    sketchRevision: reference.revision,
    stale: plan.sketchRevision !== reference.revision,
    pointCount: reference.pointCount,
    pointsInside: inside,
    insideFraction: inside / reference.pointCount,
    maxOutsideMetres,
    centerOffsetMetres: plan.center.map((n, i) => n - reference.bounds.center[i]),
    note: "Compares stroke samples with the build region; it does not prove shape similarity.",
  };
}
export function alignmentMatrix(box, plan) {
  if (box.isEmpty()) throw Error("No model geometry to align");
  const size = box.getSize(new T.Vector3()).toArray();
  const ratios = size.map((v, i) => (v > 1e-9 ? plan.size[i] / v : Infinity));
  const scale = Math.min(...ratios);
  if (!Number.isFinite(scale) || scale <= 0) throw Error("Model bounds have no extent");
  const rotation = new T.Quaternion().setFromEuler(
    new T.Euler(...plan.rotationDeg.map(T.MathUtils.degToRad)),
  );
  return new T.Matrix4()
    .compose(new T.Vector3(...plan.center), rotation, new T.Vector3(scale, scale, scale))
    .multiply(
      new T.Matrix4().makeTranslation(...box.getCenter(new T.Vector3()).negate().toArray()),
    );
}
