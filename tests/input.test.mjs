import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Mesh, PlaneGeometry, MeshBasicMaterial, Raycaster, DoubleSide, Vector2, Vector3, Group } from "three";
import { historyShortcut, microgesture, nearIndexSide, drawingInView, closedFist, panelAction, XR_BUTTONS } from "../src/xr-input.js";
import { Studio } from "../src/studio.js";
function harness() {
  const calls = [];
  const studio = Object.create(Studio.prototype);
  Object.assign(studio, {
    active: new Map(), undoStack: [], redoStack: [],
    mode: "draw", radius: 0.004, color: "#bcf477",
    controls: {}, cursor: {material:{color:{set:()=>{}}}}, onChange: ()=>{},
    inputs: new Map(),
    xrPointers: new Map(),
    xrHovered: new Set(),
    xrPanel: {mesh: new Mesh(new PlaneGeometry(0.8, 0.5), new MeshBasicMaterial({side: DoubleSide}))},
    xrQuestion: {mesh: Object.assign(new Mesh(new PlaneGeometry(.65,.52),new MeshBasicMaterial({side:DoubleSide})),{visible:false})},
    raycaster: new Raycaster(),
    updateXRPointer: () => {},
    updateHUD: () => {},drawCreationHUD:()=>{},
    onAction: action => calls.push(["action", action]),
    lastPose: 0,
    penOffset: [0, -0.11, 0.025],
    renderer: { domElement:{style:{}}, xr: { getReferenceSpace: () => ({}) } },
    store: { log: () => {} },
    begin: (...a) => calls.push(["begin", ...a]),
    sample: (...a) => calls.push(["sample", ...a]),
    end: (key) => calls.push(["end", key]),
  });
  return { studio, calls };
}
const transform = (x, y, z) => ({
  position: { x, y, z },
  matrix: new Matrix4().makeTranslation(x, y, z).toArray(),
});
test("controller lower grip uses the bottom-of-grip pose and stops on tracking loss", () => {
  const { studio, calls } = harness();
  const source = {
    handedness: "right",
    gripSpace: "grip",
    targetRaySpace: "ray",
    gamepad: { buttons: [{ pressed: false }, { pressed: true }], axes: [] },
  };
  const frame = {
    session: { inputSources: [source] },
    getPose: (space) =>
      space === "grip" ? { transform: transform(1, 2, 3) } : null,
    getViewerPose: () => ({transform:transform(1,2,4)}),
  };
  studio.updateXR(100, frame);
  assert.deepEqual(calls[0], ["begin", "right-controller", [1, 1.89, 3.025]]);
  frame.session.inputSources = [];
  studio.updateXR(200, frame);
  assert.deepEqual(calls.at(-1), ["end", "right-controller"]);
});
test("pinch hysteresis keeps a stroke active between 22 mm and 32 mm", () => {
  const { studio, calls } = harness();
  let gap = 0.02;
  const hand = new Map([
    ["thumb-tip", "thumb"],
    ["index-finger-tip", "index"],
  ]);
  const frame = {
    session: {
      inputSources: [{ handedness: "right", hand, targetRaySpace: "ray" }],
    },
    getPose: () => null,
    getViewerPose: () => ({transform:transform(0,1.6,1)}),
    getJointPose: (joint) => ({
      transform: transform(joint === "thumb" ? 0 : gap, 1, 0),
      radius: 0.005,
    }),
  };
  studio.updateXR(100, frame);
  gap = 0.027;
  studio.updateXR(200, frame);
  gap = 0.04;
  studio.updateXR(300, frame);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["begin", "sample", "end"],
  );
  assert.deepEqual(calls[0][2], [0.01, 1, 0]);
});

test("controller rays hit every translated and rotated panel button without drawing", () => {
  for(const button of XR_BUTTONS) {
    const {studio,calls}=harness();
    studio.xrPanel.mesh.position.set(-0.85, 1.55, -1.1);
    studio.xrPanel.mesh.rotation.y=0.25;
    studio.xrPanel.mesh.updateMatrixWorld(true);
    const local = new Matrix4().makeTranslation((button.x+button.width/2)/900-0.4, 0.25-(button.y+button.height/2)/900, 0.5);
    const rayMatrix=studio.xrPanel.mesh.matrixWorld.clone().multiply(local).toArray();
    const source={handedness:"right",targetRaySpace:"ray",gripSpace:"grip",gamepad:{buttons:[{pressed:true}],axes:[]}};
    const frame={session:{inputSources:[source]},getViewerPose:()=>({transform:transform(0,1.6,1)}),getPose:space=>({transform:space==="ray"?{matrix:rayMatrix}:transform(0,1,0)})};
    studio.updateXR(100,frame); studio.updateXR(150,frame);
    const delegated=["new-session","undo","redo","capture","reconstruct","mic","workspace-toggle","type-instruction","creation-toggle","spatial-ai-toggle","ai-supervision","record-example","keep-fit","shape-accept"].includes(button.action);
    assert.deepEqual(calls.filter(c=>c[0]!=="end"),delegated ? [["action",button.action]] : []);
    if(button.action==="draw" || button.action==="erase") assert.equal(studio.mode,button.action);
    if(button.color) assert.equal(studio.color,button.color);
    if(button.action==="brush-larger") assert.equal(studio.radius,0.005);
    if(button.action==="brush-smaller") assert.equal(studio.radius,0.003);
    if(button.action==="menu-close"||button.action==="surface-pick"||button.action==="objects-toggle"||button.action==="surface-clear") assert.equal(studio.xrPanel.mesh.visible,false);
    else if(!["draw","erase"].includes(button.action)) assert.ok(studio.xrHovered.has(button.action));
  }
});
test("panel gaps and blank areas consume trigger without drawing or firing an action",()=>{
  assert.equal(panelAction(new Vector2(154/720,1-350/450)),null);
  const {studio,calls}=harness();
  const source={handedness:"right",targetRaySpace:"ray",gripSpace:"grip",gamepad:{buttons:[{pressed:true}],axes:[]}};
  const frame={session:{inputSources:[source]},getViewerPose:()=>({transform:transform(0,1.6,1)}),getPose:()=>({transform:transform(0,0,1)})};
  studio.updateXR(100,frame);
  assert.deepEqual(calls.filter(c=>c[0]!=="end"),[]);
});
test("Quest face buttons and thumbstick flicks undo/redo once, requiring release or neutral",()=>{
  const state={},gamepad={buttons:Array.from({length:6},()=>({pressed:false})),axes:[0,0,0,0]};
  gamepad.buttons[4].pressed=true;
  assert.equal(historyShortcut(gamepad,state),"undo");
  assert.equal(historyShortcut(gamepad,state),null);
  gamepad.buttons[4].pressed=false; gamepad.buttons[5].pressed=true;
  assert.equal(historyShortcut(gamepad,state),"redo");
  gamepad.buttons[5].pressed=false; gamepad.axes[2]=-0.9;
  assert.equal(historyShortcut(gamepad,state),"undo");
  assert.equal(historyShortcut(gamepad,state),null);
  gamepad.axes[2]=0.9; assert.equal(historyShortcut(gamepad,state),null);
  gamepad.axes[2]=0; historyShortcut(gamepad,state);
  gamepad.axes[2]=0.9; assert.equal(historyShortcut(gamepad,state),"redo");
  gamepad.axes[2]=0;historyShortcut(gamepad,state);
  gamepad.axes[2]=0.9;gamepad.axes[3]=0.8;assert.equal(historyShortcut(gamepad,state),null);
});

