// A quick stationary hand pinch is input noise. Deliberate corner marks and
// mouse/controller strokes remain drawable, including very small geometry.
export function incidentalHandTap(stroke){
 if(!/^(left|right)-hand$/.test(stroke.input||'')||stroke.spatialRole==='corner'||!Number.isFinite(stroke.ended)||stroke.ended-stroke.started>=90||stroke.points.length>4)return false;
 let length=0;for(let i=1;i<stroke.points.length;i++)length+=Math.hypot(...stroke.points[i].map((v,k)=>v-stroke.points[i-1][k]));return length<.008;
}
export function contextChangedError(reason='drawing'){
 const error=Error('New '+reason+' input received; refreshing AI context.');error.applicationFailure={kind:'context_changed',reason,unchanged:true};return error;
}
export async function waitForDrawingPause(studio,cancelled=()=>false,onWait=()=>{}){
 let shown=false;while(studio.active?.size||studio.objects?.grabbing||performance.now()-(studio.lastDrawingInputAt||-Infinity)<350||performance.now()-(studio.lastObjectInputAt||-Infinity)<350){if(cancelled())return false;if(!shown){onWait();shown=true;}await new Promise(resolve=>setTimeout(resolve,75));}return !cancelled();
}
