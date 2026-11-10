import {desktopImageReference} from './desktop-view-reference.js';
import * as T from 'three';
import {drawingView} from './sketch-projection.js';
export function initStrokeReferenceTools({studio,store,models,renderer,refresh}){
 return async function reference({strokeIds,promptId,includeImages=true,perStrokeImages=false}={}){
  await refresh();const visible=store.session.strokes.filter(s=>!s.hidden);
  const chosen=strokeIds?strokeIds.map(id=>{const s=store.session.strokes.find(s=>s.id===id);if(!s)throw Error('Unknown stroke '+id);return s;}):visible.slice(-1);
  if(chosen.length>16)throw Error('Select at most 16 strokes per reference packet');
  for(const s of chosen){await studio.strokeWorkflow.fit(s);if(!s.localFit)await studio.strokeWorkflow.fit(s,{force:true});}
  const source=store.session.transcripts.find(t=>t.id===promptId)?.view||chosen.at(-1)?.endView||chosen.at(-1)?.view||drawingView(studio);
  const frames=[],modelList=[...models.values()].filter(m=>!m.hidden),selectedModels=studio.objects?.selectedIds||[];
  if(includeImages&&source){
   const makeCamera=view=>{const c=view.projectionMatrix[15]===1?new T.OrthographicCamera():new T.PerspectiveCamera();c.matrixAutoUpdate=false;c.matrix.fromArray(view.cameraToWorld);c.projectionMatrix.fromArray(view.projectionMatrix);c.projectionMatrixInverse.copy(c.projectionMatrix).invert();c.updateMatrixWorld(true);return c;};
   const camera=makeCamera(source);
   const copy=(m,scene)=>{m.updateWorldMatrix(true,false);const c=m.isLineSegments?new T.LineSegments(m.geometry,m.material):m.isLine?new T.Line(m.geometry,m.material):new T.Mesh(m.geometry,m.material);c.matrix.copy(m.matrixWorld);c.matrixAutoUpdate=false;c.frustumCulled=false;scene.add(c);};
   try{const layers=perStrokeImages?[...chosen.map(s=>({layer:'stroke',stroke:s})),{layer:'drawing'},{layer:'object'},{layer:'combined'}]:['stroke','object','combined'].map(layer=>({layer}));for(const {layer,stroke} of layers){
    const frameView=stroke?.view?.kind==='desktop'?stroke.view:stroke?.endView||stroke?.view||source,frameCamera=stroke?makeCamera(frameView):camera,aspect=frameView.aspect||Math.abs(frameView.projectionMatrix[5]/frameView.projectionMatrix[0])||1,width=Math.max(1,Math.round(Math.min(640,1024*aspect))),height=Math.max(1,Math.round(width/aspect));
    const scene=new T.Scene();scene.background=new T.Color('#101923');scene.add(new T.HemisphereLight(0xffffff,0x334455,2.4));const light=new T.DirectionalLight(0xffffff,2);light.position.set(2,4,3);scene.add(light);
    const disposable=[];
    if(layer!=='object')for(const s of stroke?[stroke]:['combined','drawing'].includes(layer)?visible:chosen){const m=studio.strokeMeshes.get(s.id);if(m)copy(m,scene);}
    if(!['stroke','drawing'].includes(layer)){
     for(const m of modelList)if(layer==='combined'||!selectedModels.length||selectedModels.includes(m.id))copy(m.mesh,scene);
     for(const mesh of studio.scene.getObjectByName('Editable desktop drawing figures')?.children||[])if(mesh.visible)copy(mesh,scene);
     for(const m of studio.spatialWorkflow?.previewGroup.children||[])m.traverse(o=>{if(o.isMesh||o.isLine)copy(o,scene);});
     for(const s of chosen){const f=s.localFit?.selected;if(!f)continue;const g=new T.BufferGeometry().setFromPoints(f.path.map(p=>new T.Vector3(...p))),mat=new T.LineBasicMaterial({color:0x78caff,depthTest:false}),line=new T.Line(g,mat);line.renderOrder=20;scene.add(line);disposable.push(g,mat);}
    }
    renderer.setSize(width,height,false);renderer.render(scene,frameCamera);const image=renderer.domElement.toDataURL('image/png');disposable.forEach(d=>d.dispose());
    const asset=`agent/stroke-reference/${crypto.randomUUID()}-${layer}.png`,metadata={id:crypto.randomUUID(),imageSize:[width,height],content:['stroke','drawing'].includes(layer)?'user-ink':'scene',layer,view:frameView,strokeIds:stroke?[stroke.id]:(layer==='drawing'?visible:chosen).map(s=>s.id),modelVersions:Object.fromEntries(modelList.filter(m=>layer!=="object"||!selectedModels.length||selectedModels.includes(m.id)).map(m=>[m.id,m.version])),units:'metres',coordinateSystem:'world Y-up',imageReference:desktopImageReference({view:frameView,imageSize:[width,height],plane:stroke?.drawingPlane||stroke?.surface?.frame||studio.surface?.selected?.frame||studio.desktopPlane,strokes:stroke?[stroke]:chosen,models:modelList})};
    await store.asset(asset,await(await fetch(image)).blob(),{kind:'stroke-reference',...metadata});frames.push({image,asset,...metadata});
   }}finally{renderer.setSize(320,240,false);}
  }
  const packet={workflow:studio.strokeWorkflow.summary(),sketchRevision:store.session.revision,strokes:chosen.map(s=>({id:s.id,color:s.color,fitVersion:s.fitVersion,fit:s.localFit,regularization:s.localFit.regularization,surface:s.surface,plane:s.drawingPlane,view:s.view})),models:modelList.map(m=>({id:m.id,name:m.name,version:m.version,position:m.position,rotationDeg:m.rotationDeg,scale:m.scale})),frames,note:'Raw stroke, fitted geometry plus existing objects, and combined scene rendered separately from the same recorded user POV. User and agent cameras are unchanged. Fits are local geometric references, not inferred design intent. Original data stays saved.'};
  store.log('stroke.reference',{strokeIds:chosen.map(s=>s.id),assets:frames.map(f=>f.asset),sketchRevision:packet.sketchRevision});return packet;
 };
}