test("native Meta microgestures fire once per pulse with identical mapping on both hands",()=>{
  for(const handedness of ["left","right"]){
    const source={hand:{},handedness,profiles:["oculus-hand","generic-hand"],gamepad:{buttons:Array.from({length:10},()=>({pressed:false}))}},state={};
    assert.equal(microgesture(source,state).supported,true);
    for(const [index,action] of [[5,"undo"],[6,"redo"]]){
      source.gamepad.buttons[index].pressed=true;assert.equal(microgesture(source,state).action,action);
      assert.equal(microgesture(source,state).action,null);
      source.gamepad.buttons[index].pressed=false;assert.equal(microgesture(source,state).consume,false);
    }
    source.gamepad.buttons[9].pressed=true;
    const tap=microgesture(source,state);assert.equal(tap.name,"tap-thumb");assert.equal(tap.action,null);assert.equal(tap.consume,true);
  }
  assert.equal(microgesture({hand:{},profiles:["generic-hand"],gamepad:{buttons:Array(10).fill({pressed:true})}},{}).supported,false);
});
test("side of index is reserved for microgestures but fingertip pinch still draws",()=>{
  const points={"thumb-tip":{x:0.013,y:0.08,z:0},"index-finger-phalanx-intermediate":{x:0,y:0.07,z:0},"index-finger-phalanx-distal":{x:0,y:0.09,z:0},"index-finger-tip":{x:0,y:0.11,z:0}};
  assert.equal(nearIndexSide(points),true);
  points["thumb-tip"]={x:0.013,y:0.11,z:0};assert.equal(nearIndexSide(points),false);
  assert.equal(nearIndexSide({}),false);
});
test("microgesture plus simultaneous native pinch never starts a stroke or selects UI",()=>{
  const {studio,calls}=harness();
  const hand=new Map([["thumb-tip","thumb"],["index-finger-tip","index"]]);
  const buttons=Array.from({length:10},()=>({pressed:false}));buttons[0].pressed=true;buttons[5].pressed=true;
  const source={handedness:"right",hand,profiles:["oculus-hand"],targetRaySpace:"ray",gamepad:{buttons,axes:[]}};
  const frame={session:{inputSources:[source]},getPose:()=>null,getViewerPose:()=>({transform:transform(0,1.6,1)}),getJointPose:k=>({transform:transform(k==="thumb"?0:0.015,1,0),radius:0.005})};
  studio.updateXR(100,frame);buttons[5].pressed=false;studio.updateXR(200,frame);
  assert.deepEqual(calls.filter(c=>c[0]!=="end"),[["action","undo"]]);
});
test("front trigger away from UI never draws, lower grip does",()=>{
  const {studio,calls}=harness();
  const source={handedness:"right",gripSpace:"grip",targetRaySpace:"ray",gamepad:{buttons:[{pressed:true},{pressed:false}],axes:[]}};
  const frame={session:{inputSources:[source]},getPose:s=>s==="grip"?{transform:transform(1,2,3)}:null,getViewerPose:()=>({transform:transform(1,2,4)})};
  studio.updateXR(100,frame);assert.equal(calls.some(c=>c[0]==="begin"),false);
  source.gamepad.buttons[0].pressed=false;source.gamepad.buttons[1].pressed=true;
  studio.updateXR(200,frame);assert.deepEqual(calls.at(-1),["begin","right-controller",[1,1.89,3.025]]);
});

test("a fresh fingertip pinch starts on the first frame after a swipe without a 4cm release",()=>{
  const {studio,calls}=harness();
  const buttons=Array.from({length:10},()=>({pressed:false}));
  const source={handedness:"right",hand:new Map([["thumb-tip","thumb"],["index-finger-tip","index"]]),profiles:["oculus-hand"],targetRaySpace:"ray",gamepad:{buttons,axes:[]}};
  const frame={session:{inputSources:[source]},getPose:()=>null,getViewerPose:()=>({transform:transform(0,1.6,1)}),getJointPose:k=>({transform:transform(k==="thumb"?0:0.015,1,0),radius:0.005})};
  buttons[5].pressed=true;studio.updateXR(100,frame);
  buttons[5].pressed=false;studio.updateXR(114,frame);
  buttons[0].pressed=true;studio.updateXR(128,frame);
  assert.deepEqual(calls.filter(c=>c[0]!=="end"),[["action","undo"],["begin","right-hand",[0.0075,1,0]]]);
});


test("pending tap does not open menu during a fresh drawing pinch", () => {
  const {studio,calls}=harness();
  let gap=.015;
  const buttons=Array.from({length:10},()=>({pressed:false}));
  const source={handedness:"right",hand:new Map([["thumb-tip","thumb"],["index-finger-tip","index"]]),profiles:["oculus-hand"],targetRaySpace:"ray",gamepad:{buttons,axes:[]}};
  const frame={session:{inputSources:[source]},getPose:()=>({transform:transform(0,0,1)}),getViewerPose:()=>({transform:transform(0,1.6,1)}),getJointPose:k=>({transform:transform(k==="thumb"?0:gap,1,0),radius:0.005})};
  studio.setXRMenuVisible(false);
  assert.equal(studio.xrPanelHit(frame,source),null);
  buttons[0].pressed=true;studio.updateXR(100,frame);
  assert.deepEqual(calls.filter(c=>c[0]!=="end"),[["begin","right-hand",[0.0075,1,0]]]);
  buttons[0].pressed=false;gap=.05;studio.updateXR(114,frame);calls.length=0;
  buttons[9].pressed=true;studio.updateXR(128,frame);
  assert.equal(studio.xrPanel.mesh.visible,false);
  assert.equal(studio.xrPanelHit(frame,source),null);
  studio.updateXR(142,frame);
  assert.equal(studio.xrPanel.mesh.visible,false);
  buttons[9].pressed=false;studio.updateXR(156,frame);
  buttons[9].pressed=true;studio.updateXR(170,frame);
  assert.equal(studio.xrPanel.mesh.visible,false);
  assert.deepEqual(calls.filter(c=>c[0]!=="end"),[]);
  buttons[9].pressed=false;buttons[0].pressed=true;gap=.015;studio.updateXR(184,frame);
  assert.deepEqual(calls.filter(c=>c[0]!=="end"),[["begin","right-hand",[0.0075,1,0]]]);
});


