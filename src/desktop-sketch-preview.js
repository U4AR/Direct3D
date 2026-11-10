import * as T from 'three';
import {fitDesktopSketch} from './desktop-sketch-fit.js';
// Immediate local feedback, distinct from committed AI geometry. Hidden with its source ink.
export function initDesktopSketchPreview({studio,store}){
 const group=new T.Group();group.name='Desktop fitted previews';studio.scene.add(group);const entries=new Map();
 const material=new T.LineBasicMaterial({color:0x35b6b1,transparent:true,opacity:.85,depthTest:false});
 function remove(id){const entry=entries.get(id);if(!entry)return;group.remove(entry.group);entry.group.children.forEach(l=>l.geometry.dispose());entries.delete(id);}
 function preview(s){if(s.hidden||s.points.length<2)return;try{const started=performance.now(),plane=s.drawingPlane||s.desktopSketchPlane||studio.desktopSketches?.catalog().find(k=>k.id===s.desktopSketchId)?.plane||studio.desktopPlane,fit=fitDesktopSketch([s],{plane});remove(s.id);const lines=new T.Group(),o=new T.Vector3(...fit.frame.origin),x=new T.Vector3(...fit.frame.xAxis),y=new T.Vector3(...fit.frame.yAxis);for(const path of fit.paths){const points=path.preview.map(p=>o.clone().addScaledVector(x,p[0]).addScaledVector(y,p[1]));const line=new T.Line(new T.BufferGeometry().setFromPoints(points),material);line.renderOrder=100;lines.add(line);}group.add(lines);entries.set(s.id,{group:lines,fit});requestAnimationFrame(()=>{const ms=performance.now()-started;api.lastTiming={strokeId:s.id,previewMs:Math.round(ms),fitMs:fit.elapsedMs,source:'local-preview',targetMs:2000};window.dispatchEvent(new CustomEvent('draw3d-sketch-preview',{detail:api.lastTiming}));});}catch(error){console.warn('Sketch preview:',error.message);}}
 const completed=studio.strokeWorkflow.completed;studio.strokeWorkflow.completed=s=>{s.desktopSketchPlane=structuredClone(studio.desktopSketches?.catalog().find(k=>k.id===s.desktopSketchId)?.plane||studio.desktopPlane);preview(s);completed(s);};
 const timer=setInterval(()=>{const ids=new Set(store.session.strokes.filter(s=>!s.hidden).map(s=>s.id));for(const id of entries.keys())if(!ids.has(id))remove(id);},100);
 const api={get fits(){return [...entries.values()].map(e=>e.fit);},lastTiming:null};studio.desktopSketchPreview=api;
 window.addEventListener('pagehide',()=>{clearInterval(timer);for(const id of entries.keys())remove(id);material.dispose();},{once:true});for(const s of store.session.strokes.filter(s=>!s.hidden))preview(s);return api;
}
