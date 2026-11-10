import {test,expect} from '@playwright/test';

test('a persistent client compiler OOM rebuilds an editable native solid on the server',async({page})=>{
 test.setTimeout(75000);
 await page.addInitScript(()=>{
  window.addEventListener('draw3d-ready',e=>window.testStudio=e.detail.studio);
  const compile=WebAssembly.compileStreaming;
  WebAssembly.compileStreaming=async function(input,...args){
   const response=await input;
   if(response.url.includes('/remus_wasm_bg-'))throw new RangeError('out of memory');
   return compile.call(this,response,...args);
  };
  const bytesCompile=WebAssembly.compile;
  WebAssembly.compile=function(bytes){if(bytes.byteLength===10368772)throw new RangeError('out of memory');return bytesCompile.call(this,bytes);};
 });
 await page.goto((process.env.DRAW3D_TEST_URL||'http://127.0.0.1:5191')+'/desktop.html?experiment=decision&session='+crypto.randomUUID());
 await page.waitForFunction(()=>document.body.dataset.decisionReady==='true'&&window.testStudio?.modelAgent.ready);
 const frame=page.frameLocator('#full-cad-workspace iframe');
 await expect(frame.locator('body')).toBeAttached();
 const body=()=>page.evaluate(()=>{const api=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD,doc=api?.document();return doc?.derived.bodyRepresentations[doc.bodyOrder[0]]?.volume;});
 await page.evaluate(async()=>{const api=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD;
  if(!api.document())await api.create('Recovery test','mm');
 });
 await page.waitForFunction(()=>{const api=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD;return api.document()&&!api.busy();});
 await page.evaluate(()=>{const api=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD;
  api.execute('addPrimitive',{name:'Test block',primitiveKind:'box',dimensions:{width:40,height:30,depth:20}},api.document().version);
 });
 await expect.poll(body,{timeout:30000}).toBeCloseTo(24000,2);
 expect(await page.evaluate(()=>window.draw3dRemoteCad)).toBe(true);
});
