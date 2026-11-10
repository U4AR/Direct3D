import { analyzePCA, fitPrimitive } from "./primitive-fitting.js";
import { sketchReference, publicReference } from "./sketch-reference.js";

export function selectedSketchPoints(strokes, { strokeIds, ranges } = {}) {
  const selected = strokeIds ? strokes.filter(s => strokeIds.includes(s.id)) : strokes.filter(s => !s.hidden);
  sketchReference(selected, strokeIds);
  if (ranges?.some(r => !selected.some(s => s.id === r.strokeId))) throw Error("Range outside selected strokes");
  const samples = [];
  for (const stroke of selected) {
    const segments = ranges ? ranges.filter(r => r.strokeId === stroke.id) : [{start:0,end:stroke.points.length-1}];
    for (const r of segments) {
      if (!Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end < r.start || r.end >= stroke.points.length) throw Error("Invalid inclusive sample range");
      for (let index=r.start;index<=r.end;index++) samples.push({strokeId:stroke.id,index,position:stroke.points[index]});
    }
  }
  if (samples.length < 3) throw Error("Select at least three points for shape analysis");
  return {samples,points:samples.map(s=>s.position),reference:publicReference(sketchReference(selected,strokeIds))};
}
export function sketchAnalysis(strokes, tool, args) {
  const selection=selectedSketchPoints(strokes,args);
  const provenance={sketchRevision:selection.reference.revision,strokeIds:selection.reference.strokeIds,units:"metres",up:"Y"};
  if(tool === "sketch_pca") return {...provenance,...analyzePCA(selection.points),note:"Principal directions describe point distribution, not semantic orientation. Signs and near-equal eigenvalues are ambiguous."};
  if(tool === "sketch_fit_primitive") {
    const fit=fitPrimitive(selection.points,args);
    return {...provenance,...fit,inlierSamples:fit.inlierIndices?.map(i=>({strokeId:selection.samples[i].strokeId,pointIndex:selection.samples[i].index}))};
  }
  if(tool !== "sketch_regions") throw Error("Unknown sketch analysis tool");
  const regions=[];
  for(const id of selection.reference.strokeIds) {
    const samples=selection.samples.filter(s=>s.strokeId===id);
    if(samples.length<3) continue;
    const points=samples.map(s=>s.position);
    const closureGapMetres=Math.hypot(...points[0].map((x,i)=>x-points.at(-1)[i]));
    let pca,plane,warning;
    try {pca=analyzePCA(points);plane=fitPrimitive(points,{kind:"plane",thresholdMetres:args.thresholdMetres||0.005});} catch(e) {warning=e.message;}
    regions.push({id:"stroke-"+id,strokeIds:[id],ranges:[{strokeId:id,start:samples[0].index,end:samples.at(-1).index}],pointCount:points.length,closureGapMetres,pca,plane,warning});
  }
  return {...provenance,regions,note:"One candidate per pen stroke, not semantic segmentation. Use the images and fit residuals to group contours or split an individual stroke with sketch_project.ranges. Fit samples include the original stroke IDs and point indices."};
}
