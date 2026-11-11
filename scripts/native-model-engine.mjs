import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,readFile,writeFile,access,rename} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID,createHash} from 'node:crypto';
import {validateBlenderParameters} from '../src/blender-contract.js';
export function createNativeModelEngine({key,name,executable,argumentsForWorker,worker,operations,nativeFormat,formats,guiExecutable,environment=()=>({})}){
const root=()=>path.resolve(process.env.SESSION_DIR||'sessions','modeling',key);
let child,readyPromise,version,serial=Promise.resolve();const pending=new Map();let stderr='',queued=0;
function failure(error){for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();readyPromise=undefined;version=undefined;}
async function start(){
 if(readyPromise)return readyPromise;
 readyPromise=new Promise((resolve,reject)=>{
  let settled=false;const proc=child=spawn(executable(),argumentsForWorker(worker),{windowsHide:true,env:{...process.env,...environment(),PYTHONIOENCODING:'utf-8'}});
  const startupMs=Math.max(1000,Math.min(180000,Number(process.env.DRAW3D_NATIVE_STARTUP_MS)||90000));
  const timer=setTimeout(()=>{proc.kill();reject(Error('Native engine startup timed out; please retry after the cold start'));readyPromise=undefined;},startupMs);
  proc.stderr.on('data',b=>stderr=(stderr+b).slice(-4000));
  createInterface({input:proc.stdout}).on('line',line=>{
   if(line.startsWith('DRAW3D_READY ')){clearTimeout(timer);version=JSON.parse(line.slice(13)).version;settled=true;resolve({ready:true,version,operations,engine:key,exports:Object.keys(formats),guiAvailable:process.env.ALLOW_NATIVE_GUI==='1'||process.platform==='win32'&&process.env.ALLOW_NATIVE_GUI!=='0'});}
   if(line.startsWith('DRAW3D_RESULT ')){try{const value=JSON.parse(line.slice(14)),item=pending.get(value.id);if(item){pending.delete(value.id);clearTimeout(item.timer);if(value.error)item.reject(Error(value.error));else item.resolve(value.result);}}catch(error){failure(Error('Invalid native engine response: '+error.message));}}
  });
  proc.on('error',()=>{clearTimeout(timer);const e=Error('Native engine unavailable; check the server engine path or container.');if(!settled)reject(e);failure(e);});
  proc.on('exit',()=>{clearTimeout(timer);if(child===proc){child=undefined;const e=Error('Native engine stopped unexpectedly; the scene was not changed.');if(!settled)reject(e);failure(e);}});
 });
 return readyPromise;
}
async function health(){try{return await start();}catch(error){return {ready:false,error:error.message,operations:[]};}}
function close(){const proc=child;child=undefined;readyPromise=undefined;version=undefined;failure(Error('Native engine closed'));proc?.kill();}
const idOK=id=>typeof id==='string'&&id.length>0&&id.length<=240;
function validateDocument(d){
 if(!d||!['draw3d.blender.v1','draw3d.modeling.v1'].includes(d.schema)||!Array.isArray(d.meshes)||d.meshes.length>32||!Array.isArray(d.operations)||!d.operations.length||d.operations.length>64||!idOK(d.targetId))throw Error('Invalid Blender document');
 if(d.checkpoint&&(!/^[a-f0-9-]{36}$/.test(d.checkpoint.artifactId)||!Number.isInteger(d.checkpoint.operationCount)||d.checkpoint.operationCount<1||d.checkpoint.operationCount>d.operations.length))throw Error('Invalid native checkpoint');if(d.checkpoint?.beforeFeatureIndex!==undefined&&(d.checkpoint.beforeFeatureIndex!==d.checkpoint.operationCount||!Number.isInteger(d.checkpoint.beforeFeatureIndex)))throw Error('Invalid native feature checkpoint');
 if(d.collaborationValidation){const c=d.collaborationValidation,b=c.bounds;if(key!=='freecad'||!c||Object.keys(c).some(k=>!['artifactId','bounds'].includes(k))||!(/^[a-f0-9-]{36}$/).test(c.artifactId)||!b||Object.keys(b).some(k=>!['min','max'].includes(k))||!['min','max'].every(k=>Array.isArray(b[k])&&b[k].length===3&&b[k].every(v=>Number.isFinite(v)&&Math.abs(v)<=10000))||b.min.some((v,i)=>v>b.max[i]))throw Error('Invalid native collaboration bounds guard');}
 if(d.referenceArtifactId&&!/^[a-f0-9-]{36}$/.test(d.referenceArtifactId))throw Error('Invalid native topology reference artifact');
 const ids=new Set();let points=0;
 for(const m of d.meshes){if(!m||!idOK(m.id)||ids.has(m.id)||typeof m.name!=='string'||m.name.length>200||!Array.isArray(m.vertices)||m.vertices.length<9||m.vertices.length%3||!Array.isArray(m.indices)||m.indices.length<3||m.indices.length%3)throw Error('Invalid Blender input mesh');ids.add(m.id);points+=m.vertices.length/3;if(m.nativeSource&&(!/^[a-f0-9-]{36}$/.test(m.nativeSource.artifactId)||!Array.isArray(m.nativeSource.matrix)||m.nativeSource.matrix.length!==16||m.nativeSource.matrix.some(v=>!Number.isFinite(v))))throw Error('Invalid native CAD source');if(m.analytic&&(!Array.isArray(m.analytic.matrix)||m.analytic.matrix.length!==16||m.analytic.matrix.some(v=>!Number.isFinite(v))||!['cuboid','cylinder','spheroid','plane'].includes(m.analytic.kind)))throw Error('Invalid analytic CAD source');if(m.analytic){const a=m.analytic,p=a.parameters;if(!p||a.kind==='spheroid'&&(!Array.isArray(p.radiiMetres)||p.radiiMetres.length!==3||p.radiiMetres.some(v=>!Number.isFinite(v)||v<=0||v>100)))throw Error('Invalid analytic CAD dimensions');validateBlenderParameters(a.kind==='cuboid'?'create_cube':a.kind==='spheroid'?'create_sphere':'create_'+a.kind,{center:p.center,axes:p.axes,...(a.kind==='spheroid'?{radiusMetres:Math.max(...p.radiiMetres)}:a.kind==='cuboid'||a.kind==='plane'?{sizeMetres:p.sizeMetres}:{radiusMetres:p.radiusMetres,heightMetres:p.heightMetres})});}
  if(points>600000||m.indices.length>1200000||m.vertices.some(v=>!Number.isFinite(v)||Math.abs(v)>10000)||m.indices.some(i=>!Number.isInteger(i)||i<0||i>=m.vertices.length/3))throw Error('Blender mesh exceeds geometry limits');
 }
 for(const op of d.operations){if(!op||!operations.includes(op.operation)||['edit_modifier','remove_feature','transform_body'].includes(op.operation)||!idOK(op.targetId)||typeof op.name!=='string'||!op.name.trim()||op.name.length>200||!Array.isArray(op.toolIds)||op.toolIds.length>8)throw Error('Invalid Blender modeling operation');
  if(key==='blender'&&op.operation==='mirror'&&Object.keys(op.parameters||{}).some(k=>k!=='axis'))throw Error('Blender mirror accepts only axis');
  const create=op.operation.startsWith('create_');if(create){if(ids.has(op.targetId)||op.toolIds.length)throw Error('Duplicate Blender primitive');ids.add(op.targetId);}else if(!ids.has(op.targetId))throw Error('Unknown Blender target');
  const boolean=['difference','union','intersect','loft','sweep'].includes(op.operation);if(boolean?!op.toolIds.length:op.toolIds.length)throw Error('Boolean operations require tool meshes');
  if(new Set(op.toolIds).size!==op.toolIds.length||op.toolIds.some(id=>!ids.has(id)||id===op.targetId))throw Error('Unknown Blender tool');validateBlenderParameters(op.operation,op.parameters||{});if(op.topologyReferences){if(!op.topologyReferences||typeof op.topologyReferences!=='object'||JSON.stringify(op.topologyReferences).length>1000000)throw Error('Invalid topology references');for(const [key,items]of Object.entries(op.topologyReferences)){if(!['edges','faces'].includes(key)||!Array.isArray(items)||items.length>2048||items.some(x=>!Number.isInteger(x.index)||!Array.isArray(x.center)||x.center.length!==3||!x.center.every(Number.isFinite)||typeof x.type!=='string'))throw Error('Invalid native topology reference');}}
 }
 if(!ids.has(d.targetId))throw Error('Unknown Blender result target');return d;
}
async function run(document){
 validateDocument(document);if(queued>=8)throw Error('Modeling queue is full; retry after the current operation');queued++;
 const previous=serial;let release;serial=new Promise(resolve=>release=resolve);await previous;
 try{
  await start();const id=randomUUID(),folder=path.join(root(),id);await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'document.json'),JSON.stringify(document));
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);const proc=child;child=undefined;readyPromise=undefined;proc?.kill();reject(Error('Native modeling timed out; reduce model complexity'));},60000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,document,folder})+'\n',error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});});
  const inputDigest=createHash('sha256').update(JSON.stringify(document)).digest('hex');
  if(result.parts){if(key!=='freecad'||!Array.isArray(result.parts)||result.parts.length>1||result.parts.some(p=>p.directory!=='part-0'||p.role!=='extracted'||p.result?.metrics?.valid!==true))throw Error('Invalid native region transaction output');result.parts=await Promise.all(result.parts.map(async part=>{const partId=randomUUID(),partFolder=path.join(root(),partId);await rename(path.join(folder,part.directory),partFolder);const value={...part.result,artifactId:partId,engine:key,role:part.role,name:part.name,transactionInputDigest:inputDigest,exports:Object.fromEntries(Object.keys(formats).map(format=>[format,'/api/'+key+'/export/'+partId+'/'+format]))};await writeFile(path.join(partFolder,'result.json'),JSON.stringify(value));return value;}));}
  await writeFile(path.join(folder,'result.json'),JSON.stringify(result));return {...result,inputDigest,artifactId:id,engine:key,exports:Object.fromEntries(Object.keys(formats).map(format=>[format,'/api/'+key+'/export/'+id+'/'+format]))};
 }finally{queued--;release();}
}
const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function handle(req,res){
 const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/'+key+'/'))return false;
 try{
  const allowed=(process.env.DRAW3D_AGENT_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173').split(',');if(req.headers.origin&&!allowed.includes(req.headers.origin)){reply(res,403,{error:'Origin not allowed'});return true;}
  if(req.method==='GET'&&url.pathname==='/api/'+key+'/health'){reply(res,200,await health());return true;}
  const match=url.pathname.match(new RegExp('^/api/'+key+'/export/([a-f0-9-]{36})/([a-z]+)$'));
  if(req.method==='GET'&&match){if(!formats[match[2]])throw Error('Unsupported export format');const file=path.join(root(),match[1],formats[match[2]]),bytes=await readFile(file);res.writeHead(200,{'Content-Type':match[2]==='glb'?'model/gltf-binary':'application/octet-stream','Content-Disposition':'attachment; filename="Draw3D-'+match[1]+'.'+match[2]+'"','Cache-Control':'no-store'});res.end(bytes);return true;}
  if(req.method!=='POST'||!['/api/'+key+'/run','/api/'+key+'/open'].includes(url.pathname)){reply(res,404,{error:'Not found'});return true;}
  if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON required');let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>24000000)throw Error('Blender request exceeds 24 MB');chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(url.pathname.endsWith('/open')){if(process.env.ALLOW_NATIVE_GUI==='0'||process.platform!=='win32'&&process.env.ALLOW_NATIVE_GUI!=='1')throw Error('Native GUI launch is disabled on this server; download the project to open it locally');if(typeof body.artifactId!=='string'||!(/^[a-f0-9-]{36}$/).test(body.artifactId))throw Error('Invalid Blender artifact');const file=path.join(root(),body.artifactId,formats[nativeFormat]);await access(file);const process=spawn((guiExecutable||executable)(),key==='blender'?['--disable-autoexec',file]:[file],{detached:true,stdio:'ignore',windowsHide:false});await new Promise((resolve,reject)=>{process.once('spawn',resolve);process.once('error',reject);});process.unref();reply(res,200,{opened:true});return true;}
  reply(res,200,await run(body));
 }catch(error){reply(res,error.code==='ENOENT'?404:400,{error:error.message});}return true;
}

return {health,close,run,validateDocument,handle};
}
