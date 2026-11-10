import {test,expect} from '@playwright/test';
test('draft acceptance records explicit approval and archives only reviewed IDs and versions',async({page})=>{
 await page.route('**/review-fixture',r=>r.fulfill({contentType:'text/html',body:'<aside id="panel"><p id="agent-connection"></p></aside><form><textarea id="input"></textarea></form>'}));
 await page.goto('http://localhost:5173/review-fixture');
 await page.evaluate(async()=>{
  const {initModelAgentUI}=await import('/src/model-agent-ui.js');
  const store={session:{strokes:[{id:'wing',points:[[0,0,0],[1,0,0],[0,1,0]]}],transcripts:[],acceptedAIRuns:[]},log(){},async flush(){}};
  window.fixtureStore=store;window.commands=[];
  const review={state:'awaiting_feedback',modelIds:['mesh'],models:[{id:'mesh',version:7}],strokeIds:['wing'],promptIds:['prompt'],summary:'Contour draft'};
  const data={ready:true,model:'gpt-6-luna',reasoning:'medium',run:{id:'review-run',state:'completed',review,answer:'Review wing thickness',events:[],plan:{regions:[{id:'wing',goal:'Trace wing'}]},regionReports:[{regionId:'wing',state:'created'}]}};
  window.ui=initModelAgentUI({panel:document.querySelector('#panel'),store,input:document.querySelector('#input'),addTranscript(){},async request(){return data},async dispatch(tool,args){window.commands.push({tool,args});}});
  window.ui.update(data);
 });
 await expect(page.locator('#assistant-state')).toContainText('awaiting your feedback');
 await expect(page.locator('#ai-plan')).toContainText('created');
 await page.locator('#ai-accept').click();
 expect(await page.evaluate(()=>window.commands)).toEqual([{tool:'request_complete',args:expect.objectContaining({strokeIds:['wing'],promptIds:['prompt'],resultModelIds:['mesh'],expectedModelVersions:{mesh:7}})}]);
 await expect(page.locator('#ai-accept')).toBeHidden();
 await page.waitForTimeout(1600);
 await expect(page.locator('#assistant-state')).toContainText('Draft accepted');
 expect(await page.evaluate(()=>window.fixtureStore.session.acceptedAIRuns)).toEqual(['review-run']);
});
