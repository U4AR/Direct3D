// Original ink is durable, off screen, and fetched only by an explicit AI data request.
export async function archiveAppliedStrokes({store,studio,evidence,runId,summary}){
 const ids=new Set(evidence.strokes.filter(s=>!s.archived).map(s=>s.id));
 const strokes=store.session.strokes.filter(s=>ids.has(s.id));
 if(!strokes.length)return null;
 const id=crypto.randomUUID(),asset=`stroke-archive/${id}.json`;
 const packet={id,runId,summary,at:Date.now(),strokes:structuredClone(evidence.strokes.filter(s=>ids.has(s.id))),frames:structuredClone(evidence.frames.filter(f=>!f.archived)),spatialFit:evidence.spatialFit,maskFits:structuredClone(store.session.spatialMaskFits||[])};
 // Commit the archive before removing anything from the active drawing.
 await store.asset(asset,new Blob([JSON.stringify(packet)],{type:'application/json'}),{kind:'stroke-archive',runId});
 (store.session.strokeArchiveCatalog||=[]).push({id,asset,runId,summary:summary?.slice(0,200),at:packet.at,strokeIds:strokes.map(s=>s.id),strokeCount:strokes.length});
 for(const stroke of strokes)studio.removeStroke(stroke);
 for(const key of ['undoStack','redoStack'])studio[key]=(studio[key]||[]).map(c=>({...c,items:c.items?.filter(i=>!ids.has(i.stroke.id))})).filter(c=>!c.items||c.items.length);
 store.session.revision++;
 studio.strokeWorkflow?.sync();studio.desktopAppearance?.refresh();studio.desktopSketches?.render?.();studio.onChange?.();
 store.log('strokes.archived',{id,runId,strokeIds:strokes.map(s=>s.id)});
 window.dispatchEvent(new CustomEvent('draw3d-strokes-archived',{detail:{id}}));
 await store.flush();return id;
}
export async function attachStrokeArchives(store,evidence,requested=[]){
 evidence.strokeArchiveCatalog=structuredClone(store.session.strokeArchiveCatalog||[]);
 evidence.voiceAIEnabled=store.session.voiceAIEnabled!==false;
 evidence.recalledStrokeArchives=[];
 const unique=new Set();
 for(const requestedId of requested){
  const item=requestedId==='latest'?evidence.strokeArchiveCatalog.at(-1):evidence.strokeArchiveCatalog.find(a=>a.id===requestedId);
  if(!item)throw Error('Requested stroke archive is unavailable');
  if(unique.has(item.id))continue;unique.add(item.id);
  const saved=await store.get('assets',[store.session.id,item.asset]);if(!saved)throw Error('Archived drawing data missing');
  const packet=JSON.parse(await saved.blob.text());
  const active=new Set(evidence.strokes.map(s=>s.id));
  evidence.strokes.push(...packet.strokes.filter(s=>!active.has(s.id)).map(s=>({...s,archived:true,archiveId:item.id,readOnly:true})));
  const frames=new Set(evidence.frames.map(f=>f.id));evidence.frames.push(...packet.frames.filter(f=>!frames.has(f.id)).map(f=>({...f,archived:true,archiveId:item.id})));
  evidence.recalledStrokeArchives.push({id:item.id,tool:'recall_strokes',readOnly:true});
  if(!evidence.spatialFit?.candidates?.length&&packet.spatialFit)evidence.spatialFit=packet.spatialFit;
  const sourceIds=new Set(packet.strokes.map(s=>s.id));
  const fits=(store.session.spatialMaskFits||packet.maskFits||[]).filter(f=>[...(f.sourceStrokeIds||[]),...(f.report.selectedStrokeIds||[])].some(id=>sourceIds.has(id)));
  evidence.maskFits=[...(evidence.maskFits||[]),...fits.map(({overlays,highlights,...fit})=>fit)];
  for(const f of [...(fits.at(-1)?.overlays||[]),...(fits.at(-1)?.highlights||[])])if(!evidence.frames.some(existing=>existing.id===f.id))evidence.frames.push({...structuredClone(f),archived:true,archiveId:item.id});
 }
 return evidence;
}
