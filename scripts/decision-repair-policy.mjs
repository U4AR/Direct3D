// Repair is a local correction, not permission to redesign the whole outline.
// Keep this attached to stroke lineage so a joined chain cannot lose the policy.
export function repairGroupContext(group,data){
 const c=data.editContext,ids=group.strokes.map(s=>s.id),erased=group.strokes.some(s=>s.intentionallyOpen||s.erasedFrom),selected=ids.some(id=>c?.targetStrokeIds?.includes(id));
 if(!erased&&!selected&&!c?.targetFigure)return null;
 return {groupId:group.id,sourceStrokeIds:ids,reason:erased?'Repair of deliberately erased/open ink':selected?'Editing a selected drawing':'Editing an existing CAD figure',default:'Preserve asymmetric outline and untouched portions. Do not introduce reflection, equal-size or mirrored-placement constraints merely to regularize a repair.'};
}
export function repairSymmetryQuestions(groups,data){
 if(!data.prompt?.trim())return [];
 return groups.filter(g=>repairGroupContext(g,data)).map(g=>({type:'choice',name:g.id+'.repair_symmetry_permission',instructions:'This is a repair/edit. Does the CURRENT explicit user instruction request imposing NEW reflection symmetry on this outline? A request to repair, close a gap, smooth an edge or clean up drawing is not a symmetry request. Shape resemblance, measured reflection scores and another component being symmetric are not authorization. Choose preserve unless the user explicitly asks to make this outline symmetric or mirrored. User instruction: '+data.prompt,choices:[{value:'preserve',description:'Preserve existing asymmetry; make only the requested repair.'},{value:'requested',description:'The current user instruction explicitly requests new reflection symmetry.'}]}));
}
export function repairAlignmentQuestions(groups,data){
 if(!data.prompt?.trim())return [];
 return groups.filter(g=>repairGroupContext(g,data)).map(g=>({type:'choice',name:g.id+'.repair_alignment_permission',instructions:'This is a local repair/edit. Does the CURRENT user instruction explicitly ask to realign the WHOLE outline to horizontal/vertical/common-angle axes? A local replacement, smoothing or closure may intentionally slope or depart from an earlier regularity. Preserve placement/orientation and untouched portions unless whole-outline alignment is explicitly requested. User instruction: '+data.prompt,choices:[{value:'preserve',description:'Local edit: keep the existing placement and orientation; no global axis snapping.'},{value:'requested',description:'The user explicitly asks for whole-outline axis alignment.'}]}));
}
export function repairSymmetryPolicy(group,data,response){
 const context=repairGroupContext(group,data);if(!context)return {repair:false};
 const manual=['one','both'].includes(data.options?.symmetry),requested=!!data.prompt?.trim()&&response.answers.some(a=>a.type==='choice'&&a.name===group.id+'.repair_symmetry_permission'&&a.choice==='requested');
 const alignRequested=!!data.prompt?.trim()&&response.answers.some(a=>a.type==='choice'&&a.name===group.id+'.repair_alignment_permission'&&a.choice==='requested');
 return {repair:true,preserveAsymmetry:!manual&&!requested,preservePlacement:!alignRequested,authorization:manual?'Explicit symmetry control':requested?'Explicit user instruction':'Local repair only',...context};
}
