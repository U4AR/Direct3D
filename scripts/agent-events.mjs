// Small, structured public activity records. Never ship credentials or image payloads.
export function activityDetails(value,depth=0){
 if(depth>4)return '[nested details]';if(value===null||typeof value==='boolean'||typeof value==='number')return value;
 if(typeof value==='string')return /^data:/.test(value)?'[image/audio attached]':value.slice(0,1600);
 if(Array.isArray(value))return value.slice(0,12).map(v=>activityDetails(v,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!(/^(vertices|indices|coefficients)$/i.test(k)||/(token|api.?key|authorization|secret|password|image|audio|projectionMatrix|cameraToWorld)/i.test(k))).slice(0,24).map(([k,v])=>[k,activityDetails(v,depth+1)]));
 return undefined;
}
export function appendActivity(run,message,extra={}){const entry={time:Date.now(),message,...extra};run.events.push(entry);if(run.events.length>400)run.events.splice(0,run.events.length-400);run.updatedAt=entry.time;return entry;}
export function resultDetails(value){
 if(!value||typeof value!=='object')return {result:value};if(value.error)return {error:String(value.error)};
 const keys=Object.keys(value);const selected={resultFields:keys.filter(k=>!/(image|audio|vertices|indices)/i.test(k)).slice(0,18)};
 for(const k of ['modelId','modelIds','models','state','summary','verification','nativeValidation','warnings','kind','fit','source','id','version','operation','document','figure','dimensionsMetres','nativeSketchId','solidCreated','drawingReview'])if(value[k]!==undefined)selected[k]=k==='document'?{name:value[k]?.name,version:value[k]?.version,bodyCount:Object.keys(value[k]?.derived?.bodyRepresentations||{}).length}:value[k];
 return activityDetails(selected);
}

export function toolAction(tool,args={}){
 const names={drawing_create:'Creating a dimensioned native 2D '+(args.kind||'figure'),drawing_update:'Updating drawing dimensions',drawing_list:'Reading editable drawing figures and dimensions',cad_document:'Inspecting the CAD project',cad_command_help:'Checking CAD operation '+(args.operation||'schemas'),primitive_from_strokes:'Creating '+(args.shape||'geometry')+' from the drawing',cad_execute:'CAD edit: '+(args.operation||'operation'),scene_models:'Inspecting current model geometry',agent_capture:'Rendering the model to inspect it',sketch_views:'Comparing the drawing and model from multiple views',agent_review:'Preparing the verified draft for review',model_transform:'Moving or scaling a model',model_fit_check:'Checking model dimensions against the drawing',stroke_reference:'Reading drawing images and fitted parameters',cad_create_project:'Creating an editable CAD project'};return names[tool]||'Running '+tool.replaceAll('_',' ');
}
