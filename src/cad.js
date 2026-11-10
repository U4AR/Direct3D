import {download} from "./storage.js";
const fresh=()=>({schema:"draw3d.cad.v1",units:"mm",operations:[]});
const copy=value=>structuredClone(value);
export function initCAD(studio,store,notice) {
  const selector=document.createElement("div");selector.className="tool-tabs workspace-tabs";
  selector.innerHTML='<button id="workspace-sketch" class="selected">Spatial sketch</button><button id="workspace-cad">Quick solids (PC)</button>';
  document.querySelector(".left-panel .intro").after(selector);
  const panel=document.createElement("section");panel.id="cad-panel";
  panel.innerHTML=`<div class="section-label">02 / CAD SOLIDS</div><h2>Build with dimensions.</h2><p class="hint">CadQuery · local solid modeling · millimetres</p><p id="cad-engine-status" role="status">Checking CAD engine…</p>
  <label>Solid <select id="cad-shape"><option value="box">Box</option><option value="cylinder">Cylinder</option><option value="sphere">Sphere</option></select></label>
  <label>Operation <select id="cad-operation"><option value="add">Add / union</option><option value="cut">Cut / subtract</option><option value="intersect">Intersect</option></select></label>
  <div class="cad-grid">${[["width","Width",100],["depth","Depth",80],["height","Height",100],["radius","Radius",25],["x","X",0],["y","Y",0],["z","Z",0]].map(([id,label,value])=>`<label>${label} (mm)<input id="cad-${id}" type="number" step="1" value="${value}" min="${["x","y","z"].includes(id)?-2000:0.1}" max="2000"></label>`).join("")}</div>
  <p class="hint">X/Y are the base plane; Z is up. Primitives are centred at their position. A cut must overlap an existing solid.</p>
  <div class="two-buttons"><button id="cad-add" class="primary">Add operation</button><button id="cad-update">Update selected</button></div>
  <label>Editable operations<select id="cad-operations" size="4" aria-label="CAD operations"></select></label>
  <div class="two-buttons"><button id="cad-remove">Remove selected</button><button id="cad-build">Rebuild solid</button></div>
  <div class="two-buttons"><button id="cad-undo">Undo CAD</button><button id="cad-redo">Redo CAD</button></div>
  <p id="cad-result" role="status">Add a primitive to start.</p>
  <div class="two-buttons"><button id="cad-step" disabled>Export STEP</button><button id="cad-stl" disabled>Export STL</button></div>
  <button id="cad-project" class="full">Export editable CAD project</button><p class="hint">Geometry and edits are saved locally with your session. Preview is shown at its true size.</p>`;
  document.querySelector(".right-panel").append(panel);
  const $=id=>document.getElementById(id);
  let doc=copy(store.session.cadDocument || fresh()),undo=[],redo=[],result=null,building=false,selected=doc.operations.length-1;
  const status=(text,error=false)=>{$("cad-result").textContent=text;if(error)notice(text,true);studio.updateHUD(undefined,text);};
  function render(){
    const list=$("cad-operations");list.replaceChildren();
    doc.operations.forEach((op,i)=>{const o=document.createElement("option");o.value=String(i);o.textContent=`${i+1}. ${op.operation} ${op.type}`;o.selected=i===selected;list.append(o);});
    for(const id of ["cad-add","cad-update","cad-remove","cad-build","cad-shape","cad-operation","cad-operations",... ["width","depth","height","radius","x","y","z"].map(x=>`cad-${x}`)])$(id).disabled=building;
    $("cad-update").disabled=building || selected<0;$("cad-remove").disabled=building || selected<0;
    $("cad-undo").disabled=building || !undo.length;$("cad-redo").disabled=building || !redo.length;
    $("cad-build").disabled=building || !doc.operations.length;
    $("cad-step").disabled=$("cad-stl").disabled=building || !result;
  }
  function fields(){const n=id=>Number($("cad-"+id).value);return {id:crypto.randomUUID(),type:$("cad-shape").value,operation:$("cad-operation").value,size:[n("width"),n("depth"),n("height")],height:n("height"),radius:n("radius"),position:[n("x"),n("y"),n("z")]};}
  function fill(){const op=doc.operations[selected];if(!op)return;$("cad-shape").value=op.type;$("cad-operation").value=op.operation;["width","depth","height"].forEach((k,i)=>$("cad-"+k).value=op.size?.[i]??op.height??100);$("cad-radius").value=op.radius??25;["x","y","z"].forEach((k,i)=>$("cad-"+k).value=op.position[i]);}
  function save(action){store.session.cadDocument=copy(doc);store.log("cad.edit",{action,document:doc});store.flush().catch(e=>notice(e.message,true));}
  async function build(){
    if(building)return;
    result=null;studio.setCADMesh(null);
    if(!doc.operations.length){status("Add a primitive to start.");render();return;}
    building=true;render();status("Building precise solid on the PC…");
    try{
      const response=await fetch("/api/cad/build",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(doc),signal:AbortSignal.timeout(70000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error || "CAD build failed");
      result=data;studio.setCADMesh(data.mesh);
      await store.asset(`cad/${data.id}/result.json`,new Blob([JSON.stringify(data)],{type:"application/json"}),{kind:"cad",document:doc});
      store.session.latestCAD=data.id;store.log("cad.build",{id:data.id,document:doc,solids:data.solids,volumeMm3:data.volumeMm3});await store.flush();
      status(`${data.solids} solid(s) · ${data.dimensionsMm.map(v=>v.toFixed(1)).join(" × ")} mm · ${(data.volumeMm3/1000).toFixed(2)} cm³`);
    }catch(error){status(error.message,true);}finally{building=false;render();}
  }
  function edit(action,fn){if(building)return;undo.push(copy(doc));redo=[];fn();selected=Math.min(selected,doc.operations.length-1);save(action);render();void build();}
  function add(type){if(doc.operations.length>=24){notice("Use up to 24 operations",true);return;}edit("add",()=>{const op=fields();if(type)op.type=type;doc.operations.push(op);selected=doc.operations.length-1;});}
  function history(back){if(building)return;const from=back?undo:redo,to=back?redo:undo;if(!from.length)return;to.push(copy(doc));doc=from.pop();selected=doc.operations.length-1;save(back?"undo":"redo");fill();render();void build();}
  function mode(cad){document.body.dataset.workspace=cad?"cad":"sketch";studio.setWorkspaceMode(cad?"cad":"sketch");$("workspace-cad").classList.toggle("selected",cad);$("workspace-sketch").classList.toggle("selected",!cad);store.log("workspace.mode",{mode:cad?"cad":"sketch"});if(cad && doc.operations.length && !result && !building)void build();}
  $("workspace-cad").onclick=()=>mode(true);$("workspace-sketch").onclick=()=>mode(false);
  $("cad-add").onclick=()=>add();$("cad-update").onclick=()=>edit("update",()=>{doc.operations[selected]={...fields(),id:doc.operations[selected].id};});
  $("cad-remove").onclick=()=>edit("remove",()=>doc.operations.splice(selected,1));
  $("cad-operations").onchange=()=>{selected=Number($("cad-operations").value);fill();};
  $("cad-build").onclick=build;$("cad-undo").onclick=()=>history(true);$("cad-redo").onclick=()=>history(false);
  for(const format of ["step","stl"])$("cad-"+format).onclick=()=>{if(result)download(new Blob([Uint8Array.from(atob(result.exports[format]),c=>c.charCodeAt(0))],{type:"application/octet-stream"}),`draw3d-cad.${format}`);};
  $("cad-project").onclick=()=>download(new Blob([JSON.stringify(doc,null,2)],{type:"application/json"}),"draw3d-cad.json");
  render();fill();
  fetch("/api/cad/health").then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);$("cad-engine-status").textContent=`${data.engine} ${data.version} ready on PC`;}).catch(e=>$("cad-engine-status").textContent=e.message);
  return {action(action){if(studio.workspaceMode==="cad" && ["undo","redo"].includes(action)){history(action==="undo");return true;}if(action==="workspace-toggle"){mode(studio.workspaceMode!=="cad");return true;}if(!action.startsWith("cad-"))return false;if(action.startsWith("cad-add-"))add(action.slice(8));if(action==="cad-undo")history(true);if(action==="cad-redo")history(false);if(action==="cad-build")void build();return true;}};
}
