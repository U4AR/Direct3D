/** All times use the recording's monotonic millisecond clock. */
export function speechStrokeContext(detail,strokes,view,now){
 const end=Number.isFinite(detail.end)?detail.end:now;
 const start=Number.isFinite(detail.start)?Math.min(detail.start,end):end;
 const available=strokes.filter(s=>!s.hidden&&Number.isFinite(s.started)&&s.started<=end);
 const finish=s=>Number.isFinite(s.ended)?s.ended:end;
 let matches=available.filter(s=>finish(s)>=start);
 // VAD hangover can overlap the first few milliseconds of the next mark.
 // Keep quick taps when they actually occur during the utterance.
 const substantial=matches.filter(s=>{
  const overlap=Math.min(end,finish(s))-Math.max(start,s.started);
  return overlap>=Math.min(160,Math.max(1,finish(s)-s.started)*.4);
 });
 if(substantial.length)matches=substantial;
 let relation='overlap';
 if(matches.length&&matches.every(s=>s.started>start)){
  const first=matches.reduce((a,b)=>a.started<b.started?a:b);
  const prior=available.filter(s=>finish(s)<start&&start-finish(s)<=900&&s.desktopSketchId===first.desktopSketchId)
   .sort((a,b)=>finish(b)-finish(a))[0];
  if(prior)matches.push(prior);
 }
 if(!matches.length){
  relation='preceding';
  const recent=available.filter(s=>start-finish(s)<=8000).sort((a,b)=>finish(b)-finish(a));
  if(recent.length){
   matches=[recent[0]];
   for(const s of recent.slice(1)){
    const last=matches.at(-1);
    if(last.started-finish(s)>1600||s.desktopSketchId!==last.desktopSketchId)break;
    matches.push(s);
   }
  }
 }
 const strokeIds=matches.sort((a,b)=>a.started-b.started).slice(-32).map(s=>s.id);
 return {audioId:detail.id,start,end,strokeIds,relation:strokeIds.length?relation:'none',view};
}
export function speechFigureIds(input,figures,decisions){
 const ids=new Set(input.strokeIds);
 const linked=new Set(decisions.filter(d=>d.sourceStrokeIds?.some(id=>ids.has(id))).map(d=>d.figureId));
 if(!ids.size&&input.selectedFigureId)linked.add(input.selectedFigureId);
 return figures.filter(f=>!f.hidden&&(linked.has(f.id)||f.strokeIds?.some(id=>ids.has(id)))).map(f=>f.id);
}
