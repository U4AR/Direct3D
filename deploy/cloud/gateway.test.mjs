import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {once} from 'node:events';
import {hashPasscode,userKey,seal} from './auth.mjs';import {createGateway} from './gateway.mjs';
test('gateway enforces both factors, refuses cross-origin writes, and routes each subject to its own runtime',async()=>{
 process.env.SESSION_SIGNING_KEY='a'.repeat(64);process.env.PASSCODE_HASH=hashPasscode('7351910284');process.env.GOOGLE_CLIENT_ID='test-client';process.env.PUBLIC_ORIGIN='https://test.run.app';
 const lookups=[],worker=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url,identity:req.headers['x-serverless-authorization'],spoof:req.headers['x-draw3d-user']||null,authorization:req.headers.authorization}));});worker.listen(0,'127.0.0.1');await once(worker,'listening');
 const gateway=createGateway({verifyGoogle:async credential=>JSON.parse(credential),lookupWorkspace:async key=>{lookups.push(key);return {ready:true,url:'http://127.0.0.1:'+worker.address().port};},identityForWorker:async()=> 'Bearer server-identity'});gateway.listen(0,'127.0.0.1');await once(gateway,'listening');const base='http://127.0.0.1:'+gateway.address().port;
 try{
  assert.equal((await fetch(base+'/api/freecad/export/another-user/step')).status,401);assert.equal(lookups.length,0);
  const checkCode=(passcode,origin='https://test.run.app')=>fetch(base+'/auth/passcode',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({passcode})});
  assert.equal((await checkCode('7351910285')).status,401);
  assert.equal((await checkCode('7351910284','https://evil.example')).status,403);
  const challenge=await checkCode('7351910284'),{nonce}=await challenge.json(),cookie=challenge.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  assert.equal(challenge.status,200);assert.match(cookie,/__Host-draw3d_invite=/);
  const claims={sub:'123456789',email:'one@gmail.com',email_verified:true,nonce};const login=(input,origin='https://test.run.app')=>fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal((await fetch(base+'/auth/login',{method:'POST',headers:{Origin:'https://test.run.app','Content-Type':'application/json'},body:JSON.stringify({credential:JSON.stringify(claims)})})).status,401);
  assert.equal((await login({credential:JSON.stringify({...claims,nonce:'wrong'}),passcode:'7351910284'})).status,401);
  assert.equal((await login({credential:JSON.stringify(claims),passcode:'7351910284'},'https://evil.example')).status,403);
  const accepted=await login({credential:JSON.stringify(claims),passcode:'7351910284'});assert.equal(accepted.status,200);assert.match(accepted.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);const sessionCookie=accepted.headers.get('set-cookie').split(';')[0];
  const r=await fetch(base+'/api/private',{headers:{Cookie:sessionCookie,Authorization:'Bearer app-capability','X-Draw3d-User':'someone-else','X-Serverless-Authorization':'attacker'}});assert.equal(r.status,200);const data=await r.json();assert.equal(data.identity,'Bearer server-identity');assert.equal(data.authorization,'Bearer app-capability');assert.equal(data.spoof,null);assert.equal(lookups.at(-1),userKey(claims.sub));
  const second=seal({sub:'987654321',email:'two@gmail.com',exp:Date.now()+10000},process.env.SESSION_SIGNING_KEY);assert.equal((await fetch(base+'/auth/workspace',{headers:{Cookie:'__Host-draw3d='+second}})).status,200);assert.equal(lookups.at(-1),userKey('987654321'));assert.notEqual(lookups[0],lookups.at(-1));
  assert.equal((await fetch(base+'/api/private',{method:'POST',headers:{Cookie:sessionCookie,Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/api/private',{headers:{Cookie:sessionCookie+'tampered'}})).status,401);
 }finally{await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>worker.close(r))]);}
});
test('tutorial assets and first-visit claims require a session and stay scoped to its subject',async()=>{
 process.env.SESSION_SIGNING_KEY='b'.repeat(64);process.env.PASSCODE_HASH=hashPasscode('7351910284');process.env.PUBLIC_ORIGIN='https://test.run.app';
 const seen=new Set(),claimed=[];let lookups=0;
 const worker=http.createServer((req,res)=>{if(req.url==='/api/health'){res.setHeader('Content-Type','application/json');res.end('{"ready":true}');return;}res.setHeader('Content-Type','text/html');res.end('<html><head></head><body>Workspace</body></html>');});worker.listen(0,'127.0.0.1');await once(worker,'listening');
 const gateway=createGateway({lookupWorkspace:async()=>{lookups++;return {ready:true,url:'http://127.0.0.1:'+worker.address().port};},identityForWorker:async()=> 'Bearer server',claimTutorial:async key=>{claimed.push(key);const first=!seen.has(key);seen.add(key);return first;}});gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
 const base='http://127.0.0.1:'+gateway.address().port,session=sub=>'__Host-draw3d='+seal({sub,email:sub+'@example.com',exp:Date.now()+10000},process.env.SESSION_SIGNING_KEY);
 const visit=(sub,origin='https://test.run.app')=>fetch(base+'/learn/visit',{method:'POST',headers:{Cookie:session(sub),Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({userKey:'attacker'})});
 try{
  assert.equal((await fetch(base+'/learn/onboarding.js')).status,401);
  assert.equal((await fetch(base+'/learn/visit',{method:'POST',headers:{Origin:'https://test.run.app'}})).status,401);
  assert.equal((await visit('111111','https://evil.example')).status,403);assert.equal(claimed.length,0);
  assert.deepEqual(await(await visit('111111')).json(),{firstVisit:true,version:1});assert.equal((await(await visit('111111')).json()).firstVisit,false);assert.equal((await(await visit('222222')).json()).firstVisit,true);
  assert.deepEqual(claimed,[userKey('111111'),userKey('111111'),userKey('222222')]);assert.equal(lookups,0);
  for(const resource of ['onboarding.js','onboarding.css','assets/model.webp','assets/sketch.webp','assets/edit.webp','assets/vr.webp']){const r=await fetch(base+'/learn/'+resource,{headers:{Cookie:session('111111')}});assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>1000);}
  assert.equal((await fetch(base+'/learn/assets/README.md',{headers:{Cookie:session('111111')}})).status,404);
  const landing=await fetch(base+'/desktop.html',{headers:{Cookie:session('111111')},redirect:'manual'});assert.equal(landing.headers.get('location'),'/desktop.html?experiment=decision');
  const opening=await fetch(base+'/desktop.html?experiment=decision',{headers:{Cookie:session('111111')},redirect:'manual'});assert.match(opening.headers.get('location'),/^\/open\?next=/);
  const prepare=await fetch(base+'/auth/prepare',{headers:{Cookie:session('111111')}});assert.equal((await prepare.json()).ready,true);const warmCookie=prepare.headers.getSetCookie()[0].split(';')[0];
  const html=await(await fetch(base+'/desktop.html?experiment=decision',{headers:{Cookie:session('111111')+'; '+warmCookie}})).text();assert.match(html,/src="\/learn\/onboarding.js"/);assert.ok(html.includes(userKey('111111')));
  const other=await fetch(base+'/desktop.html?experiment=decision',{headers:{Cookie:session('222222')+'; '+warmCookie},redirect:'manual'});assert.match(other.headers.get('location'),/^\/open\?next=/);
  assert.equal((await fetch(base+'/open',{headers:{Cookie:session('111111')}})).status,200);assert.equal((await fetch(base+'/auth/prepare')).status,401);
  const embedded=await(await fetch(base+'/cad/index.html',{headers:{Cookie:session('111111')}})).text();assert.doesNotMatch(embedded,/onboarding.js/);
 }finally{await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>worker.close(r))]);}
});
