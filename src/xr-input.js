export const XR_COLORS = ["#bcf477", "#8cbcff", "#ffbd78", "#ed96be", "#f0f4f8"];
const modeButton={action:"workspace-toggle",label:"Full CAD",x:550,y:10,width:148,height:48};
const objectButtons=[{action:"objects-toggle",label:"Objects",x:22,y:10,width:182,height:48},{action:"objects-clear",label:"Unselect",x:433,y:124,width:128,height:32}];
export const XR_BUTTONS = [
  {action:'shape-accept',label:'Accept shape',x:222,y:124,width:182,height:32},
  {action:'record-example',label:'Record example',x:22,y:124,width:182,height:32},
  {action:"creation-toggle",label:"Stroke / full object",x:22,y:410,width:128,height:32},
  {action:"spatial-ai-toggle",label:"Enable AI",x:159,y:410,width:128,height:32},
  {action:"ai-supervision",label:"Ask: MED",x:296,y:410,width:128,height:32},
  ...objectButtons,
  modeButton,
  {action:"surface-pick",label:"Surface",x:222,y:10,width:148,height:48},
  {action:"surface-clear",label:"Free space",x:570,y:410,width:128,height:32},
  {action:"type-instruction",label:"Type",x:386,y:10,width:148,height:48},
  ...["undo", "redo", "capture", "new-session", "mic"].map((action, i) => ({
    action, label: ["Undo", "Redo", "Capture", "New canvas", "Mic"][i],
    x: 22 + i * 137, y: 326, width: 128, height: 76,
  })),
  ...["draw", "erase", "brush-smaller", "brush-larger", "menu-close"].map((action,i)=>({
    action, label:["Pen", "Eraser", "Size -", "Size +", "Close"][i],
    x:22+i*137,y:160,width:128,height:62,
  })),
  ...XR_COLORS.map((color,i)=>({action:`color:${color}`,label:["Lime","Blue","Orange","Pink","White"][i],color,x:22+i*137,y:234,width:128,height:58})),
];
const CAD_BUTTONS=[modeButton,...objectButtons,
 ...["cad-add-box","cad-add-cylinder","cad-add-sphere","cad-undo","cad-redo"].map((action,i)=>({action,label:["+ Box","+ Cylinder","+ Sphere","Undo","Redo"][i],x:22+i*137,y:160,width:128,height:62})),
 ...["cad-build","mic","menu-close"].map((action,i)=>({action,label:["Rebuild","Mic","Close"][i],x:22+i*225,y:326,width:212,height:76}))];
const nativeRow=(items,y)=>items.map(([action,label],i)=>({action,label,x:22+i*137,y,width:128,height:60}));
const recordingButton={action:'record-example',label:'Record example',x:22,y:410,width:182,height:32};
const canvasButtons=[{action:'new-session',label:'New canvas',x:433,y:410,width:128,height:32},{action:'surface-clear',label:'Free space',x:570,y:410,width:128,height:32}];
const NATIVE_TOP=[...canvasButtons,{action:'shape-accept',label:'Accept shape',x:433,y:88,width:128,height:42},{action:'native-dimensions',label:'Dimensions',x:296,y:88,width:128,height:42},{action:'native-draw-face',label:'Draw face',x:22,y:88,width:128,height:42},{action:'native-draw-body',label:'Draw body',x:159,y:88,width:128,height:42},recordingButton,{action:'keep-fit',label:'Keep fitted CAD',x:222,y:410,width:182,height:32},{action:"objects-snap-toggle",label:"Magnet ON",x:570,y:88,width:128,height:42},...nativeRow([['native-cad','CAD'],['native-mesh','Mesh'],['objects-toggle','Move body'],['draw','Pen'],['menu-close','Close']],10)];
const NATIVE_CAD=[...NATIVE_TOP,...nativeRow([['native-select-edge','Edges'],['native-select-face','Faces'],['native-select-body','Body'],['native-all','Select all'],['native-clear','Clear']],160),...nativeRow([['native-invert','Invert'],['native-fillet','Fillet 2mm'],['native-chamfer','Chamfer 2mm'],['native-hole','Hole'],['native-hole_pattern','Hole pattern']],234),...nativeRow([['native-add-cube','+ Box'],['native-add-cylinder','+ Cylinder'],['native-convert','To mesh'],['native-undo','Undo'],['mic','Mic']],326)];
const NATIVE_MESH=[...NATIVE_TOP,...nativeRow([['native-add-cube','+ Box'],['native-add-sphere','+ Sphere'],['native-add-cylinder','+ Cylinder'],['native-select-body','Select body'],['native-clear','Clear']],160),...nativeRow([['native-smooth','Smooth'],['native-subdivision','Subdivide'],['native-convert','To CAD'],['native-undo','Undo'],['mic','Mic']],326)];
export const buttonsForMode=mode=>mode==='native-cad'?NATIVE_CAD:mode==='native-mesh'?NATIVE_MESH:mode==="cad"?CAD_BUTTONS:XR_BUTTONS;
export function panelAction(uv, mode="sketch") {
  if (!uv) return null;
  const x = uv.x * 720, y = (1 - uv.y) * 450;
  return buttonsForMode(mode).find(b => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height)?.action ?? null;
}
// Quest Touch xr-standard: A/X = 4, B/Y = 5, thumbstick = axes 2/3.
// Edge detection and a neutral dead zone prevent held inputs from repeating.
export function historyShortcut(gamepad, state) {
  const undo = !!gamepad?.buttons[4]?.pressed;
  const redo = !!gamepad?.buttons[5]?.pressed;
  const x = gamepad?.axes[2] ?? 0, y = gamepad?.axes[3] ?? 0;
  let action = undo && !state.undoHeld ? "undo" : redo && !state.redoHeld ? "redo" : null;
  state.undoHeld = undo; state.redoHeld = redo;
  if (Math.abs(x) < 0.25 && Math.abs(y) < 0.25) state.stickLatched = false;
  if (!state.stickLatched && Math.abs(x) > 0.7 && Math.abs(y) < 0.55) {
    state.stickLatched = true;
    action ??= x < 0 ? "undo" : "redo";
  }
  return action;
}

