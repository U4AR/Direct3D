import {fitCurve,evaluateCurve} from "./constrained-curve.mjs";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {sketchReference} from "../src/sketch-reference.js";
const uuid=s=>typeof s==="string"&&/^[0-9a-f-]{36}$/i.test(s);
const root=path.resolve(process.env.DRAW3D_CURVE_ROOT||"sessions/curve-fits");
export const fittingNames=["stroke_fit_curve","curve_get","curve_refit"];
const file=(session,id)=>{if(!uuid(session)||!uuid(id))throw Error("Invalid curve/session ID");return path.join(root,session,id+".json");};
async function save(session,value){const name=file(session,value.id);await mkdir(path.dirname(name),{recursive:true});await writeFile(name,JSON.stringify(value));}
export async function fittingTool(name,a,session,invoke){
 if(name==="curve_get"){
  const fit=JSON.parse(await readFile(file(session,a.curveId),"utf8"));const count=a.samples??129;
  if(!Number.isInteger(count)||count<2||count>1024)throw Error("Use 2-1024 samples");
  return {...fit,sourcePoints:undefined,samples:Array.from({length:count},(_,i)=>evaluateCurve(fit.curve,i/(count-1)))};
 }
 let points,source,previous;
 if(name==="curve_refit"){
  previous=JSON.parse(await readFile(file(session,a.curveId),"utf8"));if(previous.version!==a.expectedVersion)throw Error("Curve version conflict");
  points=previous.sourcePoints;source=previous.source;a={...previous.settings,...a};
 }else if(name==="stroke_fit_curve"){
  if((a.points!==undefined)===(a.strokeId!==undefined))throw Error("Supply exactly one strokeId or ordered points");
  if(a.strokeId){
   const context=await invoke("draw3d_context",{}),stroke=[...(context.strokes||[]),...(context.archivedStrokes||[])].find(s=>s.id===a.strokeId);
   if(!stroke)throw Error("Stroke not found");
   const start=a.start??0,end=a.end??stroke.points.length-1;
   if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>=stroke.points.length)throw Error("Invalid inclusive stroke range");
   const revision=sketchReference([stroke],[stroke.id]).revision;if(a.expectedRevision&&revision!==a.expectedRevision)throw Error("Stroke changed; inspect again");
   points=stroke.points.slice(start,end+1);source={strokeId:stroke.id,start,end,revision,frame:"world",units:"metres"};
  }else{points=a.points;source={kind:"explicit-points",frame:"world",units:"metres"};}
 }else throw Error("Unknown fitting tool");
 const settings=Object.fromEntries(["kind","degree","controlCount","terms","constraints","fairnessWeight","robustThresholdMetres"].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
 const fit={id:previous?.id||randomUUID(),version:(previous?.version||0)+1,source,sourcePoints:points,settings,...fitCurve(points,settings)};
 if(previous)await writeFile(file(session,previous.id)+".v"+previous.version,JSON.stringify(previous));
 await save(session,fit);return {...fit,sourcePoints:undefined,note:"Saved editable mathematical curve. Samples are world Y-up metres for sculpt_tube or loft section rows. Keep degree/order distinct. Native CAD currently accepts cubic spans; other degrees require a measured approximation before CAD commit. Refits reuse the saved source snapshot, not newer drawing edits."};
}
