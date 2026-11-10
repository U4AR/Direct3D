import {fitDesktopSketch} from '../src/desktop-sketch-fit.js';

// Geometric measurements, never a shape classification. Bound work/context while
// keeping corners and curved runs in the same coordinate frame used for authoring.
export function desktopInkReference(e,s){
 const plane=s.plane||e.frames.find(f=>f.layer==='stroke'&&f.strokeIds?.includes(s.id))?.imageReference?.sketchPlane||e.desktopView?.plane||e.defaultPlane;
 if(!plane||s.points?.length<2)return undefined;
 try{
  const f=fitDesktopSketch([s],{plane,kind:'mixed',maxSegments:Math.min(24,Math.max(6,Math.floor(64/Math.min(8,e.strokes.length||1))))}),p=f.paths[0];
  return {frame:f.frame,bounds:p.bounds,closed:p.closed,segments:p.segments.map(s=>s.coordinates),encoding:'Plane UV metres: 4 numbers = straight endpoints; 8 = cubic controls. Measured reference only; redraw intended features rather than copy these segments.'};
 }catch{return {unavailable:true,note:'Use original image; project_sketch can request another support.'};}
}