// Native Meta microgestures, exposed by Quest Browser's oculus-hand profile.
// https://github.com/immersive-web/webxr-input-profiles/blob/main/packages/registry/profiles/oculus/oculus-hand.json
export function microgesture(source, state, time = performance.now(), {pinching=false}={}) {
  const supported=!!source.hand && source.profiles?.includes("oculus-hand") && source.gamepad?.buttons.length>=10;
  const names=["swipe-left","swipe-right","swipe-forward","swipe-backward","tap-thumb"];
  const previous=state.microHeld ?? [];
  const held=names.map((_,i)=>supported && !(i===4&&pinching) && !!source.gamepad.buttons[i+5].pressed);
  const index=held.findIndex((down,i)=>down && !previous[i]);
  state.microHeld=held;
  const name=index<0?null:names[index];
  let action=name==="swipe-left"?"undo":name==="swipe-right"?"redo":name==="swipe-forward"?"brush-larger":name==="swipe-backward"?"brush-smaller":null;
  if(name==="tap-thumb") {
    const gap=time-(state.pendingThumbTap ?? -Infinity);
    if(gap>=100 && gap<=500) {action="toggle-brush";state.pendingThumbTap=null;}
    else if(gap>=100) state.pendingThumbTap=time;
  } else if(name || pinching || source.gamepad?.buttons[0]?.pressed || !supported) state.pendingThumbTap=null;
  // Defer the single tap until its double-tap window closes: double-tapping
  // changes tools without flashing the menu open on the first tap.
  if(state.pendingThumbTap!=null && time-state.pendingThumbTap>500 && !held.some(Boolean)) {
    action="menu-toggle";state.pendingThumbTap=null;
  }
  return {supported,name,action,consume:held.some(Boolean) || action==="menu-toggle"};
}
// Recognition arrives at gesture completion. Reserve side-of-index contact
// beforehand so the approach/swipe cannot be mistaken for drawing a pinch.
// This is only an input guard; gesture direction comes from the native signal.
export function nearIndexSide(points) {
  const thumb=points["thumb-tip"], a=points["index-finger-phalanx-intermediate"], b=points["index-finger-phalanx-distal"], tip=points["index-finger-tip"];
  if(!thumb || !a || !b || !tip) return false;
  const v=[b.x-a.x,b.y-a.y,b.z-a.z], d=[thumb.x-a.x,thumb.y-a.y,thumb.z-a.z];
  const length=v.reduce((sum,n)=>sum+n*n,0);
  if(length<0.000025)return false;
  const t=Math.max(0,Math.min(1,d.reduce((sum,n,i)=>sum+n*v[i],0)/length));
  const side=Math.hypot(...d.map((n,i)=>n-t*v[i]));
  const end=Math.hypot(thumb.x-tip.x,thumb.y-tip.y,thumb.z-tip.z);
  return side<0.03 && side<end*0.85;
}


