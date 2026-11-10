// Draw3D integration: local interaction log and committed CAD document revisions.
(() => {
  const send = (type,data) => {
    if (parent !== window) parent.postMessage({channel:"draw3d.cad",type,data}, location.origin);
  };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value,...args) {
    const request = put.call(this,value,...args);
    if (this.transaction.db.name === "openzcad-v2" && this.name === "projects") {
      const snapshot = structuredClone(value);
      this.transaction.addEventListener("complete",()=>send("project",snapshot),{once:true});
    }
    return request;
  };
  let lastMove = 0;
  for (const type of ["pointerdown","pointerup","pointermove","click","change","keydown"]) {
    document.addEventListener(type,event=>{
      if (type === "pointermove") {if(performance.now()-lastMove<100)return;lastMove=performance.now();}
      const el = event.target;
      if (el?.type === "password" || /token|api.?key|secret/i.test(el?.name || el?.id || "")) return;
      send("interaction",{type,time:performance.now(),target:el?.getAttribute?.("aria-label") || el?.id || el?.tagName,
        x:event.clientX,y:event.clientY,key:event.key,
        value:type === "change" ? String(el?.value || "").slice(0,4096) : undefined});
    },true);
  }
  window.addEventListener("DOMContentLoaded",()=>send("ready",{engine:"OpenZCAD"}));
})();

{const magnetScript=document.createElement('script');magnetScript.src='/magnetism.js';document.head.append(magnetScript);}
