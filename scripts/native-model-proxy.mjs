import {Readable} from 'node:stream';
export async function proxyNativeModel(req,res,base,key){
 const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/'+key+'/'))return false;
 const origins=(process.env.DRAW3D_AGENT_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173').split(',');
 if(req.headers.origin&&!origins.includes(req.headers.origin)){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Origin not allowed'}));return true;}
 try{const chunks=[];let size=0;if(!['GET','HEAD'].includes(req.method))for await(const chunk of req){size+=chunk.length;if(size>24000000)throw Error('Modeling request exceeds 24 MB');chunks.push(chunk);}
 const response=await fetch(new URL(url.pathname+url.search,base),{method:req.method,headers:{...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{}),...(process.env.MODELING_SERVICE_TOKEN?{'X-Modeling-Token':process.env.MODELING_SERVICE_TOKEN}:{})},...(chunks.length?{body:Buffer.concat(chunks)}:{}),signal:AbortSignal.timeout(75000)});
 const headers={};for(const key of ['content-type','content-disposition','cache-control'])if(response.headers.has(key))headers[key]=response.headers.get(key);res.writeHead(response.status,headers);if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
 }catch(error){if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:key+' engine: '+error.message}));}return true;
}
export async function nativeRemoteHealth(base,key){try{const r=await fetch(new URL('/api/'+key+'/health',base),{headers:process.env.MODELING_SERVICE_TOKEN?{'X-Modeling-Token':process.env.MODELING_SERVICE_TOKEN}:{},signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Engine health HTTP '+r.status);return await r.json();}catch(error){return {ready:false,error:error.message,operations:[]};}}
export async function nativeRemoteRun(base,key,document){const r=await fetch(new URL('/api/'+key+'/run',base),{method:'POST',headers:{'Content-Type':'application/json',...(process.env.MODELING_SERVICE_TOKEN?{'X-Modeling-Token':process.env.MODELING_SERVICE_TOKEN}:{})},body:JSON.stringify(document),signal:AbortSignal.timeout(75000)});const result=await r.json();if(!r.ok)throw Error(result.error||'Native modeling failed');return result;}
