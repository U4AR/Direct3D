import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {once} from 'node:events';import {chromium} from '@playwright/test';import {createGateway} from './gateway.mjs';import {seal,hashPasscode,userKey} from './auth.mjs';
test('a third user sees the capacity warning and can enter after a user signs out',async()=>{
 process.env.SESSION_SIGNING_KEY='q'.repeat(64);process.env.PASSCODE_HASH=hashPasscode('7351910284');const lookups=[];
 const worker=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"ready":true}');});worker.listen(0,'127.0.0.1');await once(worker,'listening');
 const gateway=createGateway({lookupWorkspace:async key=>{lookups.push(key);return {ready:true,url:'http://127.0.0.1:'+worker.address().port};},identityForWorker:async()=> 'Bearer fixture'});gateway.listen(0,'127.0.0.1');await once(gateway,'listening');const base='http://127.0.0.1:'+gateway.address().port;process.env.PUBLIC_ORIGIN=base;
 const session=sub=>'__Host-draw3d='+seal({sub,email:'test@example.com',exp:Date.now()+120000},process.env.SESSION_SIGNING_KEY);
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
  for(const sub of ['111111','222222'])assert.equal((await(await fetch(base+'/auth/prepare',{headers:{Cookie:session(sub)}})).json()).ready,true);
  const denied=await fetch(base+'/api/health',{headers:{Cookie:session('333333')}});assert.equal(denied.status,429);assert.equal((await denied.json()).code,'WORKSPACE_FULL');assert.ok(!lookups.includes(userKey('333333')));
  const context=await browser.newContext({extraHTTPHeaders:{Cookie:session('333333')}}),page=await context.newPage();await page.goto(base+'/open');await page.waitForFunction(()=>document.querySelector('#loading-status').textContent.includes('Both design spaces'));assert.match(await page.locator('#loading-status').innerText(),/2 users/);
  await fetch(base+'/auth/logout',{method:'POST',headers:{Cookie:session('111111'),Origin:base}});
  await page.route('**/desktop.html?experiment=decision',r=>r.fulfill({contentType:'text/html',body:'<h1>Workspace opened</h1>'}));await page.reload();await page.getByRole('heading',{name:'Workspace opened'}).waitFor();assert.ok(lookups.includes(userKey('333333')));await context.close();
 }finally{await browser.close();await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>worker.close(r))]);}
});
