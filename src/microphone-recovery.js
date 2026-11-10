// Same pixel coordinates as the 900 x 285 VR voice panel.
export const microphoneButton = {x: 570, y: 156, width: 308, height: 43};
export function microphoneRecovery(phase) {
  return ["off", "error", "stalled", "muted", "no-signal"].includes(phase);
}
export function microphoneActionAt(uv, phase) {
  if (!uv || !microphoneRecovery(phase)) return null;
  const x = uv.x * 900, y = (1 - uv.y) * 285, b = microphoneButton;
  return x >= b.x && x <= b.x+b.width && y >= b.y && y <= b.y+b.height ? "mic-enable" : null;
}
export function initMicrophoneRecovery(enable, parent = document.body) {
  const button = document.createElement("button");
  button.id = "mic-reconnect";
  button.textContent = "Retry microphone";
  const primary=document.querySelector("#mic");
  button.hidden = !!primary;
  button.onclick = () => enable();
  if(primary)primary.after(button);else parent.append(button);
  let phase = "off";
  return update => {
    if (update.phase) phase = update.phase;
    const recover=microphoneRecovery(phase)&&(!primary||phase!=="off");
    button.hidden = !recover;
    if(primary)primary.hidden=false;
    button.disabled = phase === "starting";
    button.textContent = phase === "starting" ? "Starting…" : "Retry microphone";
    button.title = update.status || "Enable microphone";
  };
}
