import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
try{
 let page;
 for(const p of browser.contexts().flatMap(c=>c.pages()))if(p.url().startsWith('http://localhost:5173')&&await p.locator('#workspace-sculpt').count())page=p;
 if(!page)throw Error('Active Quest application not found');
 const saved=await page.evaluate(async()=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('draw3d-studio',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const get=(store,key)=>new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{
   const session=await get('sessions',localStorage.getItem('draw3d.active'));
   const modelsAsset=await get('assets',[session.id,session.sharedModels]);
   const models=JSON.parse(await modelsAsset.blob.text());
   const cad=await get('assets',[session.id,session.activeCADProject.asset]);
   const sculpt=await get('assets',[session.id,session.sculptProject]);
   const bytes=new Uint8Array(await sculpt.blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   return {sessionId:session.id,cadProject:session.activeCADProject,cad:await cad.blob.text(),sculptBase64:btoa(binary),models:models.map(({vertices,indices,...m})=>({...m,vertexCount:vertices.length/3,triangleCount:indices.length/3})),strokes:session.strokes.length,transcripts:session.transcripts.length,sculptBytes:bytes.length};
  }finally{db.close();}
 });
 const dir='artifacts/agent/rockets/saved';await mkdir(dir,{recursive:true});
 await writeFile(dir+'/cad-project.json',saved.cad);
 await writeFile(dir+'/sculpt-scene.sgl',Buffer.from(saved.sculptBase64,'base64'));
 const {cad,sculptBase64,...summary}=saved;
 await writeFile(dir+'/verification.json',JSON.stringify(summary,null,2));
 console.log(JSON.stringify({cadProject:saved.cadProject,sculptBytes:saved.sculptBytes,modelCount:saved.models.length,recordedStrokes:saved.strokes,recordedTranscripts:saved.transcripts}));
}finally{await browser.close();}
