import * as T from "three";
import { fitPlane, planeAngles, angledPlane } from "./plane-fitting.js";
import { sketchReference } from "./sketch-reference.js";
export function initReferencePlanes({ studio, store, panel, report }) {
  const planes = (store.session.referencePlanes ??= []);
  let selectedId = planes.at(-1)?.id;
  const display = new T.Group();
  studio.scene.add(display);
  const section = document.createElement("section");
  section.innerHTML =
    '<h3>Agent reference planes</h3><p>Fit a region, compare orientations, then adjust the reference used for projection.</p><button id="fit-reference-plane">Fit visible sketch</button><select id="reference-plane-list" aria-label="Reference plane"></select><div id="reference-plane-values"></div><button id="apply-reference-plane">Apply plane</button><button id="hide-reference-plane">Hide plane guide</button><p id="reference-plane-status" role="status"></p>';
  panel.append(section);
  const select = section.querySelector("select"),
    status = section.querySelector("[role=status]");
  for (const key of ["X m", "Y m", "Z m", "Yaw degrees", "Pitch degrees"]) {
    const label = document.createElement("label");
    label.textContent = key;
    const input = document.createElement("input");
    input.type = "number";
    input.step = key.includes("degrees") ? "1" : ".001";
    input.dataset.planeField = key;
    input.setAttribute("aria-label", "Plane " + key);
    label.append(input);
    section.querySelector("#reference-plane-values").append(label);
  }
  const fields = Array.from(section.querySelectorAll("input"));
  function get(id) {
    const p = planes.find((p) => p.id === id);
    if (!p) throw Error("Reference plane not found");
    return p;
  }
  function show() {
    select.replaceChildren(...planes.map((p) => new Option(p.name, p.id)));
    select.value = selectedId || "";
    while (display.children.length) {
      const c = display.children[0];
      display.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    }
    if (!selectedId) return;
    const p = get(selectedId),
      a = planeAngles(p.frame);
    [...p.frame.origin, a.yawDeg, a.pitchDeg].forEach(
      (n, i) => (fields[i].value = String(Number(n.toFixed(6)))),
    );
    const guide = new T.Mesh(
      new T.PlaneGeometry(p.extent, p.extent),
      new T.MeshBasicMaterial({
        color: 0x74cafa,
        transparent: true,
        opacity: 0.12,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    guide.position.fromArray(p.frame.origin);
    guide.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(...p.frame.normal));
    display.add(guide);
    display.visible = true;
    status.textContent = `${p.name} · version ${p.version}. Plane fit RMS ${(p.fit.raw.errors.rmsMetres * 1000).toFixed(2)} mm${p.fit.axisAligned ? " · axis-aligned alternative available" : ""}`;
  }
  async function fit(a = {}) {
    const ref = sketchReference(
        a.strokeIds ? store.session.strokes : store.session.strokes.filter((s) => !s.hidden),
        a.strokeIds,
      ),
      result = fitPlane(ref.points, a),
      p = {
        id: crypto.randomUUID(),
        name: a.name || "Fitted sketch plane",
        version: 1,
        frame: result.selected,
        strokeIds: ref.strokeIds,
        sketchRevision: ref.revision,
        extent: Math.max(0.05, Math.hypot(...ref.bounds.size)),
        fit: result,
      };
    p.inlierRanges = [];
    p.outlierCount = 0;
    for (const stroke of store.session.strokes.filter((s) => ref.strokeIds.includes(s.id))) {
      let start = null;
      for (let i = 0; i <= stroke.points.length; i++) {
        const point = stroke.points[i],
          inside =
            point &&
            Math.abs(
              point.reduce((sum, v, k) => sum + (v - p.frame.origin[k]) * p.frame.normal[k], 0),
            ) <= result.thresholdMetres;
        if (inside) {
          start ??= i;
        } else {
          if (start !== null && i - start >= 2)
            p.inlierRanges.push({ strokeId: stroke.id, start, end: i - 1 });
          start = null;
          if (point) p.outlierCount++;
        }
      }
    }
    planes.push(p);
    selectedId = p.id;
    show();
    store.log("plane.fit", p);
    await store.flush();
    return p;
  }
  async function update(a) {
    const p = get(a.planeId);
    if (p.version !== a.expectedVersion) throw Error("Reference plane version conflict");
    p.frame = a.useAxisAligned
      ? p.fit.axisAligned?.frame ||
        (() => {
          throw Error("No axis-aligned candidate within tolerance");
        })()
      : angledPlane(
          a.origin || p.frame.origin,
          a.yawDeg ?? planeAngles(p.frame).yawDeg,
          a.pitchDeg ?? planeAngles(p.frame).pitchDeg,
        );
    p.version++;
    selectedId = p.id;
    show();
    store.log("plane.update", p);
    await store.flush();
    return p;
  }
  select.onchange = () => {
    selectedId = select.value;
    show();
  };
  section.querySelector("#fit-reference-plane").onclick = () => fit().catch(report);
  section.querySelector("#hide-reference-plane").onclick = () => (display.visible = false);
  section.querySelector("#apply-reference-plane").onclick = () => {
    try {
      const p = get(selectedId);
      update({
        planeId: p.id,
        expectedVersion: p.version,
        origin: fields.slice(0, 3).map((f) => Number(f.value)),
        yawDeg: Number(fields[3].value),
        pitchDeg: Number(fields[4].value),
      }).catch(report);
    } catch (e) {
      report(e);
    }
  };
  show();
  return { fit, update, get, list: () => structuredClone(planes) };
}
