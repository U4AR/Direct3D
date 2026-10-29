import { Matrix4, Vector3, Box3 } from "three";

export const DEPTH_SCHEMA = "draw3d.depth.v1";
export function planViews(strokes, mode = "auto") {
  const box = new Box3();
  for (const stroke of strokes)
    for (const p of stroke.points) box.expandByPoint(new Vector3(...p));
  if (box.isEmpty()) throw new Error("Draw something before capturing views.");
  box.expandByScalar(Math.max(...strokes.map((s) => s.radius)));
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const sorted = size.toArray().sort((a, b) => a - b);
  // Extent is a conservative coverage heuristic, not a convexity measurement.
  const flat = sorted[0] / Math.max(sorted[2], 0.001) < 0.12;
  const count =
    mode === "single"
      ? 1
      : mode === "six"
        ? 6
        : mode === "ten"
          ? 10
          : flat
            ? 1
            : 6;
  const radius = Math.max(size.length() / 2, 0.08);
  const distance = (radius / Math.sin((25 * Math.PI) / 180)) * 1.2;
  const flatAxis =
    size.x <= size.y && size.x <= size.z
      ? [1, 0, 0]
      : size.y <= size.z
        ? [0, 1, 0]
        : [0, 0, 1];
  const directions =
    count === 1
      ? [flat ? flatAxis : [0, 0, 1]]
      : [
          [0, 0, 1],
          [1, 0, 0],
          [0, 0, -1],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
        ];
  if (count === 10)
    directions.push([1, 1, 1], [-1, 1, 1], [1, 1, -1], [-1, 1, -1]);
  return {
    center: center.toArray(),
    size: size.toArray(),
    radius,
    distance,
    reason: flat
      ? "Nearly planar sketch"
      : "Volume detected; covering all six sides",
    directions,
  };
}

export function validateFrame(f) {
  if (
    !f ||
    !Number.isInteger(f.width) ||
    !Number.isInteger(f.height) ||
    f.width < 2 ||
    f.height < 2 ||
    f.width > 1024 ||
    f.height > 1024
  )
    throw new Error("Invalid depth dimensions (2–1024).");
  const n = f.width * f.height;
  if (f.depth.length !== n || f.mask.length !== n)
    throw new Error("Depth and mask sizes must match the frame.");
  if (f.units !== "metres" || f.depthConvention !== "camera-z")
    throw new Error("Expected camera-z depth in metres.");
  if (
    !f.cameraToWorld ||
    f.cameraToWorld.length !== 16 ||
    !f.cameraToWorld.every(Number.isFinite)
  )
    throw new Error("Invalid camera matrix.");
  if (Math.abs(new Matrix4().fromArray(f.cameraToWorld).determinant()) < 1e-8)
    throw new Error("Singular camera matrix.");
  if (
    !f.intrinsics ||
    !["fx", "fy", "cx", "cy"].every((k) => Number.isFinite(f.intrinsics[k])) ||
    f.intrinsics.fx <= 0 ||
    f.intrinsics.fy <= 0
  )
    throw new Error("Invalid camera intrinsics.");
  for (let i = 0; i < n; i++)
    if (
      !Number.isFinite(f.depth[i]) ||
      f.depth[i] < 0 ||
      f.depth[i] > 100 ||
      (f.mask[i] && f.depth[i] <= 0)
    )
      throw new Error("Invalid depth sample.");
}

export function unprojectPixel(f, x, y, d) {
  const { fx, fy, cx, cy } = f.intrinsics;
  return new Vector3(((x + 0.5 - cx) * d) / fx, (-(y + 0.5 - cy) * d) / fy, -d)
    .applyMatrix4(new Matrix4().fromArray(f.cameraToWorld))
    .toArray();
}