function handPoints(closed=true) {
  const points={wrist:{x:0,y:0,z:0}};
  for(const [i,finger] of ["index-finger","middle-finger","ring-finger","pinky-finger"].entries()) {
    const x=i*0.015;
    const coords=closed ? [[x,0.08,0],[x,0.10,0.02],[x,0.08,0.04],[x,0.06,0.02]] : [[x,0.08,0],[x,0.11,0],[x,0.13,0],[x,0.15,0]];
    ["phalanx-proximal","phalanx-intermediate","phalanx-distal","tip"].forEach((j,k)=>points[`${finger}-${j}`]={x:coords[k][0],y:coords[k][1],z:coords[k][2]});
  }
  points["thumb-tip"]={...points["index-finger-tip"]};
  return points;
}
test("fist pose never opens or closes menu",()=>{
  const {studio}=harness();studio.setXRMenuVisible(false);
  let points=handPoints(false);
  const source={handedness:"left",hand:new Map(Object.keys(points).map(k=>[k,k])),profiles:["oculus-hand"],gamepad:{buttons:Array.from({length:10},()=>({pressed:false})),axes:[]}};
  const frame={session:{inputSources:[source]},getPose:()=>null,getViewerPose:()=>({transform:transform(0,1.6,1)}),getJointPose:k=>({transform:transform(points[k].x,points[k].y,points[k].z)})};
  studio.updateXR(0,frame);studio.updateXR(400,frame);points=handPoints();studio.updateXR(500,frame);studio.updateXR(2000,frame);
  assert.equal(studio.xrPanel.mesh.visible,false);
  studio.setXRMenuVisible(true);points=handPoints(false);studio.updateXR(2200,frame);
  assert.equal(studio.xrPanel.mesh.visible,true);
});
test("vertical native swipes step size once per pulse and clamp to 2ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“24mm",()=>{
  const {studio}=harness();
  const buttons=Array.from({length:10},()=>({pressed:false}));
  const source={handedness:"right",profiles:["oculus-hand"],hand:new Map(),targetRaySpace:"ray",gamepad:{buttons,axes:[]}};
  const frame={session:{inputSources:[source]},getPose:()=>null,getViewerPose:()=>({transform:transform(0,1.6,1)}),getJointPose:()=>null};
  buttons[7].pressed=true;studio.updateXR(100,frame);assert.equal(studio.radius,0.005);
  studio.updateXR(120,frame);assert.equal(studio.radius,0.005);
  buttons[7].pressed=false;buttons[8].pressed=true;studio.updateXR(140,frame);assert.equal(studio.radius,0.004);
  for(let i=0;i<30;i++) studio.xrAction("brush-smaller",source,"test");
  assert.equal(studio.radius,0.001);
  for(let i=0;i<30;i++) studio.xrAction("brush-larger",source,"test");
  assert.equal(studio.radius,0.012);
});
test("eraser hits between samples, preserves other strokes, and undo/redo restores exact order",()=>{
  const {studio}=harness();
  for(const method of ["begin","sample","end"]) delete studio[method];
  studio.store={session:{strokes:[],revision:0},elapsed:()=>0,log:()=>{},flush:()=>Promise.resolve()};
  studio.drawing=new Group();studio.strokeMeshes=new Map();
  for(const [key,y] of [["a",0],["b",0.03],["c",0.2]]) {
    studio.begin(key,[-0.05,y,0]);studio.sample(key,[0.05,y,0]);studio.end(key);
  }
  const original=[...studio.store.session.strokes];
  studio.mode="erase";studio.begin("eraser",[0,0,0]);studio.sample("eraser",[0,0.03,0]);studio.end("eraser");
  assert.deepEqual(studio.store.session.strokes,[original[2]]);
  studio.undo();assert.deepEqual(studio.store.session.strokes,original);
  studio.redo();assert.deepEqual(studio.store.session.strokes,[original[2]]);
  studio.undo();studio.undo();assert.deepEqual(studio.store.session.strokes,original.slice(0,2));
  studio.redo();assert.deepEqual(studio.store.session.strokes,original);
  studio.undo();studio.mode="draw";studio.begin("new",[0,1,0]);studio.sample("new",[0.1,1,0]);studio.end("new");
  assert.equal(studio.redoStack.length,0);
});


test("VR button exits an existing immersive session without requesting another",async()=>{
  let ended=false;
  await Studio.prototype.enterVR.call({renderer:{xr:{getSession:()=>({end:async()=>{ended=true;}})}}});
  assert.equal(ended,true);
});


test("native thumb double tap switches pen/eraser once without repeated held actions",()=>{
  const {studio}=harness();
  const buttons=Array.from({length:10},()=>({pressed:false}));
  const source={handedness:"right",profiles:["oculus-hand"],hand:new Map(),targetRaySpace:"ray",gamepad:{buttons,axes:[]}};
  const frame={session:{inputSources:[source]},getPose:()=>null,getViewerPose:()=>({transform:transform(0,1.6,1)}),getJointPose:()=>null};
  buttons[9].pressed=true;studio.updateXR(1000,frame);assert.equal(studio.mode,"draw");
  studio.updateXR(1100,frame);assert.equal(studio.mode,"draw");
  buttons[9].pressed=false;studio.updateXR(1150,frame);
  buttons[9].pressed=true;studio.updateXR(1250,frame);assert.equal(studio.mode,"erase");
  buttons[9].pressed=false;studio.updateXR(1400,frame);
  buttons[9].pressed=true;studio.updateXR(1700,frame);
  buttons[9].pressed=false;studio.updateXR(1800,frame);
  buttons[9].pressed=true;studio.updateXR(1950,frame);assert.equal(studio.mode,"draw");
});
test("single thumb tap toggles menu after double-tap window; double tap never opens it",()=>{
  const {studio}=harness();studio.setXRMenuVisible(false);
  const buttons=Array.from({length:10},()=>({pressed:false}));
  const source={handedness:"right",profiles:["oculus-hand"],hand:new Map(),targetRaySpace:"ray",gamepad:{buttons,axes:[]}};
  const frame={session:{inputSources:[source]},getPose:()=>null,getViewerPose:()=>({transform:transform(2,1.6,3)}),getJointPose:()=>null};
  buttons[9].pressed=true;studio.updateXR(1000,frame);assert.equal(studio.xrPanel.mesh.visible,false);
  buttons[9].pressed=false;studio.updateXR(1100,frame);studio.updateXR(1501,frame);
  assert.equal(studio.xrPanel.mesh.visible,true);assert.ok(studio.xrPanel.mesh.position.distanceTo(new Vector3(2,1.18,1.35))<1e-6);
  studio.updateXR(1800,frame);assert.equal(studio.xrPanel.mesh.visible,true);
  buttons[9].pressed=true;studio.updateXR(2000,frame);buttons[9].pressed=false;studio.updateXR(2501,frame);
  assert.equal(studio.xrPanel.mesh.visible,false);
  buttons[9].pressed=true;studio.updateXR(3000,frame);buttons[9].pressed=false;studio.updateXR(3100,frame);
  buttons[9].pressed=true;studio.updateXR(3250,frame);buttons[9].pressed=false;studio.updateXR(3900,frame);
  assert.equal(studio.mode,"erase");assert.equal(studio.xrPanel.mesh.visible,false);
});


