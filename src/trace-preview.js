const scaleFor = {mm:1000, cm:100, m:1, inch:1/.0254};
export function sampleTraceObjects(objects, units) {
  const scale=scaleFor[units];
  return objects.map(o => {
    if(o.objectKind==="line") return [[o.x1,o.y1],[o.x2,o.y2]].map(p=>p.map(v=>v/scale));
    if(o.objectKind==="rectangle") {
      const x=o.centerX,y=o.centerY,w=o.width/2,h=o.height/2;
      return [[x-w,y-h],[x+w,y-h],[x+w,y+h],[x-w,y+h],[x-w,y-h]].map(p=>p.map(v=>v/scale));
    }
    if(o.objectKind==="circle") return Array.from({length:129},(_,i)=>[o.centerX+o.radius*Math.cos(i*Math.PI/64),o.centerY+o.radius*Math.sin(i*Math.PI/64)].map(v=>v/scale));
    return o.segments.flatMap(({points:p},index)=>Array.from({length:33},(_,i)=>{
      const t=i/32,s=1-t;
      return [0,1].map(a=>(s*s*s*p[a]+3*s*s*t*p[a+2]+3*s*t*t*p[a+4]+t*t*t*p[a+6])/scale);
    }).filter((_,i)=>i===0||i%33!==0));
  });
}
function distance(point, paths) {
  let best=Infinity;
  for(const path of paths) for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy;
    const t=l?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/l)):0;
    best=Math.min(best,Math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy));
  }
  return best;
}
export function traceDiagnostics(source, paths) {
  const stride=Math.max(1,Math.ceil(source.length/2048));
  const samples=source.filter((_,i)=>i%stride===0||i===source.length-1);
  const errors=samples.map(p=>distance(p,paths));
  const fitted=paths.flat(),step=Math.max(1,Math.ceil(fitted.length/2048));
  const reverse=fitted.filter((_,i)=>i%step===0).map(p=>distance(p,[source]));
  return {rmsMetres:Math.sqrt(errors.reduce((a,b)=>a+b*b,0)/errors.length),maxMetres:Math.max(...errors),reverseMaxMetres:Math.max(...reverse),sampleCount:samples.length,closureGapMetres:Math.hypot(source[0][0]-source.at(-1)[0],source[0][1]-source.at(-1)[1]),method:"Sampled source-to-curve and curve-to-source distances; not an exact Hausdorff bound"};
}
export function drawTracePreview(canvas, projection, trace) {
  const ctx=canvas.getContext("2d"),all=[...projection.paths.flatMap(p=>p.points),...trace.previewPaths.flat()];
  const min=[0,1].map(a=>all.reduce((v,p)=>Math.min(v,p[a]),Infinity));
  const max=[0,1].map(a=>all.reduce((v,p)=>Math.max(v,p[a]),-Infinity));
  const scale=640/Math.max(.001,max[0]-min[0],max[1]-min[1]);
  const pixel=p=>[64+(p[0]-min[0])*scale,700-(p[1]-min[1])*scale];
  ctx.fillStyle="#101923";ctx.fillRect(0,0,768,768);
  for(const [paths,color,width] of [[projection.paths.map(p=>p.points),"#8392a5",2],[trace.previewPaths,"#bcf477",3]]) {
    ctx.strokeStyle=color;ctx.lineWidth=width;
    for(const points of paths){ctx.beginPath();points.forEach((p,i)=>ctx[i?"lineTo":"moveTo"](...pixel(p)));ctx.stroke();}
  }
  ctx.fillStyle="#fff";ctx.font="18px sans-serif";ctx.fillText("Clean 2D profile: green | original stroke: grey",18,28);
  ctx.font="15px sans-serif";ctx.fillText(`${trace.kind} | ${trace.entityCount} editable entities | coordinates in metres`,18,739);
  return {planeMin:min,planeMax:max,pixelsPerMetre:scale,pixelOrigin:[64,700],vAxis:"up"};
}
