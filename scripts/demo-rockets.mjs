import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const evidence=new URL('../artifacts/agent/rockets/',import.meta.url);
await mkdir(evidence,{recursive:true});
const child=spawn(process.execPath,[fileURLToPath(new URL('./draw3d-mcp.mjs',import.meta.url))],{cwd:root,stdio:['pipe','pipe','inherit']});
let seq=0; const pending=new Map();
createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);pending.get(m.id)?.(m);pending.delete(m.id);});
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,m=>m.error?reject(Error(m.error.message)):resolve(m.result));child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
const log=[];
async function call(name,args={}){const r=await rpc('tools/call',{name,arguments:args});const t=r.content?.find(x=>x.type==='text')?.text;const data=r.isError?{error:t}:JSON.parse(t||'null');log.push({at:new Date().toISOString(),name,args,result:data});await writeFile(new URL('calls-'+(process.argv[2]||'inspect')+'.json',evidence),JSON.stringify(log,null,2));if(r.isError)throw Error(name+': '+t);return {data,image:r.content?.find(x=>x.type==='image')?.data};}
await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'rocket-building-agent',version:'1'}});
child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
try{
const mode=process.argv[2]||'inspect';
if(mode==='inspect'){
 console.log(JSON.stringify((await rpc('tools/list')).tools));
 for(const name of ['draw3d_sessions'])console.log(name,JSON.stringify((await call(name)).data));
 for(const operation of ['addPrimitive','transformBody','addSketch','extrudeSketch'])console.log(operation,JSON.stringify((await call('cad_command_help',{operation})).data));
}else if(mode==='build'){
 const sessionId=process.argv[3]||'5e6cf31f-f262-4839-973b-36f647ec8c4a';
 const invoke=async(name,args={})=>(await call(name,{sessionId,...args})).data;
 const manifest={created:new Date().toISOString(),sessionId,cad:{parts:[]},sculpt:{parts:[]},captures:[]};
 const save=()=>writeFile(new URL('manifest.json',evidence),JSON.stringify(manifest,null,2));
 manifest.before=await invoke('agent_status');
 await invoke('workspace_select',{workspace:'cad'});
 const project=await invoke('cad_create_project',{name:'Agent Rocket â€” parametric display model',units:'mm'});
 manifest.cad.projectId=project.projectId; let version=project.version;
 async function exec(operation,payload){const r=await invoke('cad_execute',{operation,payload,expectedVersion:version});version=r.version;if(r.diagnostics?.some?.(d=>d.severity==='error'))throw Error(JSON.stringify(r.diagnostics)); console.log('CAD',version,operation,payload.name);await save();return r;}
 async function primitive(name,primitiveKind,dimensions,translation={x:0,y:0,z:0},rotationDeg){const r=await exec('addPrimitive',{name,bodyName:name,primitiveKind,dimensions});const id=r.command.payload.ids.bodyId;if(Object.values(translation).some(Boolean)||rotationDeg)await exec('transformBody',{name:'Position '+name,targetBodyId:id,translation,...(rotationDeg?{rotationDeg}:{})});manifest.cad.parts.push({name,nativeId:id,primitiveKind,dimensions,translation,rotationDeg});await save();return id;}
 await primitive('Rocket fuselage','cylinder',{radius:26,height:150},{x:0,y:0,z:30});
 await primitive('Pointed nose cone','cone',{bottomRadius:26,topRadius:0,height:60},{x:0,y:0,z:180});
 await primitive('Engine bell','cone',{bottomRadius:22,topRadius:14,height:26},{x:0,y:0,z:4});
 await primitive('Tail reinforcement band','cylinder',{radius:28,height:8},{x:0,y:0,z:30});
 await primitive('Nose joint band','cylinder',{radius:27.5,height:5},{x:0,y:0,z:176});
 for(let i=0;i<4;i++){
  const points=[[24,32],[64,8],[64,24],[24,100]];
  const objects=points.map((p,j)=>({objectKind:'line',x1:p[0],y1:p[1],x2:points[(j+1)%points.length][0],y2:points[(j+1)%points.length][1]}));
  const r=await exec('addSketch',{name:'Swept fin '+(i+1)+' profile',planeRef:{type:'canonical',plane:'XZ',offset:0,basisRevision:2},objects});
  const sketchId=r.command.payload.ids.sketchId;
  const ext=await exec('extrudeSketch',{name:'Swept fin '+(i+1),bodyName:'Swept fin '+(i+1),sketchId,distance:5,symmetric:true,operation:'new-body',profile:{all:true,sourceEntityIds:r.command.payload.ids.objectNodeIds}});
  const id=ext.command.payload.ids.bodyId;
  if(i)await exec('transformBody',{name:'Orient fin '+(i+1),targetBodyId:id,translation:{x:0,y:0,z:0},rotationDeg:{x:0,y:0,z:i*90}});
  manifest.cad.parts.push({name:'Swept fin '+(i+1),nativeId:id,sketchId,profile:points,thickness:5,angle:i*90});
 }
 await primitive('Porthole rim','torus',{majorRadius:9,minorRadius:2},{x:0,y:-25,z:140},{x:90,y:0,z:0});
 await primitive('Porthole inset','sphere',{radius:8},{x:0,y:-23,z:140});
 manifest.cad.document=(await invoke('cad_document')).document;await save();
 await invoke('workspace_select',{workspace:'sculpt'});
 let sv=(await invoke('sculpt_document')).revision;
 async function create(name,shape,sizeMm,positionMm){const r=await invoke('sculpt_create',{name,shape,sizeMm,positionMm,expectedVersion:sv});sv=r.revision;manifest.sculpt.parts.push({name,nativeId:r.id,shape,sizeMm,positionMm});console.log('SCULPT',sv,name);await save();return r.id;}
 async function brush(id,centerMm,radiusMm,displacementMm){const r=await invoke('sculpt_brush',{id,centerMm,radiusMm,displacementMm,expectedVersion:sv});sv=r.revision;if(!r.affected)throw Error('Sculpt brush missed mesh');manifest.sculpt.parts.find(x=>x.nativeId===id).brushes??=[];manifest.sculpt.parts.find(x=>x.nativeId===id).brushes.push({centerMm,radiusMm,displacementMm,affected:r.affected});console.log('BRUSH',r.affected);await save();}
 await create('Sculpt rocket fuselage','cylinder',[52,150,52],[300,105,0]);
 const nose=await create('Sculpt pulled nose','sphere',[52,62,52],[300,196,0]);
 await brush(nose,[300,227,0],45,[0,37,0]);
 await create('Sculpt engine bell','cylinder',[38,25,38],[300,17.5,0]);
 await create('Sculpt tail collar','cylinder',[57,7,57],[300,32,0]);
 await create('Sculpt nose collar','cylinder',[55,5,55],[300,177,0]);
 for(let i=0;i<4;i++){
  const a=i*Math.PI/2,dx=Math.round(Math.cos(a)),dz=Math.round(Math.sin(a));
  const id=await create('Sculpt swept fin '+(i+1),'box',dx?[44,75,7]:[7,75,44],[300+dx*42,49,dz*42]);
  await brush(id,[300+dx*64,86.5,dz*64],65,[-dx*40,-22,-dz*40]);
 }
 await create('Sculpt porthole bezel','sphere',[22,22,7],[300,139,26]);
 await create('Sculpt porthole lens','sphere',[16,16,7],[300,139,30]);
 manifest.sculpt.document=await invoke('sculpt_document');
 const models=(await invoke('scene_models')).models;
 for(const kind of ['cad','sculpt'])for(const part of manifest[kind].parts){const m=models.find(x=>x.nativeId===part.nativeId);if(!m)throw Error('Missing scene model '+part.name);part.modelId=m.id;part.modelVersion=m.version;part.vertexCount=m.vertexCount;part.triangleCount=m.triangleCount;}
 manifest.models=models.filter(x=>[...manifest.cad.parts,...manifest.sculpt.parts].some(p=>p.modelId===x.id));
 for(const kind of ['cad','sculpt']){
  const x=kind==='cad'?0:.3;const modelIds=manifest[kind].parts.map(p=>p.modelId);
  for(const [angle,pos] of [['front',[x+.32,.26,.48]],['back',[x-.34,.21,-.48]]]){
   await invoke('agent_camera',{position:pos,target:[x,.12,0],fov:35});
   const r=await call('agent_capture',{sessionId,modelIds,width:960,height:960});
   const filename=kind+'-rocket-'+angle+'.png';await writeFile(new URL(filename,evidence),Buffer.from(r.image,'base64'));manifest.captures.push({kind,angle,file:filename,...r.data});console.log('CAPTURE',filename);
  }
 }
 manifest.after=await invoke('agent_status');manifest.userCameraUnchanged=JSON.stringify((manifest.resumeBefore||manifest.before).userCamera)===JSON.stringify(manifest.after.userCamera);await save();console.log(JSON.stringify({projectId:manifest.cad.projectId,cadParts:manifest.cad.parts.length,sculptParts:manifest.sculpt.parts.length,userCameraUnchanged:manifest.userCameraUnchanged,captures:manifest.captures.map(c=>c.file)}));
}else if(mode==='repair'){
 const manifest=JSON.parse(await readFile(new URL('manifest.json',evidence),'utf8'));const sessionId=process.argv[3]||manifest.sessionId;manifest.sessionId=sessionId;
 const invoke=async(name,args={})=>(await call(name,{sessionId,...args})).data;
 const save=()=>writeFile(new URL('manifest.json',evidence),JSON.stringify(manifest,null,2));
 const old=JSON.parse(await readFile(new URL('calls-build.json',evidence),'utf8'));
 let doc=(await invoke('cad_document')).document;if(!doc||doc.projectId!==manifest.cad.projectId)throw Error('Open saved rocket CAD project '+manifest.cad.projectId+' before resuming');manifest.resumeBefore=await invoke('agent_status');
 for(const c of old.filter(c=>c.name==='cad_execute'&&c.args.operation==='extrudeSketch')){
 const sketch=old.find(s=>s.name==='cad_execute'&&s.args.operation==='addSketch'&&s.result.command.payload.ids.sketchId===c.args.payload.sketchId);
 const r=await invoke('cad_execute',{operation:'updateFeature',payload:{featureId:c.result.command.payload.ids.featureId,data:{profile:{all:true,sourceEntityIds:sketch.result.command.payload.ids.objectNodeIds}}},expectedVersion:doc.version});
 doc=(await invoke('cad_document')).document;console.log('Repaired fin',doc.version,doc.derived.warnings);
 }
 if(doc.derived.warnings?.length)throw Error(JSON.stringify(doc.derived.warnings));manifest.cad.document=doc;manifest.sculpt.document=await invoke('sculpt_document');await save();
 const models=(await invoke('scene_models')).models;
 for(const kind of ['cad','sculpt'])for(const part of manifest[kind].parts){const m=models.find(x=>x.nativeId===part.nativeId);if(!m)throw Error('Missing scene model '+part.name);part.modelId=m.id;part.modelVersion=m.version;part.vertexCount=m.vertexCount;part.triangleCount=m.triangleCount;}
 manifest.models=models.filter(x=>[...manifest.cad.parts,...manifest.sculpt.parts].some(p=>p.modelId===x.id));
 for(const kind of ['cad','sculpt']){
  const x=kind==='cad'?0:.3;const modelIds=manifest[kind].parts.map(p=>p.modelId);
  for(const [angle,pos] of [['front',[x+.32,.26,.48]],['back',[x-.34,.21,-.48]]]){
   await invoke('agent_camera',{position:pos,target:[x,.12,0],fov:35});
   const r=await call('agent_capture',{sessionId,modelIds,width:960,height:960});
   const filename=kind+'-rocket-'+angle+'.png';await writeFile(new URL(filename,evidence),Buffer.from(r.image,'base64'));manifest.captures.push({kind,angle,file:filename,...r.data});console.log('CAPTURE',filename);
  }
 }
 manifest.after=await invoke('agent_status');manifest.userCameraUnchanged=JSON.stringify((manifest.resumeBefore||manifest.before).userCamera)===JSON.stringify(manifest.after.userCamera);await save();console.log(JSON.stringify({projectId:manifest.cad.projectId,cadParts:manifest.cad.parts.length,sculptParts:manifest.sculpt.parts.length,userCameraUnchanged:manifest.userCameraUnchanged,captures:manifest.captures.map(c=>c.file)}));
}else if(mode==='call')console.log(JSON.stringify((await call(process.argv[3],JSON.parse(process.argv[4]||'{}'))).data));
}finally{child.stdin.end();child.kill();}