test("native XR select events select the question rather than the underlying menu",async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),handlers={};
 const session={addEventListener:(name,fn)=>handlers[name]=fn};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{xr:{isSessionSupported:async()=>true,requestSession:async()=>session}}});
 try{
  const {studio}=harness();studio.renderer.xr.getSession=()=>null;studio.renderer.xr.setSession=async()=>{};studio.endAll=()=>{};
  studio.xrPanelHit=()=>({questionPanel:true,questionOption:1,uv:{x:.2,y:.5}});const actions=[];studio.xrAction=a=>actions.push(a);
  await studio.enterVR();const event={inputSource:{handedness:'right'},frame:{}};
  handlers.selectstart(event);assert.deepEqual(actions,['question:1']);
  handlers.selectstart(event);assert.equal(actions.length,1);
  handlers.selectend(event);studio.xrPanelHit=()=>({questionPanel:true,questionOption:null,uv:{x:.2,y:.5}});
  handlers.selectstart(event);assert.equal(actions.length,1);
  handlers.selectend(event);studio.voiceState={phase:'error'};studio.xrPanelHit=()=>({voicePanel:true,uv:{x:.8,y:1-177/285}});
  handlers.selectstart(event);assert.deepEqual(actions,['question:1','mic-enable']);
 }finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});


test("microphone recovery is clickable with menu hidden and voice text does not intercept drawing",()=>{
 const {studio}=harness();studio.xrPanel.mesh.visible=false;studio.voiceState={phase:"error"};
 studio.xrVoice={mesh:new Mesh(new PlaneGeometry(.9,.285),new MeshBasicMaterial({side:DoubleSide}))};
 studio.xrVoice.mesh.position.z=-1;
 const uv={x:.8,y:1-177/285};
 const frame={getPose:()=>({transform:transform((uv.x-.5)*.9,(uv.y-.5)*.285,0)})};
 const hit=studio.xrPanelHit(frame,{targetRaySpace:"ray"});
 assert.equal(studio.xrHitAction(hit),"mic-enable");
 frame.getPose=()=>({transform:transform(0,0,0)});
 assert.equal(studio.xrPanelHit(frame,{targetRaySpace:"ray"}),null);
 studio.voiceState.phase="listening";
 assert.equal(studio.xrHitAction({voicePanel:true,uv}),null);
});

test('a controller thumbstick click recovers the menu at the current viewer instead of drawing',()=>{
 const {studio,calls}=harness();studio.xrPanel.mesh.visible=false;const buttons=Array.from({length:6},()=>({pressed:false}));buttons[3].pressed=true;
 const source={handedness:'right',gripSpace:'grip',targetRaySpace:'ray',gamepad:{buttons,axes:[]}};
 const frame={session:{inputSources:[source]},getViewerPose:()=>({transform:transform(3,1.6,2)}),getPose:()=>({transform:transform(3,1,2)})};
 studio.updateXR(1000,frame);assert.equal(studio.xrPanel.mesh.visible,true);assert.ok(studio.xrPanel.mesh.position.distanceTo(new Vector3(3,1.18,.35))<1e-6);assert.ok(!calls.some(c=>c[0]==='begin'));
});
test('side-of-index drawing guard does not block native pinches selecting menu buttons',()=>{
 const {studio,calls}=harness();studio.xrPanel.mesh.position.z=-1;
 const points={'thumb-tip':{x:0,y:0,z:0},'index-finger-tip':{x:.04,y:0,z:0},'index-finger-phalanx-intermediate':{x:0,y:0,z:0},'index-finger-phalanx-distal':{x:.015,y:0,z:0}};
 const source={handedness:'left',hand:new Map(Object.keys(points).map(k=>[k,k])),targetRaySpace:'ray',gamepad:{buttons:[{pressed:true}],axes:[]}};
 studio.xrPanelHit=()=>({uv:{x:(22+64)/720,y:1-(326+38)/450}});
 const frame={session:{inputSources:[source]},getViewerPose:()=>({transform:transform(0,1.6,1)}),getPose:()=>null,getJointPose:k=>({transform:{position:points[k],matrix:new Matrix4().toArray()}})};
 studio.updateXR(1000,frame);assert.ok(calls.some(c=>c[0]==='action'&&c[1]==='undo'));assert.ok(!calls.some(c=>c[0]==='begin'));
});

test('board calibration changes the XR reference and ends input without moving stored drawing coordinates',()=>{
 const {studio}=harness();const points=[[.1,1,-.6]],saved=structuredClone(points),events=[];let applied,ended=0;
 studio.store={session:{strokes:[{points}]},log:(kind,data)=>events.push({kind,data})};studio.endAll=()=>ended++;studio.drawVoiceHUD=()=>{};
 studio.xrBaseSpace={getOffsetReferenceSpace:offset=>({offset})};studio.renderer.xr.setReferenceSpace=space=>applied=space;
 const previous=globalThis.XRRigidTransform;globalThis.XRRigidTransform=class{constructor(position,orientation){this.position=position;this.orientation=orientation;}};
 try{studio.calibrateBoard(new Vector3(2,.85,3),new Vector3(0,1,0),new Vector3(2,1.6,4),'palms');assert.ok(applied);assert.equal(ended,1);assert.deepEqual(points,saved);assert.equal(events[0].kind,'xr.board-calibration');assert.equal(studio.inputs.size,0);assert.equal(studio.calibrationStatus,'Board aligned to your palms');}
 finally{if(previous===undefined)delete globalThis.XRRigidTransform;else globalThis.XRRigidTransform=previous;}
});

