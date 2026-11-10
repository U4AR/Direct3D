// Keep live receipts cheap to render/save; full details remain in an asset.
export function compactActivityDetails(value,{arrayLimit=16,stringLimit=1200,depthLimit=7,budget=6000}={}){
 let remaining=budget;const seen=new WeakSet();
 function visit(v,depth=0,key=''){
  if(v==null||typeof v==='boolean'||typeof v==='number'){remaining-=8;return v;}
  if(typeof v==='string'){const text=/^data:(image|audio)\//.test(v)?'[media stored in exact request]':v.length>stringLimit?v.slice(0,stringLimit)+'… ['+v.length+' characters]':v;remaining-=text.length;return text;}
  if(typeof v!=='object')return String(v);
  if(seen.has(v))return '[shared reference]';seen.add(v);
  if(depth>=depthLimit||remaining<=0)return Array.isArray(v)?{count:v.length,details:'See full receipt asset'}:'[See full receipt asset]';
  if(Array.isArray(v)){
   // Numeric topology IDs remain visible; sampled polylines/meshes never crowd the live log.
   const limit=/^(vertices|indices|triangles|polyline|points|samples|frames|edges|faces)$/i.test(key)?4:arrayLimit;
   const a=v.slice(0,limit).map(x=>visit(x,depth+1));if(v.length>limit)a.push({remaining:v.length-limit,total:v.length});return a;
  }
  const priority=([k,item])=>item===null||typeof item!=='object'?0:/^(edges|faces|polyline|vertices|indices|triangles)$/.test(k)?100:k==='metrics'?80:k==='parameters'||k==='verification'?10:20;const out={};for(const [k,item]of Object.entries(v).sort((a,b)=>priority(a)-priority(b))){if(remaining<=0){out.additionalDetails='See full receipt asset';break;}remaining-=k.length;if(/^(edges|faces|polyline|vertices|indices|triangles)$/i.test(k)&&Array.isArray(item)){out[k+'Count']=item.length;out[k+'Sample']=visit(item,depth+1,k);}else out[k]=visit(item,depth+1,k);}return out;
 }
 return visit(value);
}
export function archiveActivityDetails(store,category,id,details){
 const text=JSON.stringify(details);if(!text||text.length<8000)return details;
 const asset='activity/'+category+'-'+String(id).replace(/[^a-z0-9_-]/gi,'_')+'.json';
 void store.asset(asset,new Blob([text],{type:'application/json'}),{kind:'full-activity-details',category}).catch(()=>{});
 const compact=compactActivityDetails(details);return {...compact,detailsAsset:asset,originalCharacters:text.length};
}
export async function migrateActivityDetails(store){
 if(store.session.activitySummaryVersion===1)return;
 for(const key of ['creationTimeline','aiActivity']){const rows=store.session[key];if(!Array.isArray(rows)||JSON.stringify(rows).length<16000)continue;const asset='activity/'+key+'-before-compaction.json';await store.asset(asset,new Blob([JSON.stringify(rows)],{type:'application/json'}),{kind:'full-activity-history'});store.session[key]=rows.map(row=>key==='aiActivity'?{...row,details:row.details?{...compactActivityDetails(row.details),detailsAsset:asset}:row.details}:{...compactActivityDetails(row),detailsAsset:asset});}
 if(store.session.blenderLastReceipt?.metrics){const receipt=store.session.blenderLastReceipt;const asset='activity/last-native-receipt-before-compaction.json';await store.asset(asset,new Blob([JSON.stringify(receipt)],{type:'application/json'}),{kind:'full-native-receipt'});store.session.blenderLastReceipt={...receipt,metrics:compactActivityDetails(receipt.metrics),detailsAsset:asset};}
 store.session.activitySummaryVersion=1;
}