export function fuseDepthFrames(
  frames,
  { voxelSize = 0.004, maxDepthJump = 0.04, stride = 1 } = {},
) {
  if (!frames.length || frames.length > 10)
    throw new Error("Expected 1–10 calibrated frames.");
  if (
    !(
      voxelSize > 0 &&
      maxDepthJump > 0 &&
      Number.isInteger(stride) &&
      stride >= 1
    )
  )
    throw new Error("Invalid fusion settings.");
  const voxels = new Map(),
    vertices = [],
    counts = [],
    triangles = [],
    uniqueFaces = new Set();
  for (const f of frames) {
    validateFrame(f);
    const ids = new Int32Array(f.width * f.height).fill(-1);
    for (let y = 0; y < f.height; y += stride)
      for (let x = 0; x < f.width; x += stride) {
        const i = y * f.width + x;
        if (!f.mask[i] || !f.depth[i]) continue;
        const p = unprojectPixel(f, x, y, f.depth[i]);
        const key = p.map((v) => Math.floor(v / voxelSize)).join(",");
        let id = voxels.get(key);
        if (id === undefined) {
          id = vertices.length;
          voxels.set(key, id);
          vertices.push(p);
          counts.push(1);
        } else {
          const c = ++counts[id];
          for (let j = 0; j < 3; j++)
            vertices[id][j] += (p[j] - vertices[id][j]) / c;
        }
        ids[i] = id;
      }
    const addFace = (a, b, c) => {
      const face = [ids[a], ids[b], ids[c]];
      if (face.some((v) => v < 0) || new Set(face).size < 3) return;
      const depths = [f.depth[a], f.depth[b], f.depth[c]];
      if (Math.max(...depths) - Math.min(...depths) > maxDepthJump) return;
      const key = [...face].sort((a, b) => a - b).join(",");
      if (!uniqueFaces.has(key)) {
        uniqueFaces.add(key);
        triangles.push(face);
      }
    };
    for (let y = 0; y < f.height - stride; y += stride)
      for (let x = 0; x < f.width - stride; x += stride) {
        const a = y * f.width + x,
          b = a + stride,
          c = a + stride * f.width,
          d = c + stride;
        addFace(a, c, b);
        addFace(b, c, d);
      }
  }
  return {
    vertices,
    triangles,
    counts,
    voxelSize,
    method: "calibrated-grid-triangulation-voxel-weld",
    frameCount: frames.length,
  };
}

export function meshToOBJ(mesh) {
  return (
    "# Draw3D review surface. Units: metres.\n" +
    mesh.vertices.map((p) => `v ${p.join(" ")}`).join("\n") +
    "\n" +
    mesh.triangles.map((f) => `f ${f.map((i) => i + 1).join(" ")}`).join("\n") +
    "\n"
  );
}

// Fit the generated grayscale to measured anchor depths. Refuse unidentifiable scale.
export function calibrateGeneratedDepth(source, rgba) {
  validateFrame(source);
  if (rgba.length !== source.width * source.height * 4)
    throw new Error("Generated image size mismatch.");
  const values = new Float32Array(source.depth.length);
  const anchors = [];
  for (let i = 0; i < values.length; i++) {
    const r = rgba[i * 4],
      g = rgba[i * 4 + 1],
      b = rgba[i * 4 + 2];
    values[i] = (r + g + b) / 3;
    if (
      source.mask[i] &&
      values[i] > 5 &&
      Math.max(r, g, b) - Math.min(r, g, b) < 24
    )
      anchors.push([values[i], source.depth[i]]);
  }
  if (anchors.length < 24)
    throw new Error(
      "Too few matching sketch anchors to calibrate this generated view.",
    );
  const fit = (rows) => {
    const mx = rows.reduce((s, a) => s + a[0], 0) / rows.length,
      my = rows.reduce((s, a) => s + a[1], 0) / rows.length;
    let xx = 0,
      xy = 0;
    for (const [x, y] of rows) {
      xx += (x - mx) ** 2;
      xy += (x - mx) * (y - my);
    }
    if (xx / rows.length < 4)
      throw new Error(
        "Generated depth has insufficient variation to recover scale.",
      );
    const slope = xy / xx;
    return { slope, intercept: my - slope * mx };
  };
  let { slope, intercept } = fit(anchors);
  const residuals = anchors
    .map(([x, y]) => Math.abs(slope * x + intercept - y))
    .sort((a, b) => a - b);
  const cutoff = Math.max(
    0.008,
    residuals[Math.floor(residuals.length / 2)] * 3,
  );
  const inliers = anchors.filter(
    ([x, y]) => Math.abs(slope * x + intercept - y) <= cutoff,
  );
  if (inliers.length < anchors.length * 0.6)
    throw new Error("Generated view is inconsistent with the measured sketch.");
  ({ slope, intercept } = fit(inliers));
  const rmse = Math.sqrt(
    inliers.reduce((s, [x, y]) => s + (slope * x + intercept - y) ** 2, 0) /
      inliers.length,
  );
  if (slope >= -0.00001 || rmse > 0.035)
    throw new Error(
      "Depth calibration failed: expected near-white / far-dark geometry aligned to the sketch.",
    );
  const depth = [],
    mask = [];
  for (let i = 0; i < values.length; i++) {
    const z = slope * values[i] + intercept;
    const valid =
      values[i] > 5 &&
      rgba[i * 4 + 3] > 128 &&
      z > source.near &&
      z < source.far;
    mask.push(valid ? 1 : 0);
    depth.push(valid ? z : 0);
  }
  return {
    ...source,
    depth,
    mask,
    provenance: "generated-estimate",
    calibration: {
      slope,
      intercept,
      rmseMetres: rmse,
      anchors: inliers.length,
      warning:
        "Estimated scale fitted to sketch anchors; not a metric sensor measurement.",
    },
  };
}