test('hands without a gamepad or target ray can pinch near recovery buttons and regular menu controls',()=>{
 const {studio,calls}=harness();studio.xrPanel.mesh.visible=false;
 studio.xrRecovery={mesh:new Mesh(new PlaneGeometry(600/900,108/900),new MeshBasicMaterial({side:DoubleSide}))};studio.xrRecovery.mesh.position.set(0,1,-.6);
 let tip=new Vector3((101/600-.5)*600/900,1,-.58),pinch=true;
 const source={handedness:'right',hand:new Map([['index-finger-tip','index'],['thumb-tip','thumb']]),targetRaySpace:'ray'};
 const frame={session:{inputSources:[source]},getPose:()=>null,getViewerPose:()=>({transform:transform(0,1.6,0)}),getJointPose:joint=>({transform:transform(tip.x+(joint==='thumb'?(pinch?.015:.05):0),tip.y,tip.z)})};
 studio.updateXR(1000,frame);assert.equal(studio.xrPanel.mesh.visible,true);assert.ok(!calls.some(c=>c[0]==='begin'));
 // Release and reach a normal tool button with no native pointing ray.
 pinch=false;studio.updateXR(1100,frame);studio.xrRecovery.mesh.visible=false;studio.xrPanel.mesh.position.set(0,1,-.6);studio.xrPanel.mesh.quaternion.identity();
 const uv={x:(22+137+64)/720,y:1-(160+31)/450};tip=new Vector3((uv.x-.5)*.8,1+(uv.y-.5)*.5,-.58);
 pinch=true;studio.updateXR(1200,frame);assert.equal(studio.mode,'erase');assert.ok(!calls.some(c=>c[0]==='begin'));
});
test('native hand menu click defers positioning when an event frame cannot supply viewer pose',()=>{
 const {studio}=harness();studio.endAll=()=>{};studio.xrPanel.mesh.visible=false;
 studio.xrAction('menu-recover',{handedness:'left'},'panel',{getViewerPose:()=>{throw Error('Not an animation frame');}});
 assert.equal(studio.xrPanel.mesh.visible,true);assert.equal(studio.xrMenuNeedsPlacement,true);
 studio.updateXR(1000,{session:{inputSources:[]},getViewerPose:()=>({transform:transform(2,1.6,3)})});
 assert.equal(studio.xrMenuNeedsPlacement,false);assert.ok(studio.xrPanel.mesh.position.distanceTo(new Vector3(2,1.18,1.35))<1e-6);
});

for(const tableDrawing of [false,true])test(`pinch still draws above table with table contact enabled=${tableDrawing}`,()=>{
 const {studio,calls}=harness();studio.tableDrawing=tableDrawing;studio.tableReadyAt=0;
 const hand=new Map([["thumb-tip","thumb"],["index-finger-tip","index"]]);
 let gap=.02;
 const frame={session:{inputSources:[{handedness:"right",hand,targetRaySpace:"ray"}]},getPose:()=>null,getViewerPose:()=>({transform:transform(0,1.6,1)}),getJointPose:joint=>({transform:transform(joint==="thumb"?0:gap,1.2,0),radius:.008})};
 studio.updateXR(100,frame);studio.updateXR(150,frame);gap=.05;studio.updateXR(200,frame);
 assert.deepEqual(calls.map(c=>c[0]),["begin","sample","end"]);
 assert.deepEqual(calls[0][2],[.01,1.2,0]);
});

test('menu recovery stays available while voice and requested menu stay available',()=>{
 const {studio}=harness();studio.xrVoice={mesh:new Mesh()};studio.xrRecovery={mesh:new Mesh()};
 studio.recoveryVisibleUntil=6000;studio.xrPanel.mesh.visible=true;
 const frame={getViewerPose:()=>({transform:transform(0,1.6,0)})};
 studio.updateVoicePose(frame,5999);assert.equal(studio.xrRecovery.mesh.visible,true);
 studio.updateVoicePose(frame,6000);assert.equal(studio.xrRecovery.mesh.visible,true);
 assert.equal(studio.xrVoice.mesh.visible,true);assert.equal(studio.xrPanel.mesh.visible,true);
 studio.recoveryVisibleUntil=12000;studio.updateVoicePose(frame,7000);assert.equal(studio.xrRecovery.mesh.visible,true);
});

function pinchRegressionHarness(points,buttons=Array.from({length:10},()=>({pressed:false}))){
 const {studio,calls}=harness();studio.xrPanel.mesh.visible=false;
 const source={handedness:'right',hand:new Map(Object.keys(points).map(k=>[k,k])),profiles:['oculus-hand'],targetRaySpace:'ray',gamepad:{buttons,axes:[]}};
 const frame={session:{inputSources:[source]},getPose:()=>null,getViewerPose:()=>({transform:transform(0,1.6,1)}),getJointPose:k=>points[k]?{transform:transform(points[k].x,points[k].y,points[k].z)}:null};
 return {studio,calls,source,frame,buttons};
}
test('tracked fingertip pinch draws through missing and flickering native select signals',()=>{
 const points={'thumb-tip':{x:0,y:1,z:0},'index-finger-tip':{x:.019,y:1,z:0}};
 const {studio,calls,frame,buttons}=pinchRegressionHarness(points);
 studio.updateXR(100,frame);buttons[0].pressed=true;studio.updateXR(120,frame);
 buttons[0].pressed=false;points['index-finger-tip'].x=.027;studio.updateXR(140,frame);
 points['index-finger-tip'].x=.04;studio.updateXR(160,frame);
 assert.deepEqual(calls.map(c=>c[0]),['begin','sample','sample','end']);
});
test('recorded curled-index fingertip pinch is not swallowed by the side gesture guard',()=>{
 const xyz={'thumb-tip':[.211466864,1.058225393,-.348135948],'index-finger-phalanx-intermediate':[.230589658,1.075525403,-.332655281],'index-finger-phalanx-distal':[.221650437,1.067580581,-.353812724],'index-finger-tip':[.214657366,1.052579522,-.368889958]};
 const points=Object.fromEntries(Object.entries(xyz).map(([k,[x,y,z]])=>[k,{x,y,z}]));assert.equal(nearIndexSide(points),true);
 const {studio,calls,frame}=pinchRegressionHarness(points);studio.updateXR(100,frame);
 assert.equal(calls.filter(c=>c[0]==='begin').length,1);
});
test('fingertip drawing pinches cannot queue menu taps or switch silently into eraser',()=>{
 const points={'thumb-tip':{x:0,y:1,z:0},'index-finger-tip':{x:.015,y:1,z:0}};
 const {studio,calls,frame,buttons}=pinchRegressionHarness(points);
 buttons[9].pressed=true;studio.updateXR(100,frame);buttons[9].pressed=false;studio.updateXR(200,frame);
 buttons[9].pressed=true;studio.updateXR(350,frame);buttons[9].pressed=false;studio.updateXR(1000,frame);
 assert.equal(studio.mode,'draw');assert.equal(studio.xrPanel.mesh.visible,false);assert.equal(calls.filter(c=>c[0]==='begin').length,1);
});
test('native CAD Pen releases selection and consumes its menu pinch until the hand opens',()=>{
 const points={'thumb-tip':{x:0,y:1,z:0},'index-finger-tip':{x:.015,y:1,z:0}};
 const {studio,calls,frame,buttons,source}=pinchRegressionHarness(points);let selecting=true;
 studio.workspaceMode='native-cad';studio.mode='orbit';studio.nativeSelection={get active(){return selecting&&studio.mode==='orbit';},deactivate(){selecting=false;},pickRay(){throw Error('Pinch reached CAD selection');}};
 studio.xrPanelHit=()=>({uv:{x:(22+3*137+64)/720,y:1-40/450}});
 buttons[0].pressed=true;studio.updateXR(100,frame);assert.equal(studio.mode,'draw');assert.equal(selecting,false);assert.equal(studio.xrPanel.mesh.visible,false);assert.equal(calls.some(c=>c[0]==='begin'),false);
 studio.xrPanelHit=()=>null;buttons[0].pressed=false;studio.updateXR(120,frame);assert.equal(calls.some(c=>c[0]==='begin'),false);
 points['index-finger-tip'].x=.05;studio.updateXR(140,frame);points['index-finger-tip'].x=.015;studio.updateXR(160,frame);
 assert.equal(calls.filter(c=>c[0]==='begin').length,1);
});