// Head direction is a broad intent signal, not eye tracking. Hysteresis avoids
// clipping a stroke at the edge of the user's view. Missing poses fail closed.
export function drawingInView(point, viewerMatrix, continuing=false,projectionMatrix) {
  if(!point || !viewerMatrix || viewerMatrix.length!==16 || ![...point,...viewerMatrix].every(Number.isFinite))return false;
  const delta=point.map((v,i)=>v-viewerMatrix[12+i]),distance=Math.hypot(...delta),axis=column=>{const v=viewerMatrix.slice(column*4,column*4+3),length=Math.hypot(...v);return length>.5?delta.reduce((n,x,i)=>n+x*v[i],0)/length:NaN;},depth=-axis(2),right=axis(0),up=axis(1);
  if(distance<.08||distance>1.8||!Number.isFinite(depth)||depth<.12)return false;
  if(Math.abs(right)>depth*Math.tan((continuing?50:43)*Math.PI/180)||Math.abs(up)>depth*Math.tan((continuing?42:35)*Math.PI/180))return false;
  if(projectionMatrix?.length===16&&projectionMatrix.every(Number.isFinite)){const m=projectionMatrix,x=right,y=up,z=-depth,w=m[3]*x+m[7]*y+m[11]*z+m[15],cx=(m[0]*x+m[4]*y+m[8]*z+m[12])/w,cy=(m[1]*x+m[5]*y+m[9]*z+m[13])/w,margin=continuing?.98:.9;if(!(w>0)||Math.abs(cx)>margin||Math.abs(cy)>margin)return false;}
  return true;
}
export function drawingAttentionGate(state,{point,viewerMatrix,projectionMatrix,pressed,trackingValid,releaseObserved}){
 if(!trackingValid||!point)state.drawingAwaitRelease=true;
 if(releaseObserved)state.drawingAwaitRelease=false;
 const visible=trackingValid&&drawingInView(point,viewerMatrix,!!state.pressed,projectionMatrix);
 if(pressed&&!visible)state.drawingAwaitRelease=true;
 return {visible,pressed:!!pressed&&visible&&!state.drawingAwaitRelease,blocked:!!state.drawingAwaitRelease};
}

// All four fingers must curl toward the palm. A thumb/index pinch alone is
// never a fist. Null means tracking is incomplete, so callers stop grabbing.
export function closedFist(points,continuing=false){
 const valid=p=>p&&[p.x,p.y,p.z].every(Number.isFinite),wrist=points.wrist;
 if(!valid(wrist))return null;
 const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
 let folded=true;
 for(const finger of ['index-finger','middle-finger','ring-finger','pinky-finger']){
  const a=points[finger+'-phalanx-proximal'],b=points[finger+'-phalanx-intermediate'],tip=points[finger+'-tip'];
  if(![a,b,tip].every(valid))return null;
  const u=[b.x-a.x,b.y-a.y,b.z-a.z],v=[tip.x-b.x,tip.y-b.y,tip.z-b.z],length=Math.hypot(...u)*Math.hypot(...v);
  if(length<1e-6)return null;
  const bend=u.reduce((sum,n,i)=>sum+n*v[i],0)/length;
  folded&&=bend<(continuing?.5:.2)&&distance(tip,wrist)<distance(b,wrist)*(continuing?.99:.92);
 }
 return folded;
}

// Deliberate left thumb/middle-finger pinch: index extended, hold, release to rearm.
export function previewAcceptGesture(points,state,time,{available=false}={}){
 const names=['thumb-tip','middle-finger-tip','index-finger-tip','index-finger-phalanx-proximal','wrist'],p=names.map(n=>points[n]),valid=p.every(q=>q&&[q.x,q.y,q.z].every(Number.isFinite)),distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
 const held=valid&&distance(p[0],p[1])<(state.previewAcceptHeld?.026:.018)&&distance(p[0],p[2])>.045&&distance(p[2],p[4])>distance(p[3],p[4])*1.25;
 state.previewAcceptHeld=!!held;if(!held){state.previewAcceptSince=null;state.previewAcceptLatched=false;return {held:false,fire:false};}if(!available){state.previewAcceptSince=null;return {held:true,fire:false};}state.previewAcceptSince??=time;const fire=!state.previewAcceptLatched&&time-state.previewAcceptSince>=500;if(fire)state.previewAcceptLatched=true;return {held:true,fire};
}
