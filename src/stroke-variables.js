import { sketchReference, publicReference } from "./sketch-reference.js";
import { evaluateExpression } from "./math-expression.js";
export function strokeAliases(session){const aliases=session.strokeAliases??={};let next=Math.max(0,...Object.values(aliases).map(s=>Number(s.slice(1))||0));for(const s of session.strokes)if(!Object.hasOwn(aliases,s.id))aliases[s.id]="s"+(++next);return aliases;}
export const strokeLabel=(strokes,id,aliases)=>aliases?.[id]||"s"+(strokes.findIndex(s=>s.id===id)+1);
export const strokeColor=(strokes,id,aliases)=>`hsl(${(Number(strokeLabel(strokes,id,aliases).slice(1))*137.508)%360},75%,65%)`;
const validName=name=>typeof name==="string"&&/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(name)&&!["constructor","prototype","__proto__","pi","e"].includes(name);
export function initStrokeVariables({store}) {
 const variables=store.session.mathVariables??={};
 const summary=(name,v)=>({name,kind:v.kind,strokeId:v.strokeId,revision:v.revision,pointCount:v.value?.points?.length});
 return {names:["stroke_catalog","stroke_load","math_variables","math_evaluate"],variables,
 async dispatch(tool,a={}) {
 const aliases=strokeAliases(store.session);
 if(tool==="stroke_catalog")return {strokes:store.session.strokes.map(s=>({id:s.id,variable:strokeLabel(store.session.strokes,s.id,aliases),inspectionColor:strokeColor(store.session.strokes,s.id,aliases),drawnColor:s.color,hidden:!!s.hidden,...publicReference(sketchReference([s],[s.id]))})),units:"metres",up:"Y"};
 if(tool==="stroke_load") {
 const ids=a.strokeIds||store.session.strokes.filter(s=>!s.hidden).map(s=>s.id);sketchReference(store.session.strokes,ids);
 const loaded=[];for(const id of ids){const s=store.session.strokes.find(s=>s.id===id),name=strokeLabel(store.session.strokes,id,aliases),ref=publicReference(sketchReference([s],[id]));variables[name]={kind:"stroke",strokeId:id,revision:ref.revision,value:{id,points:structuredClone(s.points),radius:s.radius||0,color:s.color,bounds:ref.bounds}};loaded.push(summary(name,variables[name]));}
 await store.flush();return {loaded,note:"Immutable snapshots in world Y-up metres. Reload explicitly after drawing edits. Read points with math_variables or formulas such as mean(column(s1.points,0))."};
 }
 if(tool==="math_variables") {
 if(!a.name)return {variables:Object.entries(variables).map(([n,v])=>summary(n,v))};
 if(!Object.hasOwn(variables,a.name))throw Error("Unknown variable");let value=variables[a.name].value;
 if(a.field){if(!Object.hasOwn(value,a.field)||["constructor","__proto__","prototype"].includes(a.field))throw Error("Unknown field");value=value[a.field];}
 if(Array.isArray(value))value=value.slice(a.start||0,(a.start||0)+Math.min(4096,a.count||256));
 return {...summary(a.name,variables[a.name]),value};
 }
 if(tool==="math_evaluate") {
 const bindings=Object.fromEntries(Object.entries(variables).map(([n,v])=>[n,v.value]));for(const[n,v]of Object.entries(a.parameters||{})){if(!validName(n)||typeof v!=="number"||!Number.isFinite(v))throw Error("Parameters must be named finite scalars");bindings[n]=v;}
 const value=evaluateExpression(a.expression,bindings);if(a.saveAs){if(!validName(a.saveAs))throw Error("Invalid variable name");if(variables[a.saveAs]?.kind==="stroke")throw Error("Cannot overwrite a stroke snapshot");variables[a.saveAs]={kind:"math",value};await store.flush();}return {value,savedAs:a.saveAs||null};
 }
 throw Error("Unknown variable tool");
 }};
}
