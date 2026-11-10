import {Vector3,Matrix4,Quaternion} from 'three';
const v=p=>new Vector3(p.x,p.y,p.z);
const get=(points,name)=>{const p=points[name];return p&&[p.x,p.y,p.z].every(Number.isFinite)?v(p):null;};
export const BOARD_TOP=[0,.7175,-.6];
// Hand bones are above the contact surface. This estimates a tabletop, not
// physical contact detection; require BOTH downward, open, coplanar hands.
export function flatPalm(points,handedness){
 if(!['left','right'].includes(handedness))return null;
 const wrist=get(points,'wrist'),index=get(points,'index-finger-phalanx-proximal'),middle=get(points,'middle-finger-phalanx-proximal'),little=get(points,'pinky-finger-phalanx-proximal');
 if(!wrist||!index||!middle||!little)return null;
 const forward=middle.clone().sub(wrist),across=little.clone().sub(index);
 if(forward.length()<.025||across.length()<.025)return null;
 const down=forward.clone().cross(across).normalize().multiplyScalar(handedness==='left'?-1:1);
 if(down.y>-.85)return null;
 const center=wrist.clone().add(index).add(middle).add(little).multiplyScalar(.25),normal=down.clone().negate();
 for(const finger of ['index-finger','middle-finger','ring-finger','pinky-finger']){
  const chain=['phalanx-proximal','phalanx-intermediate','phalanx-distal','tip'].map(n=>get(points,finger+'-'+n));
  if(chain.some(p=>!p))return null;
  const lengths=chain.slice(1).map((p,i)=>p.distanceTo(chain[i]));
  if(chain[0].distanceTo(chain[3])<lengths.reduce((a,b)=>a+b,0)*.94)return null;
  if(chain[3].clone().sub(chain[0]).normalize().dot(forward.clone().normalize())<.75)return null;
  if(chain.some(p=>Math.abs(p.clone().sub(center).dot(normal))>.014))return null;
 }
 return {center:center.addScaledVector(normal,-.008),normal};
}
export function flatPalmPair(hands){
 if(!hands.left||!hands.right)return null;
 const a=flatPalm(hands.left,'left'),b=flatPalm(hands.right,'right');if(!a||!b)return null;
 const distance=a.center.distanceTo(b.center),normal=a.normal.clone().add(b.normal).normalize();
 if(distance<.12||distance>.75||a.normal.dot(b.normal)<.96||Math.abs(a.center.clone().sub(b.center).dot(normal))>.025)return null;
 return {center:a.center.clone().add(b.center).multiplyScalar(.5),normal};
}
export class PalmCalibrationHold{
 reset(){this.anchor=null;this.started=undefined;this.last=undefined;this.latched=false;this.released=undefined;}
 constructor(){this.reset();}
 update(hands,time){
  const pair=flatPalmPair(hands);
  if(!pair){this.anchor=null;this.started=undefined;this.released??=time;if(time-this.released>=600)this.latched=false;this.last=time;return {progress:0};}
  this.released=undefined;
  if(this.latched){this.last=time;return {progress:0};}
  if(!this.anchor||time-(this.last??time)>150||this.anchor.center.distanceTo(pair.center)>.015||this.anchor.normal.dot(pair.normal)<.99){this.anchor=pair;this.started=time;}
  this.last=time;const progress=Math.min(1,(time-this.started)/1400);
  if(progress<1)return {progress};
  this.latched=true;return {progress:1,calibration:this.anchor};
 }
}
// Offset reference-space origin = desired real board pose * inverse virtual
// board pose. All rendering/input uses it, keeping stored geometry in metres.
export function boardReferenceTransform(center,normal,head){
 // Palm tracking supplies height and centre; gravity supplies level orientation.
 const up=new Vector3(0,1,0),z=head.clone().sub(center).projectOnPlane(up).normalize();
 if(z.lengthSq()<.5)z.set(0,0,1).projectOnPlane(up).normalize();
 const x=up.clone().cross(z).normalize();z.crossVectors(x,up).normalize();
 const rotation=new Matrix4().makeBasis(x,up,z),orientation=new Quaternion().setFromRotationMatrix(rotation);
 const position=center.clone().sub(new Vector3(...BOARD_TOP).applyQuaternion(orientation));
 return {position,orientation};
}
export function boardInFront(headMatrix){
 const head=new Vector3().setFromMatrixPosition(headMatrix),forward=new Vector3(0,0,-1).transformDirection(headMatrix);forward.y=0;if(forward.lengthSq()<.01)forward.set(0,0,-1);
 const center=head.clone().addScaledVector(forward.normalize(),.65);center.y=Math.max(.45,Math.min(1.25,head.y-.6));return {center,normal:new Vector3(0,1,0),head};
}
export function recoveryAction(uv){if(!uv)return null;const x=uv.x*600,y=(1-uv.y)*108;if(y<8||y>100)return null;return x>=8&&x<=194?'menu-recover':x>=207&&x<=393?'board-recenter':x>=406&&x<=592?'exit-vr':null;}

// Near interaction works even if Quest has no usable hand target ray/profile.
// Only returns a hover; the normal pinch edge still confirms activation.
export function nearHandPanelHit(mesh,point){
 if(!mesh?.visible||!point)return null;
 mesh.updateWorldMatrix(true,false);
 const local=mesh.worldToLocal(point.clone()),width=mesh.geometry.parameters.width,height=mesh.geometry.parameters.height;
 const scale=new Vector3();mesh.getWorldScale(scale);
 if(Math.abs(local.z*scale.z)>.055||Math.abs(local.x)>width/2||Math.abs(local.y)>height/2)return null;
 const contact=mesh.localToWorld(new Vector3(local.x,local.y,0));
 return {point:contact,uv:{x:local.x/width+.5,y:local.y/height+.5},distance:contact.distanceTo(point),nearHandPoint:point};
}

// Index joint centre is above the skin. Hysteresis prevents contact chatter.
export function tableContact(point, radius=.008, held=false, height=BOARD_TOP[1]) {
 if(!point || ![point.x,point.y,point.z].every(Number.isFinite))return null;
 const gap=point.y-height-Math.max(.003,Math.min(.015,radius||.008));
 if(gap < -.025 || gap > (held?.018:.008))return null;
 return [point.x,height,point.z];
}
