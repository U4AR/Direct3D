import {GoogleAuth} from 'google-auth-library';
const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
const project=process.env.GOOGLE_CLOUD_PROJECT,region=process.env.CLOUD_REGION||'us-central1';
const base=`https://run.googleapis.com/v2/projects/${project}/locations/${region}/services`;
async function call(url,method='GET',body){const client=await auth.getClient(),headers=await client.getRequestHeaders();const r=await fetch(url,{method,headers:{...Object.fromEntries(headers.entries()),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok){const error=Error(data.error?.message||'Cloud workspace request failed');error.status=r.status;throw error;}return data;}
export function workspaceSpec(key,origin){
 if(!/^[a-f0-9]{32}$/.test(key))throw Error('Invalid private workspace key');
 return {labels:{app:'draw3d',workspace:key},ingress:'INGRESS_TRAFFIC_ALL',scaling:{minInstanceCount:0,maxInstanceCount:1},template:{serviceAccount:process.env.WORKER_SERVICE_ACCOUNT,maxInstanceRequestConcurrency:20,timeout:'900s',sessionAffinity:true,scaling:{minInstanceCount:0,maxInstanceCount:1},executionEnvironment:'EXECUTION_ENVIRONMENT_GEN2',containers:[{image:process.env.WORKER_IMAGE,ports:[{containerPort:8080}],resources:{limits:{cpu:'2',memory:'8Gi'},cpuIdle:true,startupCpuBoost:false},env:Object.entries({BRIDGE_PORT:'8080',BRIDGE_HOST:'0.0.0.0',DRAW3D_STATIC_DIR:'/app/dist',SESSION_DIR:'/data',DRAW3D_AGENT_ORIGINS:origin,ALLOW_NATIVE_GUI:'0',DRAW3D_AGENT_PROVIDER:'openai',DRAW3D_GOOGLE_BACKUP:'1',OPENAI_API_KEY_FILE:'/run/secrets/openai/key',GOOGLE_CLOUD_PROJECT:project,VERTEX_LOCATION:'global',VERTEX_AGENT_MODEL:process.env.VERTEX_AGENT_MODEL||'gemini-3.8-flash',DRAW3D_CREATION_WORKFLOW:'direct',DRAW3D_NATIVE_HARNESS_TOOLS:'0',DRAW3D_USER_NAMESPACE:key}).map(([name,value])=>({name,value})),volumeMounts:[{name:'workspace',mountPath:'/data'},{name:'openai',mountPath:'/run/secrets/openai'}],startupProbe:{httpGet:{path:'/api/health',port:8080},periodSeconds:5,failureThreshold:48}}],volumes:[{name:'openai',secret:{secret:'draw3d-openai-key',items:[{version:'latest',path:'key'}]}},{name:'workspace',gcs:{bucket:process.env.WORKSPACE_BUCKET,readOnly:false,mountOptions:[`only-dir=users/${key}`,'uid=10001','gid=10001','implicit-dirs','rename-dir-limit=10000']}}]}};
}
export async function workspace(key,origin){
 const name='draw3d-u-'+key.slice(0,24),url=base+'/'+name;
 try{const service=await call(url);const ready=service.conditions?.some(c=>c.type==='Ready'&&c.state==='CONDITION_SUCCEEDED')||service.terminalCondition?.state==='CONDITION_SUCCEEDED';if(service.terminalCondition?.state==='CONDITION_FAILED')throw Error('Workspace startup failed. Contact the administrator.');return {ready:!!ready,url:service.uri};}catch(error){if(error.status!==404)throw error;}
 const listed=await call(base+'?pageSize=1000');const count=(listed.services||[]).filter(s=>s.labels?.app==='draw3d'&&s.labels?.workspace).length;
  if(count>=Number(process.env.MAX_WORKSPACES||10))throw Error('All invitation spaces are in use. Please ask the administrator to increase capacity.');
 // This placeholder ensures that the restricted FUSE directory exists.
 try{await call(`https://storage.googleapis.com/upload/storage/v1/b/${process.env.WORKSPACE_BUCKET}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent('users/'+key+'/.keep')}`,'POST');}catch(error){if(error.status!==412)throw error;}
 try{await call(base+'?serviceId='+name,'POST',workspaceSpec(key,origin));}catch(error){if(error.status!==409)throw error;}
 return {ready:false};
}
const clients=new Map();
// An immutable per-account marker needs only Object Creator, not bucket reads.
export async function claimOnboarding(key){
 if(!/^[a-f0-9]{32}$/.test(key))throw Error('Invalid private workspace key');
 try{await call(`https://storage.googleapis.com/upload/storage/v1/b/${process.env.WORKSPACE_BUCKET}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent('onboarding/v1/'+key+'.json')}`,'POST',{version:1,seenAt:new Date().toISOString()});return true;}catch(error){if(error.status===412)return false;throw error;}
}
export async function workerIdentity(url){let client=clients.get(url);if(!client){client=await auth.getIdTokenClient(url);clients.set(url,client);}const headers=await client.getRequestHeaders();return headers.get('authorization');}
