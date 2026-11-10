import {test,expect} from '@playwright/test';
test('final speech auto-starts once, queues behind edits, and Stop clears the queue',async({page,context})=>{
 await context.grantPermissions(['microphone']);
 await page.addInitScript(()=>{window.SpeechRecognition=class{constructor(){window.testRecognition=this}start(){setTimeout(()=>this.onstart?.(),0)}stop(){this.onend?.()}};window.addEventListener('draw3d-transcript-final',e=>window.lastSpeech=e.detail);});
 const calls=[];let run=null;const state=()=>({ready:true,model:'gpt-6-luna',reasoning:'medium',run});
 await page.route('**/api/agent/**',async route=>{
  const u=new URL(route.request().url());const routeName=u.pathname.split('/').at(-1);let data;
  if(routeName==='register')data={id:'test',token:'cap'};
  else if(routeName==='ai-run'){calls.push(route.request().postDataJSON());run={id:'run-'+calls.length,state:'running',step:2,activity:'Using cad_execute',events:[]};data=state();}
  else if(routeName==='ai-stop'){run={...run,state:'stopped'};data=state();}
  else if(routeName==='poll')data={job:null,ai:state()};else data=state();
  await route.fulfill({json:data});
 });
 await page.goto('http://localhost:5173/');await page.locator('#mic').click();await expect(page.locator('#mic')).toHaveAttribute('aria-pressed','true');
 const emit=async(text,final=true)=>page.evaluate(({text,final})=>{const r=[{transcript:text,confidence:1}];r.isFinal=final;window.testRecognition.onresult({resultIndex:0,results:[r]});},{text,final});
 await emit('Make this',false);await page.waitForTimeout(2000);expect(calls).toHaveLength(0);
 await emit('Make this into a butterfly.');await emit('Use a thin body.');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('draw3d-transcript-final',{detail:window.lastSpeech})));
 await expect.poll(()=>calls.length).toBe(1);expect(calls[0].prompt).toContain('butterfly');expect(calls[0].prompt).toContain('thin body');expect(calls[0].promptIds).toHaveLength(2);
 await expect(page.locator('#assistant-state')).toContainText('cad_execute');
 await emit('Make the wings rounder.');await expect(page.locator('#assistant-state')).toContainText('next request queued');await page.waitForTimeout(2100);expect(calls).toHaveLength(1);
 await page.locator('#assistant-stop').click();await expect(page.locator('#assistant-state')).toContainText('stopped');await page.waitForTimeout(2100);expect(calls).toHaveLength(1);
 await page.locator('#mic').click();
});
