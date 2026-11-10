import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const replay=process.env.DRAW3D_EXISTING_BUILD_CASE;
for(const action of ['finish','redesign','compound']){
 const redesign=action!=='finish';
 test('recorded existing part '+(action==='compound'?'redesigns and attaches both sections':redesign?'receives a newly designed main body':'receives the remaining material features'),async({page})=>{
  test.skip(!replay,'Opt-in private existing-part replay');test.setTimeout(200000);
  const {data}=JSON.parse(await readFile(replay,'utf8'));
  await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.workspace=e.detail));
  await page.goto('http://127.0.0.1:5191/desktop.html?experiment=decision&session='+crypto.randomUUID());
  await page.waitForFunction(()=>window.workspace?.studio.modelAgent.ready&&document.body.dataset.decisionReady==='true');
  const originalId=await page.evaluate(async input=>{
   const {studio,store}=workspace,api=studio.desktopDrawing,ids={};
   for(const p of input.referencePlanes)if(!store.session.desktopPlanes.some(v=>v.id===p.id))store.session.desktopPlanes.push(p);
   for(const f of input.figures){
    const args=Object.fromEntries(['kind','name','origin','xAxis','yAxis','segments','widthMetres','heightMetres','radiusMetres','closed','planeId','construction'].filter(k=>f[k]!=null).map(k=>[k,f[k]]));
    const out=await api.dispatch('drawing_create',args);ids[f.id]=out.figure;
   }
   const base=structuredClone(input.existingSolids[0].parameters);
   base.profiles=base.profiles.map(p=>({...p,figureId:ids[p.figureId].id,expectedVersion:ids[p.figureId].version}));
   return (await api.createSolid(base)).solid.bodyId;
  },data);
  const prompt=action==='compound'?'Ignore the drawing and replace the main body with a newly designed streamlined fuselage, and join both thin wings and the thin horizontal tail using the two other sketch planes.':redesign?'Ignore the drawn silhouette and design a new, smooth, streamlined main body for this aeroplane in place of the original extruded fuselage. Keep the other sketches available.':'Make the wings and the tail thin and finish the existing aeroplane.';
  await page.locator('#decision-instruction').fill(prompt);await page.locator('#part-create').click();
  let response;
  await expect.poll(async()=>{
   response=await page.evaluate(()=>({message:document.querySelector('#decision-status').textContent,active:!!workspace.studio.aiDraftReview.active,busy:workspace.studio.decisionLab.busy}));
   if(/could not|failed/i.test(response.message))throw Error(response.message);
   return /CAD model ready/i.test(response.message)&&!response.active&&!response.busy;
  },{timeout:150000}).toBe(true);
  const result=await page.evaluate(id=>{
   const {store}=workspace,doc=document.querySelector('#full-cad-workspace iframe').contentWindow.__draw3dCAD.document();
   return {original:doc.derived.exportableBodyIds.includes(id),volumes:doc.derived.exportableBodyIds.map(b=>doc.derived.bodyRepresentations[b].volume),features:store.session.desktopSolids.map(s=>s.kind),created:store.session.decisionCases.at(-1)?.work?.summary};
  },originalId);
  console.log('Verified existing part replay',result);
  expect(result.volumes.every(n=>n>0)).toBe(true);expect(result.volumes).toHaveLength(1);
  if(redesign)expect(result.original).toBe(false);if(action!=='redesign'){expect(result.features.filter(k=>k==='join-material')).toHaveLength(2);}
 });
}
