import {sketchFrame} from '../src/desktop-sketch-fit.js';
import {bounds} from '../src/decision-sketch/math.js';
export function validateEditContext(data){
 const c=data.editContext;if(!c)return;if(!['drawing','cad'].includes(c.mode)||c.targetStrokeIds&&!Array.isArray(c.targetStrokeIds))throw Error('Invalid drawing edit context');const f=c.targetFigure;if(!f)return;
 if(c.mode!=='cad'||typeof f.id!=='string'||f.id.length>160||!Number.isInteger(f.version)||f.version<1||!['circle','rectangle','line','arc','spline'].includes(f.kind))throw Error('Invalid selected CAD figure');sketchFrame(f);
 const positive=n=>Number.isFinite(n)&&n>0&&n<=100,vec=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
 if(['circle','arc'].includes(f.kind)&&!positive(f.radiusMetres)||f.kind==='rectangle'&&(!positive(f.widthMetres)||!positive(f.heightMetres))||f.kind==='line'&&!vec(f.end)||f.kind==='spline'&&(!Array.isArray(f.segments)||!f.segments.length||f.segments.length>64||f.segments.some(s=>s.length!==8||!s.every(Number.isFinite))))throw Error('Selected figure has invalid geometry');
 if(!data.references?.some(r=>r.id===f.id))throw Error('Selected CAD figure needs its reference image/path');
}
export function editTargetQuestion(data,groups){
 const c=data.editContext,f=c?.mode==='cad'&&c.targetFigure;if(!f)return [];
 return [{type:'choice',name:'edit_selected_drawing',instructions:'The user selected '+(f.name||f.kind)+' ['+f.id+'] for editing. Inspect editContext, selectedComponent, new ink and the existing target reference. Choose replacement only when a group redraws the WHOLE intended outline of this selected figure. Preserve the selected figure identity. A small local detail, connecting stroke or new hole should be an added feature, never a shrunken replacement of the whole figure. Choose independent if the user is making a separate part. Current explicit user instructions take priority. Other existing figures stay unchanged.',choices:[{value:'add_detail',description:'Add new editable detail(s) to the selected drawing; preserve its existing outline.'},{value:'independent',description:'Create a separate new figure, as requested.'},...groups.slice(0,8).map(g=>({value:'replace_'+g.id,description:'Group '+g.id+' redraws the complete selected outline: update that same figure.'}))]}];
}
export function selectedDrawingEdits(data,results,edits,response){
 const target=data.editContext?.targetFigure,answer=response.answers.find(a=>a.name==='edit_selected_drawing')?.choice;
 if(!target||!answer?.startsWith('replace_'))return;
 const id=answer.slice(8),index=results.findIndex(r=>r.id===id);if(index<0)return;const r=results[index],frame=sketchFrame(target),ref=data.references.find(f=>f.id===target.id),local=p=>[frame.xAxis,frame.yAxis].map(a=>a.reduce((s,v,k)=>s+v*(p[k]-frame.origin[k]),0)),a=bounds(ref.points.map(local)),b=bounds(r.pathWorld.map(local)),ratio=b.span/a.span,closed=['circle','rectangle'].includes(target.kind)||target.kind==='spline'&&!!target.closed;
 if(Math.abs(r.frame.normal.reduce((s,v,k)=>s+v*frame.normal[k],0))<.999||closed!==!!r.constraints.closed||ratio<.6||ratio>1.65||Math.hypot(...a.center.map((v,k)=>v-b.center[k]))>a.span*.4){r.warnings.push('Kept new geometry separate: it does not cover the selected outline on the same plane.');return;}
 Object.assign(edits[index],{operation:'update',figureId:target.id,expectedVersion:target.version,planeId:target.planeId??frame.id,name:target.name||edits[index].name});
 r.editedFigureId=target.id;r.editedFigureVersion=target.version;r.interpretation={mode:'edit',label:'Edit '+(target.name||target.kind)};
}
