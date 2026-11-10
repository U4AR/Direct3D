import SculptGL from "SculptGL";
import { mat4, vec3 } from "gl-matrix";
import Export from "files/ExportSGL";
import Subdivision from "editing/Subdivision";
const app = new SculptGL();
app.subdivideClamp = (mesh, linear) => {
  Subdivision.LINEAR = !!linear;
  while (mesh.getNbFaces() < 8000) mesh.addLevel();
  Subdivision.LINEAR = false;
};
app.start();
app._autoMatrix = false;
let revision = 0,
  changing = false,
  timer;
const emit = () =>
  parent.postMessage({ channel: "draw3d.sculpt", type: "changed", revision }, location.origin);
function changed() {
  revision++;
  app.render();
  clearTimeout(timer);
  timer = setTimeout(emit, 250);
  return { revision };
}
function meshId(m) {
  return (m.draw3dId ||= crypto.randomUUID());
}
function meshById(id) {
  const m = app.getMeshes().find((m) => meshId(m) === String(id));
  if (!m) throw Error("Mesh not found");
  return m;
}
function guard(expected) {
  if (changing) throw Error("User is sculpting; retry");
  if (expected !== undefined && expected !== revision) throw Error("Sculpt version conflict");
}
function meshes() {
  return app.getMeshes().map((m) => {
    const v = m.getVertices(),
      f = m.getFaces(),
      vertices = [],
      indices = [],
      pt = vec3.create();
    for (let i = 0; i < m.getNbVertices() * 3; i += 3) {
      vec3.transformMat4(pt, v.subarray(i, i + 3), m.getMatrix());
      vertices.push(pt[0] / 1000, pt[1] / 1000, pt[2] / 1000);
    }
    for (let i = 0; i < m.getNbFaces() * 4; i += 4) {
      indices.push(f[i], f[i + 1], f[i + 2]);
      if (f[i + 3] !== 0xffffffff) indices.push(f[i], f[i + 2], f[i + 3]);
    }
    return { id: meshId(m), name: m.draw3dName || "Sculpt " + m.getID(), vertices, indices };
  });
}
window.__draw3dSculpt = {
  status: () => ({
    revision,
    meshes: app
      .getMeshes()
      .map((m) => ({
        id: meshId(m),
        name: m.draw3dName || "Sculpt " + m.getID(),
        vertices: m.getNbVertices(),
        faces: m.getNbFaces(),
      })),
  }),
  meshes,
  create({
    shape = "sphere",
    name = "Sculpt",
    sizeMm = [100, 100, 100],
    positionMm = [0, 0, 0],
    expectedVersion,
  }) {
    guard(expectedVersion);
    const fn = { sphere: "addSphere", box: "addCube", cylinder: "addCylinder", torus: "addTorus" }[
      shape
    ];
    if (!fn) throw Error("Unknown sculpt primitive");
    app[fn]();
    const m = app.getMeshes().at(-1);
    m.draw3dName = name;
    const v = m.getVertices(),
      min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.getNbVertices() * 3; i++) {
      const a = i % 3;
      min[a] = Math.min(min[a], v[i]);
      max[a] = Math.max(max[a], v[i]);
    }
    const matrix = m.getMatrix();
    mat4.identity(matrix);
    mat4.translate(matrix, matrix, positionMm);
    mat4.scale(
      matrix,
      matrix,
      sizeMm.map((n, i) => n / (max[i] - min[i] || 1)),
    );
    mat4.translate(
      matrix,
      matrix,
      min.map((n, i) => -(n + max[i]) / 2),
    );
    changed();
    return { id: meshId(m), revision };
  },
  importMesh({ name, vertices, indices, expectedVersion }) {
    guard(expectedVersion);
    let obj = "";
    for (let i = 0; i < vertices.length; i += 3)
      obj +=
        "v " +
        vertices
          .slice(i, i + 3)
          .map((n) => n * 1000)
          .join(" ") +
        "\n";
    for (let i = 0; i < indices.length; i += 3)
      obj +=
        "f " +
        indices
          .slice(i, i + 3)
          .map((n) => n + 1)
          .join(" ") +
        "\n";
    const reset = app.resetCameraMeshes;
    app.resetCameraMeshes = () => {};
    try {
      app.loadScene(obj, "obj");
    } finally {
      app.resetCameraMeshes = reset;
    }
    const m = app.getMeshes().at(-1);
    m.draw3dName = name;
    changed();
    return { id: meshId(m), revision };
  },
  brush({ id, centerMm, radiusMm, displacementMm, expectedVersion }) {
    guard(expectedVersion);
    const m = meshById(id),
      v = m.getVertices(),
      matrix = m.getMatrix(),
      inv = mat4.invert(mat4.create(), matrix),
      pt = vec3.create(),
      selected = [];
    for (let i = 0; i < m.getNbVertices(); i++) {
      vec3.transformMat4(pt, v.subarray(i * 3, i * 3 + 3), matrix);
      if (vec3.distance(pt, centerMm) < radiusMm) selected.push(i);
    }
    if (!selected.length) return { revision, affected: 0 };
    const state = app.getStateManager();
    state.pushStateGeometry(m);
    state.pushVertices(selected);
    for (const i of selected) {
      vec3.transformMat4(pt, v.subarray(i * 3, i * 3 + 3), matrix);
      const w = (1 - vec3.distance(pt, centerMm) / radiusMm) ** 2;
      for (let a = 0; a < 3; a++) pt[a] += displacementMm[a] * w;
      vec3.transformMat4(pt, pt, inv);
      v.set(pt, i * 3);
    }
    m.updateGeometry();
    m.updateGeometryBuffers();
    changed();
    return { revision, affected: selected.length };
  },
  transform({ id, matrix, expectedVersion }) {
    guard(expectedVersion);
    const m = meshById(id),
      before = mat4.clone(m.getMatrix()),
      after = Float32Array.from(matrix);
    app.getStateManager().pushStateCustom(
      () => {
        m.getMatrix().set(before);
        app.render();
      },
      () => {
        m.getMatrix().set(after);
        app.render();
      },
    );
    m.getMatrix().set(after);
    return changed();
  },
  undo() {
    guard();
    app.getStateManager().undo();
    return changed();
  },
  redo() {
    guard();
    app.getStateManager().redo();
    return changed();
  },
  save: () => Export.exportSGL(app.getMeshes(), app),
  restore(buffer, metadata = []) {
    app.clearScene();
    app.loadScene(buffer, "sgl");
    app.getMeshes().forEach((m, i) => {
      if (metadata[i]) {
        m.draw3dId = metadata[i].nativeId;
        m.draw3dName = metadata[i].name;
      }
    });
    return changed();
  },
};
window.addEventListener(
  "pointerdown",
  () => {
    changing = true;
  },
  true,
);
window.addEventListener(
  "pointerup",
  () => {
    changing = false;
    changed();
  },
  true,
);
window.addEventListener(
  "pointercancel",
  () => {
    changing = false;
  },
  true,
);
window.addEventListener(
  "keydown",
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => changed(), 500);
  },
  true,
);
parent.postMessage({ channel: "draw3d.sculpt", type: "ready" }, location.origin);
