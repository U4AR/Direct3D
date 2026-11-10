import {freecadHealth,runFreeCADDocument} from './freecad-bridge.mjs';
import {legacyCADDocument,legacyCADPreview} from './legacy-cad-adapter.mjs';
import {spawn} from "node:child_process";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
const worker=fileURLToPath(new URL("./cad-engine.py",import.meta.url));
const python=()=>process.env.CAD_PYTHON || "I:/Projects/Draw3d/.cache/native-build/cad-venv/Scripts/python.exe";
const reply=(res,status,data)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(data));};
function execute(args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(python(),[worker,...args],{windowsHide:true,env:{...process.env,PYTHONIOENCODING:"utf-8"}});
    let output="",errors="",timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},60000);
    child.stdout.on("data",b=>{output+=b;if(output.length>1000000)child.kill();});
    child.stderr.on("data",b=>{errors=(errors+b).slice(-4000);});
    child.on("error",()=>{clearTimeout(timer);reject(new Error("CAD engine unavailable. Run npm run cad:setup on the PC."));});
    child.on("close",code=>{
      clearTimeout(timer);let result;try{result=JSON.parse(output.trim().split(/\r?\n/).at(-1));}catch{}
      if(timedOut)reject(new Error("CAD operation timed out; simplify the model."));
      else if(code!==0)reject(new Error(result?.error || (errors.includes("ModuleNotFoundError") ? "Install CadQuery with npm run cad:setup" : "CAD engine could not build this solid")));
      else resolve(result);
    });
  });
}
let building=false;
export async function handleCAD(req,res) {
  if(!req.url.startsWith("/api/cad/"))return false;
  try{
    if(req.method==="GET" && req.url==="/api/cad/health") {reply(res,200,process.env.FREECAD_SERVICE_URL?{...await freecadHealth(),engine:"FreeCAD",license:"LGPL-2.1-or-later"}:await execute(["--health"]));return true;}
    if(req.method!=="POST" || req.url!=="/api/cad/build") {reply(res,404,{error:"Not found"});return true;}
    if(building){reply(res,429,{error:"A CAD build is already running; wait for it to finish."});return true;}
    if(!req.headers["content-type"]?.startsWith("application/json")){reply(res,415,{error:"JSON required"});return true;}
    building=true;
    try{
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>128000)throw new Error("CAD document exceeds 128 KB");chunks.push(chunk);}
      const document=JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if(document.schema!=="draw3d.cad.v1" || !Array.isArray(document.operations) || document.operations.length>24)throw new Error("Invalid CAD document");
      if(process.env.FREECAD_SERVICE_URL){
        const native=await runFreeCADDocument(legacyCADDocument(document)),result=legacyCADPreview(native);result.exports={};
        for(const format of ['step','stl']){const response=await fetch(new URL(native.exports[format],process.env.FREECAD_SERVICE_URL),{headers:process.env.MODELING_SERVICE_TOKEN?{'X-Modeling-Token':process.env.MODELING_SERVICE_TOKEN}:{},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Native CAD export unavailable');result.exports[format]=Buffer.from(await response.arrayBuffer()).toString('base64');}
        reply(res,200,result);return true;
      }
      const id=randomUUID(),folder=path.resolve(process.env.SESSION_DIR||"sessions","cad",id);
      await mkdir(folder,{recursive:true});await writeFile(path.join(folder,"document.json"),JSON.stringify(document));
      await execute([folder]);
      const result=JSON.parse(await readFile(path.join(folder,"preview.json"),"utf8"));
      result.id=id;result.exports={};
      for(const format of ["step","stl"])result.exports[format]=(await readFile(path.join(folder,`model.${format}`))).toString("base64");
      reply(res,200,result);
    }finally{building=false;}
  }catch(error){reply(res,400,{error:error.message});}
  return true;
}
