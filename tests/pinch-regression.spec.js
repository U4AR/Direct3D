import {test,expect} from '@playwright/test';
const base=process.env.DRAW3D_TEST_URL||'http://localhost:5173';
test('native CAD Pen creates a saved 3D stroke from fingertip tracking despite false native select and tap signals',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.pinchTest=e.detail));
 await page.goto(base+'/?session='+crypto.randomUUID());await page.waitForFunction(()=>window.pinchTest?.studio.modeling.ready);
 const result=await page.evaluate(async()=>{
  const {studio,store}=window.pinchTest;studio.spatialWorkflow.setEnabled(false);studio.modeling.activate('freecad');
  studio.xrAction('draw',{handedness:'right'},'regression');
  const xyz={'thumb-tip':[.211466864,1.058225393,-.348135948],'index-finger-phalanx-intermediate':[.230589658,1.075525403,-.332655281],'index-finger-phalanx-distal':[.221650437,1.067580581,-.353812724],'index-finger-tip':[.214657366,1.052579522,-.368889958]},buttons=Array.from({length:10},()=>({pressed:false}));
  const source={handedness:'right',hand:new Map(Object.keys(xyz).map(k=>[k,k])),profiles:['oculus-hand'],gamepad:{buttons,axes:[]}};
  let offset=0,released=false;
  const frame={session:{inputSources:[source]},getViewerPose:()=>({transform:{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,1.6,0,1]}}),getPose:()=>null,getJointPose:k=>{const a=xyz[k];return a?{transform:{position:{x:a[0]+offset+(released&&k==='thumb-tip'?.08:0),y:a[1],z:a[2]},matrix:[1,0,0,0,0,1,0,0,0,0,1,0,a[0]+offset+(released&&k==='thumb-tip'?.08:0),a[1],a[2],1]},radius:.005}:null;}};
  const before=store.session.strokes.length;studio.updateXR(100,frame);
  for(let i=1;i<=8;i++){offset=i*.006;buttons[9].pressed=i===2||i===6;studio.updateXR(100+i*40,frame);}
  released=true;buttons[9].pressed=false;studio.updateXR(500,frame);
  await store.flush();const stroke=store.session.strokes.at(-1),saved=await store.get('sessions',store.session.id);
  return {added:store.session.strokes.length-before,points:stroke?.points.length,input:stroke?.input,ended:stroke?.ended!=null,saved:saved.strokes.some(s=>s.id===stroke?.id),mode:studio.mode,selecting:studio.nativeSelection.active,menu:studio.xrPanel.mesh.visible};
 });
 expect(result.added).toBe(1);expect(result.points).toBeGreaterThan(4);expect(result.input).toBe('right-hand');expect(result.ended).toBe(true);expect(result.saved).toBe(true);expect(result.mode).toBe('draw');expect(result.selecting).toBe(false);expect(result.menu).toBe(false);expect(errors).toEqual([]);
});


test('left-hand tracked pinch selects a native component while right-hand Pen stays active',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.pinchTest=e.detail));
 await page.goto(base+'/desktop.html?session='+crypto.randomUUID());await page.waitForFunction(()=>window.pinchTest?.studio.modeling.ready);
 await page.locator('#workspace-full-cad').click();await page.locator('[data-primitive=cube]').click();
 await page.waitForFunction(()=>window.pinchTest.studio.surfaceModels().some(m=>m.source==='freecad'&&!m.hidden));
 const result=await page.evaluate(()=>{
  const {studio,store}=window.pinchTest;studio.spatialWorkflow?.setEnabled(false);studio.xrAction('draw',{handedness:'right'},'test');studio.objects.setMagnetEnabled(false);
  const m=studio.surfaceModels().find(m=>m.source==='freecad'&&!m.hidden),bounds=m.blender.metrics.bounds;
  m.mesh.updateWorldMatrix(true,false);
  const center=studio.camera.position.clone().fromArray(bounds.min.map((v,i)=>(v+bounds.max[i])/2));m.mesh.localToWorld(center);
  const origin=center.clone();origin.z+=.8;
  let pinch=true,ray=studio.camera.matrixWorld.clone().lookAt(origin,center,studio.camera.up).setPosition(origin).toArray();
  const buttons=Array.from({length:10},()=>({pressed:false})),source={handedness:'left',profiles:['oculus-hand'],hand:new Map([['thumb-tip','thumb'],['index-finger-tip','index']]),gamepad:{buttons,axes:[]},targetRaySpace:'ray'};
  const frame={session:{inputSources:[source]},getViewerPose:()=>({transform:{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,1.6,1,1]}}),getPose:()=>({transform:{matrix:ray}}),getJointPose:k=>({transform:{position:{x:origin.x+(k==='thumb'?(pinch?.015:.06):0),y:origin.y,z:origin.z},matrix:ray}})};
  const before=store.session.strokes.length;studio.updateXR(100,frame);studio.updateXR(150,frame);
  const selection=studio.nativeSelection.summary();pinch=false;studio.updateXR(200,frame);
  const edge=m.blender.metrics.edges.find(e=>e.polyline.length>=2&&e.polyline.every(p=>Math.abs(p[2]-bounds.max[2])<1e-7));
  const target=studio.camera.position.clone().fromArray(edge.polyline[0]).lerp(studio.camera.position.clone().fromArray(edge.polyline.at(-1)),.5);m.mesh.localToWorld(target);
  ray=studio.camera.matrixWorld.clone().lookAt(origin,target,studio.camera.up).setPosition(origin).toArray();pinch=true;studio.updateXR(300,frame);
  return {selection,edge:studio.nativeSelection.summary(),id:m.id,mode:studio.mode,added:store.session.strokes.length-before,grabbing:studio.objects.grabbing};
 });
 expect(result.selection?.modelId).toBe(result.id);expect(result.selection?.kind).toBe('face');expect(result.selection?.faceIndices).toHaveLength(1);expect(result.edge?.kind).toBe('edge');expect(result.edge?.edgeIndices).toHaveLength(1);expect(result.grabbing).toBe(false);expect(result.mode).toBe('draw');expect(result.added).toBe(0);expect(errors).toEqual([]);
});