test('right hand draws in view; left pinch selects without switching off the Pen',()=>{
 const points={'thumb-tip':{x:0,y:1,z:0},'index-finger-tip':{x:.015,y:1,z:0}};
 const {studio,calls,source,frame}=pinchRegressionHarness(points);let picked=0;
 studio.nativeSelection={pickXR(){picked++;}};
 frame.getPose=()=>({transform:transform(0,1,1)});
 source.handedness='left';studio.updateXR(100,frame);studio.updateXR(120,frame);
 assert.equal(picked,1);assert.equal(studio.mode,'draw');assert.ok(!calls.some(c=>c[0]==='begin'));
 points['index-finger-tip'].x=.05;studio.updateXR(140,frame);
 source.handedness='right';points['index-finger-tip'].x=.015;studio.updateXR(160,frame);
 assert.equal(calls.filter(c=>c[0]==='begin').length,1);
});

test('looking away ends ink and a held pinch cannot restart until released',()=>{
 const points={'thumb-tip':{x:0,y:1,z:0},'index-finger-tip':{x:.015,y:1,z:0}};
 const {studio,calls,frame}=pinchRegressionHarness(points);let looking=true;
 frame.getViewerPose=()=>({transform:{matrix:new Matrix4().makeRotationY(looking?0:Math.PI).setPosition(0,1.6,1).toArray()}});
 studio.updateXR(100,frame);assert.equal(calls.at(-1)[0],'begin');
 looking=false;studio.updateXR(120,frame);assert.equal(calls.at(-1)[0],'end');
 looking=true;studio.updateXR(140,frame);assert.equal(calls.filter(c=>c[0]==='begin').length,1);
 points['index-finger-tip'].x=.05;studio.updateXR(160,frame);points['index-finger-tip'].x=.015;studio.updateXR(180,frame);
 assert.equal(calls.filter(c=>c[0]==='begin').length,2);
});

test('head direction gate permits focused drawing with modest hysteresis and rejects missing tracking',()=>{
 const matrix=new Matrix4().toArray(),point=degrees=>[Math.sin(degrees*Math.PI/180),0,-Math.cos(degrees*Math.PI/180)];
 assert.equal(drawingInView(point(40),matrix),true);assert.equal(drawingInView(point(50),matrix),false);
 assert.equal(drawingInView(point(48),matrix,true),true);assert.equal(drawingInView(point(55),matrix,true),false);
 assert.equal(drawingInView([0,0,1],matrix),false);assert.equal(drawingInView(point(0),null),false);
 const {studio,calls,frame}=pinchRegressionHarness({'thumb-tip':{x:0,y:1,z:0},'index-finger-tip':{x:.015,y:1,z:0}});
 frame.getViewerPose=()=>null;studio.updateXR(100,frame);assert.ok(!calls.some(c=>c[0]==='begin'));
});

test('agent, question, construction and recovery panels stay world anchored until recenter',()=>{
 const {studio}=harness();studio.xrVoice={mesh:new Mesh()};studio.xrCreation={mesh:new Mesh()};studio.xrRecovery={mesh:new Mesh()};studio.agentQuestion={id:'q'};
 let matrix=new Matrix4().makeTranslation(0,1.6,0);const frame={getViewerPose:()=>({transform:{matrix:matrix.toArray()}})};
 studio.updateVoicePose(frame,100);
 const panels=[studio.xrVoice,studio.xrCreation,studio.xrQuestion,studio.xrRecovery],before=panels.map(p=>({position:p.mesh.position.clone(),rotation:p.mesh.quaternion.clone()}));
 matrix=new Matrix4().makeRotationY(Math.PI/2).setPosition(2,1.8,1);studio.updateVoicePose(frame,200);
 panels.forEach((p,i)=>{assert.ok(p.mesh.position.equals(before[i].position));assert.ok(p.mesh.quaternion.equals(before[i].rotation));});
 studio.xrHUDAnchor=null;studio.updateVoicePose(frame,300);assert.ok(studio.xrVoice.mesh.position.distanceTo(before[0].position)>1);
});


test('left pinch selects components and only a stable fist routes whole-body movement',()=>{
 let points=handPoints(false);const {studio,calls,source,frame}=pinchRegressionHarness(points);
 source.handedness='left';frame.getPose=()=>({transform:transform(0,1,1)});frame.getJointPose=k=>points[k]?{transform:transform(points[k].x,points[k].y,points[k].z)}:null;
 const routed=[];let picked=0;
 studio.nativeSelection={pickXR:()=>{picked++;return true;}};
 studio.objects={enabled:false,selectedIds:['body'],beginFrame(){},endFrame(){},startXRGrab:(key,pose)=>{routed.push(['start',key]);return true;},directInput:v=>routed.push(['input',v.pressed])};
 studio.updateXR(100,frame);studio.updateXR(140,frame);assert.equal(picked,1);assert.deepEqual(routed,[]);
 points=handPoints();studio.updateXR(180,frame);assert.deepEqual(routed,[]);
 studio.updateXR(300,frame);studio.updateXR(340,frame);points={};studio.updateXR(380,frame);
 assert.deepEqual(routed,[['start','left-hand'],['input',true],['input',true],['input',false]]);
 assert.ok(!calls.some(c=>c[0]==='begin'));assert.equal(studio.mode,'draw');
});

