import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {once} from 'node:events';
import {hashPasscode,userKey,seal} from './auth.mjs';import {createGateway} from './gateway.mjs';
test('gateway enforces both factors, refuses cross-origin writes, and routes each subject to its own runtime',async()=>{
 process.env.SESSION_SIGNING_KEY='a'.repeat(64);process.env.PASSCODE_HASH=hashPasscode('7351910284');process.env.GOOGLE_CLIENT_ID='test-client';process.env.PUBLIC_ORIGIN='https://test.run.app';
 const lookups=[],worker=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url,identity:req.headers['x-serverless-authorization'],spoof:req.headers['x-draw3d-user']||null,authorization:req.headers.authorization}));});worker.listen(0,'127.0.0.1');await once(worker,'listening');
 const gateway=createGateway({verifyGoogle:async credential=>JSON.parse(credential),lookupWorkspace:async key=>{lookups.push(key);return {ready:true,url:'http://127.0.0.1:'+worker.address().port};},identityForWorker:async()=> 'Bearer server-identity'});gateway.listen(0,'127.0.0.1');await once(gateway,'listening');const base='http://127.0.0.1:'+gateway.address().port;
 try{
  assert.equal((await fetch(base+'/api/freecad/export/another-user/step')).status,401);assert.equal(lookups.length,0);
  const challenge=await fetch(base+'/auth/nonce'),{nonce}=await challenge.json(),cookie=challenge.headers.get('set-cookie').split(';')[0];
  const claims={sub:'123456789',email:'one@gmail.com',email_verified:true,nonce};const login=(input,origin='https://test.run.app')=>fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await login({credential:JSON.stringify(claims),passcode:'7351910285'})).status,401);
  assert.equal((await login({credential:JSON.stringify({...claims,nonce:'wrong'}),passcode:'7351910284'})).status,401);
  assert.equal((await login({credential:JSON.stringify(claims),passcode:'7351910284'},'https://evil.example')).status,403);
  const accepted=await login({credential:JSON.stringify(claims),passcode:'7351910284'});assert.equal(accepted.status,200);assert.match(accepted.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);const sessionCookie=accepted.headers.get('set-cookie').split(';')[0];
  const r=await fetch(base+'/api/private',{headers:{Cookie:sessionCookie,Authorization:'Bearer app-capability','X-Draw3d-User':'someone-else','X-Serverless-Authorization':'attacker'}});assert.equal(r.status,200);const data=await r.json();assert.equal(data.identity,'Bearer server-identity');assert.equal(data.authorization,'Bearer app-capability');assert.equal(data.spoof,null);assert.equal(lookups.at(-1),userKey(claims.sub));
  const second=seal({sub:'987654321',email:'two@gmail.com',exp:Date.now()+10000},process.env.SESSION_SIGNING_KEY);assert.equal((await fetch(base+'/auth/workspace',{headers:{Cookie:'__Host-draw3d='+second}})).status,200);assert.equal(lookups.at(-1),userKey('987654321'));assert.notEqual(lookups[0],lookups.at(-1));
  assert.equal((await fetch(base+'/api/private',{method:'POST',headers:{Cookie:sessionCookie,Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/api/private',{headers:{Cookie:sessionCookie+'tampered'}})).status,401);
 }finally{await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>worker.close(r))]);}
});
