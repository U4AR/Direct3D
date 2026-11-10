import http from 'node:http';import {readFile} from 'node:fs/promises';import {randomBytes} from 'node:crypto';import {Readable} from 'node:stream';
import {OAuth2Client} from 'google-auth-library';
import {seal,unseal,verifyPasscode,cookies,sessionIdentity,sameOrigin} from './auth.mjs';
import {workspace,workerIdentity,claimOnboarding} from './workspaces.mjs';
import {fileURLToPath} from 'node:url';import path from 'node:path';
export function createGateway({verifyGoogle,lookupWorkspace=workspace,identityForWorker=workerIdentity,claimTutorial=claimOnboarding}={}){
const key=process.env.SESSION_SIGNING_KEY,passHash=process.env.PASSCODE_HASH,clientId=process.env.GOOGLE_CLIENT_ID||'',oauth=new OAuth2Client(clientId);
if(!key||key.length<32||!passHash)throw Error('Authentication secrets must be configured');
const cookieName='__Host-draw3d',nonceName='__Host-draw3d_nonce',inviteName='__Host-draw3d_invite';
const attempts=new Map(),routes=new Map();
const send=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));};
const cookie=(name,value,seconds)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
const originFor=req=>process.env.PUBLIC_ORIGIN||'https://'+req.headers.host;
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>12000)throw Error('Request too large');}return JSON.parse(data||'{}');}
function limited(req){const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',').map(x=>x.trim()).at(-1);const now=Date.now();if(attempts.size>20000)for(const [k,v]of attempts)if(v.until<now)attempts.delete(k);const value=attempts.get(ip);if(!value||value.until<now){attempts.set(ip,{count:1,until:now+900000});return false;}return ++value.count>12;}
async function getWorkspace(user,origin){const cached=routes.get(user.key);if(cached&&cached.until>Date.now())return cached.value;const value=await lookupWorkspace(user.key,origin);if(value.ready)routes.set(user.key,{value,until:Date.now()+60000});return value;}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'),origin=originFor(req);const jar=cookies(req);
  res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');
  if(url.pathname==='/_health'){send(res,200,{ready:true,service:'Draw3D access gateway'});return;}
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!sameOrigin(req,origin)){send(res,403,{error:'Request origin not allowed'});return;}
  if(url.pathname==='/auth/config'&&req.method==='GET'){send(res,200,{clientId});return;}
  if(url.pathname==='/auth/passcode'&&req.method==='POST'){
   if(limited(req)){send(res,429,{error:'Too many passcode attempts. Please wait 15 minutes.'});return;}
   const input=await body(req);if(!verifyPasscode(input.passcode,passHash)){send(res,401,{error:'That invitation passcode was not accepted. Please check the number.'});return;}
   const nonce=randomBytes(24).toString('hex'),proof=seal({nonce,exp:Date.now()+600000},key);
   send(res,200,{accepted:true,nonce},{'Set-Cookie':[cookie(nonceName,proof,600),cookie(inviteName,proof,600)]});return;
  }
  if(url.pathname==='/auth/login'&&req.method==='POST'){
   if(!clientId){send(res,503,{error:'Google sign-in is being configured'});return;}
   if(limited(req)){send(res,429,{error:'Too many sign-in attempts. Please wait 15 minutes.'});return;}
   const input=await body(req),challenge=unseal(jar[nonceName],key),invitation=unseal(jar[inviteName],key);
   if(!challenge||!invitation||invitation.nonce!==challenge.nonce){send(res,401,{error:'Your sign-in step expired. Refresh and enter the passcode again.'});return;}
   let claims;try{claims=verifyGoogle?await verifyGoogle(input.credential):(await oauth.verifyIdToken({idToken:input.credential,audience:clientId})).getPayload();}catch{send(res,401,{error:'Google sign-in could not be verified. Please refresh and try again.'});return;}
   if(!claims.email_verified||!claims.sub||claims.nonce!==challenge.nonce){send(res,401,{error:'Google sign-in could not be verified. Please refresh and try again.'});return;}
   const session={sub:claims.sub,email:claims.email,exp:Date.now()+12*3600000};
   if(!sessionIdentity(session)){send(res,401,{error:'Invalid Google account'});return;}
   send(res,200,{signedIn:true},{'Set-Cookie':[cookie(cookieName,seal(session,key),43200),cookie(nonceName,'',0),cookie(inviteName,'',0)]});return;
  }
  const user=sessionIdentity(unseal(jar[cookieName],key));
  if(url.pathname==='/auth/me'){send(res,user?200:401,user?{email:user.email}:{error:'Sign-in required'});return;}
  if(url.pathname==='/auth/logout'&&req.method==='POST'){send(res,200,{signedOut:true},{'Set-Cookie':cookie(cookieName,'',0)});return;}
  if(url.pathname==='/auth/login.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(await readFile(new URL('./login.js',import.meta.url)));return;}
  if(url.pathname==='/auth/account.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(`addEventListener('DOMContentLoaded',()=>{const b=document.createElement('button');b.textContent='Sign out';b.title='Sign out of your private workspace';b.style.cssText='position:fixed;right:12px;bottom:12px;z-index:99999;border:1px solid #526b77;background:#17252e;color:#e9f1f4;border-radius:8px;padding:8px 12px;cursor:pointer';b.onclick=async()=>{await fetch('/auth/logout',{method:'POST'});location.replace('/login')};document.body.append(b)});`);return;}
  if(url.pathname==='/login'||!user&&req.method==='GET'&&(url.pathname==='/'||url.pathname.endsWith('.html'))){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(await readFile(new URL('./login.html',import.meta.url)));return;}
  if(!user){send(res,401,{error:'Google sign-in and invitation passcode required'});return;}
  if(url.pathname.startsWith('/learn/')){
   if(url.pathname==='/learn/visit'&&req.method==='POST'){send(res,200,{firstVisit:await claimTutorial(user.key),version:1});return;}
   const assets=new Map([['/learn/onboarding.js',['onboarding.js','text/javascript; charset=utf-8']],['/learn/onboarding.css',['onboarding.css','text/css; charset=utf-8']],...['sketch','model','edit','vr'].map(name=>['/learn/assets/'+name+'.webp',['tutorial-assets/'+name+'.webp','image/webp']])]);
   const asset=assets.get(url.pathname);
   if(asset&&req.method==='GET'){res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'});res.end(await readFile(new URL('./'+asset[0],import.meta.url)));return;}
   send(res,404,{error:'Tutorial resource not found'});return;
  }
  if(url.pathname==='/auth/workspace'&&req.method==='GET'){const status=await getWorkspace(user,origin);send(res,200,{ready:status.ready});return;}
  const target=await getWorkspace(user,origin);
  if(!target.ready){if(req.method==='GET'&&!url.pathname.startsWith('/api/')){res.writeHead(302,{Location:'/login','Cache-Control':'no-store'});res.end();}else send(res,503,{error:'Your private workspace is starting. Please wait a moment.'});return;}
  if(url.pathname==='/'&&req.method==='GET'){res.writeHead(302,{Location:'/desktop.html','Cache-Control':'no-store'});res.end();return;}
  const headers={...req.headers};for(const name of ['host','cookie','connection','content-length','x-serverless-authorization','x-goog-iap-jwt-assertion','x-draw3d-user'])delete headers[name];
  headers['x-serverless-authorization']=await identityForWorker(target.url);headers.origin=origin;
  const upstream=await fetch(target.url+url.pathname+url.search,{method:req.method,headers,redirect:'manual',...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
  const responseHeaders=Object.fromEntries(upstream.headers.entries());for(const name of ['connection','content-encoding','content-length','set-cookie'])delete responseHeaders[name];responseHeaders['cache-control']='private, no-store';
  if(upstream.headers.get('content-type')?.includes('text/html')){
   const html=await upstream.text();const tutorial=['/desktop.html','/index.html'].includes(url.pathname)?'<script src="/learn/onboarding.js" defer></script>':'';const bootstrap=`<script>window.DRAW3D_USER_NAMESPACE=${JSON.stringify(user.key)};</script><script src="/auth/account.js" defer></script>${tutorial}`;
   res.writeHead(upstream.status,responseHeaders);res.end(html.replace('</head>',bootstrap+'</head>'));return;
  }
  res.writeHead(upstream.status,responseHeaders);if(upstream.body)Readable.fromWeb(upstream.body).pipe(res);else res.end();
 }catch(error){console.error('Gateway request failed:',String(error.message).replace(/Bearer\s+\S+/g,'Bearer [redacted]'));if(!res.headersSent)send(res,503,{error:'The workspace could not be reached. Please retry in a moment.'});else res.end();}
});
return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))createGateway().listen(Number(process.env.PORT||8080),'0.0.0.0');
