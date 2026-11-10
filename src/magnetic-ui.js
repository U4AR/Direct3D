import "../public/magnetism.js";
export function initMagneticUI(store) {
  const config = store.session.magnetism || {
    enabled: true,
    numberStep: 5,
    angleStep: 5,
    strength: 0.15,
  };
  const section = document.createElement("details");
  section.className = "magnetism-controls";
  section.innerHTML =
    '<summary>Snapping preferences</summary><label><input id="magnet-enabled" type="checkbox"/> Magnetic controls</label><label>Number step <input id="magnet-number" type="number" min="0.001" step="1"/></label><label>Angle step ° <input id="magnet-angle" type="number" min="0.1" max="90" step="1"/></label><p>Sliders pause near round values. Typed values stay exact; use the offered rounded value if wanted. Hold Shift or Alt for free adjustment.</p>';
  document.querySelector(".surface-tools").after(section);
  const enabled = section.querySelector("#magnet-enabled"),
    number = section.querySelector("#magnet-number"),
    angle = section.querySelector("#magnet-angle");
  enabled.checked = config.enabled;
  number.value = config.numberStep;
  angle.value = config.angleStep;
  function apply() {
    window.Draw3dMagnetism.set(config);
    for (const f of document.querySelectorAll("iframe"))
      f.contentWindow?.postMessage({ type: "draw3d-magnetism", settings: config }, location.origin);
  }
  section.onchange = () => {
    if (!(Number(number.value) > 0) || !(Number(angle.value) > 0 && Number(angle.value) <= 90))
      return;
    Object.assign(config, {
      enabled: enabled.checked,
      numberStep: Number(number.value),
      angleStep: Number(angle.value),
    });
    store.session.magnetism = config;
    store.log("snapping.preferences", config);
    apply();
  };
  apply();
  setInterval(apply, 2000);
}