test('selecting an edge or a UI control never starts whole-body movement',()=>{
 for(const ui of [false,true]){
  const {studio,source,frame}=pinchRegressionHarness({'thumb-tip':{x:0,y:1,z:0},'index-finger-tip':{x:.015,y:1,z:0}});
  source.handedness='left';frame.getPose=()=>({transform:transform(0,1,1)});
  studio.nativeSelection={pickXR:()=>true,summary:()=>({body:false,edgeIndices:[1]})};
  studio.objects={enabled:false,beginFrame(){},endFrame(){},startXRGrab:()=>{throw Error('Unexpected body grab');}};
  if(ui)studio.xrPanelHit=()=>({questionPanel:true,questionOption:null});
  studio.updateXR(100,frame);
 }
});


test('fist detection rejects a pinch, open palm and incomplete tracking in any orientation',()=>{
 const closed=handPoints(true),open=handPoints(false);open['thumb-tip']={...open['index-finger-tip']};
 assert.equal(closedFist(closed),true);assert.equal(closedFist(open),false);
 delete closed['pinky-finger-tip'];assert.equal(closedFist(closed),null);
 const matrix=new Matrix4().makeRotationY(1.2).setPosition(3,1,-2),rotated=Object.fromEntries(Object.entries(handPoints(true)).map(([k,p])=>[k,new Vector3(p.x,p.y,p.z).applyMatrix4(matrix)]));
 assert.equal(closedFist(rotated),true);
});

test('a fist cannot select UI or queue thumb shortcuts even with a native pinch signal',()=>{
 const points=handPoints(true),{studio,calls,source,frame,buttons}=pinchRegressionHarness(points);source.handedness='left';
 studio.xrPanelHit=()=>({uv:{x:(22+64)/720,y:1-(326+38)/450}});
 buttons[0].pressed=true;buttons[9].pressed=true;studio.updateXR(100,frame);studio.updateXR(240,frame);
 assert.ok(!calls.some(c=>c[0]==='action'||c[0]==='begin'));assert.equal(studio.inputs.get('left-hand').pendingThumbTap,null);
});


test('a left fist delegates body acquisition to its physical grip pose',()=>{
 const points=handPoints(true),{studio,calls,source,frame}=pinchRegressionHarness(points);source.handedness='left';
 frame.getPose=()=>({transform:transform(0,1,1)});const selected=[],events=[];
 studio.nativeSelection={pickBodyXR:()=>{selected.push('body');events.push('pick-body');return true;},pickXR:()=>{throw Error('Fist reached component selection');}};
 studio.objects={enabled:false,selectedIds:selected,beginFrame(){},endFrame(){},startXRGrab:()=>{events.push('grab');return true;},directInput(){}};
 studio.updateXR(100,frame);studio.updateXR(220,frame);
 assert.deepEqual(events,['grab']);assert.ok(!calls.some(c=>c[0]==='begin'));
});


test('both information panels and the tool screen remain fixed when the menu reopens after a head turn',()=>{
 const {studio}=harness();studio.xrVoice={mesh:new Mesh()};studio.xrCreation={mesh:new Mesh()};studio.xrRecovery={mesh:new Mesh()};
 let matrix=new Matrix4().makeTranslation(0,1.6,0);const frame={getViewerPose:()=>({transform:{matrix:matrix.toArray()}})};
 studio.updateVoicePose(frame,100);studio.setXRMenuVisible(true,frame);const panels=[studio.xrVoice,studio.xrCreation,studio.xrPanel],positions=panels.map(p=>p.mesh.position.clone());
 matrix=new Matrix4().makeRotationY(1.2).setPosition(1,1.8,1);studio.setXRMenuVisible(false,frame);studio.setXRMenuVisible(true,frame);studio.updateVoicePose(frame,200);
 panels.forEach((p,i)=>assert.ok(p.mesh.position.equals(positions[i])));assert.equal(studio.xrCreation.mesh.visible,true);assert.ok(studio.xrVoice.mesh.position.z<-2);assert.ok(studio.xrCreation.mesh.position.z<-2);
});

test('preview acceptance gesture passes through the real XR loop once and consumes left selection',()=>{
 const {studio,calls}=harness();studio.liveShapes={canAccept:true,candidate:{kind:'cuboid'}};studio.endAll=()=>calls.push(['endAll']);studio.xrPanel.mesh.visible=false;
 const xyz={'thumb-tip':[0,.1,-.6],'middle-finger-tip':[.01,.1,-.6],'index-finger-tip':[.06,.16,-.6],'index-finger-phalanx-proximal':[.02,.04,-.6],wrist:[0,0,-.6]},source={handedness:'left',hand:new Map(Object.keys(xyz).map(n=>[n,n]))},frame={session:{inputSources:[source]},getPose:()=>null,getViewerPose:()=>({transform:transform(0,1,0)}),getJointPose:n=>xyz[n]?{transform:transform(...xyz[n]),radius:.005}:null};
 studio.updateXR(100,frame);studio.updateXR(650,frame);studio.updateXR(900,frame);assert.equal(calls.filter(c=>c[0]==='action'&&c[1]==='shape-accept').length,1);assert.equal(calls.filter(c=>c[0]==='begin').length,0);
});
test('right controller A can accept a preview while whole-body selection is enabled',()=>{
 const {studio,calls}=harness();studio.liveShapes={candidate:{kind:'cuboid'}};studio.endAll=()=>{};studio.objects={enabled:true,beginFrame:()=>{},endFrame:()=>{},input:()=>{}};studio.xrPanel.mesh.visible=false;
 const buttons=Array.from({length:6},()=>({pressed:false}));buttons[4].pressed=true;const source={handedness:'right',gripSpace:'grip',targetRaySpace:'ray',gamepad:{buttons,axes:[]}},frame={session:{inputSources:[source]},getPose:()=>({transform:transform(0,1,-.6)}),getViewerPose:()=>({transform:transform(0,1,0)})};studio.updateXR(100,frame);studio.updateXR(200,frame);assert.equal(calls.filter(c=>c[0]==='action'&&c[1]==='shape-accept').length,1);
});

