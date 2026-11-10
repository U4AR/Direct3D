// Serve the built webpage and same-origin backend. Useful on removable drives
// where recursive development watchers can stall. No browser automation here.
import http from 'node:http';
import {serveStatic} from './serve-static.mjs';
const port=Number(process.env.DESKTOP_WEB_PORT||5191),root=process.env.DESKTOP_WEB_DIR||'dist',backend=new URL(process.env.DRAW3D_BACKEND_URL||'http://127.0.0.1:18890');
http.createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')){const proxy=http.request(new URL(req.url,backend),{method:req.method,headers:req.headers},upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);});res.once('close',()=>{if(!res.writableEnded)proxy.destroy();});proxy.on('error',()=>{if(res.destroyed)return;res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Backend unavailable'}));});req.pipe(proxy);return;}
 await serveStatic(req,res,root);
}).listen(port,process.env.DESKTOP_WEB_HOST||'127.0.0.1',()=>console.log('Desktop web ready on port '+port));
