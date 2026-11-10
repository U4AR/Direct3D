import * as T from "three";
import { planeFrame } from "./sketch-projection.js";
export function planeErrors(points, frame, threshold) {
  let sum = 0,
    max = 0,
    inside = 0;
  for (const p of points) {
    const d = Math.abs(p.reduce((s, n, i) => s + (n - frame.origin[i]) * frame.normal[i], 0));
    sum += d * d;
    max = Math.max(max, d);
    if (d <= threshold) inside++;
  }
  return {
    rmsMetres: Math.sqrt(sum / points.length),
    maxMetres: max,
    inlierFraction: inside / points.length,
  };
}
function refine(points) {
  const center = [0, 1, 2].map((i) => points.reduce((s, p) => s + p[i], 0) / points.length),
    a = Array.from({ length: 3 }, () => [0, 0, 0]),
    vectors = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  for (const point of points) {
    const d = point.map((n, i) => n - center[i]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += d[i] * d[j];
  }
  for (let step = 0; step < 24; step++) {
    let p = 0,
      q = 1;
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ])
      if (Math.abs(a[i][j]) > Math.abs(a[p][q])) {
        p = i;
        q = j;
      }
    if (Math.abs(a[p][q]) < 1e-14) break;
    const theta = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]),
      c = Math.cos(theta),
      s = Math.sin(theta),
      app = a[p][p],
      aqq = a[q][q],
      apq = a[p][q];
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const x = a[k][p],
          y = a[k][q];
        a[k][p] = a[p][k] = c * x - s * y;
        a[k][q] = a[q][k] = s * x + c * y;
      }
      const x = vectors[k][p],
        y = vectors[k][q];
      vectors[k][p] = c * x - s * y;
      vectors[k][q] = s * x + c * y;
    }
    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = a[q][p] = 0;
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  if (a[order[1]][order[1]] < 1e-10)
    throw Error("The selection is nearly a line; choose an explicit plane or more points");
  return { origin: center, normal: vectors.map((row) => row[order[0]]) };
}
export function fitPlane(
  points,
  { thresholdMetres = 0.005, axisToleranceDeg = 7, preferAxis = false } = {},
) {
  if (
    points.length < 3 ||
    !Number.isFinite(thresholdMetres) ||
    thresholdMetres <= 0 ||
    !Number.isFinite(axisToleranceDeg) ||
    axisToleranceDeg < 0 ||
    axisToleranceDeg > 45
  )
    throw Error("Invalid plane fit settings");
  const sample = points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 4000)) === 0);
  let best = [],
    seed = 78319;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let trial = 0; trial < 192; trial++) {
    const pick = () => sample[Math.floor(random() * sample.length)],
      a = pick(),
      b = pick(),
      c = pick(),
      normal = new T.Vector3()
        .subVectors(new T.Vector3(...b), new T.Vector3(...a))
        .cross(new T.Vector3().subVectors(new T.Vector3(...c), new T.Vector3(...a)));
    if (normal.lengthSq() < 1e-14) continue;
    normal.normalize();
    const inliers = sample.filter(
      (p) => Math.abs(normal.dot(new T.Vector3(...p).sub(new T.Vector3(...a)))) <= thresholdMetres,
    );
    if (inliers.length > best.length) best = inliers;
  }
  if (best.length < 3) throw Error("No stable plane found");
  const fit = refine(best);
  const major = fit.normal.map(Math.abs).indexOf(Math.max(...fit.normal.map(Math.abs)));
  if (fit.normal[major] < 0) fit.normal = fit.normal.map((n) => -n);
  const raw = planeFrame(fit),
    axis = [0, 0, 0];
  axis[major] = 1;
  const angleDeg = (Math.acos(Math.min(1, Math.abs(raw.normal[major]))) * 180) / Math.PI;
  const candidate = planeFrame({ origin: fit.origin, normal: axis });
  const aligned =
    angleDeg <= axisToleranceDeg
      ? {
          frame: candidate,
          angleFromFitDeg: angleDeg,
          orientation: major === 1 ? "horizontal" : "vertical",
          errors: planeErrors(points, candidate, thresholdMetres),
        }
      : null;
  return {
    raw: { frame: raw, errors: planeErrors(points, raw, thresholdMetres) },
    axisAligned: aligned,
    selected: preferAxis && aligned ? aligned.frame : raw,
    method: "RANSAC with covariance refinement",
    thresholdMetres,
    sampledPoints: sample.length,
    inlierCount: best.length,
    note: "Plane fit is a geometric hypothesis. Compare inliers/outliers and other views before interpreting the object.",
  };
}
export function planeAngles(frame) {
  return {
    yawDeg: (Math.atan2(frame.normal[0], frame.normal[2]) * 180) / Math.PI,
    pitchDeg: (Math.asin(Math.max(-1, Math.min(1, frame.normal[1]))) * 180) / Math.PI,
  };
}
export function angledPlane(origin, yawDeg, pitchDeg) {
  if (![yawDeg, pitchDeg].every(Number.isFinite)) throw Error("Finite angles required");
  const yaw = (yawDeg * Math.PI) / 180,
    pitch = (pitchDeg * Math.PI) / 180;
  return planeFrame({
    origin,
    normal: [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)],
  });
}