test('controller pen marker matches its actual grip-offset drawing point and hides on tracking loss',()=>{const {studio,calls}=harness();studio.scene=new Group();studio.xrPanel.mesh.visible=false;const buttons=[{pressed:false},{pressed:false}],source={handedness:'right',gripSpace:'grip',targetRaySpace:'ray',gamepad:{buttons,axes:[]}},frame={session:{inputSources:[source]},getPose:()=>({transform:transform(.2,1,-.6)}),getViewerPose:()=>({transform:transform(0,1.25,0)})};studio.updateXR(100,frame);const tip=studio.xrPenTips.get('right-controller');assert.equal(tip.visible,true);buttons[1].pressed=true;studio.updateXR(200,frame);const begin=calls.find(c=>c[0]==='begin');assert.deepEqual(tip.position.toArray(),begin[2]);frame.session.inputSources=[];studio.updateXR(300,frame);assert.equal(tip.visible,false);});
test('finger pen marker uses the tracked pinch drawing point without requiring a pointing ray',()=>{const {studio,calls}=harness();studio.scene=new Group();studio.xrPanel.mesh.visible=false;const xyz={'thumb-tip':[.2,1,-.6],'index-finger-tip':[.22,1,-.6]},source={handedness:'right',hand:new Map(Object.keys(xyz).map(k=>[k,k]))},frame={session:{inputSources:[source]},getPose:()=>null,getJointPose:k=>xyz[k]?{transform:transform(...xyz[k]),radius:.005}:null,getViewerPose:()=>({transform:transform(0,1.25,0)})};studio.updateXR(100,frame);const tip=studio.xrPenTips.get('right-hand');assert.equal(tip.visible,true);assert.deepEqual(tip.position.toArray(),calls.find(c=>c[0]==='begin')[2]);});
test('pen marker does not display nonfinite or missing tracking',()=>{const {studio}=harness();studio.scene=new Group();studio.updateXRPenTip('right-hand',[.1,.2,.3],{visible:true});assert.deepEqual(studio.xrPenTips.get('right-hand').position.toArray(),[.1,.2,.3]);studio.updateXRPenTip('right-hand',[NaN,0,0],{visible:true});assert.equal(studio.xrPenTips.get('right-hand').visible,false);});

test('XR pen marker follows selected-surface projection rather than the raw controller position',()=>{const {studio}=harness();studio.scene=new Group();studio.xrPanel.mesh.visible=false;studio.surface={selected:{modelId:'body'},project:()=>[.25,1,-.5]};const source={handedness:'right',gripSpace:'grip',targetRaySpace:'ray',gamepad:{buttons:[{pressed:false},{pressed:false}],axes:[]}},frame={session:{inputSources:[source]},getPose:()=>({transform:transform(.2,1,-.6)}),getViewerPose:()=>({transform:transform(0,1.25,0)})};studio.updateXR(100,frame);assert.deepEqual(studio.xrPenTips.get('right-controller').position.toArray(),[.25,1,-.5]);});

test('grab-hand controller lower grip starts a direct body grab and release ends its held input without drawing',()=>{const {studio,calls}=harness(),grabs=[],held=[];studio.xrPanel.mesh.visible=false;studio.objects={enabled:false,beginFrame(){},endFrame(){},startXRGrab(key,pose){grabs.push([key,new Vector3().setFromMatrixPosition(pose).toArray()]);return true;},directInput(value){held.push(value.pressed);}};const source={handedness:'left',gripSpace:'grip',targetRaySpace:'ray',gamepad:{buttons:[{pressed:false},{pressed:true}],axes:[]}},frame={session:{inputSources:[source]},getPose:space=>space==='grip'?{transform:transform(0,1,-.4)}:null,getViewerPose:()=>({transform:transform(0,1,1)})};studio.updateXR(100,frame);source.gamepad.buttons[1].pressed=false;studio.updateXR(200,frame);assert.equal(grabs.length,1);assert.deepEqual(grabs[0],['left-controller',[0,1,-.4]]);assert.deepEqual(held,[true,false]);assert.equal(calls.some(c=>c[0]==='begin'),false);});
test('swapped draw hand draws with the left and the right pinch selects',()=>{const {studio,calls,source,frame}=pinchRegressionHarness({'thumb-tip':{x:0,y:1,z:0},'index-finger-tip':{x:.015,y:1,z:0}});studio.drawHand='left';let picked=0;studio.nativeSelection={pickXR(){picked++;}};frame.getPose=()=>({transform:transform(0,1,1)});source.handedness='right';studio.updateXR(100,frame);assert.equal(picked,1);assert.equal(calls.some(c=>c[0]==='begin'),false);source.handedness='left';studio.updateXR(200,frame);assert.equal(calls.filter(c=>c[0]==='begin').length,1);});

test('a grab-hand grip can enter a body while already held, and a panel hover does not block it',()=>{const {studio,calls}=harness(),attempts=[],held=[];studio.xrPanel.mesh.visible=false;studio.xrPanelHit=()=>({voicePanel:true,uv:new Vector2(.9,.9)});studio.voicePanelAction=()=>null;let inside=false;studio.objects={enabled:false,beginFrame(){},endFrame(){},startXRGrab(key,pose){attempts.push(key);return inside;},directInput(v){held.push(v.pressed&&!v.blocked);}};const source={handedness:'left',gripSpace:'grip',targetRaySpace:'ray',gamepad:{buttons:[{pressed:false},{pressed:true}],axes:[]}},frame={session:{inputSources:[source]},getPose:space=>space==='grip'?{transform:transform(0,1,-.4)}:null,getViewerPose:()=>({transform:transform(0,1,1)})};studio.updateXR(100,frame);inside=true;studio.updateXR(200,frame);studio.updateXR(270,frame);assert.equal(attempts.length,2);assert.deepEqual(held,[true]);assert.equal(calls.some(c=>c[0]==='begin'),false);});

test('a tracked draw hand that disappears cannot start fresh ink on return while still pinched',()=>{const points={'thumb-tip':{x:0,y:1,z:0},'index-finger-tip':{x:.015,y:1,z:0}},h=pinchRegressionHarness(points),{studio,calls,source,frame}=h;studio.updateXR(100,frame);assert.equal(calls.filter(c=>c[0]==='begin').length,1);frame.session.inputSources=[];studio.updateXR(120,frame);frame.session.inputSources=[source];studio.updateXR(140,frame);assert.equal(calls.filter(c=>c[0]==='begin').length,1);points['index-finger-tip'].x=.05;studio.updateXR(160,frame);points['index-finger-tip'].x=.015;studio.updateXR(180,frame);assert.equal(calls.filter(c=>c[0]==='begin').length,2);});