test('fist must be inside the body to move and rotate it; magnetic alignment and placement persist',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>window.addEventListener('draw3d-ready',e=>window.pinchTest=e.detail));
 await page.goto(base+'/desktop.html?session='+crypto.randomUUID());await page.waitForFunction(()=>window.pinchTest?.studio.modeling.ready);
 await page.locator('#workspace-full-cad').click();await page.locator('[data-primitive=cube]').click();
 await page.waitForFunction(()=>window.pinchTest.studio.surfaceModels().some(m=>m.source==='freecad'&&!m.hidden));
 const result=await page.evaluate(async()=>{
  const {studio,store}=window.pinchTest;studio.spatialWorkflow?.setEnabled(false);studio.xrAction('draw',{handedness:'right'},'test');studio.objects.setMagnetEnabled(false);
  const m=studio.surfaceModels().find(m=>m.source==='freecad'&&!m.hidden),bounds=m.blender.metrics.bounds;
  const initial={position:[...m.position],rotation:[...m.rotationDeg],scale:[...m.scale],version:m.version,volume:m.blender.metrics.volumeMetres3};
  const origin=studio.camera.position.clone().set(0,1.3,.5);let pose='fist',tracked=true,offset=[0,0,.5],yaw=0;
  function joints(){const p={wrist:{x:0,y:0,z:0}};for(const [i,f]of ['index-finger','middle-finger','ring-finger','pinky-finger'].entries()){
    const x=i*.015,closed=pose==='fist',coords=closed?[[x,.08,0],[x,.10,.02],[x,.08,.04],[x,.06,.02]]:[[x,.08,0],[x,.11,0],[x,.13,0],[x,.15,0]];
    ['phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'].forEach((n,j)=>p[f+'-'+n]={x:coords[j][0],y:coords[j][1],z:coords[j][2]});}
    p['thumb-tip']={...p['index-finger-tip'],x:p['index-finger-tip'].x+(pose==='open'?.06:.015)};
    for(const v of Object.values(p)){const x=v.x-.018,z=v.z;v.x=.018+x*Math.cos(yaw)+z*Math.sin(yaw);v.z=-x*Math.sin(yaw)+z*Math.cos(yaw);v.x+=origin.x+offset[0];v.y+=origin.y+offset[1];v.z+=origin.z+offset[2];}return p;}
  const target=()=>{m.mesh.updateWorldMatrix(true,false);return m.mesh.localToWorld(studio.camera.position.clone().fromArray(bounds.min.map((v,i)=>(v+bounds.max[i])/2)));};
  origin.copy(target()).sub(studio.camera.position.clone().set(.018,.064,0));const rayOrigin=target().add(studio.camera.position.clone().set(0,0,.8));
  const ray=()=>studio.camera.matrixWorld.clone().lookAt(rayOrigin,target(),studio.camera.up).setPosition(rayOrigin).toArray();
  const buttons=Array.from({length:10},()=>({pressed:false})),source={handedness:'left',profiles:['oculus-hand'],hand:new Map(Object.keys(joints()).map(k=>[k,k])),gamepad:{buttons,axes:[]},targetRaySpace:'ray'};
  const frame={session:{inputSources:[source]},getViewerPose:()=>({transform:{matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,1.6,1,1]}}),getPose:()=>({transform:{matrix:ray()}}),getJointPose:k=>tracked&&joints()[k]?{transform:{position:joints()[k],matrix:studio.camera.matrixWorld.clone().makeRotationY(yaw).setPosition(joints()[k].x,joints()[k].y,joints()[k].z).toArray()}}:null};
  const strokes=store.session.strokes.length;
  studio.updateXR(-200,frame);studio.updateXR(-80,frame);const outsideRejected=!studio.objects.grabbing&&m.version===initial.version;
  pose='open';offset=[0,0,0];studio.updateXR(-40,frame);pose='pinch';studio.updateXR(100,frame);offset=[.04,0,0];studio.updateXR(140,frame);
  const pinchVersion=m.version,selectedFace=studio.nativeSelection.summary();
  pose='open';offset=[0,0,0];studio.updateXR(180,frame);
  pose='fist';buttons[0].pressed=true;studio.updateXR(220,frame);studio.updateXR(340,frame);
  offset=[.001,0,0];studio.updateXR(380,frame);const tapVersion=m.version;
  offset=[.1,.02,-.03];studio.updateXR(420,frame);const moving=studio.objects.grabbing,translated=[...m.position];yaw=Math.PI/2;studio.updateXR(440,frame);
  pose='open';buttons[0].pressed=false;studio.updateXR(460,frame);const released=!studio.objects.grabbing,first=[...m.position];
  pose='fist';studio.updateXR(500,frame);studio.updateXR(620,frame);offset=[.14,.02,-.03];studio.updateXR(660,frame);
  tracked=false;studio.updateXR(700,frame);const trackingLossStopped=!studio.objects.grabbing,last=[...m.position];
  tracked=true;offset=[.5,.2,0];studio.updateXR(740,frame);studio.updateXR(900,frame);const stableAfterLoss=m.position.every((v,i)=>v===last[i]);
  await new Promise(r=>setTimeout(r,200));await store.flush();
  return {id:m.id,initial,outsideRejected,translated,pinchVersion,selectedFace,tapVersion,first,worldCenter:target().toArray(),position:[...m.position],rotation:m.rotationDeg,scale:m.scale,volume:m.blender.metrics.volumeMetres3,moving,released,trackingLossStopped,stableAfterLoss,mode:studio.mode,objectsMode:studio.objects.enabled,strokes:store.session.strokes.length-strokes,selection:studio.nativeSelection.summary()};
 });
 expect(result.outsideRejected).toBe(true);expect(result.pinchVersion).toBe(result.initial.version);expect(result.selectedFace?.kind).toBe('face');expect(result.selectedFace?.faceIndices).toHaveLength(1);
 expect(result.tapVersion).toBe(result.initial.version);expect(result.moving).toBe(true);expect(result.released).toBe(true);expect(result.trackingLossStopped).toBe(true);expect(result.stableAfterLoss).toBe(true);
 for(const [i,n]of [.1,.02,-.03].entries())expect(result.translated[i]-result.initial.position[i]).toBeCloseTo(n,7);
 expect(result.rotation[1]).toBeCloseTo(90,6);expect(result.scale).toEqual(result.initial.scale);expect(result.volume).toBe(result.initial.volume);
 expect(result.mode).toBe('draw');expect(result.objectsMode).toBe(false);expect(result.strokes).toBe(0);expect(result.selection?.faceIndices).toEqual(result.selectedFace.faceIndices);
 await page.reload();await page.waitForFunction(()=>window.pinchTest?.studio.modeling.ready);
 const restored=await page.evaluate(id=>{const m=window.pinchTest.studio.surfaceModels().find(m=>m.id===id);return {position:m?.position,rotation:m?.rotationDeg,scale:m?.scale};},result.id);
 expect(restored.position).toEqual(result.position);expect(restored.rotation).toEqual(result.rotation);expect(restored.scale).toEqual(result.scale);
 const snap=await page.evaluate(id=>{const {studio}=window.pinchTest,m=studio.surfaceModels().find(m=>m.id===id);studio.objects.setMagnetEnabled(true);m.mesh.geometry.computeBoundingBox();const center=m.mesh.geometry.boundingBox.getCenter(studio.camera.position.clone()).applyMatrix4(m.mesh.matrixWorld),start=studio.camera.matrixWorld.clone().identity().setPosition(center);const began=studio.objects.startXRGrab('left-hand',start);studio.objects.beginFrame();const end=start.clone().setPosition(.001,center.y,.001);studio.objects.directInput({key:'left-hand',pose:end,pressed:true,blocked:false});studio.objects.endFrame();const result={began,center:m.mesh.geometry.boundingBox.getCenter(studio.camera.position.clone()).applyMatrix4(m.mesh.matrixWorld).toArray(),status:studio.objects.snapStatus,scale:m.scale};studio.objects.finish();return result;},result.id);
 expect(snap.began).toBe(true);expect(snap.center[0]).toBeCloseTo(0,8);expect(snap.center[2]).toBeCloseTo(0,8);expect(snap.status).toContain('Magnet:');expect(snap.scale).toEqual(result.scale);expect(errors).toEqual([]);
});
