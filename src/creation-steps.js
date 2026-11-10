import {archiveActivityDetails} from './activity-summary.js';
// Public construction receipts. Yield rendering without a long artificial animation delay.
export async function presentCreationStep(studio,store,label,details={},record=()=>{}){
 const item={at:Date.now(),label,...archiveActivityDetails(store,'creation',crypto.randomUUID(),details)};
 store.session.creationTimeline=[...(store.session.creationTimeline||[]),item].slice(-64);
 studio.creationTimeline=store.session.creationTimeline;
 studio.drawCreationHUD?.();record(label,item);
 await new Promise(resolve=>{let finished=false;const done=()=>{if(finished)return;finished=true;clearTimeout(timer);resolve();};const timer=setTimeout(done,40);const session=studio.renderer?.xr?.getSession?.();if(session)session.requestAnimationFrame(done);else if(typeof requestAnimationFrame==='function')requestAnimationFrame(done);else setTimeout(done,0);});
 return item;
}
